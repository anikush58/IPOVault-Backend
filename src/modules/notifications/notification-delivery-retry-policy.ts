import { Injectable, Optional } from '@nestjs/common';
import {
  DeliveryRecord,
  DeliveryStatus,
  NotificationDeliveryRetryPolicyConfig,
} from './notification.types';

export const DEFAULT_RETRY_POLICY_CONFIG: NotificationDeliveryRetryPolicyConfig = {
  maxAttempts: 5,
  baseDelayMs: 10_000, // 10 seconds
  maxDelayMs: 3_600_000, // 1 hour
  backoffMultiplier: 2,
};

export function sanitizeRetryPolicyConfig(
  input?: Partial<NotificationDeliveryRetryPolicyConfig>,
): NotificationDeliveryRetryPolicyConfig {
  const maxAttemptsRaw = Number(input?.maxAttempts);
  const maxAttempts =
    !isNaN(maxAttemptsRaw) && maxAttemptsRaw >= 1
      ? Math.floor(maxAttemptsRaw)
      : DEFAULT_RETRY_POLICY_CONFIG.maxAttempts;

  const baseDelayMsRaw = Number(input?.baseDelayMs);
  const baseDelayMs =
    !isNaN(baseDelayMsRaw) && baseDelayMsRaw >= 1
      ? Math.floor(baseDelayMsRaw)
      : DEFAULT_RETRY_POLICY_CONFIG.baseDelayMs;

  const maxDelayMsRaw = Number(input?.maxDelayMs);
  let maxDelayMs =
    !isNaN(maxDelayMsRaw) && maxDelayMsRaw >= 1
      ? Math.floor(maxDelayMsRaw)
      : DEFAULT_RETRY_POLICY_CONFIG.maxDelayMs;

  if (maxDelayMs < baseDelayMs) {
    maxDelayMs = baseDelayMs;
  }

  const multiplierRaw = Number(input?.backoffMultiplier);
  const backoffMultiplier =
    !isNaN(multiplierRaw) && multiplierRaw >= 1
      ? multiplierRaw
      : DEFAULT_RETRY_POLICY_CONFIG.backoffMultiplier;

  return {
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    backoffMultiplier,
  };
}

/**
 * NotificationDeliveryRetryPolicy
 *
 * Responsibilities:
 *   - Pure, deterministic evaluation of delivery retry eligibility.
 *   - Exponential backoff calculation with configurable cap.
 *   - Maximum attempts enforcement.
 *   - Robust input sanitization for configuration properties.
 *
 * Does NOT:
 *   - Perform database mutations.
 *   - Perform network calls.
 *   - Access PAN or sensitive identifiers.
 */
@Injectable()
export class NotificationDeliveryRetryPolicy {
  private readonly config: NotificationDeliveryRetryPolicyConfig;

  constructor(@Optional() config?: Partial<NotificationDeliveryRetryPolicyConfig>) {
    this.config = sanitizeRetryPolicyConfig(config);
  }

  /**
   * Returns current retry policy configuration.
   */
  getConfig(): NotificationDeliveryRetryPolicyConfig {
    return { ...this.config };
  }

  /**
   * Determines whether a delivery record is currently eligible for an execution attempt.
   *
   * Rules:
   *   - PENDING: eligible immediately.
   *   - DELIVERED: never eligible.
   *   - PROCESSING: never eligible through retry policy (stale recovery handled separately).
   *   - FAILED: eligible ONLY if attemptCount < maxAttempts AND (lastAttemptAt + backoffDelay <= now).
   */
  isEligibleForRetry(delivery: DeliveryRecord, now: Date = new Date()): boolean {
    if (delivery.status === DeliveryStatus.PENDING) {
      return true;
    }

    if (delivery.status === DeliveryStatus.DELIVERED || delivery.status === DeliveryStatus.PROCESSING) {
      return false;
    }

    if (delivery.status === DeliveryStatus.FAILED) {
      if (this.isExhausted(delivery)) {
        return false;
      }

      if (!delivery.lastAttemptAt) {
        return true;
      }

      const lastAttemptDate = new Date(delivery.lastAttemptAt);
      const delayMs = this.calculateBackoffDelayMs(delivery.attemptCount);
      const nextEligibleTime = new Date(lastAttemptDate.getTime() + delayMs);

      return now.getTime() >= nextEligibleTime.getTime();
    }

    return false;
  }

  /**
   * Calculates the timestamp when the next attempt becomes eligible.
   * Returns null if delivery is exhausted or already delivered.
   */
  getNextAttemptTime(delivery: DeliveryRecord): Date | null {
    if (delivery.status === DeliveryStatus.DELIVERED || this.isExhausted(delivery)) {
      return null;
    }

    if (delivery.status === DeliveryStatus.PENDING || !delivery.lastAttemptAt) {
      return new Date();
    }

    const lastAttemptDate = new Date(delivery.lastAttemptAt);
    const delayMs = this.calculateBackoffDelayMs(delivery.attemptCount);
    return new Date(lastAttemptDate.getTime() + delayMs);
  }

  /**
   * Returns true if the delivery has reached or exceeded maximum attempts.
   */
  isExhausted(delivery: DeliveryRecord): boolean {
    return delivery.attemptCount >= this.config.maxAttempts;
  }

  /**
   * Calculates backoff delay in milliseconds for a given attempt count using exponential backoff with cap:
   *   delay = min(baseDelayMs * multiplier^(attemptCount - 1), maxDelayMs)
   */
  calculateBackoffDelayMs(attemptCount: number): number {
    if (attemptCount <= 0) {
      return 0;
    }

    const exponent = Math.max(0, attemptCount - 1);
    const rawDelay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, exponent);
    return Math.min(rawDelay, this.config.maxDelayMs);
  }
}
