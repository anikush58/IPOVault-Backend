import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliveryOperationsService } from './notification-delivery-operations.service';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { NotificationDeliveryRetryPolicy } from './notification-delivery-retry-policy';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';

describe('NotificationDeliveryOperationsService (Phase 29.8)', () => {
  let operationsService: NotificationDeliveryOperationsService;
  let deliveryRepository: jest.Mocked<NotificationDeliveryRepository>;

  beforeEach(async () => {
    const mockRepo = {
      getAggregateOperationalStats: jest.fn(),
      getRecentHealthStats: jest.fn(),
    };

    const mockRetryPolicy = {
      getConfig: jest.fn().mockReturnValue({
        maxAttempts: 5,
        baseDelayMs: 10_000,
        maxDelayMs: 3_600_000,
        backoffMultiplier: 2,
      }),
    };

    const mockWorkerService = {
      getConfig: jest.fn().mockReturnValue({
        enabled: true,
        batchSize: 50,
        intervalMs: 10_000,
        staleLeaseTimeoutMs: 300_000, // 5 min
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryOperationsService,
        { provide: NotificationDeliveryRepository, useValue: mockRepo },
        { provide: NotificationDeliveryRetryPolicy, useValue: mockRetryPolicy },
        { provide: NotificationDeliveryWorkerService, useValue: mockWorkerService },
      ],
    }).compile();

    operationsService = module.get<NotificationDeliveryOperationsService>(
      NotificationDeliveryOperationsService,
    );
    deliveryRepository = module.get(NotificationDeliveryRepository);
  });

  it('returns empty/zero health metrics when database has no delivery records', async () => {
    deliveryRepository.getAggregateOperationalStats.mockResolvedValue({
      totalDeliveries: 0,
      pendingCount: 0,
      processingCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      exhaustedFailedCount: 0,
      retryableFailedCount: 0,
      staleProcessingCount: 0,
      oldestPendingDeliveryAgeMs: null,
      oldestRetryableFailedDeliveryAgeMs: null,
      oldestProcessingDeliveryAgeMs: null,
    });

    deliveryRepository.getRecentHealthStats.mockResolvedValue({
      deliveriesCreated: 0,
      delivered: 0,
      failed: 0,
      exhausted: 0,
      retryAttempts: 0,
    });

    const summary = await operationsService.getDeliveryOperationsSummary();

    expect(summary.totalDeliveries).toBe(0);
    expect(summary.pendingCount).toBe(0);
    expect(summary.processingCount).toBe(0);
    expect(summary.deliveredCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.exhaustedFailedCount).toBe(0);
    expect(summary.retryableFailedCount).toBe(0);
    expect(summary.staleProcessingCount).toBe(0);
    expect(summary.oldestPendingDeliveryAgeMs).toBeNull();
    expect(summary.oldestRetryableFailedDeliveryAgeMs).toBeNull();
    expect(summary.oldestProcessingDeliveryAgeMs).toBeNull();
    expect(summary.deliverySuccessRatePercentage).toBe(0);
    expect(summary.deliveryFailureRatePercentage).toBe(0);
    expect(summary.recentHealth.windowMs).toBe(86_400_000);
    expect(summary.recentHealth.deliveriesCreated).toBe(0);
  });

  it('correctly aggregates counts, success/failure rates, ages, and recent 24h health', async () => {
    deliveryRepository.getAggregateOperationalStats.mockResolvedValue({
      totalDeliveries: 100,
      pendingCount: 10,
      processingCount: 5,
      deliveredCount: 75,
      failedCount: 10,
      exhaustedFailedCount: 2,
      retryableFailedCount: 8,
      staleProcessingCount: 1,
      oldestPendingDeliveryAgeMs: 120_000,
      oldestRetryableFailedDeliveryAgeMs: 45_000,
      oldestProcessingDeliveryAgeMs: 350_000,
    });

    deliveryRepository.getRecentHealthStats.mockResolvedValue({
      deliveriesCreated: 40,
      delivered: 35,
      failed: 5,
      exhausted: 1,
      retryAttempts: 12,
    });

    const summary = await operationsService.getDeliveryOperationsSummary();

    expect(summary.totalDeliveries).toBe(100);
    expect(summary.pendingCount).toBe(10);
    expect(summary.processingCount).toBe(5);
    expect(summary.deliveredCount).toBe(75);
    expect(summary.failedCount).toBe(10);
    expect(summary.exhaustedFailedCount).toBe(2);
    expect(summary.retryableFailedCount).toBe(8);
    expect(summary.staleProcessingCount).toBe(1);
    expect(summary.oldestPendingDeliveryAgeMs).toBe(120_000);
    expect(summary.oldestRetryableFailedDeliveryAgeMs).toBe(45_000);
    expect(summary.oldestProcessingDeliveryAgeMs).toBe(350_000);

    // completed = 75 + 10 = 85. success = (75 / 85) * 100 = 88.24%
    expect(summary.deliverySuccessRatePercentage).toBe(88.24);
    // failure = (10 / 85) * 100 = 11.76%
    expect(summary.deliveryFailureRatePercentage).toBe(11.76);

    expect(summary.recentHealth.deliveriesCreated).toBe(40);
    expect(summary.recentHealth.delivered).toBe(35);
    expect(summary.recentHealth.failed).toBe(5);
    expect(summary.recentHealth.exhausted).toBe(1);
    expect(summary.recentHealth.retryAttempts).toBe(12);
  });

  it('respects effective maxAttempts and staleLeaseTimeoutMs from retry policy and worker config', async () => {
    deliveryRepository.getAggregateOperationalStats.mockResolvedValue({
      totalDeliveries: 0,
      pendingCount: 0,
      processingCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      exhaustedFailedCount: 0,
      retryableFailedCount: 0,
      staleProcessingCount: 0,
      oldestPendingDeliveryAgeMs: null,
      oldestRetryableFailedDeliveryAgeMs: null,
      oldestProcessingDeliveryAgeMs: null,
    });
    deliveryRepository.getRecentHealthStats.mockResolvedValue({
      deliveriesCreated: 0,
      delivered: 0,
      failed: 0,
      exhausted: 0,
      retryAttempts: 0,
    });

    await operationsService.getDeliveryOperationsSummary(60_000);

    expect(deliveryRepository.getAggregateOperationalStats).toHaveBeenCalledWith(
      expect.objectContaining({
        maxAttempts: 5,
        staleThreshold: expect.any(Date),
      }),
    );
  });

  it('SECURITY REVIEW: output response contains zero sensitive fields (PAN, userId, titles, metadata)', async () => {
    deliveryRepository.getAggregateOperationalStats.mockResolvedValue({
      totalDeliveries: 5,
      pendingCount: 1,
      processingCount: 1,
      deliveredCount: 2,
      failedCount: 1,
      exhaustedFailedCount: 0,
      retryableFailedCount: 1,
      staleProcessingCount: 0,
      oldestPendingDeliveryAgeMs: 1000,
      oldestRetryableFailedDeliveryAgeMs: 2000,
      oldestProcessingDeliveryAgeMs: 3000,
    });
    deliveryRepository.getRecentHealthStats.mockResolvedValue({
      deliveriesCreated: 5,
      delivered: 2,
      failed: 1,
      exhausted: 0,
      retryAttempts: 1,
    });

    const summary = await operationsService.getDeliveryOperationsSummary();
    const jsonString = JSON.stringify(summary);

    expect(jsonString).not.toContain('userId');
    expect(jsonString).not.toContain('pan');
    expect(jsonString).not.toContain('panHash');
    expect(jsonString).not.toContain('panEncrypted');
    expect(jsonString).not.toContain('title');
    expect(jsonString).not.toContain('message');
    expect(jsonString).not.toContain('metadata');
    expect(jsonString).not.toContain('providerMessageId');
  });
});
