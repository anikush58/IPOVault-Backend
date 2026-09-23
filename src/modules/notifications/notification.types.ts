export const LISTING_SOON_WINDOW_DAYS = 3;

export const NotificationType = {
  IPO_OPENED: 'IPO_OPENED',
  IPO_CLOSED: 'IPO_CLOSED',
  IPO_LISTING_SOON: 'IPO_LISTING_SOON',
  IPO_DATA_CHANGED: 'IPO_DATA_CHANGED',
  IPO_DATA_QUALITY_WARNING: 'IPO_DATA_QUALITY_WARNING',
  ALLOTTED_RESULT_AVAILABLE: 'ALLOTTED_RESULT_AVAILABLE',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationType, boolean> = {
  [NotificationType.IPO_OPENED]: true,
  [NotificationType.IPO_CLOSED]: true,
  [NotificationType.IPO_LISTING_SOON]: true,
  [NotificationType.IPO_DATA_CHANGED]: true,
  [NotificationType.IPO_DATA_QUALITY_WARNING]: true,
  [NotificationType.ALLOTTED_RESULT_AVAILABLE]: true,
};

export interface EffectiveNotificationPreference {
  type: NotificationType;
  enabled: boolean;
  isDefault: boolean;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  metadata?: Record<string, unknown>;
  deduplicationKey: string;
}

export function buildIpoOpenedDeduplicationKey(
  ipoId: string,
  lifecycleEventId: string,
): string {
  return `ipo_opened:${ipoId}:${lifecycleEventId}`;
}

export function buildIpoClosedDeduplicationKey(
  ipoId: string,
  lifecycleEventId: string,
): string {
  return `ipo_closed:${ipoId}:${lifecycleEventId}`;
}

export function buildIpoListingSoonDeduplicationKey(
  ipoId: string,
  eventDateIso: string,
): string {
  return `ipo_listing_soon:${ipoId}:${eventDateIso}`;
}

export function buildIpoDataChangedDeduplicationKey(
  ipoId: string,
  changeEventId: string,
): string {
  return `ipo_data_changed:${ipoId}:${changeEventId}`;
}

export function buildIpoDataQualityWarningDeduplicationKey(
  ipoId: string,
  qualityCondition: string,
): string {
  return `ipo_quality_warning:${ipoId}:${qualityCondition}`;
}

export function buildAllotmentResultDeduplicationKey(
  ipoId: string,
  jobItemId: string,
): string {
  return `allotment_result:${ipoId}:${jobItemId}`;
}

export function buildIpoAllotmentOutDeduplicationKey(ipoId: string): string {
  return `ipo_allotment_out:${ipoId}`;
}

// ─────────────────────────────────────────────────────────
// Phase 29.4 — Delivery Infrastructure Types
// ─────────────────────────────────────────────────────────

/**
 * Supported delivery channels. Mirrors the Prisma DeliveryChannel enum.
 * IN_APP is the only channel with an implemented adapter in Phase 29.4.
 * PUSH, EMAIL, SMS are reserved for future adapters (Phase 29.5+).
 */
export const DeliveryChannel = {
  IN_APP: 'IN_APP',
  PUSH: 'PUSH',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
} as const;

export type DeliveryChannel = (typeof DeliveryChannel)[keyof typeof DeliveryChannel];

/**
 * Legal states for a NotificationDelivery record.
 *
 * State machine:
 *   PENDING → PROCESSING
 *   PROCESSING → DELIVERED
 *   PROCESSING → FAILED
 *   FAILED → PROCESSING  (retry)
 *
 * DELIVERED is terminal — repeat deliver() calls are idempotent (no-op).
 */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;

export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

/**
 * Result returned by a NotificationDeliveryAdapter.deliver() call.
 */
export interface DeliveryResult {
  status: 'DELIVERED' | 'FAILED';
  failureReason?: string;
  /**
   * Optional provider-assigned message/trace ID. Never contains sensitive data.
   * The IN_APP adapter does not populate this field.
   */
  providerMessageId?: string;
}

/**
 * Internal representation of a NotificationDelivery record (domain-layer DTO).
 * Not exposed as a public API response.
 */
export interface DeliveryRecord {
  id: string;
  notificationId: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  attemptCount: number;
  lastAttemptAt: string | null;
  processingStartedAt: string | null;
  deliveredAt: string | null;
  failureReason: string | null;
  providerMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Result of an atomic delivery claim attempt (Phase 29.5).
 * CLAIMED: This caller successfully claimed ownership of the delivery attempt.
 * NOT_CLAIMED: Another caller claimed the delivery or its status changed concurrently.
 */
export type DeliveryClaimResult = 'CLAIMED' | 'NOT_CLAIMED';

// ─────────────────────────────────────────────────────────
// Phase 29.6 — Delivery Automation & Retry Policy Types
// ─────────────────────────────────────────────────────────

export interface NotificationDeliveryWorkerConfig {
  enabled: boolean;
  batchSize: number;
  intervalMs: number;
  staleLeaseTimeoutMs: number;
}

export interface NotificationDeliveryRetryPolicyConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}
