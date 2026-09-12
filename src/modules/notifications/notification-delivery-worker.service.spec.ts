import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import { DeliveryChannel, DeliveryRecord, DeliveryStatus } from './notification.types';
import { NotificationResponseDto } from './dto/notification.dto';

describe('NotificationDeliveryWorkerService (Phase 29.6)', () => {
  let workerService: NotificationDeliveryWorkerService;
  let deliveryRepository: jest.Mocked<NotificationDeliveryRepository>;
  let deliveryService: jest.Mocked<NotificationDeliveryService>;
  let retryPolicy: NotificationDeliveryRetryPolicy;

  const mockNotification: NotificationResponseDto = {
    id: 'notif-1',
    type: 'IPO_OPENED',
    title: 'IPO Opened',
    message: 'Test IPO is now open',
    relatedEntityType: null,
    relatedEntityId: null,
    metadata: null,
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  const createDummyDelivery = (override: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
    id: 'del-1',
    notificationId: 'notif-1',
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
    ...override,
  });

  beforeEach(async () => {
    const mockRepo = {
      recoverStaleDeliveries: jest.fn().mockResolvedValue(0),
      findEligibleDeliveries: jest.fn().mockResolvedValue([]),
      findDeliveryById: jest.fn().mockResolvedValue(createDummyDelivery({ status: DeliveryStatus.DELIVERED })),
    };

    const mockDeliveryService = {
      initDelivery: jest.fn().mockResolvedValue(undefined),
      retryDelivery: jest.fn().mockResolvedValue(createDummyDelivery({ status: DeliveryStatus.DELIVERED })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryWorkerService,
        { provide: NotificationDeliveryRepository, useValue: mockRepo },
        { provide: NotificationDeliveryService, useValue: mockDeliveryService },
        {
          provide: NotificationDeliveryRetryPolicy,
          useValue: new NotificationDeliveryRetryPolicy({
            maxAttempts: 3,
            baseDelayMs: 1000,
          }),
        },
      ],
    }).compile();

    workerService = module.get<NotificationDeliveryWorkerService>(NotificationDeliveryWorkerService);
    deliveryRepository = module.get(NotificationDeliveryRepository);
    deliveryService = module.get(NotificationDeliveryService);
    retryPolicy = module.get(NotificationDeliveryRetryPolicy);
  });

  it('Scenario O: Returns early when worker is disabled', async () => {
    const disabledWorker = new NotificationDeliveryWorkerService(
      deliveryRepository,
      deliveryService,
      retryPolicy,
      { get: (key: string, def: any) => (key === 'NOTIFICATION_WORKER_ENABLED' ? false : def) } as any,
    );

    const result = await disabledWorker.processBatch();
    expect(result.status).toBe('COMPLETED');
    expect(result.candidatesFound).toBe(0);
    expect(deliveryRepository.findEligibleDeliveries).not.toHaveBeenCalled();
  });

  it('Scenario A/B: Queries bounded candidates respecting batch size and maxAttempts', async () => {
    deliveryRepository.findEligibleDeliveries.mockResolvedValue([
      { delivery: createDummyDelivery({ id: 'd1' }), notification: mockNotification },
    ]);

    const result = await workerService.processBatch();
    expect(result.status).toBe('COMPLETED');
    expect(deliveryRepository.findEligibleDeliveries).toHaveBeenCalledWith(50, 3); // batchSize 50, maxAttempts 3
    expect(result.candidatesFound).toBe(1);
  });

  it('Scenario C/R: Invokes deliveryService for PENDING candidates and updates metrics', async () => {
    const pendingDel = createDummyDelivery({ id: 'd1', status: DeliveryStatus.PENDING });
    deliveryRepository.findEligibleDeliveries.mockResolvedValue([
      { delivery: pendingDel, notification: mockNotification },
    ]);
    deliveryRepository.findDeliveryById.mockResolvedValue({
      ...pendingDel,
      status: DeliveryStatus.DELIVERED,
      deliveredAt: new Date().toISOString(),
    });

    const result = await workerService.processBatch();

    expect(deliveryService.initDelivery).toHaveBeenCalledWith(mockNotification, DeliveryChannel.IN_APP);
    expect(result.succeededCount).toBe(1);
    expect(result.processedCount).toBe(1);
  });

  it('Scenario F: Retries FAILED candidates eligible by backoff timing', async () => {
    const failedDel = createDummyDelivery({
      id: 'd2',
      status: DeliveryStatus.FAILED,
      attemptCount: 1,
      lastAttemptAt: new Date(Date.now() - 5000).toISOString(),
    });
    deliveryRepository.findEligibleDeliveries.mockResolvedValue([
      { delivery: failedDel, notification: mockNotification },
    ]);
    deliveryRepository.findDeliveryById.mockResolvedValue({
      ...failedDel,
      status: DeliveryStatus.DELIVERED,
    });

    const result = await workerService.processBatch();

    expect(deliveryService.retryDelivery).toHaveBeenCalledWith('notif-1', DeliveryChannel.IN_APP, mockNotification);
    expect(result.succeededCount).toBe(1);
  });

  it('Scenario G: Skips exhausted FAILED candidates (attemptCount >= maxAttempts)', async () => {
    const exhaustedDel = createDummyDelivery({
      id: 'd3',
      status: DeliveryStatus.FAILED,
      attemptCount: 3,
    });
    deliveryRepository.findEligibleDeliveries.mockResolvedValue([
      { delivery: exhaustedDel, notification: mockNotification },
    ]);

    const result = await workerService.processBatch();

    expect(deliveryService.retryDelivery).not.toHaveBeenCalled();
    expect(result.exhaustedCount).toBe(1);
    expect(result.processedCount).toBe(0);
  });

  it('Scenario E: Isolated failure on item 1 does not break processing for item 2', async () => {
    const del1 = createDummyDelivery({ id: 'd1', status: DeliveryStatus.PENDING });
    const del2 = createDummyDelivery({ id: 'd2', status: DeliveryStatus.PENDING });

    deliveryRepository.findEligibleDeliveries.mockResolvedValue([
      { delivery: del1, notification: mockNotification },
      { delivery: del2, notification: mockNotification },
    ]);

    // First delivery throws inside initDelivery
    deliveryService.initDelivery
      .mockRejectedValueOnce(new Error('Adapter crashed unexpectedly'))
      .mockResolvedValueOnce(undefined);

    deliveryRepository.findDeliveryById.mockImplementation(async (id: string) => {
      if (id === 'd1') return { ...del1, status: DeliveryStatus.FAILED, failureReason: 'Adapter crashed' };
      return { ...del2, status: DeliveryStatus.DELIVERED };
    });

    const result = await workerService.processBatch();

    expect(result.processedCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.succeededCount).toBe(1);
    expect(deliveryService.initDelivery).toHaveBeenCalledTimes(2);
  });

  it('Scenario J/K/L/M: Recovers stale PROCESSING deliveries and leaves active leases alone', async () => {
    deliveryRepository.recoverStaleDeliveries.mockResolvedValue(2);

    const result = await workerService.processBatch();

    expect(deliveryRepository.recoverStaleDeliveries).toHaveBeenCalled();
    expect(result.staleRecoveredCount).toBe(2);
  });

  it('Scenario N/X: In-flight guard prevents overlapping batch iterations', async () => {
    deliveryRepository.findEligibleDeliveries.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100)),
    );

    // Trigger first batch asynchronously
    const firstPromise = workerService.processBatch();

    // Trigger second batch immediately while first is in flight
    const secondResult = await workerService.processBatch();

    expect(secondResult.status).toBe('SKIPPED_OVERLAP');

    await firstPromise;
  });

  it('Scenario V: Does not log sensitive PAN/hash data', async () => {
    const logSpy = jest.spyOn((workerService as any).logger, 'log');

    await workerService.processBatch();

    logSpy.mock.calls.forEach((call) => {
      const message = call[0] as string;
      expect(message).not.toContain('panEncrypted');
      expect(message).not.toContain('panHash');
      expect(message).not.toContain('identifierHash');
    });
  });

  describe('Configuration Sanitization & Enriched Metrics (Phase 29.7)', () => {
    it('sanitizes invalid environment variables to safe defaults', () => {
      const customWorker = new NotificationDeliveryWorkerService(
        deliveryRepository,
        deliveryService,
        retryPolicy,
        {
          get: (key: string, def: any) => {
            switch (key) {
              case 'NOTIFICATION_WORKER_ENABLED':
                return 'invalid-boolean';
              case 'NOTIFICATION_WORKER_BATCH_SIZE':
                return '-50';
              case 'NOTIFICATION_WORKER_INTERVAL_MS':
                return '0';
              case 'NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS':
                return 'abc';
              default:
                return def;
            }
          },
        } as any,
      );

      const config = customWorker.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.batchSize).toBe(50);
      expect(config.intervalMs).toBe(10_000);
      expect(config.staleLeaseTimeoutMs).toBe(300_000);
    });

    it('tracks detailed per-tick candidate metrics (pending, retry, claimed, item error counts)', async () => {
      const pendingDel = createDummyDelivery({ id: 'd1', status: DeliveryStatus.PENDING });
      const failedDel = createDummyDelivery({
        id: 'd2',
        status: DeliveryStatus.FAILED,
        attemptCount: 1,
        lastAttemptAt: new Date(Date.now() - 60_000).toISOString(),
      });

      deliveryRepository.findEligibleDeliveries.mockResolvedValue([
        { delivery: pendingDel, notification: mockNotification },
        { delivery: failedDel, notification: mockNotification },
      ]);

      deliveryService.initDelivery.mockResolvedValue(undefined);
      deliveryService.retryDelivery.mockRejectedValue(new Error('Retry failed completely'));

      deliveryRepository.findDeliveryById.mockImplementation(async (id: string) => {
        if (id === 'd1') return { ...pendingDel, status: DeliveryStatus.DELIVERED };
        return { ...failedDel, status: DeliveryStatus.FAILED, attemptCount: 2 };
      });

      const result = await workerService.processBatch();

      expect(result.pendingProcessedCount).toBe(1);
      expect(result.failedRetryProcessedCount).toBe(1);
      expect(result.claimedCount).toBe(1);
      expect(result.itemErrorCount).toBe(1);
      expect(result.succeededCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
