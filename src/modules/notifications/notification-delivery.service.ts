import { Injectable, Logger } from '@nestjs/common';
import { NotificationDeliveryAdapter } from './notification-delivery.adapter';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { InAppDeliveryAdapter } from './adapters/in-app-delivery.adapter';
import { NotificationResponseDto } from './dto/notification.dto';
import {
  DeliveryChannel,
  DeliveryRecord,
  DeliveryStatus,
} from './notification.types';

/**
 * NotificationDeliveryService
 *
 * Responsibilities:
 *   - Create/get delivery records.
 *   - Route delivery through the correct adapter for a channel.
 *   - Enforce explicit state machine transitions.
 *   - Increment attemptCount and record timestamps on each attempt.
 *   - Isolate adapter failures — never throws to caller.
 *   - Support idempotent delivery (DELIVERED → no-op).
 *   - Support retry semantics (FAILED → PROCESSING → DELIVERED/FAILED).
 *
 * Does NOT:
 *   - Generate notifications.
 *   - Evaluate user preferences.
 *   - Inspect PAN/hash/encrypted identifiers.
 *   - Implement external provider logic.
 *   - Run background workers or schedulers.
 *
 * State machine (legal transitions):
 *   PENDING    → PROCESSING
 *   PROCESSING → DELIVERED
 *   PROCESSING → FAILED
 *   FAILED     → PROCESSING  (via retryDelivery)
 *   DELIVERED  → (terminal, idempotent on re-delivery request)
 *
 * Privacy: DeliveryResult must never contain PAN, panHash, panEncrypted,
 * identifierHash, or raw secrets. The InAppDeliveryAdapter does not use
 * any of these fields (they are not present on NotificationResponseDto).
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  /**
   * Registry of adapters keyed by channel.
   * In Phase 29.4 only IN_APP is registered.
   * Future channels: inject additional adapters and register here.
   */
  private readonly adapterRegistry: Map<DeliveryChannel, NotificationDeliveryAdapter>;

  constructor(
    private readonly deliveryRepository: NotificationDeliveryRepository,
    private readonly inAppAdapter: InAppDeliveryAdapter,
  ) {
    this.adapterRegistry = new Map();
    this.adapterRegistry.set(DeliveryChannel.IN_APP, this.inAppAdapter);
  }

  /**
   * Initialises delivery for a notification on the specified channel.
   *
   * Creates a PENDING delivery record (idempotent — existing records are preserved),
   * then immediately attempts delivery through the channel adapter.
   *
   * For IN_APP: transitions PENDING → PROCESSING → DELIVERED in one synchronous call.
   * For future channels: PENDING is created; a worker picks it up later.
   *
   * Failure isolation: errors are caught, logged, and do NOT propagate. This ensures
   * notification creation always succeeds even if delivery infrastructure has a problem.
   *
   * @param notification - The persisted notification (must not contain PAN/hash).
   * @param channel - The delivery channel to use.
   */
  async initDelivery(
    notification: NotificationResponseDto,
    channel: DeliveryChannel,
  ): Promise<void> {
    try {
      const record = await this.deliveryRepository.createDelivery(
        notification.id,
        channel,
      );

      this.logger.log(
        `Delivery initiated: notificationId=${notification.id} deliveryId=${record.id} channel=${channel} status=${record.status}`,
      );

      // If already DELIVERED (idempotent repeat call), skip re-delivery
      if (record.status === DeliveryStatus.DELIVERED) {
        this.logger.debug(
          `Delivery already DELIVERED (idempotent): notificationId=${notification.id} channel=${channel}`,
        );
        return;
      }

      // If currently PROCESSING (active claim in progress), skip re-delivery
      if (record.status === DeliveryStatus.PROCESSING) {
        this.logger.debug(
          `Delivery currently PROCESSING (skipping): notificationId=${notification.id} channel=${channel}`,
        );
        return;
      }

      await this.executeDelivery(record, notification, channel, DeliveryStatus.PENDING);
    } catch (err: unknown) {
      this.logger.error(
        `Delivery init failure (isolated): notificationId=${notification.id} channel=${channel} — ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Failure is isolated — caller (NotificationRepository) is NOT affected
    }
  }

  /**
   * Retries delivery for a previously FAILED delivery record.
   *
   * Only valid for FAILED records. PENDING and PROCESSING records are left unchanged.
   * DELIVERED records are returned as idempotent no-ops.
   *
   * Designed for use by a future retry worker. In Phase 29.4 no automatic worker
   * calls this — it can be triggered programmatically or by tests.
   *
   * @param notificationId - The notification ID.
   * @param channel - The delivery channel.
   * @returns The updated DeliveryRecord, or null if the record doesn't exist.
   */
  async retryDelivery(
    notificationId: string,
    channel: DeliveryChannel,
    notification: NotificationResponseDto,
  ): Promise<DeliveryRecord | null> {
    const record = await this.deliveryRepository.findDelivery(notificationId, channel);

    if (!record) {
      this.logger.warn(
        `retryDelivery called for non-existent record: notificationId=${notificationId} channel=${channel}`,
      );
      return null;
    }

    if (record.status === DeliveryStatus.DELIVERED) {
      this.logger.debug(
        `retryDelivery no-op: already DELIVERED notificationId=${notificationId} channel=${channel}`,
      );
      return record;
    }

    if (record.status === DeliveryStatus.PROCESSING) {
      this.logger.debug(
        `retryDelivery skipped: delivery currently PROCESSING notificationId=${notificationId} channel=${channel}`,
      );
      return record;
    }

    if (record.status !== DeliveryStatus.FAILED) {
      this.logger.warn(
        `retryDelivery skipped: invalid source state ${record.status} for notificationId=${notificationId} channel=${channel}`,
      );
      return record;
    }

    return this.executeDelivery(record, notification, channel, DeliveryStatus.FAILED);
  }

  /**
   * Retrieves the delivery record for a notification on a channel.
   * User isolation: caller must verify notification ownership before calling.
   * This is an internal service method — not directly exposed by a controller.
   */
  async getDeliveryStatus(
    notificationId: string,
    channel: DeliveryChannel,
  ): Promise<DeliveryRecord | null> {
    return this.deliveryRepository.findDelivery(notificationId, channel);
  }

  /**
   * Returns the adapter for a given channel.
   * Returns undefined if no adapter is registered for that channel.
   */
  getAdapter(channel: DeliveryChannel): NotificationDeliveryAdapter | undefined {
    return this.adapterRegistry.get(channel);
  }

  /**
   * Core delivery execution (Phase 29.5 Atomic Claim Flow):
   *   1. Verify adapter registration.
   *   2. Atomically claim record via claimDelivery(record.id, expectedStatus).
   *      - If NOT_CLAIMED: another execution won or status changed concurrently. Return fresh record.
   *   3. Call adapter.deliver(notification).
   *   4. Conditionally finalize record to DELIVERED or FAILED via conditionalFinalizeDelivery().
   *
   * Failure isolation: Adapter exceptions are caught and conditionally finalized to FAILED.
   * No error is thrown to caller.
   */
  private async executeDelivery(
    record: DeliveryRecord,
    notification: NotificationResponseDto,
    channel: DeliveryChannel,
    expectedStatus: DeliveryStatus,
  ): Promise<DeliveryRecord> {
    const adapter = this.adapterRegistry.get(channel);

    if (!adapter) {
      const reason = `No delivery adapter registered for channel: ${channel}`;
      this.logger.error(reason);
      return this.deliveryRepository.updateDelivery(record.id, {
        status: DeliveryStatus.FAILED,
        lastAttemptAt: new Date(),
        attemptCount: record.attemptCount + 1,
        failureReason: reason,
      });
    }

    // Phase 29.5: Atomic claim BEFORE invoking adapter
    const claimResult = await this.deliveryRepository.claimDelivery(
      record.id,
      expectedStatus,
    );

    if (claimResult === 'NOT_CLAIMED') {
      this.logger.debug(
        `Delivery claim lost or already claimed (concurrency guard): notificationId=${notification.id} deliveryId=${record.id} channel=${channel}`,
      );
      const current = await this.deliveryRepository.findDeliveryById(record.id);
      return current ?? record;
    }

    this.logger.debug(
      `Delivery claim won: notificationId=${notification.id} deliveryId=${record.id} channel=${channel}`,
    );

    try {
      const result = await adapter.deliver(notification);

      if (result.status === 'DELIVERED') {
        const delivered = await this.deliveryRepository.conditionalFinalizeDelivery(
          record.id,
          {
            status: DeliveryStatus.DELIVERED,
            deliveredAt: new Date(),
            failureReason: null,
            providerMessageId: result.providerMessageId ?? null,
          },
        );

        this.logger.log(
          `Delivery succeeded: notificationId=${notification.id} deliveryId=${record.id} channel=${channel}`,
        );

        return (
          delivered ??
          (await this.deliveryRepository.findDeliveryById(record.id)) ??
          record
        );
      } else {
        const reason = result.failureReason ?? 'Adapter returned FAILED without reason';
        const failed = await this.deliveryRepository.conditionalFinalizeDelivery(
          record.id,
          {
            status: DeliveryStatus.FAILED,
            failureReason: reason,
            providerMessageId: result.providerMessageId ?? null,
          },
        );

        this.logger.warn(
          `Delivery failed: notificationId=${notification.id} deliveryId=${record.id} channel=${channel} reason=${reason}`,
        );

        return (
          failed ??
          (await this.deliveryRepository.findDeliveryById(record.id)) ??
          record
        );
      }
    } catch (err: unknown) {
      const reason = `Adapter threw unexpectedly: ${(err as Error).message}`;
      this.logger.error(
        `Delivery adapter exception: notificationId=${notification.id} deliveryId=${record.id} channel=${channel} — ${reason}`,
        (err as Error).stack,
      );

      const failed = await this.deliveryRepository.conditionalFinalizeDelivery(
        record.id,
        {
          status: DeliveryStatus.FAILED,
          failureReason: reason,
        },
      );

      return (
        failed ??
        (await this.deliveryRepository.findDeliveryById(record.id)) ??
        record
      );
    }
  }
}
