import {
  BrokerSyncSchedulerService,
  getIstDateString,
  isPostListingSyncWindow,
  isTradingDay,
} from './broker-sync-scheduler.service';
import { BrokerInvestmentService } from './broker-investment.service';

describe('BrokerSyncSchedulerService', () => {
  let service: BrokerSyncSchedulerService;
  let mockInvestmentService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockInvestmentService = {
      syncAllConnectedUpstoxAccounts: jest.fn().mockResolvedValue({
        processedCount: 2,
        successCount: 2,
        failureCount: 0,
        results: [
          { brokerAccountId: 'acc-1', status: 'SUCCESS' },
          { brokerAccountId: 'acc-2', status: 'SUCCESS' },
        ],
      }),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'BROKER_SYNC_SCHEDULER_ENABLED') return true;
        if (key === 'BROKER_SYNC_SCHEDULER_INTERVAL_MS') return 60000;
        return undefined;
      }),
    };

    service = new BrokerSyncSchedulerService(
      mockInvestmentService as unknown as BrokerInvestmentService,
      mockConfigService as any,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('Trading Day & Time Window Helpers', () => {
    it('isTradingDay correctly identifies Monday-Friday vs Saturday-Sunday in IST', () => {
      // 2026-09-21 is Monday
      const monday = new Date('2026-09-21T10:30:00Z');
      // 2026-09-25 is Friday
      const friday = new Date('2026-09-25T10:30:00Z');
      // 2026-09-26 is Saturday
      const saturday = new Date('2026-09-26T10:30:00Z');
      // 2026-09-27 is Sunday
      const sunday = new Date('2026-09-27T10:30:00Z');

      expect(isTradingDay(monday)).toBe(true);
      expect(isTradingDay(friday)).toBe(true);
      expect(isTradingDay(saturday)).toBe(false);
      expect(isTradingDay(sunday)).toBe(false);
    });

    it('isPostListingSyncWindow detects ~3:41 PM IST (10:11 UTC)', () => {
      // 10:11 UTC + 5:30 IST = 15:41 IST (3:41 PM) -> true
      const at341PmIst = new Date('2026-09-22T10:11:00Z');
      // 10:25 UTC + 5:30 IST = 15:55 IST -> true (within 15:41-16:11 window)
      const at355PmIst = new Date('2026-09-22T10:25:00Z');
      // 06:30 UTC + 5:30 IST = 12:00 IST -> false
      const at12PmIst = new Date('2026-09-22T06:30:00Z');

      expect(isPostListingSyncWindow(at341PmIst)).toBe(true);
      expect(isPostListingSyncWindow(at355PmIst)).toBe(true);
      expect(isPostListingSyncWindow(at12PmIst)).toBe(false);
    });

    it('getIstDateString returns YYYY-MM-DD in IST timezone', () => {
      // 2026-09-22 10:11 UTC is 2026-09-22 15:41 IST
      const date = new Date('2026-09-22T10:11:00Z');
      expect(getIstDateString(date)).toBe('2026-09-22');
    });
  });

  describe('Scheduled Tick Execution', () => {
    it('executes sync cycle when called on a trading day within 3:41 PM IST window', async () => {
      const tuesday341Pm = new Date('2026-09-22T10:11:00Z'); // 3:41 PM IST Tuesday

      const ran = await service.handleScheduledTick(tuesday341Pm);

      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);

      const health = service.getHealthStatus();
      expect(health.lastRunDate).toBe('2026-09-22');
      expect(health.lastRunResult).toEqual(
        expect.objectContaining({
          processedCount: 2,
          successCount: 2,
          failureCount: 0,
        }),
      );
    });

    it('skips execution on weekends', async () => {
      const sunday341Pm = new Date('2026-09-27T10:11:00Z');

      const ran = await service.handleScheduledTick(sunday341Pm);

      expect(ran).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).not.toHaveBeenCalled();
    });

    it('skips execution outside the 3:41 PM IST window', async () => {
      const tuesdayMorning = new Date('2026-09-22T04:30:00Z'); // 10:00 AM IST

      const ran = await service.handleScheduledTick(tuesdayMorning);

      expect(ran).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).not.toHaveBeenCalled();
    });

    it('runs only once per day (skips duplicate ticks on the same date)', async () => {
      const tuesday341PmFirst = new Date('2026-09-22T10:11:00Z');
      const tuesday341PmSecond = new Date('2026-09-22T10:12:00Z');

      const ranFirst = await service.handleScheduledTick(tuesday341PmFirst);
      expect(ranFirst).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);

      const ranSecond = await service.handleScheduledTick(tuesday341PmSecond);
      expect(ranSecond).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });
  });

  describe('Lifecycle Management', () => {
    it('starts timer when enabled in config and stops on module destroy', () => {
      service.onModuleInit();
      expect(service.getHealthStatus().enabled).toBe(true);

      service.onModuleDestroy();
    });

    it('does not start timer when disabled in config', () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'BROKER_SYNC_SCHEDULER_ENABLED') return false;
        return undefined;
      });

      const disabledService = new BrokerSyncSchedulerService(
        mockInvestmentService as unknown as BrokerInvestmentService,
        mockConfigService as any,
      );

      disabledService.onModuleInit();
      expect(disabledService.getHealthStatus().enabled).toBe(false);
      disabledService.onModuleDestroy();
    });
  });
});
