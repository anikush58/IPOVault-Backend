import { Injectable } from '@nestjs/common';
import { NotificationDeliveryAdapter } from '../notification-delivery.adapter';
import { NotificationResponseDto } from '../dto/notification.dto';
import { DeliveryChannel, DeliveryResult } from '../notification.types';

/**
 * IN_APP delivery adapter.
 *
 * Semantics:
 *   The `Notification` row persisted by NotificationRepository is already the
 *   user's in-app notification. It is immediately readable via:
 *
 *     GET /api/v1/notifications
 *     GET /api/v1/notifications/:id
 *
 *   Therefore, "delivering" an IN_APP notification requires no additional I/O
 *   or external system calls. This adapter simply confirms the delivery as
 *   immediately successful so the delivery record transitions to DELIVERED.
 *
 * This does NOT mean a browser push or mobile alert was sent.
 * Browser/mobile push belongs to the PUSH channel (Phase 29.5+, FCM/APNs).
 *
 * Failure path: There is no external failure path for IN_APP delivery.
 * The adapter always returns DELIVERED.
 */
@Injectable()
export class InAppDeliveryAdapter extends NotificationDeliveryAdapter {
  readonly channel = DeliveryChannel.IN_APP;

  /**
   * IN_APP delivery is a no-op: the notification is already persisted and
   * readable. Returns DELIVERED immediately without any external I/O.
   */
  async deliver(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _notification: NotificationResponseDto,
  ): Promise<DeliveryResult> {
    return { status: 'DELIVERED' };
  }
}
