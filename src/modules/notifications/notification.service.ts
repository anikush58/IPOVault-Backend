import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  NotificationListResponseDto,
  NotificationPreferenceResponseDto,
  NotificationPreferencesListResponseDto,
  NotificationQueryDto,
  NotificationResponseDto,
  ReadNotificationsResponseDto,
} from './dto/notification.dto';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationRepository } from './notification.repository';
import { NotificationType } from './notification.types';

@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    public readonly generator: NotificationEventGenerator,
  ) {}

  /**
   * Retrieves paginated notifications for the authenticated user.
   */
  async getUserNotifications(
    userId: string | undefined,
    query: NotificationQueryDto,
  ): Promise<NotificationListResponseDto> {
    const validUserId = this.validateUserId(userId);
    return this.repository.findUserNotifications(validUserId, query);
  }

  /**
   * Retrieves a single notification belonging to the authenticated user.
   */
  async getUserNotificationById(
    id: string,
    userId: string | undefined,
  ): Promise<NotificationResponseDto> {
    const validUserId = this.validateUserId(userId);
    const notification = await this.repository.findUserNotificationById(
      id,
      validUserId,
    );

    if (!notification) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'Notification not found or unowned',
        404,
      );
    }

    return notification;
  }

  /**
   * Marks a specific notification as read for the authenticated user.
   */
  async markNotificationAsRead(
    id: string,
    userId: string | undefined,
  ): Promise<NotificationResponseDto> {
    const validUserId = this.validateUserId(userId);
    const updated = await this.repository.markAsRead(id, validUserId);

    if (!updated) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'Notification not found or unowned',
        404,
      );
    }

    return updated;
  }

  /**
   * Marks all unread notifications for the authenticated user as read.
   */
  async markAllNotificationsAsRead(
    userId: string | undefined,
  ): Promise<ReadNotificationsResponseDto> {
    const validUserId = this.validateUserId(userId);
    const updatedCount = await this.repository.markAllAsRead(validUserId);
    return { updatedCount };
  }

  /**
   * Retrieves effective notification preferences for all supported types for the authenticated user.
   */
  async getUserPreferences(
    userId: string | undefined,
  ): Promise<NotificationPreferencesListResponseDto> {
    const validUserId = this.validateUserId(userId);
    const preferences = await this.repository.getUserPreferences(validUserId);
    return { preferences };
  }

  /**
   * Updates an explicit notification preference for a specific type for the authenticated user.
   */
  async updateUserPreference(
    typeString: string,
    enabled: boolean,
    userId: string | undefined,
  ): Promise<NotificationPreferenceResponseDto> {
    const validUserId = this.validateUserId(userId);
    const validNotificationType = this.validateNotificationType(typeString);

    return this.repository.upsertUserPreference(
      validUserId,
      validNotificationType,
      enabled,
    );
  }

  /**
   * Resets all explicit notification preferences for the authenticated user back to system defaults.
   */
  async resetUserPreferences(
    userId: string | undefined,
  ): Promise<NotificationPreferencesListResponseDto> {
    const validUserId = this.validateUserId(userId);
    const preferences = await this.repository.resetUserPreferences(validUserId);
    return { preferences };
  }

  /**
   * Validates user identity header x-user-id.
   */
  private validateUserId(userId: string | undefined): string {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication identity required (x-user-id)',
        401,
      );
    }
    return userId.trim();
  }

  /**
   * Validates notification type parameter against strict allowlist.
   */
  private validateNotificationType(typeString: string): NotificationType {
    const validTypes = Object.values(NotificationType);
    const found = validTypes.find((t) => t === typeString);

    if (!found) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Invalid notification type: "${typeString}". Supported types: ${validTypes.join(', ')}`,
        400,
      );
    }

    return found;
  }
}
