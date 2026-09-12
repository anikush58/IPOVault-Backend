import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import {
  DeliveryStatus,
  NotificationDeliveryWorkerConfig,
} from './notification.types';

export interface WorkerBatchResult {
  status: 'COMPLETED' | 'SKIPPED_OVERLAP' | 'FAILED';
  staleRecoveredCount: number;
  candidatesFound: number;
  pendingProcessedCount: number;
  failedRetryProcessedCount: number;
  claimedCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  exhaustedCount: number;
  itemErrorCount: number;
  durationMs: number;
  error?: string;
}

export const DEFAULT_WORKER_CONFIG: NotificationDeliveryWorkerConfig = {
  enabled: true,
  batchSize: 50,
  intervalMs: 10_000,
  staleLeaseTimeoutMs: 300_000, // 5 minutes
};

export function sanitizeWorkerConfig(
  configService?: ConfigService,
): NotificationDeliveryWorkerConfig {
  let enabled = DEFAULT_WORKER_CONFIG.enabled;
  if (configService) {
    const rawEnabled = configService.get<unknown>('NOTIFICATION_WORKER_ENABLED');
    if (typeof rawEnabled === 'boolean') {
      enabled = rawEnabled;
    } else if (typeof rawEnabled === 'string') {
      const lower = rawEnabled.trim().toLowerCase();
      enabled = lower !== 'false' && lower !== '0';
    }
  }

  const rawBatchSize = configService
    ? Number(configService.get<unknown>('NOTIFICATION_WORKER_BATCH_SIZE'))
    : NaN;
  const batchSize =
    !isNaN(rawBatchSize) && rawBatchSize >= 1
      ? Math.floor(rawBatchSize)
      : DEFAULT_WORKER_CONFIG.batchSize;

  const rawInterval = configService
    ? Number(configService.get<unknown>('NOTIFICATION_WORKER_INTERVAL_MS'))
    : NaN;
  const intervalMs =
    !isNaN(rawInterval) && rawInterval >= 100
      ? Math.floor(rawInterval)
      : DEFAULT_WORKER_CONFIG.intervalMs;

  const rawStaleTimeout = configService
    ? Number(configService.get<unknown>('NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS'))
    : NaN;
  const staleLeaseTimeoutMs =
    !isNaN(rawStaleTimeout) && rawStaleTimeout >= 1000
      ? Math.floor(rawStaleTimeout)
      : DEFAULT_WORKER_CONFIG.staleLeaseTimeoutMs;

  return {
    enabled,
    batchSize,
    intervalMs,
    staleLeaseTimeoutMs,
  };
}

/**
 * NotificationDeliveryWorkerService
 *
 * Responsibilities:
 *   - Bounded batch querying of eligible deliveries.
 *   - Atomic claim execution reuse via NotificationDeliveryService/Repository.
 *   - Stale PROCESSING lease recovery (atomic lease timeout).
 *   - Overlap protection via in-flight execution guard.
 *   - Failure isolation per delivery item — errors never break batch or worker process.
 *   - Structured operational metrics & logging (zero PAN, panHash, or sensitive payload leakage).
 *   - Configuration sanitization and validation.
 *
 * Does NOT:
 *   - Generate notifications.
 *   - Evaluate user preferences.
 *   - Inspect PAN, panHash, panEncrypted, or identifierHash.
 *   - Implement external provider SDK logic.
 *   - Bypass Phase 29.5 state machine or claim invariants.
 */
@Injectable()
export class NotificationDeliveryWorkerService {
  private readonly logger = new Logger(NotificationDeliveryWorkerService.name);
  private isProcessing = false;
  private readonly config: NotificationDeliveryWorkerConfig;

  constructor(
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly deliveryService: NotificationDeliveryService,
    private readonly retryPolicy: NotificationDeliveryRetryPolicy,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.config = sanitizeWorkerConfig(this.configService);
  }

  getConfig(): NotificationDeliveryWorkerConfig {
    return { ...this.config };
  }

  /**
   * Returns whether the worker is currently executing a batch (in-flight guard state).
   */
  isInFlight(): boolean {
    return this.isProcessing;
  }

  /**
   * Main entry point for a worker batch iteration.
   * Executed periodically by NotificationDeliverySchedulerService or programmatically in tests.
   */
  async processBatch(): Promise<WorkerBatchResult> {
    if (!this.config.enabled) {
      this.logger.debug('Notification delivery worker is disabled by configuration');
      return {
        status: 'COMPLETED',
        staleRecoveredCount: 0,
        candidatesFound: 0,
        pendingProcessedCount: 0,
        failedRetryProcessedCount: 0,
        claimedCount: 0,
        processedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        skippedCount: 0,
        exhaustedCount: 0,
        itemErrorCount: 0,
        durationMs: 0,
      };
    }

    if (this.isProcessing) {
      this.logger.warn('Worker iteration skipped: previous delivery batch is still in flight');
      return {
        status: 'SKIPPED_OVERLAP',
        staleRecoveredCount: 0,
        candidatesFound: 0,
        pendingProcessedCount: 0,
        failedRetryProcessedCount: 0,
        claimedCount: 0,
        processedCount: 0,
        succeededCount: 0,
        failedCount: 0,
        skippedCount: 0,
        exhaustedCount: 0,
        itemErrorCount: 0,
        durationMs: 0,
      };
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let staleRecoveredCount = 0;
    let candidatesFound = 0;
    let pendingProcessedCount = 0;
    let failedRetryProcessedCount = 0;
    let claimedCount = 0;
    let processedCount = 0;
    let succeededCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let exhaustedCount = 0;
    let itemErrorCount = 0;

    try {
      this.logger.log(`Worker batch starting: batchSize=${this.config.batchSize}`);

      // 1. Recover stale PROCESSING deliveries older than staleLeaseTimeoutMs
      const staleThreshold = new Date(Date.now() - this.config.staleLeaseTimeoutMs);
      staleRecoveredCount = await this.deliveryRepository.recoverStaleDeliveries(staleThreshold);

      // 2. Query bounded candidate set (filtering out exhausted FAILED deliveries in DB)
      const retryConfig = this.retryPolicy.getConfig();
      const candidates = await this.deliveryRepository.findEligibleDeliveries(
        this.config.batchSize,
        retryConfig.maxAttempts,
      );
      candidatesFound = candidates.length;

      this.logger.debug(`Eligible delivery candidates found: count=${candidatesFound}`);

      // 3. Process candidate items independently
      const now = new Date();

      for (const candidate of candidates) {
        const { delivery, notification } = candidate;

        // Check if delivery is exhausted by attempt count
        if (this.retryPolicy.isExhausted(delivery)) {
          exhaustedCount++;
          this.logger.debug(
            `Delivery attempt exhausted: deliveryId=${delivery.id} notificationId=${notification.id} attempts=${delivery.attemptCount}`,
          );
          continue;
        }

        // Check retry eligibility (backoff timing)
        if (!this.retryPolicy.isEligibleForRetry(delivery, now)) {
          skippedCount++;
          this.logger.debug(
            `Delivery retry not yet eligible (backoff): deliveryId=${delivery.id} notificationId=${notification.id} status=${delivery.status}`,
          );
          continue;
        }

        // Process single candidate item with isolated failure boundary
        processedCount++;
        if (delivery.status === DeliveryStatus.PENDING) {
          pendingProcessedCount++;
        } else if (delivery.status === DeliveryStatus.FAILED) {
          failedRetryProcessedCount++;
        }

        try {
          if (delivery.status === DeliveryStatus.PENDING) {
            await this.deliveryService.initDelivery(notification, delivery.channel);
          } else if (delivery.status === DeliveryStatus.FAILED) {
            await this.deliveryService.retryDelivery(
              delivery.notificationId,
              delivery.channel,
              notification,
            );
          }

          // Inspect updated delivery state for metric accounting
          const updated = await this.deliveryRepository.findDeliveryById(delivery.id);
          if (updated?.status === DeliveryStatus.DELIVERED) {
            succeededCount++;
            claimedCount++;
            this.logger.log(
              `Worker processed delivery: deliveryId=${delivery.id} channel=${delivery.channel} outcome=DELIVERED`,
            );
          } else {
            failedCount++;
            if (updated?.status === DeliveryStatus.PROCESSING || updated?.attemptCount! > delivery.attemptCount) {
              claimedCount++;
            }
            this.logger.warn(
              `Worker processed delivery: deliveryId=${delivery.id} channel=${delivery.channel} outcome=FAILED reason=${updated?.failureReason ?? 'unknown'}`,
            );
          }
        } catch (itemErr: unknown) {
          failedCount++;
          itemErrorCount++;
          this.logger.error(
            `Worker item failure (isolated): deliveryId=${delivery.id} channel=${delivery.channel} — ${(itemErr as Error).message}`,
            (itemErr as Error).stack,
          );
          // Isolated item failure — loop continues for remaining batch items
        }
      }

      const durationMs = Date.now() - startTime;
      this.logger.log(
        `Worker batch completed: candidates=${candidatesFound} pending=${pendingProcessedCount} failedRetry=${failedRetryProcessedCount} claimed=${claimedCount} succeeded=${succeededCount} failed=${failedCount} skipped=${skippedCount} exhausted=${exhaustedCount} staleRecovered=${staleRecoveredCount} itemErrors=${itemErrorCount} durationMs=${durationMs}`,
      );

      return {
        status: 'COMPLETED',
        staleRecoveredCount,
        candidatesFound,
        pendingProcessedCount,
        failedRetryProcessedCount,
        claimedCount,
        processedCount,
        succeededCount,
        failedCount,
        skippedCount,
        exhaustedCount,
        itemErrorCount,
        durationMs,
      };
    } catch (batchErr: unknown) {
      const durationMs = Date.now() - startTime;
      const errorMessage = (batchErr as Error).message;
      this.logger.error(
        `Worker batch unexpected error (contained): ${errorMessage}`,
        (batchErr as Error).stack,
      );

      return {
        status: 'FAILED',
        staleRecoveredCount,
        candidatesFound,
        pendingProcessedCount,
        failedRetryProcessedCount,
        claimedCount,
        processedCount,
        succeededCount,
        failedCount,
        skippedCount,
        exhaustedCount,
        itemErrorCount,
        durationMs,
        error: errorMessage,
      };
    } finally {
      this.isProcessing = false;
    }
  }
}
