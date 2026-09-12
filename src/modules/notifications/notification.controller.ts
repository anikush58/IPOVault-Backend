import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  DeliveryOperationsSummaryResponseDto,
  NotificationListResponseDto,
  NotificationPreferenceResponseDto,
  NotificationPreferencesListResponseDto,
  NotificationQueryDto,
  notificationQuerySchema,
  NotificationResponseDto,
  ReadNotificationsResponseDto,
  UpdatePreferenceBodyDto,
  updatePreferenceBodySchema,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';
import { NotificationDeliveryOperationsService } from './notification-delivery-operations.service';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryOperationsService: NotificationDeliveryOperationsService,
  ) {}

  @Get()
  async getNotifications(
    @Query(new ZodValidationPipe(notificationQuerySchema))
    query: NotificationQueryDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationListResponseDto> {
    return this.notificationService.getUserNotifications(userId, query);
  }

  @Get('preferences')
  async getPreferences(
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationPreferencesListResponseDto> {
    return this.notificationService.getUserPreferences(userId);
  }

  /**
   * Administrative Visibility Boundary: Returns aggregate notification delivery health summary.
   * Note: Should be gated by API Gateway / Admin RBAC in production.
   */
  @Get('delivery/operations')
  async getDeliveryOperations(): Promise<DeliveryOperationsSummaryResponseDto> {
    return this.deliveryOperationsService.getDeliveryOperationsSummary();
  }

  @Put('preferences/:type')
  @HttpCode(HttpStatus.OK)
  async updatePreference(
    @Param('type') type: string,
    @Body(new ZodValidationPipe(updatePreferenceBodySchema))
    body: UpdatePreferenceBodyDto,
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationPreferenceResponseDto> {
    return this.notificationService.updateUserPreference(
      type,
      body.enabled,
      userId,
    );
  }

  @Post('preferences/reset')
  @HttpCode(HttpStatus.OK)
  async resetPreferences(
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationPreferencesListResponseDto> {
    return this.notificationService.resetUserPreferences(userId);
  }

  @Get(':id')
  async getNotification(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationService.getUserNotificationById(id, userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationService.markNotificationAsRead(id, userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @Headers('x-user-id') userId?: string,
  ): Promise<ReadNotificationsResponseDto> {
    return this.notificationService.markAllNotificationsAsRead(userId);
  }
}
