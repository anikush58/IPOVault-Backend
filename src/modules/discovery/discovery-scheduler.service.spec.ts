import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoverySchedulerService } from './discovery-scheduler.service';
import { NseDiscoveryFlow } from './nse-discovery.flow';
import { SebiDiscoveryFlow } from './adapters/sebi/sebi-discovery.flow';
import { DiscoveryProcessResult } from './discovery.types';

describe('DiscoverySchedulerService', () => {
  let service: DiscoverySchedulerService;
  let configService: jest.Mocked<ConfigService>;
  let nseFlow: jest.Mocked<NseDiscoveryFlow>;
  let sebiFlow: jest.Mocked<SebiDiscoveryFlow>;

  beforeEach(async () => {
    configService = {
      get: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    nseFlow = {
      ingestLive: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NseDiscoveryFlow>;

    sebiFlow = {
      run: jest.fn().mockResolvedValue({
        totalDiscovered: 0,
        duplicateCount: 0,
        createdRecordsCount: 0,
        downloadedDocumentsCount: 0,
        skippedDocumentsCount: 0,
        failedDownloadsCount: 0,
        canonicalCreatedCount: 0,
        canonicalMatchedCount: 0,
      }),
    } as unknown as jest.Mocked<SebiDiscoveryFlow>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoverySchedulerService,
        { provide: ConfigService, useValue: configService },
        { provide: NseDiscoveryFlow, useValue: nseFlow },
        { provide: SebiDiscoveryFlow, useValue: sebiFlow },
      ],
    }).compile();

    service = module.get<DiscoverySchedulerService>(DiscoverySchedulerService);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('1. should report DISABLED status when scheduler is disabled', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return false;
      return undefined;
    });

    const health = service.getHealth();

    expect(health.enabled).toBe(false);
    expect(health.status).toBe('DISABLED');
  });

  it('2. should report STARTING status before first cycle has executed', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    const health = service.getHealth();

    expect(health.enabled).toBe(true);
    expect(health.status).toBe('STARTING');
    expect(health.lastCycle).toBeNull();
  });

  it('3. should report HEALTHY status after a successful cycle', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    await service.tick();
    const health = service.getHealth();

    expect(health.status).toBe('HEALTHY');
    expect(health.lastCycle?.status).toBe('SUCCESS');
    expect(health.consecutiveFailureCount).toBe(0);
    expect(health.sources.nse.status).toBe('SUCCESS');
    expect(health.sources.sebi.status).toBe('SUCCESS');
  });

  it('4. should report DEGRADED status after partial success (one source fails)', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockRejectedValue(new Error('NSE network error'));
    await service.tick();
    const health = service.getHealth();

    expect(health.status).toBe('DEGRADED');
    expect(health.sources.nse.status).toBe('FAILED');
    expect(health.sources.sebi.status).toBe('SUCCESS');
    expect(health.consecutiveFailureCount).toBe(1);
  });

  it('5. should report FAILED status after consecutive cycle failures', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockRejectedValue(new Error('Fatal'));
    sebiFlow.run.mockRejectedValue(new Error('Fatal'));

    await service.tick();
    await service.tick();

    const health = service.getHealth();

    expect(health.status).toBe('FAILED');
    expect(health.consecutiveFailureCount).toBe(2);
  });

  it('6. should report STALE status when age exceeds 1.5 * intervalMs', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 10000;
      return undefined;
    });

    await service.tick();
    const completedAt = new Date(service.getHealth().lastCycle!.completedAt);

    // 1.5 * 10000ms = 15000ms stale threshold
    const freshTime = new Date(completedAt.getTime() + 10000);
    const staleTime = new Date(completedAt.getTime() + 16000);

    const freshHealth = service.getHealth(freshTime);
    expect(freshHealth.status).toBe('HEALTHY');

    const staleHealth = service.getHealth(staleTime);
    expect(staleHealth.status).toBe('STALE');
    expect(staleHealth.staleThresholdMs).toBe(15000);
  });

  it('7. should use configured interval to determine stale threshold', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 3600000; // 1 hour
      return undefined;
    });

    const health = service.getHealth();

    expect(health.intervalMs).toBe(3600000);
    expect(health.staleThresholdMs).toBe(5400000); // 1.5 hours
  });

  it('8. should increment consecutive failures on cycle failure and reset on success', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockRejectedValue(new Error('Error 1'));
    sebiFlow.run.mockRejectedValue(new Error('Error 1'));

    await service.tick();
    expect(service.getHealth().consecutiveFailureCount).toBe(1);

    nseFlow.ingestLive.mockResolvedValue([]);
    sebiFlow.run.mockResolvedValue({
      totalDiscovered: 0,
      duplicateCount: 0,
      createdRecordsCount: 0,
      downloadedDocumentsCount: 0,
      skippedDocumentsCount: 0,
      failedDownloadsCount: 0,
      canonicalCreatedCount: 0,
      canonicalMatchedCount: 0,
    });

    await service.tick();
    expect(service.getHealth().consecutiveFailureCount).toBe(0);
    expect(service.getHealth().status).toBe('HEALTHY');
  });

  it('9. should increment overlapSkipCount when tick overlaps', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    let resolveNse: (val: DiscoveryProcessResult[]) => void = () => {};
    nseFlow.ingestLive.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNse = resolve;
        }),
    );

    const firstTick = service.tick();
    await service.tick();

    expect(service.getHealth().overlapSkipCount).toBe(1);

    resolveNse([]);
    await firstTick;
  });

  it('10. should not expose sensitive fields (PANs, credentials, secrets) in health object', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    await service.tick();
    const health = service.getHealth();
    const jsonString = JSON.stringify(health);

    expect(jsonString).not.toContain('DATABASE_URL');
    expect(jsonString).not.toContain('password');
    expect(jsonString).not.toContain('secret');
    expect(jsonString).not.toContain('pan');
  });

  it('11. should clear timers on module destroy', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 300000;
      return undefined;
    });

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
