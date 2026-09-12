import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import { DeliveryRecord, DeliveryStatus } from './notification.types';

describe('NotificationDeliveryRetryPolicy (Phase 29.6)', () => {
  let retryPolicy: NotificationDeliveryRetryPolicy;

  beforeEach(() => {
    retryPolicy = new NotificationDeliveryRetryPolicy({
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      backoffMultiplier: 2,
    });
  });

  const createDummyRecord = (override: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
    id: 'del-1',
    notificationId: 'notif-1',
    channel: 'IN_APP',
    status: DeliveryStatus.PENDING,
    attemptCount: 0,
    lastAttemptAt: null,
    processingStartedAt: null,
    deliveredAt: null,
    failureReason: null,
    providerMessageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...override,
  });

  describe('Eligibility Evaluation', () => {
    it('Scenario A/F: PENDING deliveries are immediately eligible', () => {
      const record = createDummyRecord({ status: DeliveryStatus.PENDING, attemptCount: 0 });
      expect(retryPolicy.isEligibleForRetry(record)).toBe(true);
    });

    it('Scenario S: DELIVERED deliveries are never eligible', () => {
      const record = createDummyRecord({ status: DeliveryStatus.DELIVERED, attemptCount: 1 });
      expect(retryPolicy.isEligibleForRetry(record)).toBe(false);
    });

    it('Scenario L: Active PROCESSING deliveries are never eligible via retry policy', () => {
      const record = createDummyRecord({ status: DeliveryStatus.PROCESSING, attemptCount: 1 });
      expect(retryPolicy.isEligibleForRetry(record)).toBe(false);
    });

    it('Scenario G: FAILED deliveries with attemptCount >= maxAttempts are blocked as exhausted', () => {
      const record = createDummyRecord({ status: DeliveryStatus.FAILED, attemptCount: 3 });
      expect(retryPolicy.isExhausted(record)).toBe(true);
      expect(retryPolicy.isEligibleForRetry(record)).toBe(false);
    });

    it('Scenario F/H: FAILED delivery below maxAttempts is eligible only after backoff delay', () => {
      const now = new Date('2026-09-11T12:00:10Z');
      // Attempt 1: backoff delay = 1000ms (1s)
      const recentFailure = createDummyRecord({
        status: DeliveryStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date('2026-09-11T12:00:09.500Z').toISOString(), // 500ms ago
      });
      expect(retryPolicy.isEligibleForRetry(recentFailure, now)).toBe(false);

      const readyFailure = createDummyRecord({
        status: DeliveryStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date('2026-09-11T12:00:08.000Z').toISOString(), // 2s ago
      });
      expect(retryPolicy.isEligibleForRetry(readyFailure, now)).toBe(true);
    });
  });

  describe('Exponential Backoff & Cap', () => {
    it('Scenario I: Calculates exponential backoff with configurable cap', () => {
      // attempt 1: baseDelay * 2^0 = 1000ms
      expect(retryPolicy.calculateBackoffDelayMs(1)).toBe(1_000);

      // attempt 2: baseDelay * 2^1 = 2000ms
      expect(retryPolicy.calculateBackoffDelayMs(2)).toBe(2_000);

      // attempt 3: baseDelay * 2^2 = 4000ms
      expect(retryPolicy.calculateBackoffDelayMs(3)).toBe(4_000);

      // attempt 10: baseDelay * 2^9 = 512,000ms -> capped at maxDelayMs (10,000ms)
      expect(retryPolicy.calculateBackoffDelayMs(10)).toBe(10_000);
    });

    it('Scenario H: getNextAttemptTime returns null when exhausted or delivered', () => {
      const delivered = createDummyRecord({ status: DeliveryStatus.DELIVERED });
      expect(retryPolicy.getNextAttemptTime(delivered)).toBeNull();

      const exhausted = createDummyRecord({ status: DeliveryStatus.FAILED, attemptCount: 3 });
      expect(retryPolicy.getNextAttemptTime(exhausted)).toBeNull();
    });

    it('Scenario H: getNextAttemptTime returns valid target Date for pending/retryable records', () => {
      const pending = createDummyRecord({ status: DeliveryStatus.PENDING });
      expect(retryPolicy.getNextAttemptTime(pending)).toBeInstanceOf(Date);

      const failed = createDummyRecord({
        status: DeliveryStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date('2026-09-11T12:00:00Z').toISOString(),
      });
      const nextTime = retryPolicy.getNextAttemptTime(failed);
      expect(nextTime?.toISOString()).toBe('2026-09-11T12:00:01.000Z');
    });
  });

  describe('Configuration Sanitization (Phase 29.7)', () => {
    it('applies default configuration when empty object is passed', () => {
      const policy = new NotificationDeliveryRetryPolicy({});
      const config = policy.getConfig();
      expect(config.maxAttempts).toBe(5);
      expect(config.baseDelayMs).toBe(10_000);
      expect(config.maxDelayMs).toBe(3_600_000);
      expect(config.backoffMultiplier).toBe(2);
    });

    it('safely normalizes invalid maxAttempts (0, negative, NaN)', () => {
      const policyZero = new NotificationDeliveryRetryPolicy({ maxAttempts: 0 });
      expect(policyZero.getConfig().maxAttempts).toBe(5);

      const policyNeg = new NotificationDeliveryRetryPolicy({ maxAttempts: -3 });
      expect(policyNeg.getConfig().maxAttempts).toBe(5);

      const policyNaN = new NotificationDeliveryRetryPolicy({ maxAttempts: NaN });
      expect(policyNaN.getConfig().maxAttempts).toBe(5);
    });

    it('safely normalizes invalid baseDelayMs and maxDelayMs', () => {
      const policyInvalid = new NotificationDeliveryRetryPolicy({
        baseDelayMs: -100,
        maxDelayMs: NaN,
      });
      const config = policyInvalid.getConfig();
      expect(config.baseDelayMs).toBe(10_000);
      expect(config.maxDelayMs).toBe(3_600_000);
    });

    it('ensures maxDelayMs is at least baseDelayMs when maxDelayMs < baseDelayMs', () => {
      const policySwapped = new NotificationDeliveryRetryPolicy({
        baseDelayMs: 20_000,
        maxDelayMs: 5_000,
      });
      const config = policySwapped.getConfig();
      expect(config.baseDelayMs).toBe(20_000);
      expect(config.maxDelayMs).toBe(20_000);
    });

    it('safely normalizes invalid backoffMultiplier', () => {
      const policy = new NotificationDeliveryRetryPolicy({ backoffMultiplier: -1 });
      expect(policy.getConfig().backoffMultiplier).toBe(2);
    });
  });
});
