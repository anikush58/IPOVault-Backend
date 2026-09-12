import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { paginationMeta, paginationOffset } from '../../common/pagination/pagination';
import {
  CreateNotificationInput,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DeliveryChannel,
  EffectiveNotificationPreference,
  NotificationType,
} from './notification.types';
import { NotificationListResponseDto, NotificationResponseDto } from './dto/notification.dto';
import { NotificationDeliveryService } from './notification-delivery.service';

@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveryService: NotificationDeliveryService,
  ) {}

  /**
   * Checks if a notification type is enabled for a specific user based on explicit preferences or system defaults.
   */
  async isNotificationTypeEnabled(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        userId_notificationType: {
          userId,
          notificationType: type,
        },
      },
    });

    if (pref !== null) {
      return pref.enabled;
    }

    return DEFAULT_NOTIFICATION_PREFERENCES[type] ?? true;
  }

  /**
   * Retrieves effective preferences for all supported notification types for a user.
   */
  async getUserPreferences(
    userId: string,
  ): Promise<EffectiveNotificationPreference[]> {
    const storedPrefs = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });

    const storedMap = new Map<NotificationType, boolean>();
    for (const p of storedPrefs) {
      storedMap.set(p.notificationType as NotificationType, p.enabled);
    }

    const allTypes = Object.values(NotificationType);
    return allTypes.map((type) => {
      if (storedMap.has(type)) {
        return {
          type,
          enabled: storedMap.get(type)!,
          isDefault: false,
        };
      }
      return {
        type,
        enabled: DEFAULT_NOTIFICATION_PREFERENCES[type] ?? true,
        isDefault: true,
      };
    });
  }

  /**
   * Upserts a user's explicit preference for a notification type.
   */
  async upsertUserPreference(
    userId: string,
    type: NotificationType,
    enabled: boolean,
  ): Promise<EffectiveNotificationPreference> {
    const updated = await this.prisma.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId,
          notificationType: type,
        },
      },
      create: {
        userId,
        notificationType: type,
        enabled,
      },
      update: {
        enabled,
      },
    });

    return {
      type: updated.notificationType as NotificationType,
      enabled: updated.enabled,
      isDefault: false,
    };
  }

  /**
   * Resets all user explicit preferences back to system defaults.
   */
  async resetUserPreferences(
    userId: string,
  ): Promise<EffectiveNotificationPreference[]> {
    await this.prisma.notificationPreference.deleteMany({
      where: { userId },
    });

    return this.getUserPreferences(userId);
  }

  /**
   * Persists a notification with DB-enforced user-scoped idempotency and user preference checks.
   * If the notification type is disabled for the user, creation is suppressed and returns null.
   * If a record with the same (userId, deduplicationKey) already exists, it is ignored cleanly.
   */
  async createNotification(
    input: CreateNotificationInput,
  ): Promise<NotificationResponseDto | null> {
    const isEnabled = await this.isNotificationTypeEnabled(
      input.userId,
      input.type,
    );

    if (!isEnabled) {
      this.logger.debug(
        `Notification generation suppressed for disabled type ${input.type} (user: ${input.userId})`,
      );
      return null;
    }

    try {
      const created = await this.prisma.notification.upsert({
        where: {
          userId_deduplicationKey: {
            userId: input.userId,
            deduplicationKey: input.deduplicationKey,
          },
        },
        create: {
          userId: input.userId,
          type: input.type as NotificationType,
          title: input.title,
          message: input.message,
          relatedEntityType: input.relatedEntityType || null,
          relatedEntityId: input.relatedEntityId || null,
          metadata: (input.metadata as Prisma.InputJsonValue) || Prisma.DbNull,
          deduplicationKey: input.deduplicationKey,
        },
        update: {}, // No-op if already existing to preserve idempotency
      });

      const dto = this.mapToDto(created);

      // Initiate IN_APP delivery. Fire-and-forget: isolated in try/catch so
      // delivery failures NEVER cause notification creation to fail.
      this.deliveryService
        .initDelivery(dto, DeliveryChannel.IN_APP)
        .catch((err: unknown) => {
          this.logger.error(
            `Delivery init error (isolated from notification creation): notificationId=${created.id} — ${(err as Error).message}`,
            (err as Error).stack,
          );
        });

      return dto;
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(
          `Notification duplicate suppressed for key: ${input.deduplicationKey}`,
        );
        return null;
      }
      throw err;
    }
  }

  /**
   * Batch creates multiple notifications with user-scoped idempotency and preference checks.
   */
  async createNotificationsBulk(
    inputs: CreateNotificationInput[],
  ): Promise<number> {
    let createdCount = 0;
    for (const input of inputs) {
      const result = await this.createNotification(input);
      if (result) {
        createdCount++;
      }
    }
    return createdCount;
  }

  /**
   * Queries notifications for a user with database-level filtering, ordering, pagination, and unread count.
   */
  async findUserNotifications(
    userId: string,
    query: { page: number; limit: number; unreadOnly: boolean },
  ): Promise<NotificationListResponseDto> {
    const { page, limit, unreadOnly } = query;
    const offset = paginationOffset(page, limit);

    const whereClause: Prisma.NotificationWhereInput = {
      userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [items, filteredTotal, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: whereClause,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.notification.count({ where: whereClause }),
      this.prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return {
      notifications: items.map((item) => this.mapToDto(item)),
      meta: paginationMeta(page, limit, filteredTotal),
      unreadCount,
    };
  }

  /**
   * Retrieves a single notification strictly scoped by userId.
   */
  async findUserNotificationById(
    id: string,
    userId: string,
  ): Promise<NotificationResponseDto | null> {
    const item = await this.prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    return item ? this.mapToDto(item) : null;
  }

  /**
   * Marks a specific notification as read.
   * Idempotent: if already read, leaves readAt unchanged.
   */
  async markAsRead(
    id: string,
    userId: string,
  ): Promise<NotificationResponseDto | null> {
    const item = await this.prisma.notification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!item) {
      return null;
    }

    if (item.readAt !== null) {
      return this.mapToDto(item);
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    return this.mapToDto(updated);
  }

  /**
   * Marks all unread notifications for a user as read.
   * Idempotent and bounded update.
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
      },
      data: {
        readAt: new Date(),
      },
    });

    return result.count;
  }

  private mapToDto(item: {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType: string | null;
    relatedEntityId: string | null;
    metadata: Prisma.JsonValue;
    readAt: Date | null;
    createdAt: Date;
  }): NotificationResponseDto {
    return {
      id: item.id,
      type: item.type,
      title: item.title,
      message: item.message,
      relatedEntityType: item.relatedEntityType,
      relatedEntityId: item.relatedEntityId,
      metadata:
        item.metadata && typeof item.metadata === 'object'
          ? (item.metadata as Record<string, unknown>)
          : null,
      readAt: item.readAt ? item.readAt.toISOString() : null,
      createdAt: item.createdAt.toISOString(),
    };
  }
}
