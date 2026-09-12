import { Test, TestingModule } from '@nestjs/testing';
import { MarketSegment, ExchangeListing, IpoStatus } from '@prisma/client';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsController } from './analytics.controller';
import {
  allotmentAnalyticsQuerySchema,
  marketAnalyticsQuerySchema,
  performanceAnalyticsQuerySchema,
  subscriptionAnalyticsQuerySchema,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsQualityStatus,
  AnalyticsTimePeriod,
  MetricAvailabilityStatus,
} from './analytics.types';

describe('AnalyticsController Unit Tests', () => {
  let controller: AnalyticsController;
  let service: jest.Mocked<AnalyticsService>;

  const mockMarketResponse: any = {
    filter: {},
    snapshot: { totalIpos: 10, openIposCount: 2 },
    marketSummary: { totalIpos: 10 },
    issueSizeDistribution: { minimumIssueSizeInr: 100 },
    issueShareCoverage: { knownIssueShareCount: 5 },
    bySegmentDetailed: [],
    byExchangeDetailed: { totalExchangeListingsCount: 10 },
    trends: { period: AnalyticsTimePeriod.MONTH, trendPoints: [] },
  };

  const mockPerformanceResponse: any = {
    filter: {},
    priceBandSummary: { totalIpos: 10, knownPriceBandCount: 8 },
    listingTimeline: { evaluatedIposCount: 10 },
    listingPerformance: { listingPerformanceSupported: false },
    bySegmentDetailed: [],
    trends: { period: AnalyticsTimePeriod.MONTH, trendPoints: [] },
  };

  const mockSubscriptionResponse: any = {
    filter: {},
    subscriptionSummary: {
      subscriptionSupported: false,
      unsupportedMetricReason:
        'Subscription demand metrics are FUTURE_DATA_DEPENDENT.',
    },
    categoryWise: { categories: [] },
    bySegmentDetailed: [],
    trends: { period: AnalyticsTimePeriod.MONTH, trendPoints: [] },
  };

  const mockAllotmentResponse: any = {
    filter: {},
    summary: {
      dataQuality: { totalRawObservations: 5, deduplicatedObservationsCount: 5 },
      outcomes: { observedPositiveAllotmentRatePercentage: 50.0 },
      disclaimer:
        'Observed allotment rates represent descriptive statistics of checked sample observations only.',
    },
    byIpoDetailed: [],
    bySegmentDetailed: [],
    trends: { period: AnalyticsTimePeriod.MONTH, trendPoints: [] },
    lotRatioMetricStatus: MetricAvailabilityStatus.FUTURE_DATA_DEPENDENT,
    lotRatioExplanation: 'Lot ratio analytics require uniform canonical lot size.',
  };

  const mockQualityResponse: any = {
    evaluatedAt: new Date().toISOString(),
    overallQualityStatus: AnalyticsQualityStatus.COMPLETE,
    disclaimer: 'Data quality describes canonical data reliability.',
    domains: {},
    provenance: {},
    sourceHealth: {},
    freshness: {},
    qualityGate: {},
    metricQualityContracts: [],
    activeWarnings: [],
  };

  beforeEach(async () => {
    const mockService = {
      getDetailedMarketAnalytics: jest.fn().mockResolvedValue(mockMarketResponse),
      getIpoPerformanceAnalytics: jest.fn().mockResolvedValue(mockPerformanceResponse),
      getSubscriptionDemandAnalytics: jest.fn().mockResolvedValue(mockSubscriptionResponse),
      getAllotmentAnalytics: jest.fn().mockResolvedValue(mockAllotmentResponse),
      getAnalyticsQualitySummary: jest.fn().mockResolvedValue(mockQualityResponse),
      getMetricContracts: jest.fn().mockReturnValue({ TOTAL_IPOS: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        {
          provide: AnalyticsService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    service = module.get(AnalyticsService);
  });

  describe('GET /api/v1/analytics/market', () => {
    it('should return market analytics for empty query', async () => {
      const queryPipe = new ZodValidationPipe(marketAnalyticsQuerySchema);
      const query = queryPipe.transform({});

      const result = await controller.getMarketAnalytics(query);

      expect(service.getDetailedMarketAnalytics).toHaveBeenCalledWith({});
      expect(result).toBe(mockMarketResponse);
    });

    it('should pass validated query filters to AnalyticsService', async () => {
      const rawQuery = {
        from: '2026-01-01',
        to: '2026-06-30',
        segment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        period: 'MONTH',
      };
      const queryPipe = new ZodValidationPipe(marketAnalyticsQuerySchema);
      const query = queryPipe.transform(rawQuery);

      await controller.getMarketAnalytics(query);

      expect(service.getDetailedMarketAnalytics).toHaveBeenCalledWith({
        from: '2026-01-01',
        to: '2026-06-30',
        segment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: IpoStatus.OPEN,
        period: AnalyticsTimePeriod.MONTH,
      });
    });

    it('should throw validation error when from > to', () => {
      const queryPipe = new ZodValidationPipe(marketAnalyticsQuerySchema);
      expect(() =>
        queryPipe.transform({ from: '2026-06-30', to: '2026-01-01' }),
      ).toThrow();
    });

    it('should throw validation error for invalid segment enum', () => {
      const queryPipe = new ZodValidationPipe(marketAnalyticsQuerySchema);
      expect(() => queryPipe.transform({ segment: 'INVALID' })).toThrow();
    });
  });

  describe('GET /api/v1/analytics/performance', () => {
    it('should return performance analytics', async () => {
      const queryPipe = new ZodValidationPipe(performanceAnalyticsQuerySchema);
      const query = queryPipe.transform({ segment: 'SME' });

      const result = await controller.getPerformanceAnalytics(query);

      expect(service.getIpoPerformanceAnalytics).toHaveBeenCalledWith({
        segment: MarketSegment.SME,
      });
      expect(result).toBe(mockPerformanceResponse);
    });
  });

  describe('GET /api/v1/analytics/subscription', () => {
    it('should return subscription analytics with FUTURE_DATA_DEPENDENT status', async () => {
      const queryPipe = new ZodValidationPipe(subscriptionAnalyticsQuerySchema);
      const query = queryPipe.transform({});

      const result = await controller.getSubscriptionAnalytics(query);

      expect(service.getSubscriptionDemandAnalytics).toHaveBeenCalledWith({});
      expect(result.subscriptionSummary.subscriptionSupported).toBe(false);
    });
  });

  describe('GET /api/v1/analytics/allotment', () => {
    it('should return allotment analytics', async () => {
      const queryPipe = new ZodValidationPipe(allotmentAnalyticsQuerySchema);
      const query = queryPipe.transform({ period: 'MONTH' });

      const result = await controller.getAllotmentAnalytics(query);

      expect(service.getAllotmentAnalytics).toHaveBeenCalledWith({
        period: AnalyticsTimePeriod.MONTH,
      });
      expect(result).toBe(mockAllotmentResponse);
    });

    it('should satisfy privacy requirements and contain zero sensitive PAN fields', async () => {
      const queryPipe = new ZodValidationPipe(allotmentAnalyticsQuerySchema);
      const query = queryPipe.transform({});

      const result = await controller.getAllotmentAnalytics(query);
      const jsonStr = JSON.stringify(result);

      expect(jsonStr).not.toContain('panEncrypted');
      expect(jsonStr).not.toContain('panMasked');
      expect(jsonStr).not.toContain('identifierValue');
      expect(jsonStr).not.toContain('rawPayload');
    });
  });

  describe('GET /api/v1/analytics/quality', () => {
    it('should return quality summary', async () => {
      const result = await controller.getQualityAnalytics();

      expect(service.getAnalyticsQualitySummary).toHaveBeenCalled();
      expect(result).toBe(mockQualityResponse);
    });
  });

  describe('GET /api/v1/analytics/contracts', () => {
    it('should return metric contracts registry', async () => {
      const result = await controller.getMetricContracts();

      expect(service.getMetricContracts).toHaveBeenCalled();
      expect(result).toEqual({ TOTAL_IPOS: {} });
    });
  });
});
