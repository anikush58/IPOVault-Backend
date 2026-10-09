import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
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
  PushTokenResponseDto,
  ReadNotificationsResponseDto,
  RegisterPushTokenDto,
  registerPushTokenSchema,
  UpdatePreferenceBodyDto,
  updatePreferenceBodySchema,
} from './dto/notification.dto';
import { NotificationService } from './notification.service';
import { NotificationDeliveryOperationsService } from './notification-delivery-operations.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('notifications')
@UseGuards(FirebaseAuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly deliveryOperationsService: NotificationDeliveryOperationsService,
  ) {}

  @Get()
  async getNotifications(
    @Query(new ZodValidationPipe(notificationQuerySchema))
    query: NotificationQueryDto,
    @CurrentUser('uid') userId: string,
  ): Promise<NotificationListResponseDto> {
    return this.notificationService.getUserNotifications(userId, query);
  }

  @Get('preferences')
  async getPreferences(
    @CurrentUser('uid') userId: string,
  ): Promise<NotificationPreferencesListResponseDto> {
    return this.notificationService.getUserPreferences(userId);
  }

  /**
   * Administrative Visibility Boundary: Returns aggregate notification delivery health summary.
   * Note: Should be gated by API Gateway / Admin RBAC in production.
   */
  @Public()
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
    @CurrentUser('uid') userId: string,
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
    @CurrentUser('uid') userId: string,
  ): Promise<NotificationPreferencesListResponseDto> {
    return this.notificationService.resetUserPreferences(userId);
  }

  @Get(':id')
  async getNotification(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('uid') userId: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationService.getUserNotificationById(id, userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser('uid') userId: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationService.markNotificationAsRead(id, userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @CurrentUser('uid') userId: string,
  ): Promise<ReadNotificationsResponseDto> {
    return this.notificationService.markAllNotificationsAsRead(userId);
  }

  @Post('push-token')
  @HttpCode(HttpStatus.OK)
  async registerPushToken(
    @Body(new ZodValidationPipe(registerPushTokenSchema))
    body: RegisterPushTokenDto,
    @CurrentUser('uid') userId: string,
  ): Promise<PushTokenResponseDto> {
    return this.notificationService.registerPushToken(userId, body);
  }

  @Delete('push-token/:token')
  @HttpCode(HttpStatus.OK)
  async deactivatePushToken(
    @Param('token') token: string,
    @CurrentUser('uid') userId: string,
  ): Promise<{ success: boolean }> {
    return this.notificationService.deactivatePushToken(userId, token);
  }
}
