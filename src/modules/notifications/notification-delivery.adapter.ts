import { NotificationResponseDto } from './dto/notification.dto';
import { DeliveryChannel, DeliveryResult } from './notification.types';

/**
 * Abstract adapter interface for notification delivery channels.
 *
 * Each concrete adapter (InAppDeliveryAdapter, FcmDeliveryAdapter, EmailDeliveryAdapter, …)
 * implements this interface for its specific channel. The adapter:
 *  - MUST NOT know about Prisma internals or delivery record state management.
 *  - MUST NOT access PAN, panHash, panEncrypted, or identifierHash.
 *  - MUST return a typed DeliveryResult without throwing (internal errors become FAILED results).
 *
 * The NotificationDeliveryService is responsible for:
 *  - Selecting the correct adapter for a channel.
 *  - Managing delivery record state transitions.
 *  - Handling retry semantics.
 *
 * Future channels:
 *   IN_APP   → InAppDeliveryAdapter   (Phase 29.4, implemented)
 *   PUSH     → FcmDeliveryAdapter     (Phase 29.5+)
 *   EMAIL    → EmailDeliveryAdapter   (Phase 29.5+)
 *   SMS      → SmsDeliveryAdapter     (Phase 29.5+)
 */
export abstract class NotificationDeliveryAdapter {
  /**
   * The channel this adapter handles.
   */
  abstract readonly channel: DeliveryChannel;

  /**
   * Delivers a notification through this channel.
   *
   * @param notification - The notification to deliver (no PAN/hash in payload by design).
   * @returns A DeliveryResult indicating DELIVERED or FAILED with diagnostic info.
   *
   * Implementations MUST NOT throw. Failures must be expressed as DeliveryResult.status = 'FAILED'.
   */
  abstract deliver(notification: NotificationResponseDto): Promise<DeliveryResult>;
}
