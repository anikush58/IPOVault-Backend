import { Test, TestingModule } from '@nestjs/testing';
import { ConsoleService } from './console.service';
import { PrismaService } from '../../database/prisma.service';
import { IpoService } from '../ipos/ipo.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationDeliveryOperationsService } from '../notifications/notification-delivery-operations.service';

describe('ConsoleService', () => {
  let service: ConsoleService;
  let prisma: Record<string, jest.Mock | Record<string, jest.Mock>>;
  let ipoService: Record<string, jest.Mock>;
  let analyticsService: Record<string, jest.Mock>;
  let notificationOpsService: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      ipo: {
        count: jest.fn().mockResolvedValue(10),
      },
      source: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'src-1',
            code: 'NSE',
            name: 'National Stock Exchange',
            sourceType: 'EXCHANGE',
            enabled: true,
          },
        ]),
      },
      discoveryRecord: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ sourceId: 'src-1', _count: { id: 100 } }]),
      },
      allotmentCheckJob: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ status: 'COMPLETED', _count: { id: 5 } }]),
      },
      allotmentCheckJobItem: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ status: 'ALLOTTED', _count: { id: 12 } }]),
      },
    };

    ipoService = {
      list: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      getById: jest.fn().mockResolvedValue({ id: 'ipo-1', symbol: 'TESTIPO' }),
      getTimeline: jest.fn().mockResolvedValue({ events: [] }),
      getSources: jest.fn().mockResolvedValue({ sources: [] }),
      getChanges: jest.fn().mockResolvedValue({ changes: [] }),
      getLineage: jest.fn().mockResolvedValue({ provenances: [] }),
      getQuality: jest
        .fn()
        .mockResolvedValue({ overallQualityStatus: 'COMPLETE' }),
    };

    analyticsService = {
      getDataQualitySummary: jest.fn().mockResolvedValue({
        totalIpos: 10,
        completeIposCount: 8,
        completenessScorePercentage: 80,
        freshnessScorePercentage: 100,
        unmappedSourceIdentityCount: 0,
      }),
    };

    notificationOpsService = {
      getDeliveryOperationsSummary: jest.fn().mockResolvedValue({
        totalDeliveries: 50,
        deliveredCount: 48,
        failedCount: 2,
        pendingCount: 0,
        processingCount: 0,
        deliverySuccessRatePercentage: 96,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: IpoService, useValue: ipoService },
        { provide: AnalyticsService, useValue: analyticsService },
        {
          provide: NotificationDeliveryOperationsService,
          useValue: notificationOpsService,
        },
      ],
    }).compile();

    service = module.get<ConsoleService>(ConsoleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return aggregated dashboard metrics', async () => {
    const res = await service.getDashboardSummary();
    expect(res).toBeDefined();
    expect(res.ipoCounts.total).toBe(10);
    expect(res.sourceHealth.totalSources).toBe(3);
    expect(res.notifications.deliveredCount).toBe(48);
    expect(res.allotment.completedJobs).toBe(5);
  });

  it('should query canonical IPO list via ipoService', async () => {
    await service.listIpos({ q: 'TEST', page: 1, limit: 10 });
    expect(ipoService.list).toHaveBeenCalledWith({
      q: 'TEST',
      status: undefined,
      marketSegment: undefined,
      exchange: undefined,
      page: 1,
      limit: 10,
    });
  });

  it('should get detailed IPO lineage and provenances', async () => {
    const res = await service.getIpoDetail('ipo-1');
    expect(res.id).toBe('ipo-1');
    expect(ipoService.getById).toHaveBeenCalledWith('ipo-1');
  });

  it('should return source health summary without exposing sensitive credentials', async () => {
    const res = await service.getSourceHealth();
    expect(res.totalSources).toBe(1);
    expect(res.sources[0].code).toBe('NSE');
    const jsonStr = JSON.stringify(res);
    expect(jsonStr).not.toContain('panEncrypted');
    expect(jsonStr).not.toContain('identifierHash');
    expect(jsonStr).not.toContain('password');
  });

  it('should return aggregate allotment ops stats without exposing PAN', async () => {
    const res = await service.getAllotmentOpsSummary();
    expect(res.completedJobs).toBe(5);
    expect(res.positiveAllotments).toBe(12);
    const jsonStr = JSON.stringify(res);
    expect(jsonStr).not.toContain('pan');
    expect(jsonStr).not.toContain('identifierHash');
  });
});
