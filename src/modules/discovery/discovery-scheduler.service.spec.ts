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

  it('1. should register no scheduler timer when scheduler is disabled', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return false;
      return undefined;
    });

    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    service.onModuleInit();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    const config = service.getConfig();
    expect(config.enabled).toBe(false);
  });

  it('2. should start interval timer when scheduler is enabled', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 300000;
      return undefined;
    });

    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    service.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
    service.onModuleDestroy();
  });

  it('3. should not execute discovery immediately on startup when initial delay is 0/default', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INITIAL_DELAY_MS') return 0;
      return undefined;
    });

    service.onModuleInit();

    expect(nseFlow.ingestLive).not.toHaveBeenCalled();
    expect(sebiFlow.run).not.toHaveBeenCalled();

    service.onModuleDestroy();
  });

  it('4. should execute discovery sequentially (NSE then SEBI) during tick', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    const callOrder: string[] = [];
    nseFlow.ingestLive.mockImplementation(async () => {
      callOrder.push('NSE');
      return [];
    });
    sebiFlow.run.mockImplementation(async () => {
      callOrder.push('SEBI');
      return {
        totalDiscovered: 5,
        duplicateCount: 0,
        createdRecordsCount: 5,
        downloadedDocumentsCount: 2,
        skippedDocumentsCount: 0,
        failedDownloadsCount: 0,
        canonicalCreatedCount: 1,
        canonicalMatchedCount: 0,
      };
    });

    const result = await service.tick();

    expect(result.status).toBe('SUCCESS');
    expect(callOrder).toEqual(['NSE', 'SEBI']);
    expect(result.sources.nse.status).toBe('SUCCESS');
    expect(result.sources.sebi.status).toBe('SUCCESS');
    expect(result.sources.sebi.totalDiscovered).toBe(5);
  });

  it('5. should skip overlapping tick when a cycle is already running', async () => {
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

    const firstTickPromise = service.tick();

    expect(service.isRunningCycle()).toBe(true);

    const secondTickResult = await service.tick();

    expect(secondTickResult.status).toBe('SKIPPED_OVERLAP');
    expect(secondTickResult.sources.nse.status).toBe('SKIPPED');

    resolveNse([]);
    await firstTickPromise;

    expect(service.isRunningCycle()).toBe(false);
  });

  it('6. should continue to execute SEBI when NSE discovery fails', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockRejectedValue(new Error('NSE network timeout'));
    sebiFlow.run.mockResolvedValue({
      totalDiscovered: 3,
      duplicateCount: 0,
      createdRecordsCount: 3,
      downloadedDocumentsCount: 1,
      skippedDocumentsCount: 0,
      failedDownloadsCount: 0,
      canonicalCreatedCount: 0,
      canonicalMatchedCount: 1,
    });

    const result = await service.tick();

    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.sources.nse.status).toBe('FAILED');
    expect(result.sources.nse.error).toBe('NSE network timeout');
    expect(result.sources.sebi.status).toBe('SUCCESS');
    expect(sebiFlow.run).toHaveBeenCalledTimes(1);
  });

  it('7. should contain SEBI failure and not crash scheduler when SEBI throws', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockResolvedValue([]);
    sebiFlow.run.mockRejectedValue(new Error('SEBI parse error'));

    const result = await service.tick();

    expect(result.status).toBe('PARTIAL_SUCCESS');
    expect(result.sources.nse.status).toBe('SUCCESS');
    expect(result.sources.sebi.status).toBe('FAILED');
    expect(result.sources.sebi.error).toBe('SEBI parse error');
  });

  it('8. should contain unexpected discovery exception and reset running flag', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      return undefined;
    });

    nseFlow.ingestLive.mockRejectedValue(new Error('Fatal error'));
    sebiFlow.run.mockRejectedValue(new Error('Fatal error'));

    const result = await service.tick();

    expect(result.status).toBe('FAILED');
    expect(service.isRunningCycle()).toBe(false);
  });

  it('9. should clear timer handles on module destroy', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 300000;
      if (key === 'DISCOVERY_SCHEDULER_INITIAL_DELAY_MS') return 5000;
      return undefined;
    });

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    service.onModuleInit();
    service.onModuleDestroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('10. should fall back to default interval when configured interval is invalid (<1000ms)', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return true;
      if (key === 'DISCOVERY_SCHEDULER_INTERVAL_MS') return 500; // invalid < 1000ms
      return undefined;
    });

    const config = service.getConfig();

    expect(config.intervalMs).toBe(21600000); // 6 hours default
  });

  it('11. should return DISABLED status when tick is invoked while disabled', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'DISCOVERY_SCHEDULER_ENABLED') return false;
      return undefined;
    });

    const result = await service.tick();

    expect(result.status).toBe('DISABLED');
    expect(nseFlow.ingestLive).not.toHaveBeenCalled();
    expect(sebiFlow.run).not.toHaveBeenCalled();
  });
});
