import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IpoGuruSchedulerService } from './ipo-guru-scheduler.service';
import { IpoGuruService } from './ipo-guru.service';
import { IPOGURU_SCHEDULED_SLOTS } from './ipo-guru.types';

describe('IpoGuruSchedulerService Unit Tests', () => {
  let scheduler: IpoGuruSchedulerService;
  let mockIpoGuruService: any;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      if (key === 'IPOGURU_SCHEDULER_ENABLED') return true;
      if (key === 'IPOGURU_SCHEDULER_INTERVAL_MS') return 15000;
      return undefined;
    });

    mockIpoGuruService = {
      getPersistedUsageState: jest.fn().mockResolvedValue({
        istDate: '2026-09-23',
        totalRequestsToday: 0,
        autoRequestsToday: 0,
        manualRequestsToday: 0,
        lastRequestAt: null,
        lastSuccessAt: null,
        lastFetchStatus: 'IDLE',
        completedSlots: [],
      }),
      syncIpos: jest.fn().mockResolvedValue({
        totalFetched: 5,
        matchedUpdated: 3,
        newlyCreated: 2,
        skipped: 0,
        errorCount: 0,
        syncedAt: new Date().toISOString(),
        items: [],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpoGuruSchedulerService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
        {
          provide: IpoGuruService,
          useValue: mockIpoGuruService,
        },
      ],
    }).compile();

    scheduler = module.get<IpoGuruSchedulerService>(IpoGuruSchedulerService);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.resetAllMocks();
  });

  // ── 1. Four daily schedules recognition ─────────────────────────────────

  it('should declare exactly 4 daily schedules (10:00, 13:00, 15:00, 17:30 IST)', () => {
    expect(IPOGURU_SCHEDULED_SLOTS).toEqual(['10:00', '13:00', '15:00', '17:30']);
  });

  it('should find due slot for each scheduled time at exact minute', () => {
    // 10:00 AM IST = 600 minutes
    expect(scheduler.findDueSlot(600, [])).toBe('10:00');
    // 1:00 PM IST = 13:00 = 780 minutes
    expect(scheduler.findDueSlot(780, [])).toBe('13:00');
    // 3:00 PM IST = 15:00 = 900 minutes
    expect(scheduler.findDueSlot(900, [])).toBe('15:00');
    // 5:30 PM IST = 17:30 = 1050 minutes
    expect(scheduler.findDueSlot(1050, [])).toBe('17:30');
  });

  it('should trigger automatic sync when slot is due at 10:00 AM IST', async () => {
    // 10:00 AM IST = 04:30 UTC
    const at10amIst = new Date('2026-09-23T04:30:00.000Z');
    const result = await scheduler.tick(at10amIst);

    expect(result.triggered).toBe(true);
    expect(result.slot).toBe('10:00');
    expect(mockIpoGuruService.syncIpos).toHaveBeenCalledWith('AUTO', '10:00');
  });

  it('should trigger automatic sync when slot is due at 5:30 PM IST', async () => {
    // 5:30 PM IST = 12:00 UTC
    const at530pmIst = new Date('2026-09-23T12:00:00.000Z');
    const result = await scheduler.tick(at530pmIst);

    expect(result.triggered).toBe(true);
    expect(result.slot).toBe('17:30');
    expect(mockIpoGuruService.syncIpos).toHaveBeenCalledWith('AUTO', '17:30');
  });

  // ── 2. Restart & duplicate execution protection ─────────────────────────

  it('should NOT re-execute a slot that was already completed today after service restart', async () => {
    mockIpoGuruService.getPersistedUsageState.mockResolvedValueOnce({
      istDate: '2026-09-23',
      totalRequestsToday: 1,
      autoRequestsToday: 1,
      manualRequestsToday: 0,
      lastRequestAt: '2026-09-23T04:30:00.000Z',
      completedSlots: ['10:00'],
    });

    // Server restarted and runs tick at 10:05 AM IST (04:35 UTC)
    const at1005amIst = new Date('2026-09-23T04:35:00.000Z');
    const result = await scheduler.tick(at1005amIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('NO_DUE_SLOT');
    expect(mockIpoGuruService.syncIpos).not.toHaveBeenCalled();
  });

  // ── 3. Missed schedules catch-up protection ─────────────────────────────

  it('should NOT trigger multiple catch-up requests if service was offline during earlier slots', async () => {
    // Server boots up at 2:10 PM IST (14:10 = 08:40 UTC)
    // 10:00 and 13:00 passed and are outside the 15-minute tolerance window
    mockIpoGuruService.getPersistedUsageState.mockResolvedValueOnce({
      istDate: '2026-09-23',
      totalRequestsToday: 0,
      autoRequestsToday: 0,
      manualRequestsToday: 0,
      lastRequestAt: null,
      completedSlots: [],
    });

    const at210pmIst = new Date('2026-09-23T08:40:00.000Z');
    const result = await scheduler.tick(at210pmIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('NO_DUE_SLOT');
    expect(mockIpoGuruService.syncIpos).not.toHaveBeenCalled();
  });

  // ── 4. Quota and rate-limit safety guards ────────────────────────────────

  it('should skip tick when 10-request daily hard limit is reached', async () => {
    mockIpoGuruService.getPersistedUsageState.mockResolvedValueOnce({
      istDate: '2026-09-23',
      totalRequestsToday: 10,
      autoRequestsToday: 3,
      manualRequestsToday: 7,
      lastRequestAt: '2026-09-23T04:00:00.000Z',
      completedSlots: ['10:00', '13:00', '15:00'],
    });

    const at530pmIst = new Date('2026-09-23T12:00:00.000Z');
    const result = await scheduler.tick(at530pmIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('DAILY_TOTAL_LIMIT_REACHED');
    expect(mockIpoGuruService.syncIpos).not.toHaveBeenCalled();
  });

  it('should skip tick when 4-slot daily auto quota is reached', async () => {
    mockIpoGuruService.getPersistedUsageState.mockResolvedValueOnce({
      istDate: '2026-09-23',
      totalRequestsToday: 4,
      autoRequestsToday: 4,
      manualRequestsToday: 0,
      lastRequestAt: '2026-09-23T11:00:00.000Z',
      completedSlots: ['10:00', '13:00', '15:00', '17:30'],
    });

    const at530pmIst = new Date('2026-09-23T12:00:00.000Z');
    const result = await scheduler.tick(at530pmIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('DAILY_AUTO_LIMIT_REACHED');
    expect(mockIpoGuruService.syncIpos).not.toHaveBeenCalled();
  });

  it('should skip tick when 1-minute rate-limit window is active', async () => {
    mockIpoGuruService.getPersistedUsageState.mockResolvedValueOnce({
      istDate: '2026-09-23',
      totalRequestsToday: 1,
      autoRequestsToday: 0,
      manualRequestsToday: 1,
      lastRequestAt: '2026-09-23T04:29:45.000Z', // 15 seconds ago
      completedSlots: [],
    });

    const at10amIst = new Date('2026-09-23T04:30:00.000Z');
    const result = await scheduler.tick(at10amIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe('RATE_LIMIT_WAIT');
    expect(mockIpoGuruService.syncIpos).not.toHaveBeenCalled();
  });

  // ── 5. Error containment ────────────────────────────────────────────────

  it('should safely contain tick execution failure without throwing', async () => {
    mockIpoGuruService.syncIpos.mockRejectedValueOnce(new Error('Network failure'));

    const at10amIst = new Date('2026-09-23T04:30:00.000Z');
    const result = await scheduler.tick(at10amIst);

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain('ERROR: Network failure');
  });
});
