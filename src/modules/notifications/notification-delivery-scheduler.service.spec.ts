import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliverySchedulerService } from './notification-delivery-scheduler.service';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';

describe('NotificationDeliverySchedulerService (Phase 29.6)', () => {
  let schedulerService: NotificationDeliverySchedulerService;
  let workerService: jest.Mocked<NotificationDeliveryWorkerService>;

  beforeEach(async () => {
    jest.useFakeTimers();

    const mockWorker = {
      getConfig: jest.fn().mockReturnValue({
        enabled: true,
        intervalMs: 5000,
        batchSize: 50,
        staleLeaseTimeoutMs: 300000,
      }),
      processBatch: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliverySchedulerService,
        { provide: NotificationDeliveryWorkerService, useValue: mockWorker },
      ],
    }).compile();

    schedulerService = module.get<NotificationDeliverySchedulerService>(
      NotificationDeliverySchedulerService,
    );
    workerService = module.get(NotificationDeliveryWorkerService);
  });

  afterEach(() => {
    schedulerService.onModuleDestroy();
    jest.useRealTimers();
  });

  it('Scenario P: Sets interval timer onModuleInit when enabled', () => {
    schedulerService.onModuleInit();
    expect(workerService.processBatch).not.toHaveBeenCalled();

    // Fast forward 5 seconds (1 tick)
    jest.advanceTimersByTime(5000);
    expect(workerService.processBatch).toHaveBeenCalledTimes(1);

    // Fast forward another 5 seconds (2 ticks)
    jest.advanceTimersByTime(5000);
    expect(workerService.processBatch).toHaveBeenCalledTimes(2);
  });

  it('Scenario O: Does not start timer if worker config is disabled', () => {
    workerService.getConfig.mockReturnValue({
      enabled: false,
      intervalMs: 5000,
      batchSize: 50,
      staleLeaseTimeoutMs: 300000,
    });

    schedulerService.onModuleInit();
    jest.advanceTimersByTime(10000);

    expect(workerService.processBatch).not.toHaveBeenCalled();
  });

  it('Scenario Q: Contains worker tick errors without throwing', async () => {
    workerService.processBatch.mockRejectedValue(new Error('Database connection reset'));

    await expect(schedulerService.tick()).resolves.not.toThrow();
    expect(workerService.processBatch).toHaveBeenCalled();
  });

  it('Clears interval timer onModuleDestroy', () => {
    schedulerService.onModuleInit();
    jest.advanceTimersByTime(5000);
    expect(workerService.processBatch).toHaveBeenCalledTimes(1);

    schedulerService.onModuleDestroy();
    jest.advanceTimersByTime(10000);
    expect(workerService.processBatch).toHaveBeenCalledTimes(1); // No new ticks
  });

  describe('Double-Registration & Lifecycle Safety (Phase 29.7)', () => {
    it('prevents double-registration if onModuleInit is called twice', () => {
      schedulerService.onModuleInit();
      schedulerService.onModuleInit(); // Second call should be guarded

      jest.advanceTimersByTime(5000);
      expect(workerService.processBatch).toHaveBeenCalledTimes(1);
    });

    it('ensures worker tick rejection does not terminate future scheduling', async () => {
      workerService.processBatch.mockRejectedValueOnce(new Error('Transient DB timeout'));

      schedulerService.onModuleInit();

      // First tick fails
      jest.advanceTimersByTime(5000);
      expect(workerService.processBatch).toHaveBeenCalledTimes(1);

      // Second tick should still fire normally
      jest.advanceTimersByTime(5000);
      expect(workerService.processBatch).toHaveBeenCalledTimes(2);
    });
  });
});
