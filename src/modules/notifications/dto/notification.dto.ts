import { z } from 'zod';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT, PaginationMeta } from '../../../common/pagination/pagination';
import { EffectiveNotificationPreference, NotificationType } from '../notification.types';

const booleanQuerySchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    if (val.toLowerCase() === 'true') return true;
    if (val.toLowerCase() === 'false') return false;
  }
  return val;
}, z.boolean().optional().default(false));

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  unreadOnly: booleanQuerySchema,
});

export type NotificationQueryDto = z.infer<typeof notificationQuerySchema>;

export const updatePreferenceBodySchema = z.object({
  enabled: z.boolean(),
});

export type UpdatePreferenceBodyDto = z.infer<typeof updatePreferenceBodySchema>;

export interface NotificationResponseDto {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponseDto {
  notifications: NotificationResponseDto[];
  meta: PaginationMeta;
  unreadCount: number;
}

export interface ReadNotificationsResponseDto {
  updatedCount: number;
}

export interface NotificationPreferenceResponseDto extends EffectiveNotificationPreference {}

export interface NotificationPreferencesListResponseDto {
  preferences: NotificationPreferenceResponseDto[];
}

export interface DeliveryOperationsRecentHealthDto {
  windowMs: number;
  deliveriesCreated: number;
  delivered: number;
  failed: number;
  exhausted: number;
  retryAttempts: number;
}

export interface DeliveryOperationsSummaryResponseDto {
  totalDeliveries: number;
  pendingCount: number;
  processingCount: number;
  deliveredCount: number;
  failedCount: number;
  exhaustedFailedCount: number;
  retryableFailedCount: number;
  staleProcessingCount: number;
  oldestPendingDeliveryAgeMs: number | null;
  oldestRetryableFailedDeliveryAgeMs: number | null;
  oldestProcessingDeliveryAgeMs: number | null;
  deliverySuccessRatePercentage: number;
  deliveryFailureRatePercentage: number;
  recentHealth: DeliveryOperationsRecentHealthDto;
}
