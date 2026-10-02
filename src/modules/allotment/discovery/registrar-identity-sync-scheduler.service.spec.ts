import { RegistrarIdentitySyncSchedulerService } from './registrar-identity-sync-scheduler.service';
import { SourceIdentitySyncService } from './source-identity-sync.service';
import { KfinIdentityDiscoveryAdapter } from './kfin-identity-discovery.adapter';
import { MufgIdentityDiscoveryAdapter } from './mufg-identity-discovery.adapter';
import { RegistrarSourceIdentitySyncSummary } from './registrar-identity-discovery.types';

describe('RegistrarIdentitySyncSchedulerService', () => {
  let scheduler: RegistrarIdentitySyncSchedulerService;
  let syncService: jest.Mocked<SourceIdentitySyncService>;
  let kfinDiscoveryAdapter: KfinIdentityDiscoveryAdapter;
  let mufgDiscoveryAdapter: MufgIdentityDiscoveryAdapter;

  const mockKfinSummary: RegistrarSourceIdentitySyncSummary = {
    registrarCode: 'KFINTECH',
    totalDiscovered: 5,
    noChangeCount: 4,
    discoveredCount: 1,
    changedCount: 0,
    unresolvedCount: 0,
    syncRecords: [],
    executedAt: new Date(),
  };

  const mockMufgSummary: RegistrarSourceIdentitySyncSummary = {
    registrarCode: 'MUFG_INTIME',
    totalDiscovered: 10,
    noChangeCount: 10,
    discoveredCount: 0,
    changedCount: 0,
    unresolvedCount: 0,
    syncRecords: [],
    executedAt: new Date(),
  };

  beforeEach(() => {
    jest.useFakeTimers();

    syncService = {
      syncRegistrarIdentities: jest.fn(),
    } as unknown as jest.Mocked<SourceIdentitySyncService>;

    kfinDiscoveryAdapter = new KfinIdentityDiscoveryAdapter();
    mufgDiscoveryAdapter = new MufgIdentityDiscoveryAdapter();

    scheduler = new RegistrarIdentitySyncSchedulerService(
      syncService,
      kfinDiscoveryAdapter,
      mufgDiscoveryAdapter,
    );
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('1. should execute scheduled discovery cycle across both KFin and MUFG adapters', async () => {
    syncService.syncRegistrarIdentities
      .mockResolvedValueOnce(mockKfinSummary)
      .mockResolvedValueOnce(mockMufgSummary);

    const result = await scheduler.tick();

    expect(result).toBeDefined();
    expect(result?.results['KFINTECH']?.success).toBe(true);
    expect(result?.results['KFINTECH']?.summary).toEqual(mockKfinSummary);
    expect(result?.results['MUFG_INTIME']?.success).toBe(true);
    expect(result?.results['MUFG_INTIME']?.summary).toEqual(mockMufgSummary);

    expect(syncService.syncRegistrarIdentities).toHaveBeenCalledTimes(2);
    expect(syncService.syncRegistrarIdentities).toHaveBeenNthCalledWith(
      1,
      kfinDiscoveryAdapter,
    );
    expect(syncService.syncRegistrarIdentities).toHaveBeenNthCalledWith(
      2,
      mufgDiscoveryAdapter,
    );
  });

  it('2. should prevent overlapping sync cycles when previous cycle is still active', async () => {
    let resolveFirst: (val: RegistrarSourceIdentitySyncSummary) => void;
    const slowPromise = new Promise<RegistrarSourceIdentitySyncSummary>((res) => {
      resolveFirst = res;
    });

    syncService.syncRegistrarIdentities.mockReturnValueOnce(slowPromise);

    // Start first tick (in-flight)
    const tick1 = scheduler.tick();

    // Trigger second tick while first is still running
    const tick2 = await scheduler.tick();

    expect(tick2).toBeNull(); // Overlap prevented

    // Complete first tick
    resolveFirst!(mockKfinSummary);
    await tick1;

    // Subsequent tick should run normally
    syncService.syncRegistrarIdentities.mockResolvedValueOnce(mockKfinSummary);
    const tick3 = await scheduler.tick();
    expect(tick3).toBeDefined();
  });

  it('3. should isolate failure on one adapter without crashing service or skipping other adapters', async () => {
    syncService.syncRegistrarIdentities
      .mockRejectedValueOnce(new Error('KFin network timeout'))
      .mockResolvedValueOnce(mockMufgSummary);

    const result = await scheduler.tick();

    expect(result).toBeDefined();
    expect(result?.results['KFINTECH']?.success).toBe(false);
    expect(result?.results['KFINTECH']?.error).toBe('KFin network timeout');
    expect(result?.results['MUFG_INTIME']?.success).toBe(true);
    expect(result?.results['MUFG_INTIME']?.summary).toEqual(mockMufgSummary);
  });

  it('4. should register initial startup and recurring interval timers on onModuleInit', async () => {
    const tickSpy = jest.spyOn(scheduler, 'tick').mockResolvedValue(null);

    scheduler.onModuleInit();

    // Advance past initialDelayMs (10,000ms)
    jest.advanceTimersByTime(10_000);
    expect(tickSpy).toHaveBeenCalledTimes(1);

    // Advance past recurring interval (21,600,000ms = 6h)
    jest.advanceTimersByTime(21_600_000);
    expect(tickSpy).toHaveBeenCalledTimes(2);
  });

  it('5. should clear timers cleanly on onModuleDestroy', () => {
    scheduler.onModuleInit();
    scheduler.onModuleDestroy();

    const tickSpy = jest.spyOn(scheduler, 'tick').mockResolvedValue(null);
    jest.advanceTimersByTime(30_000_000);
    expect(tickSpy).not.toHaveBeenCalled();
  });
});
