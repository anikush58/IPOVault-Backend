import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { DiscoverySchedulerService } from '../modules/discovery/discovery-scheduler.service';

describe('HealthController', () => {
  let controller: HealthController;
  let healthService: jest.Mocked<HealthService>;
  let discoverySchedulerService: jest.Mocked<DiscoverySchedulerService>;

  beforeEach(async () => {
    healthService = {
      checkLiveness: jest.fn().mockReturnValue({ status: 'ok' }),
      checkReadiness: jest
        .fn()
        .mockResolvedValue({ status: 'ok', database: 'up' }),
    } as unknown as jest.Mocked<HealthService>;

    discoverySchedulerService = {
      getHealth: jest.fn().mockReturnValue({
        enabled: true,
        status: 'HEALTHY',
        intervalMs: 21600000,
        staleThresholdMs: 32400000,
        running: false,
        lastCycle: {
          cycleId: '11111111-1111-4111-8111-111111111111',
          status: 'SUCCESS',
          startedAt: '2026-09-12T10:00:00.000Z',
          completedAt: '2026-09-12T10:00:15.000Z',
          durationMs: 15000,
        },
        sources: {
          nse: { status: 'SUCCESS', durationMs: 200, recordsProcessed: 2 },
          sebi: {
            status: 'SUCCESS',
            durationMs: 14800,
            totalDiscovered: 25,
            canonicalCreated: 0,
          },
        },
        consecutiveFailureCount: 0,
        overlapSkipCount: 0,
      }),
    } as unknown as jest.Mocked<DiscoverySchedulerService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthService, useValue: healthService },
        {
          provide: DiscoverySchedulerService,
          useValue: discoverySchedulerService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should return liveness status on GET /health', () => {
    expect(controller.checkLiveness()).toEqual({ status: 'ok' });
  });

  it('should return readiness status on GET /ready', async () => {
    await expect(controller.checkReadiness()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('should return discovery scheduler health on GET /health/discovery', () => {
    const health = controller.getDiscoveryHealth();

    expect(health.enabled).toBe(true);
    expect(health.status).toBe('HEALTHY');
    expect(health.intervalMs).toBe(21600000);
    expect(health.lastCycle?.status).toBe('SUCCESS');
    expect(discoverySchedulerService.getHealth).toHaveBeenCalledTimes(1);
  });
});
