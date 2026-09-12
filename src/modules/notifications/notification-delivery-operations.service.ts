import { Injectable } from '@nestjs/common';
import { DeliveryOperationsSummaryResponseDto } from './dto/notification.dto';
import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationDeliveryRepository } from './notification-delivery.repository';

/**
 * NotificationDeliveryOperationsService
 *
 * Responsibilities:
 *   - Read-only operational visibility layer for notification delivery pipeline.
 *   - Aggregates delivery health metrics (counts, rates, ages, recent 24h window).
 *   - Leverages efficient DB-level counts/aggregations (zero full-table heap loading).
 *   - Enforces strict security & privacy boundaries (zero PAN, userId, or message content exposed).
 *
 * Does NOT:
 *   - Expose delivery mutation methods (no retry, force-delivery, or status updates).
 *   - Load individual notifications or message bodies into memory.
 *   - Add external dependencies (Redis, BullMQ, RabbitMQ).
 *
 * Security Note:
 *   This service boundary provides administrative operational visibility.
 *   HTTP Controller endpoints calling this service MUST be protected by API Gateway
 *   or administrative authorization guards in production.
 */
@Injectable()
export class NotificationDeliveryOperationsService {
  constructor(
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly retryPolicy: NotificationDeliveryRetryPolicy,
    private readonly workerService: NotificationDeliveryWorkerService,
  ) {}

  /**
   * Computes aggregate operational health summary for notification delivery pipeline.
   *
   * @param recentWindowMs Duration of recent window in ms (default: 24 hours / 86,400,000ms)
   */
  async getDeliveryOperationsSummary(
    recentWindowMs: number = 86_400_000,
  ): Promise<DeliveryOperationsSummaryResponseDto> {
    const now = new Date();
    const maxAttempts = this.retryPolicy.getConfig().maxAttempts;
    const staleTimeoutMs = this.workerService.getConfig().staleLeaseTimeoutMs;
    const staleThreshold = new Date(now.getTime() - staleTimeoutMs);
    const windowStart = new Date(now.getTime() - recentWindowMs);

    const stats = await this.deliveryRepository.getAggregateOperationalStats({
      maxAttempts,
      staleThreshold,
      now,
    });

    const recent = await this.deliveryRepository.getRecentHealthStats({
      windowStart,
      maxAttempts,
    });

    const completedCount = stats.deliveredCount + stats.failedCount;
    const successRate =
      completedCount > 0
        ? Math.round((stats.deliveredCount / completedCount) * 10000) / 100
        : 0;
    const failureRate =
      completedCount > 0
        ? Math.round((stats.failedCount / completedCount) * 10000) / 100
        : 0;

    return {
      totalDeliveries: stats.totalDeliveries,
      pendingCount: stats.pendingCount,
      processingCount: stats.processingCount,
      deliveredCount: stats.deliveredCount,
      failedCount: stats.failedCount,
      exhaustedFailedCount: stats.exhaustedFailedCount,
      retryableFailedCount: stats.retryableFailedCount,
      staleProcessingCount: stats.staleProcessingCount,
      oldestPendingDeliveryAgeMs: stats.oldestPendingDeliveryAgeMs,
      oldestRetryableFailedDeliveryAgeMs: stats.oldestRetryableFailedDeliveryAgeMs,
      oldestProcessingDeliveryAgeMs: stats.oldestProcessingDeliveryAgeMs,
      deliverySuccessRatePercentage: successRate,
      deliveryFailureRatePercentage: failureRate,
      recentHealth: {
        windowMs: recentWindowMs,
        deliveriesCreated: recent.deliveriesCreated,
        delivered: recent.delivered,
        failed: recent.failed,
        exhausted: recent.exhausted,
        retryAttempts: recent.retryAttempts,
      },
    };
  }
}
