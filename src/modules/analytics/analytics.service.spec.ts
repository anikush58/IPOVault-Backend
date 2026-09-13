import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService (Phase 30.1 Foundation)', () => {
  let analyticsService: AnalyticsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const mockPrisma = {
      ipo: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      allotmentCheckLog: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn(),
      },
      allotmentCheckJobItem: {
        count: jest.fn(),
        groupBy: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      source: {
        findMany: jest.fn(),
      },
      fieldProvenance: {
        count: jest.fn(),
      },
      ipoLifecycleEvent: {
        groupBy: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    analyticsService = module.get<AnalyticsService>(AnalyticsService);
    prisma = module.get(PrismaService);
  });

  describe('Metric Contracts Registry', () => {
    it('returns canonical metric definitions contract map', () => {
      const contracts = analyticsService.getMetricContracts();
      expect(contracts).toHaveProperty('TOTAL_IPOS');
      expect(contracts).toHaveProperty('LISTING_GAIN_PERCENTAGE');
      expect(contracts.LISTING_GAIN_PERCENTAGE.availabilityStatus).toBe(
        'FUTURE_DATA_DEPENDENT',
      );
      expect(contracts.OBSERVED_POSITIVE_ALLOTMENT_RATE.availabilityStatus).toBe(
        'SUPPORTED',
      );
    });
  });

  describe('IPO Market Summary Analytics', () => {
    it('returns zero counts and null averages when database has no IPO records', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(0);
      (prisma.ipo.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([]);

      const summary = await analyticsService.getMarketSummary();

      expect(summary.totalIpos).toBe(0);
      expect(summary.byStatus.LISTED).toBe(0);
      expect(summary.bySegment.MAINBOARD).toBe(0);
      expect(summary.byExchange.NSE).toBe(0);
      expect(summary.issueSize.totalIssueSizeInr).toBe(0);
      expect(summary.issueSize.averageIssueSizeInr).toBeNull();
      expect(summary.issueSize.medianIssueSizeInr).toBeNull();
      expect(summary.issueSize.freshIssueVsOfsRatio).toBeNull();
      expect(summary.issueSize.totalIssueShareCount).toBe(0);
    });

    it('calculates aggregate issue size totals, averages, medians, and fresh/OFS ratio', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(2);
      (prisma.ipo.groupBy as jest.Mock).mockImplementation(async (args: any) => {
        if (args.by[0] === 'status') return [{ status: 'LISTED', _count: { id: 2 } }];
        if (args.by[0] === 'marketSegment')
          return [{ marketSegment: 'MAINBOARD', _count: { id: 2 } }];
        if (args.by[0] === 'exchange')
          return [{ exchange: 'NSE', _count: { id: 2 } }];
        return [];
      });

      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        {
          issueSize: 100_000_000,
          freshIssueSize: 60_000_000,
          ofsSize: 40_000_000,
          issueShareCount: 1_000_000,
          freshIssueShareCount: 600_000,
          ofsShareCount: 400_000,
        },
        {
          issueSize: 300_000_000,
          freshIssueSize: 150_000_000,
          ofsSize: 150_000_000,
          issueShareCount: 3_000_000,
          freshIssueShareCount: 1_500_000,
          ofsShareCount: 1_500_000,
        },
      ]);

      const summary = await analyticsService.getMarketSummary();

      expect(summary.totalIpos).toBe(2);
      expect(summary.byStatus.LISTED).toBe(2);
      expect(summary.bySegment.MAINBOARD).toBe(2);
      expect(summary.byExchange.NSE).toBe(2);

      expect(summary.issueSize.totalIssueSizeInr).toBe(400_000_000);
      expect(summary.issueSize.totalFreshIssueSizeInr).toBe(210_000_000);
      expect(summary.issueSize.totalOfsSizeInr).toBe(190_000_000);
      expect(summary.issueSize.averageIssueSizeInr).toBe(200_000_000);
      expect(summary.issueSize.medianIssueSizeInr).toBe(200_000_000);
      expect(summary.issueSize.freshIssueVsOfsRatio).toBe(1.1053);

      expect(summary.issueSize.totalIssueShareCount).toBe(4_000_000);
      expect(summary.issueSize.totalFreshIssueShareCount).toBe(2_100_000);
      expect(summary.issueSize.totalOfsShareCount).toBe(1_900_000);
    });
  });

  describe('IPO Performance Summary Analytics', () => {
    it('computes price band spreads and returns listingPerformanceSupported = false', async () => {
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        { priceBandLow: 100, priceBandHigh: 120 },
        { priceBandLow: 500, priceBandHigh: 550 },
      ]);

      const perf = await analyticsService.getPerformanceSummary();

      expect(perf.evaluatedCount).toBe(2);
      expect(perf.averagePriceBandSpreadInr).toBe(35); // (20 + 50) / 2
      expect(perf.averagePriceBandSpreadPercentage).toBe(15); // (20% + 10%) / 2
      expect(perf.listingPerformanceSupported).toBe(false);
      expect(perf.unsupportedMetricReason).toContain('FUTURE DATA DEPENDENT');
    });
  });

  describe('Allotment Observation Summary Analytics (Phase 28 Rules Preserved)', () => {
    it('deduplicates latest check log observation per (ipoId, identifierHash) and calculates descriptive allotment rate', async () => {
      (prisma.allotmentCheckLog.count as jest.Mock).mockResolvedValue(3);
      (prisma.allotmentCheckJobItem.count as jest.Mock).mockResolvedValue(1);

      (prisma.allotmentCheckLog.groupBy as jest.Mock).mockResolvedValue([
        { identifierHash: 'hash-1' },
        { identifierHash: 'hash-2' },
      ]);
      (prisma.allotmentCheckJobItem.groupBy as jest.Mock).mockResolvedValue([
        { identifierHash: 'hash-1' },
      ]);

      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        {
          ipoId: 'ipo-1',
          identifierHash: 'hash-1',
          status: 'ALLOTTED',
          checkedAt: new Date('2026-09-11T12:00:00Z'),
        },
        {
          ipoId: 'ipo-1',
          identifierHash: 'hash-2',
          status: 'NOT_ALLOTTED',
          checkedAt: new Date('2026-09-11T12:00:00Z'),
        },
      ]);

      const allotmentSummary = await analyticsService.getAllotmentSummary();

      expect(allotmentSummary.totalCheckLogs).toBe(3);
      expect(allotmentSummary.totalJobItems).toBe(1);
      expect(allotmentSummary.distinctIdentifiersChecked).toBe(2);
      expect(allotmentSummary.deduplicatedObservationsCount).toBe(2);
      expect(allotmentSummary.observedAllottedCount).toBe(1);
      expect(allotmentSummary.observedNotAllottedCount).toBe(1);
      expect(allotmentSummary.observedPositiveOutcomeCount).toBe(1);
      expect(allotmentSummary.observedPositiveAllotmentRatePercentage).toBe(50);
      expect(allotmentSummary.disclaimer).toContain('MUST NOT be interpreted as predictive');
    });
  });

  describe('Data Quality Summary Analytics', () => {
    it('computes completeness score and unmapped source identities count', async () => {
      (prisma.ipo.count as jest.Mock)
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // complete
        .mockResolvedValueOnce(2); // unmapped

      const quality = await analyticsService.getDataQualitySummary();

      expect(quality.totalIpos).toBe(10);
      expect(quality.completeIposCount).toBe(8);
      expect(quality.completenessScorePercentage).toBe(80);
      expect(quality.unmappedSourceIdentityCount).toBe(2);
    });
  });

  describe('Detailed Market Analytics (Phase 30.2)', () => {
    it('returns empty snapshot and null aggregates when database has no IPO records', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(0);
      (prisma.ipo.groupBy as jest.Mock).mockResolvedValue([]);
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getDetailedMarketAnalytics();

      expect(result.snapshot.totalIpos).toBe(0);
      expect(result.snapshot.openIposCount).toBe(0);
      expect(result.snapshot.upcomingIposCount).toBe(0);
      expect(result.snapshot.closedIposCount).toBe(0);
      expect(result.snapshot.listingSoonIposCount).toBe(0);
      expect(result.snapshot.withdrawnOrCancelledCount).toBe(0);

      expect(result.issueSizeDistribution.minimumIssueSizeInr).toBeNull();
      expect(result.issueSizeDistribution.maximumIssueSizeInr).toBeNull();
      expect(result.issueSizeDistribution.averageIssueSizeInr).toBeNull();
      expect(result.issueSizeDistribution.medianIssueSizeInr).toBeNull();
      expect(result.issueSizeDistribution.knownIssueSizeCount).toBe(0);
      expect(result.issueSizeDistribution.issueSizeCoveragePercentage).toBe(0);

      expect(result.issueShareCoverage.knownIssueShareCount).toBe(0);
      expect(result.issueShareCoverage.issueShareCountCoveragePercentage).toBe(0);
      expect(result.trends.trendPoints).toEqual([]);
    });

    it('correctly maps snapshot statuses, issue size distribution, segment & exchange breakdowns', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(4);
      (prisma.ipo.groupBy as jest.Mock).mockImplementation(async (args: any) => {
        if (args.by[0] === 'status') {
          return [
            { status: 'OPEN', _count: { id: 1 } },
            { status: 'UPCOMING', _count: { id: 1 } },
            { status: 'ALLOTMENT_COMPLETED', _count: { id: 1 } },
            { status: 'WITHDRAWN', _count: { id: 1 } },
          ];
        }
        if (args.by[0] === 'marketSegment') {
          return [
            { marketSegment: 'MAINBOARD', _count: { id: 3 } },
            { marketSegment: 'SME', _count: { id: 1 } },
          ];
        }
        if (args.by[0] === 'exchange') {
          return [
            { exchange: 'NSE', _count: { id: 1 } },
            { exchange: 'BSE', _count: { id: 1 } },
            { exchange: 'BOTH', _count: { id: 2 } },
          ];
        }
        return [];
      });

      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ipo-1',
          status: 'OPEN',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          issueSize: 100_000_000,
          freshIssueSize: 60_000_000,
          ofsSize: 40_000_000,
          issueShareCount: 1_000_000,
          freshIssueShareCount: 600_000,
          ofsShareCount: 400_000,
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
        {
          id: 'ipo-2',
          status: 'UPCOMING',
          marketSegment: 'MAINBOARD',
          exchange: 'BSE',
          issueSize: 300_000_000,
          freshIssueSize: 150_000_000,
          ofsSize: 150_000_000,
          issueShareCount: 3_000_000,
          freshIssueShareCount: 1_500_000,
          ofsShareCount: 1_500_000,
          createdAt: new Date('2026-08-15T00:00:00Z'),
        },
        {
          id: 'ipo-3',
          status: 'ALLOTMENT_COMPLETED',
          marketSegment: 'MAINBOARD',
          exchange: 'BOTH',
          issueSize: 500_000_000,
          freshIssueSize: 500_000_000,
          ofsSize: 0,
          issueShareCount: 5_000_000,
          freshIssueShareCount: 5_000_000,
          ofsShareCount: 0,
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
        {
          id: 'ipo-4',
          status: 'WITHDRAWN',
          marketSegment: 'SME',
          exchange: 'BOTH',
          issueSize: null, // Null value test
          freshIssueSize: null,
          ofsSize: null,
          issueShareCount: null,
          freshIssueShareCount: null,
          ofsShareCount: null,
          createdAt: new Date('2026-09-05T00:00:00Z'),
        },
      ]);

      const result = await analyticsService.getDetailedMarketAnalytics();

      // Market Snapshot
      expect(result.snapshot.totalIpos).toBe(4);
      expect(result.snapshot.openIposCount).toBe(1);
      expect(result.snapshot.upcomingIposCount).toBe(1);
      expect(result.snapshot.listingSoonIposCount).toBe(1);
      expect(result.snapshot.withdrawnOrCancelledCount).toBe(1);

      // Issue Size Distribution (3 known out of 4)
      expect(result.issueSizeDistribution.minimumIssueSizeInr).toBe(100_000_000);
      expect(result.issueSizeDistribution.maximumIssueSizeInr).toBe(500_000_000);
      expect(result.issueSizeDistribution.averageIssueSizeInr).toBe(300_000_000);
      expect(result.issueSizeDistribution.medianIssueSizeInr).toBe(300_000_000);
      expect(result.issueSizeDistribution.knownIssueSizeCount).toBe(3);
      expect(result.issueSizeDistribution.issueSizeCoveragePercentage).toBe(75);

      // Share Count Coverage
      expect(result.issueShareCoverage.knownIssueShareCount).toBe(3);
      expect(result.issueShareCoverage.issueShareCountCoveragePercentage).toBe(75);

      // Exchange Summary (NSE: 1, BSE: 1, BOTH: 2 => total listings = 1 + 1 + 4 = 6)
      expect(result.byExchangeDetailed.byExchangeClassification.NSE).toBe(1);
      expect(result.byExchangeDetailed.byExchangeClassification.BSE).toBe(1);
      expect(result.byExchangeDetailed.byExchangeClassification.BOTH).toBe(2);
      expect(result.byExchangeDetailed.totalExchangeListingsCount).toBe(6);

      // Segment Analytics
      const mainboard = result.bySegmentDetailed.find((s) => s.segment === 'MAINBOARD');
      const sme = result.bySegmentDetailed.find((s) => s.segment === 'SME');
      expect(mainboard?.totalIpos).toBe(3);
      expect(mainboard?.knownIssueSizeCount).toBe(3);
      expect(mainboard?.totalIssueSizeInr).toBe(900_000_000);

      expect(sme?.totalIpos).toBe(1);
      expect(sme?.knownIssueSizeCount).toBe(0);
      expect(sme?.totalIssueSizeInr).toBe(0);
      expect(sme?.averageIssueSizeInr).toBeNull();

      // Period Trends (Grouped by MONTH: 2026-08 and 2026-09)
      expect(result.trends.trendPoints.length).toBe(2);
      expect(result.trends.trendPoints[0].periodKey).toBe('2026-08');
      expect(result.trends.trendPoints[0].ipoCount).toBe(2);
      expect(result.trends.trendPoints[0].totalIssueSizeInr).toBe(400_000_000);

      expect(result.trends.trendPoints[1].periodKey).toBe('2026-09');
      expect(result.trends.trendPoints[1].ipoCount).toBe(2);
      expect(result.trends.trendPoints[1].totalIssueSizeInr).toBe(500_000_000);
    });

    it('throws error when date range filter has invalid boundaries', async () => {
      await expect(
        analyticsService.getDetailedMarketAnalytics({
          from: '2026-12-31',
          to: '2026-01-01',
        }),
      ).rejects.toThrow('cannot be after');
    });
  });

  describe('Detailed Performance Analytics (Phase 30.3)', () => {
    it('returns empty summaries and null averages when database has no matching IPO records', async () => {
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getIpoPerformanceAnalytics();

      expect(result.priceBandSummary.totalIpos).toBe(0);
      expect(result.priceBandSummary.knownPriceBandCount).toBe(0);
      expect(result.priceBandSummary.priceBandCoveragePercentage).toBe(0);
      expect(result.priceBandSummary.averagePriceBandSpreadInr).toBeNull();
      expect(result.priceBandSummary.medianPriceBandSpreadInr).toBeNull();

      expect(result.listingTimeline.evaluatedIposCount).toBe(0);
      expect(result.listingTimeline.evaluatedTimelineCount).toBe(0);
      expect(result.listingTimeline.timelineCoveragePercentage).toBe(0);
      expect(result.listingTimeline.averageDaysCloseToListing).toBeNull();
      expect(result.listingTimeline.medianDaysCloseToListing).toBeNull();

      expect(result.listingPerformance.listingPerformanceSupported).toBe(false);
      expect(result.listingPerformance.unsupportedMetricReason).toContain(
        'FUTURE_DATA_DEPENDENT',
      );

      expect(result.trends.trendPoints).toEqual([]);
    });

    it('calculates price band spread, timeline durations, segment breakdowns, and coverage percentages', async () => {
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ipo-1',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'LISTED',
          priceBandLow: 100,
          priceBandHigh: 120, // spreadInr: 20, spreadPct: 20%
          createdAt: new Date('2026-08-01T00:00:00Z'),
          lifecycleEvents: [
            { eventType: 'CLOSE', eventDate: new Date('2026-08-10T00:00:00Z') },
            { eventType: 'LISTING', eventDate: new Date('2026-08-15T00:00:00Z') }, // 5 days
          ],
        },
        {
          id: 'ipo-2',
          marketSegment: 'MAINBOARD',
          exchange: 'BSE',
          status: 'LISTED',
          priceBandLow: 500,
          priceBandHigh: 550, // spreadInr: 50, spreadPct: 10%
          createdAt: new Date('2026-08-05T00:00:00Z'),
          lifecycleEvents: [
            { eventType: 'CLOSE', eventDate: new Date('2026-08-20T00:00:00Z') },
            { eventType: 'LISTING', eventDate: new Date('2026-08-20T00:00:00Z') }, // 0 days (same-day)
          ],
        },
        {
          id: 'ipo-3',
          marketSegment: 'SME',
          exchange: 'BOTH',
          status: 'LISTED',
          priceBandLow: null, // missing price band
          priceBandHigh: 100,
          createdAt: new Date('2026-09-01T00:00:00Z'),
          lifecycleEvents: [
            { eventType: 'CLOSE', eventDate: new Date('2026-09-01T00:00:00Z') },
            // missing LISTING event
          ],
        },
        {
          id: 'ipo-4',
          marketSegment: 'SME',
          exchange: 'NSE',
          status: 'LISTED',
          priceBandLow: 200,
          priceBandHigh: 150, // high < low (invalid)
          createdAt: new Date('2026-09-02T00:00:00Z'),
          lifecycleEvents: [
            { eventType: 'CLOSE', eventDate: new Date('2026-09-10T00:00:00Z') },
            { eventType: 'LISTING', eventDate: new Date('2026-09-05T00:00:00Z') }, // negative duration (invalid)
          ],
        },
      ]);

      const result = await analyticsService.getIpoPerformanceAnalytics();

      // Price Band Summary: 2 valid price bands out of 4 (50%)
      expect(result.priceBandSummary.totalIpos).toBe(4);
      expect(result.priceBandSummary.knownPriceBandCount).toBe(2);
      expect(result.priceBandSummary.priceBandCoveragePercentage).toBe(50);
      expect(result.priceBandSummary.averagePriceBandSpreadInr).toBe(35); // (20 + 50) / 2
      expect(result.priceBandSummary.medianPriceBandSpreadInr).toBe(35);
      expect(result.priceBandSummary.minimumPriceBandSpreadInr).toBe(20);
      expect(result.priceBandSummary.maximumPriceBandSpreadInr).toBe(50);
      expect(result.priceBandSummary.averagePriceBandSpreadPercentage).toBe(15); // (20% + 10%) / 2

      // Listing Timeline: 2 valid durations (5 days, 0 days) out of 4 (50%)
      expect(result.listingTimeline.evaluatedIposCount).toBe(4);
      expect(result.listingTimeline.evaluatedTimelineCount).toBe(2);
      expect(result.listingTimeline.timelineCoveragePercentage).toBe(50);
      expect(result.listingTimeline.averageDaysCloseToListing).toBe(2.5); // (5 + 0) / 2
      expect(result.listingTimeline.medianDaysCloseToListing).toBe(2.5);
      expect(result.listingTimeline.minimumDaysCloseToListing).toBe(0);
      expect(result.listingTimeline.maximumDaysCloseToListing).toBe(5);

      // Listing Performance Status
      expect(result.listingPerformance.listingPerformanceSupported).toBe(false);
      expect(result.listingPerformance.knownListingPriceCount).toBe(0);

      // Segment Breakdown
      const mainboard = result.bySegmentDetailed.find((s) => s.segment === 'MAINBOARD');
      const sme = result.bySegmentDetailed.find((s) => s.segment === 'SME');

      expect(mainboard?.totalIpos).toBe(2);
      expect(mainboard?.knownPriceBandCount).toBe(2);
      expect(mainboard?.averagePriceBandSpreadInr).toBe(35);
      expect(mainboard?.evaluatedTimelineCount).toBe(2);
      expect(mainboard?.averageDaysCloseToListing).toBe(2.5);

      expect(sme?.totalIpos).toBe(2);
      expect(sme?.knownPriceBandCount).toBe(0);
      expect(sme?.averagePriceBandSpreadInr).toBeNull();
      expect(sme?.evaluatedTimelineCount).toBe(0);
      expect(sme?.averageDaysCloseToListing).toBeNull();
    });

    it('handles zero low price band without throwing division-by-zero error', async () => {
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ipo-zero',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'LISTED',
          priceBandLow: 0,
          priceBandHigh: 100,
          createdAt: new Date('2026-08-01T00:00:00Z'),
          lifecycleEvents: [],
        },
      ]);

      const result = await analyticsService.getIpoPerformanceAnalytics();
      expect(result.priceBandSummary.knownPriceBandCount).toBe(1);
      expect(result.priceBandSummary.averagePriceBandSpreadInr).toBe(100);
      expect(result.priceBandSummary.averagePriceBandSpreadPercentage).toBeNull();
    });

    it('applies date filtering and respects period trend anchors', async () => {
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'ipo-1',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'LISTED',
          priceBandLow: 100,
          priceBandHigh: 150,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          lifecycleEvents: [
            { eventType: 'CLOSE', eventDate: new Date('2026-08-01T00:00:00Z') },
            { eventType: 'LISTING', eventDate: new Date('2026-08-05T00:00:00Z') },
          ],
        },
      ]);

      const result = await analyticsService.getIpoPerformanceAnalytics({
        from: '2026-08-01',
        to: '2026-08-31',
        period: 'MONTH' as any,
        anchor: 'LISTING_DATE' as any,
      });

      expect(result.filter.from).toBe('2026-08-01');
      expect(result.filter.to).toBe('2026-08-31');
      expect(result.trends.period).toBe('MONTH');
      expect(result.trends.anchor).toBe('LISTING_DATE');
      expect(result.trends.trendPoints.length).toBe(1);
      expect(result.trends.trendPoints[0].periodKey).toBe('2026-08');
      expect(result.trends.trendPoints[0].averageDaysCloseToListing).toBe(4);
    });

    it('rejects invalid date range with explicit error message', async () => {
      await expect(
        analyticsService.getIpoPerformanceAnalytics({
          from: '2026-12-31',
          to: '2026-01-01',
        }),
      ).rejects.toThrow('cannot be after');
    });
  });

  describe('Detailed Subscription & Demand Analytics (Phase 30.4)', () => {
    it('returns subscriptionSupported = false, knownSubscriptionCount = 0, and explicit unsupported reason', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(5);
      (prisma.ipo.groupBy as jest.Mock).mockResolvedValue([
        { marketSegment: 'MAINBOARD', _count: { id: 3 } },
        { marketSegment: 'SME', _count: { id: 2 } },
      ]);

      const result = await analyticsService.getSubscriptionDemandAnalytics();

      expect(result.subscriptionSummary.totalIpos).toBe(5);
      expect(result.subscriptionSummary.knownSubscriptionCount).toBe(0);
      expect(result.subscriptionSummary.subscriptionCoveragePercentage).toBe(0);
      expect(result.subscriptionSummary.subscriptionSupported).toBe(false);
      expect(result.subscriptionSummary.averageSubscriptionMultiplier).toBeNull();
      expect(result.subscriptionSummary.medianSubscriptionMultiplier).toBeNull();
      expect(result.subscriptionSummary.unsupportedMetricReason).toContain(
        'FUTURE_DATA_DEPENDENT',
      );

      expect(result.categoryWise.knownCategoryCount).toBe(0);
      expect(result.categoryWise.supportedCategories).toContain('QIB');
      expect(result.categoryWise.supportedCategories).toContain('RETAIL');
      expect(result.categoryWise.explanation).toContain('category demand observations');

      const mainboard = result.bySegmentDetailed.find((s) => s.segment === 'MAINBOARD');
      const sme = result.bySegmentDetailed.find((s) => s.segment === 'SME');
      expect(mainboard?.totalIpos).toBe(3);
      expect(mainboard?.knownSubscriptionCount).toBe(0);
      expect(mainboard?.averageSubscriptionMultiplier).toBeNull();

      expect(sme?.totalIpos).toBe(2);
      expect(sme?.knownSubscriptionCount).toBe(0);
      expect(sme?.averageSubscriptionMultiplier).toBeNull();

      expect(result.trends.trendPoints).toEqual([]);
    });

    it('strictly isolates subscription domain from allotment check observations', async () => {
      (prisma.ipo.count as jest.Mock).mockResolvedValue(2);
      (prisma.ipo.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getSubscriptionDemandAnalytics();

      // Assert that allotment models are NEVER queried for subscription demand
      expect(prisma.allotmentCheckLog.findMany).not.toHaveBeenCalled();
      expect(prisma.allotmentCheckLog.count).not.toHaveBeenCalled();
      expect(prisma.allotmentCheckJobItem.findMany).not.toHaveBeenCalled();
      expect(prisma.allotmentCheckJobItem.count).not.toHaveBeenCalled();

      // Assert subscription multiplier remains null and unsupported
      expect(result.subscriptionSummary.subscriptionSupported).toBe(false);
      expect(result.subscriptionSummary.knownSubscriptionCount).toBe(0);
      expect(result.subscriptionSummary.averageSubscriptionMultiplier).toBeNull();
    });

    it('rejects invalid date range filter with explicit error message', async () => {
      await expect(
        analyticsService.getSubscriptionDemandAnalytics({
          from: '2026-12-31',
          to: '2026-01-01',
        }),
      ).rejects.toThrow('cannot be after');
    });
  });

  describe('Detailed Allotment Analytics (Phase 30.5)', () => {
    it('returns empty summary when no allotment check records exist', async () => {
      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getAllotmentAnalytics();

      expect(result.summary.dataQuality.totalRawObservations).toBe(0);
      expect(result.summary.dataQuality.deduplicatedObservationsCount).toBe(0);
      expect(result.summary.dataQuality.definitiveObservationsCount).toBe(0);
      expect(result.summary.dataQuality.excludedNonDefinitiveCount).toBe(0);
      expect(result.summary.dataQuality.observationCoveragePercentage).toBeNull();

      expect(result.summary.outcomes.positiveOutcomeCount).toBe(0);
      expect(result.summary.outcomes.observedPositiveAllotmentRatePercentage).toBeNull();
      expect(result.summary.disclaimer).toContain('descriptive statistics');

      expect(result.byIpoDetailed).toEqual([]);
      expect(result.bySegmentDetailed.find((s) => s.segment === 'MAINBOARD')?.dataQuality.totalRawObservations).toBe(0);
      expect(result.trends.trendPoints).toEqual([]);
      expect(result.lotRatioMetricStatus).toBe('FUTURE_DATA_DEPENDENT');
    });

    it('applies Phase 28 deduplication precedence, positive classification, segment breakdown, and privacy bounds', async () => {
      const now = new Date('2026-09-12T10:00:00Z');
      const earlier = new Date('2026-09-10T10:00:00Z');

      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        // IPO 1 (MAINBOARD): PAN A (earlier non-definitive SOURCE_UNAVAILABLE, later definitive ALLOTTED)
        {
          id: 'log-1',
          ipoId: 'ipo-1',
          identifierHash: 'hash-pan-a',
          status: 'SOURCE_UNAVAILABLE',
          checkedAt: earlier,
          sharesApplied: 15,
          sharesAllotted: 0,
          ipo: { symbol: 'MAIN1', marketSegment: 'MAINBOARD', company: { displayName: 'Mainboard Inc' } },
        },
        {
          id: 'log-2',
          ipoId: 'ipo-1',
          identifierHash: 'hash-pan-a',
          status: 'ALLOTTED',
          checkedAt: now,
          sharesApplied: 15,
          sharesAllotted: 15,
          ipo: { symbol: 'MAIN1', marketSegment: 'MAINBOARD', company: { displayName: 'Mainboard Inc' } },
        },
        // IPO 1 (MAINBOARD): PAN B (NOT_ALLOTTED)
        {
          id: 'log-3',
          ipoId: 'ipo-1',
          identifierHash: 'hash-pan-b',
          status: 'NOT_ALLOTTED',
          checkedAt: now,
          sharesApplied: 15,
          sharesAllotted: 0,
          ipo: { symbol: 'MAIN1', marketSegment: 'MAINBOARD', company: { displayName: 'Mainboard Inc' } },
        },
      ]);

      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([
        // IPO 2 (SME): PAN C (PARTIALLY_ALLOTTED)
        {
          id: 'item-1',
          identifierHash: 'hash-pan-c',
          status: 'PARTIALLY_ALLOTTED',
          checkedAt: now,
          sharesApplied: 1000,
          sharesAllotted: 500,
          job: {
            ipoId: 'ipo-2',
            createdAt: now,
            ipo: { symbol: 'SME1', marketSegment: 'SME', company: { displayName: 'SME Ltd' } },
          },
        },
        // IPO 2 (SME): PAN D (NON-DEFINITIVE: UNKNOWN)
        {
          id: 'item-2',
          identifierHash: 'hash-pan-d',
          status: 'UNKNOWN',
          checkedAt: now,
          sharesApplied: null,
          sharesAllotted: null,
          job: {
            ipoId: 'ipo-2',
            createdAt: now,
            ipo: { symbol: 'SME1', marketSegment: 'SME', company: { displayName: 'SME Ltd' } },
          },
        },
      ]);

      const result = await analyticsService.getAllotmentAnalytics();

      // Total Raw Observations = 3 logs + 2 job items = 5
      expect(result.summary.dataQuality.totalRawObservations).toBe(5);
      // Deduplicated Observations: PAN A (ALLOTTED), PAN B (NOT_ALLOTTED), PAN C (PARTIALLY_ALLOTTED), PAN D (UNKNOWN) = 4
      expect(result.summary.dataQuality.deduplicatedObservationsCount).toBe(4);
      // Definitive Observations: ALLOTTED(1) + NOT_ALLOTTED(1) + PARTIALLY_ALLOTTED(1) = 3
      expect(result.summary.dataQuality.definitiveObservationsCount).toBe(3);
      expect(result.summary.dataQuality.excludedNonDefinitiveCount).toBe(1);

      // Outcomes: Positive = ALLOTTED(1) + PARTIALLY_ALLOTTED(1) = 2.
      // Observed Positive Rate = 2 / 3 * 100 = 66.67%
      expect(result.summary.outcomes.positiveOutcomeCount).toBe(2);
      expect(result.summary.outcomes.allottedCount).toBe(1);
      expect(result.summary.outcomes.partiallyAllottedCount).toBe(1);
      expect(result.summary.outcomes.notAllottedCount).toBe(1);
      expect(result.summary.outcomes.observedPositiveAllotmentRatePercentage).toBe(66.67);
      expect(result.summary.outcomes.fullAllotmentRatePercentage).toBe(33.33);
      expect(result.summary.outcomes.partialAllotmentRatePercentage).toBe(33.33);
      expect(result.summary.outcomes.notAllottedRatePercentage).toBe(33.33);

      // Privacy check: JSON stringified response must not contain raw/encrypted PAN fields or identifierHash values
      const jsonString = JSON.stringify(result);
      expect(jsonString).not.toContain('panEncrypted');
      expect(jsonString).not.toContain('panMasked');
      expect(jsonString).not.toContain('panHash');
      expect(jsonString).not.toContain('hash-pan-a');
      expect(jsonString).not.toContain('hash-pan-b');
      expect(jsonString).not.toContain('identifierHash');

      // Segment Breakdown
      const mainboard = result.bySegmentDetailed.find((s) => s.segment === 'MAINBOARD');
      const sme = result.bySegmentDetailed.find((s) => s.segment === 'SME');
      expect(mainboard?.dataQuality.deduplicatedObservationsCount).toBe(2);
      expect(mainboard?.outcomes.positiveOutcomeCount).toBe(1); // 1 ALLOTTED, 1 NOT_ALLOTTED -> 50%
      expect(mainboard?.outcomes.observedPositiveAllotmentRatePercentage).toBe(50.0);

      expect(sme?.dataQuality.deduplicatedObservationsCount).toBe(2);
      expect(sme?.outcomes.positiveOutcomeCount).toBe(1); // 1 PARTIALLY_ALLOTTED, 1 UNKNOWN -> 1 definitive -> 100%
      expect(sme?.outcomes.observedPositiveAllotmentRatePercentage).toBe(100.0);
    });

    it('handles deterministic tie-breaking and retry attempt deduplication', async () => {
      const ts = new Date('2026-09-12T12:00:00Z');

      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        // Retry attempt 1: FAILED check
        {
          id: 'log-retry-1',
          ipoId: 'ipo-tie',
          identifierHash: 'hash-tie-pan',
          status: 'RATE_LIMITED',
          checkedAt: ts,
          sharesApplied: 15,
          sharesAllotted: null,
          ipo: { symbol: 'TIE1', marketSegment: 'MAINBOARD', company: { displayName: 'Tie Corp' } },
        },
        // Retry attempt 2: Definitive check with exact same timestamp
        {
          id: 'log-retry-2',
          ipoId: 'ipo-tie',
          identifierHash: 'hash-tie-pan',
          status: 'ALLOTTED',
          checkedAt: ts,
          sharesApplied: 15,
          sharesAllotted: 15,
          ipo: { symbol: 'TIE1', marketSegment: 'MAINBOARD', company: { displayName: 'Tie Corp' } },
        },
      ]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getAllotmentAnalytics();
      expect(result.summary.dataQuality.totalRawObservations).toBe(2);
      expect(result.summary.dataQuality.deduplicatedObservationsCount).toBe(1);
      expect(result.summary.outcomes.allottedCount).toBe(1);
      expect(result.summary.outcomes.observedPositiveAllotmentRatePercentage).toBe(100.0);
    });

    it('computes 100% positive rate when all definitive observations are positive', async () => {
      const ts = new Date('2026-09-12T12:00:00Z');
      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-pos-1',
          ipoId: 'ipo-pos',
          identifierHash: 'hash-pos-1',
          status: 'ALLOTTED',
          checkedAt: ts,
          sharesApplied: 15,
          sharesAllotted: 15,
          ipo: { symbol: 'POS1', marketSegment: 'MAINBOARD', company: { displayName: 'Positive Corp' } },
        },
        {
          id: 'log-pos-2',
          ipoId: 'ipo-pos',
          identifierHash: 'hash-pos-2',
          status: 'PARTIALLY_ALLOTTED',
          checkedAt: ts,
          sharesApplied: 30,
          sharesAllotted: 15,
          ipo: { symbol: 'POS1', marketSegment: 'MAINBOARD', company: { displayName: 'Positive Corp' } },
        },
      ]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getAllotmentAnalytics();
      expect(result.summary.outcomes.positiveOutcomeCount).toBe(2);
      expect(result.summary.outcomes.notAllottedCount).toBe(0);
      expect(result.summary.outcomes.observedPositiveAllotmentRatePercentage).toBe(100.0);
      expect(result.summary.outcomes.notAllottedRatePercentage).toBe(0.0);
    });

    it('computes 0% positive rate when all definitive observations are negative', async () => {
      const ts = new Date('2026-09-12T12:00:00Z');
      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-neg-1',
          ipoId: 'ipo-neg',
          identifierHash: 'hash-neg-1',
          status: 'NOT_ALLOTTED',
          checkedAt: ts,
          sharesApplied: 15,
          sharesAllotted: 0,
          ipo: { symbol: 'NEG1', marketSegment: 'MAINBOARD', company: { displayName: 'Negative Corp' } },
        },
      ]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      const result = await analyticsService.getAllotmentAnalytics();
      expect(result.summary.outcomes.positiveOutcomeCount).toBe(0);
      expect(result.summary.outcomes.notAllottedCount).toBe(1);
      expect(result.summary.outcomes.observedPositiveAllotmentRatePercentage).toBe(0.0);
      expect(result.summary.outcomes.notAllottedRatePercentage).toBe(100.0);
    });

    it('supports trend aggregation across DAY, WEEK, MONTH, QUARTER, and YEAR periods', async () => {
      const ts = new Date('2026-09-12T12:00:00Z');
      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'log-trend',
          ipoId: 'ipo-trend',
          identifierHash: 'hash-trend-1',
          status: 'ALLOTTED',
          checkedAt: ts,
          sharesApplied: 15,
          sharesAllotted: 15,
          ipo: { symbol: 'TRND1', marketSegment: 'MAINBOARD', company: { displayName: 'Trend Corp' } },
        },
      ]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      const periods = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as any[];
      for (const p of periods) {
        const res = await analyticsService.getAllotmentAnalytics({ period: p });
        expect(res.trends.period).toBe(p);
        expect(res.trends.trendPoints.length).toBe(1);
      }
    });
  });

  describe('Detailed Analytics Quality Summary (Phase 30.6)', () => {
    it('computes unified quality telemetry across Market, Performance, Subscription, Allotment, Provenance, and Source Health', async () => {
      (prisma.ipo.count as jest.Mock).mockImplementation(async (args?: any) => {
        if (!args || !args.where) return 4;
        if (args.where.priceBandLow && args.where.priceBandHigh && args.where.symbol) return 2;
        if (args.where.priceBandLow) return 3;
        if (args.where.issueSize) return 2;
        if (args.where.issueShareCount) return 2;
        return 0;
      });

      (prisma.source.findMany as jest.Mock).mockResolvedValue([
        { healthStatus: 'HEALTHY', enabled: true },
        { healthStatus: 'DEGRADED', enabled: true },
      ]);

      (prisma.fieldProvenance.count as jest.Mock).mockResolvedValue(20);

      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);

      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        { id: 'ipo-1', symbol: 'SYM1', companyId: 'comp-1', priceBandLow: 100, priceBandHigh: 120, marketSegment: 'MAINBOARD' },
        { id: 'ipo-2', symbol: 'SYM2', companyId: 'comp-2', priceBandLow: null, priceBandHigh: 200, marketSegment: 'MAINBOARD' },
        { id: 'ipo-3', symbol: null, companyId: 'comp-3', priceBandLow: null, priceBandHigh: null, marketSegment: 'SME' },
        { id: 'ipo-4', symbol: null, companyId: null, priceBandLow: null, priceBandHigh: null, marketSegment: 'SME' },
      ]);

      (prisma.ipoLifecycleEvent.groupBy as jest.Mock).mockResolvedValue([
        { ipoId: 'ipo-1', _count: { eventType: 2 } },
      ]);

      const result = await analyticsService.getAnalyticsQualitySummary();

      expect(result.overallQualityStatus).toBe('NEEDS_REVIEW');
      expect(result.disclaimer).toContain('NOT an investment-quality rating');

      expect(result.domains.market.domain).toBe('MARKET');
      expect(result.domains.market.completenessPercentage).toBe(50); // 2 complete / 4 total

      expect(result.domains.performance.domain).toBe('PERFORMANCE');
      expect(result.domains.performance.completenessPercentage).toBe(75); // 3 price band / 4 total

      expect(result.domains.subscription.domain).toBe('SUBSCRIPTION');
      expect(result.domains.subscription.qualityStatus).toBe('FUTURE_DATA_DEPENDENT');

      expect(result.domains.allotment.domain).toBe('ALLOTMENT');
      expect(result.domains.allotment.qualityStatus).toBe('UNAVAILABLE');

      expect(result.missingFieldCounts).toBeDefined();
      expect(result.missingFieldCounts?.missingSymbolCount).toBe(2);

      expect(result.sourceHealth.totalSources).toBe(2);
      expect(result.sourceHealth.healthySourcesCount).toBe(1);
      expect(result.sourceHealth.degradedSourcesCount).toBe(1);

      expect(result.activeWarnings).toContain('PRICE_BAND_INCOMPLETE');
      expect(result.activeWarnings).toContain('SUBSCRIPTION_DATA_UNAVAILABLE');
      expect(result.activeWarnings).toContain('SOURCE_HEALTH_DEGRADED');
    });

    it('verifies independent domain quality statuses without collapsing into a single score', async () => {
      (prisma.ipo.count as jest.Mock).mockImplementation(async (args?: any) => {
        if (!args || !args.where) return 1;
        if (args.where.priceBandLow && args.where.priceBandHigh && args.where.symbol) return 1;
        if (args.where.priceBandLow) return 1;
        return 0;
      });

      (prisma.source.findMany as jest.Mock).mockResolvedValue([
        { healthStatus: 'HEALTHY', enabled: true },
      ]);
      (prisma.fieldProvenance.count as jest.Mock).mockResolvedValue(10);
      (prisma.allotmentCheckLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.allotmentCheckJobItem.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ipo.findMany as jest.Mock).mockResolvedValue([
        { id: 'ipo-complete', symbol: 'CMP1', companyId: 'comp-1', priceBandLow: 100, priceBandHigh: 200, marketSegment: 'MAINBOARD' },
      ]);
      (prisma.ipoLifecycleEvent.groupBy as jest.Mock).mockResolvedValue([
        { ipoId: 'ipo-complete', _count: { eventType: 2 } },
      ]);

      const result = await analyticsService.getAnalyticsQualitySummary();

      // Market: 100% complete -> AVAILABLE
      expect(result.domains.market.qualityStatus).toBe('AVAILABLE');
      // Performance: 100% price band -> AVAILABLE
      expect(result.domains.performance.qualityStatus).toBe('AVAILABLE');
      // Subscription: capability model absent -> FUTURE_DATA_DEPENDENT
      expect(result.domains.subscription.qualityStatus).toBe('FUTURE_DATA_DEPENDENT');
      // Allotment: zero observations -> UNAVAILABLE
      expect(result.domains.allotment.qualityStatus).toBe('UNAVAILABLE');
    });
  });
});
