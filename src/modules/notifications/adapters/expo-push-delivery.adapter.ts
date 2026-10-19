import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { NotificationDeliveryAdapter } from '../notification-delivery.adapter';
import { NotificationResponseDto } from '../dto/notification.dto';
import { DeliveryChannel, DeliveryResult } from '../notification.types';

export const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo Push Delivery Adapter.
 * Delivers push notifications to Expo Push service for registered user devices.
 * Failure isolated: never throws to caller.
 */
@Injectable()
export class ExpoPushDeliveryAdapter extends NotificationDeliveryAdapter {
  private readonly logger = new Logger(ExpoPushDeliveryAdapter.name);
  readonly channel = DeliveryChannel.PUSH;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async deliver(notification: NotificationResponseDto): Promise<DeliveryResult> {
    try {
      if (!notification.userId) {
        return {
          status: 'FAILED',
          failureReason: 'Notification missing userId for push delivery',
        };
      }

      // Query active push tokens for user
      const userTokens = await this.prisma.userPushToken.findMany({
        where: {
          userId: notification.userId,
          isActive: true,
        },
      });

      if (userTokens.length === 0) {
        this.logger.debug(
          `No active push tokens found for user ${notification.userId} (notificationId: ${notification.id})`,
        );
        return {
          status: 'DELIVERED',
        };
      }

      const pushPayload = userTokens.map((t) => ({
        to: t.token,
        sound: 'default',
        channelId: 'ipovault-alerts',
        priority: 'high',
        title: notification.title,
        body: notification.message,
        data: {
          notificationId: notification.id,
          type: notification.type,
          ipoId:
            notification.relatedEntityId ||
            (notification.metadata as Record<string, unknown> | undefined)?.ipoId,
          ...(notification.metadata as Record<string, unknown> | undefined),
        },
      }));

      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(pushPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Expo push delivery HTTP ${response.status} for notificationId=${notification.id}`,
        );
        return {
          status: 'FAILED',
          failureReason: `HTTP_${response.status}: ${errorText.substring(0, 200)}`,
        };
      }

      const result = (await response.json()) as {
        data?: Array<{
          status: 'ok' | 'error';
          id?: string;
          message?: string;
          details?: { error?: string };
        }>;
      };

      // Check if any tokens returned DeviceNotRegistered
      if (result.data && Array.isArray(result.data)) {
        const inactiveTokenIds: string[] = [];
        result.data.forEach((ticket, idx) => {
          if (
            ticket.status === 'error' &&
            ticket.details?.error === 'DeviceNotRegistered'
          ) {
            const tok = userTokens[idx];
            if (tok) inactiveTokenIds.push(tok.id);
          }
        });

        if (inactiveTokenIds.length > 0) {
          await this.prisma.userPushToken.updateMany({
            where: { id: { in: inactiveTokenIds } },
            data: { isActive: false, updatedAt: new Date() },
          });
          this.logger.log(
            `Deactivated ${inactiveTokenIds.length} unregistered Expo push tokens`,
          );
        }
      }

      return {
        status: 'DELIVERED',
        providerMessageId: result.data?.[0]?.id || undefined,
      };
    } catch (err: unknown) {
      this.logger.error(
        `Expo push delivery exception for notificationId=${notification.id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        status: 'FAILED',
        failureReason: (err as Error).message,
      };
    }
  }
}
