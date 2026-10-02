import {
  BrokerSyncSchedulerService,
  getActiveSyncWindow,
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
      // 2026-09-21 is Monday (not holiday)
      const monday = new Date('2026-09-21T10:30:00Z');
      // 2026-09-25 is Friday (not holiday)
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

    it('isTradingDay returns false on Indian market holidays even if on a weekday', () => {
      // 2026-10-02 is Friday (Mahatma Gandhi Jayanti) -> Holiday
      const gandhiJayanti = new Date('2026-10-02T10:15:00Z');
      // 2026-08-15 is Saturday (Independence Day) -> Holiday & Weekend
      const independenceDay = new Date('2026-08-15T10:15:00Z');
      // 2026-01-26 is Monday (Republic Day) -> Holiday
      const republicDay = new Date('2026-01-26T10:15:00Z');

      expect(isTradingDay(gandhiJayanti)).toBe(false);
      expect(isTradingDay(independenceDay)).toBe(false);
      expect(isTradingDay(republicDay)).toBe(false);
    });

    it('detects all 5 scheduled IST sync windows correctly', () => {
      // 09:30 AM IST (04:00 UTC)
      const win0930 = new Date('2026-09-22T04:00:00Z');
      expect(getActiveSyncWindow(win0930)?.id).toBe('09:30');
      expect(isPostListingSyncWindow(win0930)).toBe(true);

      // 11:00 AM IST (05:30 UTC)
      const win1100 = new Date('2026-09-22T05:30:00Z');
      expect(getActiveSyncWindow(win1100)?.id).toBe('11:00');
      expect(isPostListingSyncWindow(win1100)).toBe(true);

      // 01:00 PM IST (07:30 UTC)
      const win1300 = new Date('2026-09-22T07:30:00Z');
      expect(getActiveSyncWindow(win1300)?.id).toBe('13:00');
      expect(isPostListingSyncWindow(win1300)).toBe(true);

      // 02:30 PM IST (09:00 UTC)
      const win1430 = new Date('2026-09-22T09:00:00Z');
      expect(getActiveSyncWindow(win1430)?.id).toBe('14:30');
      expect(isPostListingSyncWindow(win1430)).toBe(true);

      // 03:45 PM IST (10:15 UTC)
      const win1545 = new Date('2026-09-22T10:15:00Z');
      expect(getActiveSyncWindow(win1545)?.id).toBe('15:45');
      expect(isPostListingSyncWindow(win1545)).toBe(true);

      // 12:00 PM IST (06:30 UTC) -> outside all windows
      const offWindow = new Date('2026-09-22T06:30:00Z');
      expect(getActiveSyncWindow(offWindow)).toBeNull();
      expect(isPostListingSyncWindow(offWindow)).toBe(false);
    });

    it('getIstDateString returns YYYY-MM-DD in IST timezone', () => {
      const date = new Date('2026-09-22T10:15:00Z');
      expect(getIstDateString(date)).toBe('2026-09-22');
    });
  });

  describe('Scheduled Tick Execution', () => {
    it('executes sync cycle for 09:30 AM IST window on trading day', async () => {
      const time0930 = new Date('2026-09-22T04:05:00Z'); // 09:35 AM IST
      const ran = await service.handleScheduledTick(time0930);
      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('executes sync cycle for 11:00 AM IST window on trading day', async () => {
      const time1100 = new Date('2026-09-22T05:35:00Z'); // 11:05 AM IST
      const ran = await service.handleScheduledTick(time1100);
      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('executes sync cycle for 01:00 PM IST window on trading day', async () => {
      const time1300 = new Date('2026-09-22T07:35:00Z'); // 01:05 PM IST
      const ran = await service.handleScheduledTick(time1300);
      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('executes sync cycle for 02:30 PM IST window on trading day', async () => {
      const time1430 = new Date('2026-09-22T09:05:00Z'); // 02:35 PM IST
      const ran = await service.handleScheduledTick(time1430);
      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('executes sync cycle for 03:45 PM IST window on trading day', async () => {
      const time1545 = new Date('2026-09-22T10:20:00Z'); // 03:50 PM IST
      const ran = await service.handleScheduledTick(time1545);
      expect(ran).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('skips execution on market holidays even within a valid time window', async () => {
      const holidayTime = new Date('2026-10-02T10:15:00Z'); // 3:45 PM IST Gandhi Jayanti
      const ran = await service.handleScheduledTick(holidayTime);
      expect(ran).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).not.toHaveBeenCalled();
    });

    it('skips execution on weekends', async () => {
      const sundayTime = new Date('2026-09-27T05:30:00Z'); // Sunday 11:00 AM IST
      const ran = await service.handleScheduledTick(sundayTime);
      expect(ran).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).not.toHaveBeenCalled();
    });

    it('skips duplicate runs for the same window on the same trading day', async () => {
      const time1100First = new Date('2026-09-22T05:31:00Z');
      const time1100Second = new Date('2026-09-22T05:32:00Z');

      const ranFirst = await service.handleScheduledTick(time1100First);
      expect(ranFirst).toBe(true);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);

      const ranSecond = await service.handleScheduledTick(time1100Second);
      expect(ranSecond).toBe(false);
      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(1);
    });

    it('allows all 5 different windows to run sequentially on the same trading day', async () => {
      const t0930 = new Date('2026-09-22T04:00:00Z');
      const t1100 = new Date('2026-09-22T05:30:00Z');
      const t1300 = new Date('2026-09-22T07:30:00Z');
      const t1430 = new Date('2026-09-22T09:00:00Z');
      const t1545 = new Date('2026-09-22T10:15:00Z');

      expect(await service.handleScheduledTick(t0930)).toBe(true);
      expect(await service.handleScheduledTick(t1100)).toBe(true);
      expect(await service.handleScheduledTick(t1300)).toBe(true);
      expect(await service.handleScheduledTick(t1430)).toBe(true);
      expect(await service.handleScheduledTick(t1545)).toBe(true);

      expect(mockInvestmentService.syncAllConnectedUpstoxAccounts).toHaveBeenCalledTimes(5);

      const health = service.getHealthStatus(t1545);
      expect(health.executedWindowsToday).toEqual(['09:30', '11:00', '13:00', '14:30', '15:45']);
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
