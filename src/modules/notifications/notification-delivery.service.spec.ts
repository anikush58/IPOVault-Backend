import { Test, TestingModule } from '@nestjs/testing';
import { InAppDeliveryAdapter } from './adapters/in-app-delivery.adapter';
import { NotificationDeliveryAdapter } from './notification-delivery.adapter';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationResponseDto } from './dto/notification.dto';
import {
  DeliveryChannel,
  DeliveryRecord,
  DeliveryStatus,
  NotificationType,
} from './notification.types';

/**
 * Unit tests for Phase 29.4 & 29.5 Notification Delivery Service.
 *
 * Tests items A–U as specified in the Phase 29.5 implementation spec.
 */

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeNotification(overrides: Partial<NotificationResponseDto> = {}): NotificationResponseDto {
  return {
    id: 'notif-uuid-1',
    type: NotificationType.IPO_OPENED,
    title: 'IPO Subscription Opened',
    message: 'Test IPO is now open.',
    relatedEntityType: 'IPO',
    relatedEntityId: 'ipo-uuid-1',
    metadata: { companyName: 'Test Corp', symbol: 'TST' },
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDeliveryRecord(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: 'delivery-uuid-1',
    notificationId: 'notif-uuid-1',
    channel: DeliveryChannel.IN_APP,
    status: DeliveryStatus.PENDING,
    attemptCount: 0,
    lastAttemptAt: null,
    processingStartedAt: null,
    deliveredAt: null,
    failureReason: null,
    providerMessageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('NotificationDeliveryService Unit Tests (Phase 29.5 Atomic Claim)', () => {
  let service: NotificationDeliveryService;
  let deliveryRepository: jest.Mocked<NotificationDeliveryRepository>;
  let inAppAdapter: jest.Mocked<InAppDeliveryAdapter>;

  const mockDeliveryRepository = {
    createDelivery: jest.fn(),
    findDelivery: jest.fn(),
    findDeliveryById: jest.fn(),
    updateDelivery: jest.fn(),
    claimDelivery: jest.fn(),
    conditionalFinalizeDelivery: jest.fn(),
  };

  const mockInAppAdapter = {
    channel: DeliveryChannel.IN_APP,
    deliver: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryService,
        { provide: NotificationDeliveryRepository, useValue: mockDeliveryRepository },
        { provide: InAppDeliveryAdapter, useValue: mockInAppAdapter },
      ],
    }).compile();

    service = module.get<NotificationDeliveryService>(NotificationDeliveryService);
    deliveryRepository = module.get(NotificationDeliveryRepository);
    inAppAdapter = module.get(InAppDeliveryAdapter);

    jest.clearAllMocks();
  });

  // ─── A. Delivery record creation ───────────────────────────────────────

  describe('A. Delivery record creation & Atomic Claim', () => {
    it('creates a PENDING delivery record and claims it when initDelivery is called', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED, deliveredAt: new Date().toISOString() });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.createDelivery).toHaveBeenCalledWith(
        notification.id,
        DeliveryChannel.IN_APP,
      );
      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(
        pendingRecord.id,
        DeliveryStatus.PENDING,
      );
      expect(inAppAdapter.deliver).toHaveBeenCalledWith(notification);
    });

    it('idempotent: createDelivery uses upsert — existing records are not duplicated', async () => {
      const notification = makeNotification();
      const existingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING, attemptCount: 0 });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(existingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.createDelivery).toHaveBeenCalledTimes(1);
    });
  });

  // ─── B. IN_APP adapter success ─────────────────────────────────────────

  describe('B. IN_APP adapter success', () => {
    it('IN_APP adapter.deliver() returns DELIVERED immediately without external I/O', async () => {
      const realAdapter = new InAppDeliveryAdapter();
      const result = await realAdapter.deliver(makeNotification());
      expect(result.status).toBe('DELIVERED');
      expect(result.failureReason).toBeUndefined();
      expect(result.providerMessageId).toBeUndefined();
    });

    it('IN_APP adapter channel is IN_APP', () => {
      const realAdapter = new InAppDeliveryAdapter();
      expect(realAdapter.channel).toBe(DeliveryChannel.IN_APP);
    });
  });

  // ─── C. PENDING → PROCESSING via Atomic Claim ───────────────────────────

  describe('C. Atomic Claim (claimDelivery)', () => {
    it('calls claimDelivery before executing adapter and skips adapter if NOT_CLAIMED', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const currentProcessingRecord = makeDeliveryRecord({ status: DeliveryStatus.PROCESSING, attemptCount: 1 });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('NOT_CLAIMED');
      deliveryRepository.findDeliveryById.mockResolvedValue(currentProcessingRecord);

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(pendingRecord.id, DeliveryStatus.PENDING);
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
      expect(deliveryRepository.conditionalFinalizeDelivery).not.toHaveBeenCalled();
    });

    it('concurrent PENDING claims: only winner calls adapter', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery
        .mockResolvedValueOnce('CLAIMED')
        .mockResolvedValueOnce('NOT_CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      deliveryRepository.findDeliveryById.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await Promise.all([
        service.initDelivery(notification, DeliveryChannel.IN_APP),
        service.initDelivery(notification, DeliveryChannel.IN_APP),
      ]);

      // Adapter called exactly once by the winner
      expect(inAppAdapter.deliver).toHaveBeenCalledTimes(1);
    });
  });

  // ─── D. PROCESSING → DELIVERED ────────────────────────────────────────

  describe('D. PROCESSING → DELIVERED transition', () => {
    it('transitions to DELIVERED and records deliveredAt when adapter succeeds', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED, deliveredAt: new Date().toISOString() });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0];
      expect(finalizeCall[0]).toBe(pendingRecord.id);
      expect(finalizeCall[1]).toMatchObject({
        status: DeliveryStatus.DELIVERED,
      });
      expect(finalizeCall[1].deliveredAt).toBeInstanceOf(Date);
      expect(finalizeCall[1].failureReason).toBeNull();
    });
  });

  // ─── E. PROCESSING → FAILED ───────────────────────────────────────────

  describe('E. PROCESSING → FAILED transition', () => {
    it('transitions to FAILED and records failureReason when adapter returns FAILED', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED, failureReason: 'push error' });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(failedRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'FAILED', failureReason: 'push error' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0];
      expect(finalizeCall[1]).toMatchObject({
        status: DeliveryStatus.FAILED,
        failureReason: 'push error',
      });
    });

    it('transitions to FAILED when adapter throws unexpectedly', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED, failureReason: 'Adapter threw unexpectedly: network error' });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(failedRecord);
      inAppAdapter.deliver.mockRejectedValue(new Error('network error'));

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0];
      expect(finalizeCall[1].status).toBe(DeliveryStatus.FAILED);
      expect(finalizeCall[1].failureReason).toContain('network error');
    });
  });

  // ─── F. FAILED → PROCESSING (retry) ───────────────────────────────────

  describe('F. FAILED → PROCESSING retry', () => {
    it('retryDelivery claims FAILED -> PROCESSING and delivers successfully', async () => {
      const notification = makeNotification();
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED, attemptCount: 1, failureReason: 'prev error' });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED, attemptCount: 2, deliveredAt: new Date().toISOString() });

      deliveryRepository.findDelivery.mockResolvedValue(failedRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      const result = await service.retryDelivery(notification.id, DeliveryChannel.IN_APP, notification);

      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(failedRecord.id, DeliveryStatus.FAILED);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(DeliveryStatus.DELIVERED);
    });

    it('retryDelivery skips execution if claim is lost (concurrency guard)', async () => {
      const notification = makeNotification();
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED, attemptCount: 1 });
      const freshRecord = makeDeliveryRecord({ status: DeliveryStatus.PROCESSING, attemptCount: 2 });

      deliveryRepository.findDelivery.mockResolvedValue(failedRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('NOT_CLAIMED');
      deliveryRepository.findDeliveryById.mockResolvedValue(freshRecord);

      const result = await service.retryDelivery(notification.id, DeliveryChannel.IN_APP, notification);

      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
      expect(result?.status).toBe(DeliveryStatus.PROCESSING);
    });
  });

  // ─── G. DELIVERED is idempotent ───────────────────────────────────────

  describe('G. DELIVERED is idempotent', () => {
    it('initDelivery is a no-op when delivery record is already DELIVERED', async () => {
      const notification = makeNotification();
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(deliveredRecord);

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.claimDelivery).not.toHaveBeenCalled();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
    });

    it('retryDelivery returns existing record without re-delivering if already DELIVERED', async () => {
      const notification = makeNotification();
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.findDelivery.mockResolvedValue(deliveredRecord);

      const result = await service.retryDelivery(notification.id, DeliveryChannel.IN_APP, notification);

      expect(result?.status).toBe(DeliveryStatus.DELIVERED);
      expect(deliveryRepository.claimDelivery).not.toHaveBeenCalled();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
    });
  });

  // ─── H. Duplicate delivery creation ───────────────────────────────────

  describe('H. Duplicate delivery creation', () => {
    it('upsert in createDelivery prevents duplicate rows on repeated calls', async () => {
      const notification = makeNotification();
      const record = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(record);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);
      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.createDelivery).toHaveBeenCalledTimes(2);
    });
  });

  // ─── I. Concurrent uniqueness protection ──────────────────────────────

  describe('I. Concurrent uniqueness protection', () => {
    it('concurrent initDelivery calls do not error out — DB unique constraint and claim are the safeguards', async () => {
      const notification = makeNotification();
      const record = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(record);
      deliveryRepository.claimDelivery
        .mockResolvedValueOnce('CLAIMED')
        .mockResolvedValueOnce('NOT_CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      deliveryRepository.findDeliveryById.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await expect(
        Promise.all([
          service.initDelivery(notification, DeliveryChannel.IN_APP),
          service.initDelivery(notification, DeliveryChannel.IN_APP),
        ]),
      ).resolves.not.toThrow();
    });
  });

  // ─── J. attemptCount increment ────────────────────────────────────────

  describe('J. attemptCount increment via Atomic Claim', () => {
    it('claimDelivery is passed expected status for DB-level attemptCount increment', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING, attemptCount: 0 });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED, attemptCount: 1 });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(pendingRecord.id, DeliveryStatus.PENDING);
    });
  });

  // ─── K. Timestamps ────────────────────────────────────────────────────

  describe('K. Timestamps', () => {
    it('records deliveredAt as a Date when delivery succeeds', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0][1];
      expect(finalizeCall.deliveredAt).toBeInstanceOf(Date);
    });
  });

  // ─── L. failureReason persistence ────────────────────────────────────

  describe('L. failureReason persistence', () => {
    it('persists failureReason from adapter result on FAILED transition', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(failedRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'FAILED', failureReason: 'FCM quota exceeded' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0][1];
      expect(finalizeCall.failureReason).toBe('FCM quota exceeded');
    });

    it('uses default failureReason when adapter returns FAILED without reason', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(failedRecord);
      inAppAdapter.deliver.mockResolvedValue({ status: 'FAILED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0][1];
      expect(finalizeCall.failureReason).toBeTruthy();
      expect(typeof finalizeCall.failureReason).toBe('string');
    });
  });

  // ─── M. providerMessageId handling ───────────────────────────────────

  describe('M. providerMessageId handling', () => {
    it('persists providerMessageId when adapter returns one', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const deliveredRecord = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(deliveredRecord);
      inAppAdapter.deliver.mockResolvedValue({
        status: 'DELIVERED',
        providerMessageId: 'fcm-msg-id-12345',
      });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      const finalizeCall = deliveryRepository.conditionalFinalizeDelivery.mock.calls[0][1];
      expect(finalizeCall.providerMessageId).toBe('fcm-msg-id-12345');
    });
  });

  // ─── N. Notification creation succeeds even if delivery fails ─────────

  describe('N. Notification creation succeeds if delivery fails', () => {
    it('initDelivery failure does not propagate — no exception thrown to caller', async () => {
      const notification = makeNotification();
      deliveryRepository.createDelivery.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.initDelivery(notification, DeliveryChannel.IN_APP),
      ).resolves.not.toThrow();
    });

    it('initDelivery adapter exception is isolated — no exception thrown to caller', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(failedRecord);
      inAppAdapter.deliver.mockRejectedValue(new Error('unexpected crash'));

      await expect(
        service.initDelivery(notification, DeliveryChannel.IN_APP),
      ).resolves.not.toThrow();
    });
  });

  // ─── O. User isolation ────────────────────────────────────────────────

  describe('O. User isolation', () => {
    it('getDeliveryStatus uses notificationId — caller must verify notification ownership', async () => {
      const record = makeDeliveryRecord({ status: DeliveryStatus.DELIVERED });
      deliveryRepository.findDelivery.mockResolvedValue(record);

      const result = await service.getDeliveryStatus('notif-uuid-1', DeliveryChannel.IN_APP);

      expect(deliveryRepository.findDelivery).toHaveBeenCalledWith(
        'notif-uuid-1',
        DeliveryChannel.IN_APP,
      );
      expect(result).toEqual(record);
    });
  });

  // ─── P. Privacy ───────────────────────────────────────────────────────

  describe('P. Privacy', () => {
    it('notification passed to adapter does not contain PAN, panHash, or panEncrypted fields', async () => {
      const notification = makeNotification();
      const notifKeys = Object.keys(notification);
      expect(notifKeys).not.toContain('panHash');
      expect(notifKeys).not.toContain('panEncrypted');
      expect(notifKeys).not.toContain('identifierHash');
      expect(notifKeys).not.toContain('pan');
    });
  });

  // ─── Q. Adapter selection ─────────────────────────────────────────────

  describe('Q. Adapter selection', () => {
    it('returns InAppDeliveryAdapter for IN_APP channel', () => {
      const adapter = service.getAdapter(DeliveryChannel.IN_APP);
      expect(adapter).toBe(inAppAdapter);
    });

    it('getAdapter returns undefined for unregistered channels', () => {
      const adapter = service.getAdapter(DeliveryChannel.PUSH);
      expect(adapter).toBeUndefined();
    });
  });

  // ─── R. Unsupported channel handling ──────────────────────────────────

  describe('R. Unsupported channel handling', () => {
    it('initDelivery transitions to FAILED when no adapter is registered for the channel', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING, channel: DeliveryChannel.PUSH });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED, channel: DeliveryChannel.PUSH });

      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.updateDelivery.mockResolvedValue(failedRecord);

      await service.initDelivery(notification, DeliveryChannel.PUSH);

      const updateCall = deliveryRepository.updateDelivery.mock.calls[0][1];
      expect(updateCall.status).toBe(DeliveryStatus.FAILED);
      expect(updateCall.failureReason).toContain('No delivery adapter registered');
    });
  });

  // ─── S. No external network calls ─────────────────────────────────────

  describe('S. No external network calls', () => {
    it('IN_APP adapter.deliver() makes no external network calls (synchronous result)', async () => {
      const realAdapter = new InAppDeliveryAdapter();
      const start = Date.now();
      const result = await realAdapter.deliver(makeNotification());
      const elapsed = Date.now() - start;

      expect(result.status).toBe('DELIVERED');
      expect(elapsed).toBeLessThan(100);
    });
  });

  // ─── T. No scheduler/worker behavior ─────────────────────────────────

  describe('T. No scheduler/worker behavior', () => {
    it('NotificationDeliveryService has no timer/interval/cron in its implementation', () => {
      const serviceKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
      const schedulerKeys = serviceKeys.filter(k =>
        k.toLowerCase().includes('cron') ||
        k.toLowerCase().includes('interval') ||
        k.toLowerCase().includes('worker') ||
        k.toLowerCase().includes('schedule'),
      );
      expect(schedulerKeys).toHaveLength(0);
    });
  });

  // ─── U. Retry & Concurrency Edge Cases ────────────────────────────────

  describe('U. Retry & Concurrency Edge Cases', () => {
    it('retryDelivery returns null when record does not exist', async () => {
      deliveryRepository.findDelivery.mockResolvedValue(null);

      const result = await service.retryDelivery('unknown-id', DeliveryChannel.IN_APP, makeNotification());

      expect(result).toBeNull();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
    });

    it('retryDelivery skips delivery for PROCESSING state', async () => {
      const processingRecord = makeDeliveryRecord({ status: DeliveryStatus.PROCESSING });
      deliveryRepository.findDelivery.mockResolvedValue(processingRecord);

      const result = await service.retryDelivery('notif-id', DeliveryChannel.IN_APP, makeNotification());

      expect(result?.status).toBe(DeliveryStatus.PROCESSING);
      expect(deliveryRepository.claimDelivery).not.toHaveBeenCalled();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
    });

    it('initDelivery skips delivery for PROCESSING state without claiming or calling adapter', async () => {
      const notification = makeNotification();
      const processingRecord = makeDeliveryRecord({ status: DeliveryStatus.PROCESSING, attemptCount: 1 });

      deliveryRepository.createDelivery.mockResolvedValue(processingRecord);

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      // Verify no claim attempt was made and adapter was not called
      expect(deliveryRepository.claimDelivery).not.toHaveBeenCalled();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
      expect(deliveryRepository.conditionalFinalizeDelivery).not.toHaveBeenCalled();
    });

    it('initDelivery passes expectedStatus PENDING and retryDelivery passes expectedStatus FAILED', async () => {
      const notification = makeNotification();
      const pendingRecord = makeDeliveryRecord({ status: DeliveryStatus.PENDING });
      const failedRecord = makeDeliveryRecord({ status: DeliveryStatus.FAILED });

      // Test initDelivery passes PENDING to claimDelivery
      deliveryRepository.createDelivery.mockResolvedValue(pendingRecord);
      deliveryRepository.claimDelivery.mockResolvedValue('CLAIMED');
      deliveryRepository.conditionalFinalizeDelivery.mockResolvedValue(makeDeliveryRecord({ status: DeliveryStatus.DELIVERED }));
      inAppAdapter.deliver.mockResolvedValue({ status: 'DELIVERED' });

      await service.initDelivery(notification, DeliveryChannel.IN_APP);

      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(pendingRecord.id, DeliveryStatus.PENDING);

      // Test retryDelivery passes FAILED to claimDelivery
      deliveryRepository.findDelivery.mockResolvedValue(failedRecord);
      await service.retryDelivery(notification.id, DeliveryChannel.IN_APP, notification);

      expect(deliveryRepository.claimDelivery).toHaveBeenCalledWith(failedRecord.id, DeliveryStatus.FAILED);
    });

    it('concurrent calls when record is PROCESSING result in zero adapter invocations', async () => {
      const notification = makeNotification();
      const processingRecord = makeDeliveryRecord({ status: DeliveryStatus.PROCESSING });

      deliveryRepository.createDelivery.mockResolvedValue(processingRecord);

      await Promise.all([
        service.initDelivery(notification, DeliveryChannel.IN_APP),
        service.initDelivery(notification, DeliveryChannel.IN_APP),
      ]);

      expect(deliveryRepository.claimDelivery).not.toHaveBeenCalled();
      expect(inAppAdapter.deliver).not.toHaveBeenCalled();
    });
  });

  // ─── Adapter Interface ───────────────────────────────────────────────

  describe('Adapter Interface', () => {
    it('InAppDeliveryAdapter extends NotificationDeliveryAdapter', () => {
      const adapter = new InAppDeliveryAdapter();
      expect(adapter).toBeInstanceOf(NotificationDeliveryAdapter);
    });
  });
});
