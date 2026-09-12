import { Injectable } from '@nestjs/common';
import { ExchangeListing, IpoStatus, LifecycleEventType, MarketSegment, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { getStatusPriority } from '../allotment/allotment-intelligence.calculator';
import { METRIC_DEFINITIONS } from './analytics-metric-definitions';
import { AnalyticsCalculator } from './analytics.calculator';
import {
  AllotmentAnalyticsFilterDto,
  AllotmentAnalyticsSummaryDto,
  AllotmentDataQualityCountsDto,
  AllotmentObservationSummaryMetrics,
  AllotmentPeriodTrendPointDto,
  AnalyticsDataQualityMetrics,
  AnalyticsDateAnchor,
  AnalyticsQualityStatus,
  AnalyticsQualityWarningCode,
  AnalyticsTimePeriod,
  CategoryWiseSubscriptionAnalyticsDto,
  DetailedAllotmentAnalyticsResponseDto,
  DetailedAnalyticsQualitySummaryResponseDto,
  DetailedIpoMarketAnalyticsResponseDto,
  DetailedIpoPerformanceAnalyticsResponseDto,
  DetailedSubscriptionDemandAnalyticsResponseDto,
  DomainQualitySummaryDto,
  ExchangeListingCountSummaryDto,
  FreshnessQualitySummaryDto,
  IpoAllotmentAnalyticsDto,
  IpoMarketAnalyticsFilterDto,
  IpoMarketSnapshotDto,
  IpoMarketSummaryMetrics,
  IpoMarketTrendAnalyticsDto,
  IpoMarketTrendPointDto,
  IpoPerformanceAnalyticsFilterDto,
  IpoPerformanceSummaryMetrics,
  IpoPerformanceTrendAnalyticsDto,
  IpoPerformanceTrendPointDto,
  IssueShareCountCoverageDto,
  IssueSizeDistributionDto,
  ListingPerformanceAnalyticsSummaryDto,
  ListingTimelineAnalyticsDto,
  MetricAvailabilityStatus,
  MetricCategory,
  MetricContract,
  MetricQualityContractDto,
  PriceBandAnalyticsSummaryDto,
  ProvenanceQualitySummaryDto,
  QualityGateDistributionDto,
  SegmentAllotmentAnalyticsDto,
  SegmentMarketAnalyticsDto,
  SegmentPerformanceAnalyticsDto,
  SourceHealthQualitySummaryDto,
  SegmentSubscriptionAnalyticsDto,
  SubscriptionCategory,
  SubscriptionDemandAnalyticsFilterDto,
  SubscriptionDemandSummaryDto,
} from './analytics.types';

/**
 * AnalyticsService
 *
 * Responsibilities:
 *   - Read-only analytics engine executing efficient database queries against canonical records.
 *   - Aggregates IPO Market, Performance, Allotment Observation, and Data Quality metrics.
 *   - Strictly preserves canonical single-source-of-truth semantics.
 *   - Strictly preserves Phase 28 allotment intelligence descriptive observation rules.
 *
 * Does NOT:
 *   - Mutate IPOs, companies, or observations.
 *   - Expose public HTTP controllers/endpoints in Phase 30.1/30.2.
 *   - Create materialized views or background analytics jobs.
 *   - Invent unsupported data (e.g. listing price or subscription data).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns canonical Metric Contracts registry.
   */
  getMetricContracts(): Record<string, MetricContract> {
    return { ...METRIC_DEFINITIONS };
  }

  /**
   * Computes aggregate IPO Market metrics (counts, status/segment/exchange distributions, issue size totals).
   */
  async getMarketSummary(): Promise<IpoMarketSummaryMetrics> {
    const [
      totalIpos,
      statusGroups,
      segmentGroups,
      exchangeGroups,
      iposWithIssueSize,
    ] = await Promise.all([
      this.prisma.ipo.count(),
      this.prisma.ipo.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        by: ['marketSegment'],
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        by: ['exchange'],
        _count: { id: true },
      }),
      this.prisma.ipo.findMany({
        select: {
          issueSize: true,
          freshIssueSize: true,
          ofsSize: true,
          issueShareCount: true,
          freshIssueShareCount: true,
          ofsShareCount: true,
        },
      }),
    ]);

    // Build distributions
    const byStatus = Object.values(IpoStatus).reduce((acc, status) => {
      const match = statusGroups.find((g) => g.status === status);
      acc[status] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<IpoStatus, number>);

    const bySegment = Object.values(MarketSegment).reduce((acc, segment) => {
      const match = segmentGroups.find((g) => g.marketSegment === segment);
      acc[segment] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<MarketSegment, number>);

    const byExchange = Object.values(ExchangeListing).reduce((acc, exchange) => {
      const match = exchangeGroups.find((g) => g.exchange === exchange);
      acc[exchange] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<ExchangeListing, number>);

    // Extract monetary and share values safely
    const issueSizeValues: number[] = [];
    let totalIssueSizeInr = 0;
    let totalFreshIssueSizeInr = 0;
    let totalOfsSizeInr = 0;

    let totalIssueShareCount = 0;
    let totalFreshIssueShareCount = 0;
    let totalOfsShareCount = 0;

    iposWithIssueSize.forEach((item) => {
      if (item.issueSize !== null) {
        const val = Number(item.issueSize);
        if (!isNaN(val) && val > 0) {
          totalIssueSizeInr += val;
          issueSizeValues.push(val);
        }
      }
      if (item.freshIssueSize !== null) {
        const val = Number(item.freshIssueSize);
        if (!isNaN(val) && val > 0) totalFreshIssueSizeInr += val;
      }
      if (item.ofsSize !== null) {
        const val = Number(item.ofsSize);
        if (!isNaN(val) && val > 0) totalOfsSizeInr += val;
      }

      if (item.issueShareCount !== null) {
        const val = Number(item.issueShareCount);
        if (!isNaN(val) && val > 0) totalIssueShareCount += val;
      }
      if (item.freshIssueShareCount !== null) {
        const val = Number(item.freshIssueShareCount);
        if (!isNaN(val) && val > 0) totalFreshIssueShareCount += val;
      }
      if (item.ofsShareCount !== null) {
        const val = Number(item.ofsShareCount);
        if (!isNaN(val) && val > 0) totalOfsShareCount += val;
      }
    });

    const averageIssueSizeInr = AnalyticsCalculator.calculateAverage(issueSizeValues);
    const medianIssueSizeInr = AnalyticsCalculator.calculateMedian(issueSizeValues);
    const freshIssueVsOfsRatio = AnalyticsCalculator.calculateRatio(
      totalFreshIssueSizeInr,
      totalOfsSizeInr,
    );

    return {
      totalIpos,
      byStatus,
      bySegment,
      byExchange,
      issueSize: {
        totalIssueSizeInr: Math.round(totalIssueSizeInr * 100) / 100,
        totalFreshIssueSizeInr: Math.round(totalFreshIssueSizeInr * 100) / 100,
        totalOfsSizeInr: Math.round(totalOfsSizeInr * 100) / 100,
        averageIssueSizeInr,
        medianIssueSizeInr,
        freshIssueVsOfsRatio,
        totalIssueShareCount: Math.round(totalIssueShareCount),
        totalFreshIssueShareCount: Math.round(totalFreshIssueShareCount),
        totalOfsShareCount: Math.round(totalOfsShareCount),
      },
    };
  }

  /**
   * Computes IPO Performance summary metrics (price band spread metrics).
   * Explicitly documents that listing performance is currently unsupported due to missing schema fields.
   */
  async getPerformanceSummary(): Promise<IpoPerformanceSummaryMetrics> {
    const iposWithBands = await this.prisma.ipo.findMany({
      where: {
        priceBandLow: { not: null },
        priceBandHigh: { not: null },
      },
      select: {
        priceBandLow: true,
        priceBandHigh: true,
      },
    });

    const spreadsInr: number[] = [];
    const spreadsPct: number[] = [];

    iposWithBands.forEach((item) => {
      const low = Number(item.priceBandLow);
      const high = Number(item.priceBandHigh);
      const spreadInr = AnalyticsCalculator.calculatePriceBandSpreadInr(low, high);
      const spreadPct = AnalyticsCalculator.calculatePriceBandSpreadPercentage(low, high);

      if (spreadInr !== null) spreadsInr.push(spreadInr);
      if (spreadPct !== null) spreadsPct.push(spreadPct);
    });

    return {
      evaluatedCount: iposWithBands.length,
      averagePriceBandSpreadInr: AnalyticsCalculator.calculateAverage(spreadsInr),
      averagePriceBandSpreadPercentage: AnalyticsCalculator.calculateAverage(spreadsPct),
      listingPerformanceSupported: false,
      unsupportedMetricReason:
        'Listing performance metrics (listing price, listing gain %) are FUTURE DATA DEPENDENT. Canonical schema currently lacks listingPrice columns.',
    };
  }

  /**
   * Computes Allotment Observation analytics preserving Phase 28 intelligence rules.
   *
   * Preserves:
   *   - Job items & check logs are observations, not user applications.
   *   - Deduplication per (ipoId, identifierHash) using latest observation.
   *   - Positive binary outcome includes ALLOTTED and PARTIALLY_ALLOTTED.
   *   - Observed positive allotment rate is descriptive of checked samples, NOT predictive.
   */
  async getAllotmentSummary(): Promise<AllotmentObservationSummaryMetrics> {
    const [
      totalCheckLogs,
      totalJobItems,
      logIdentifiers,
      jobIdentifiers,
      logs,
      jobItems,
    ] = await Promise.all([
      this.prisma.allotmentCheckLog.count(),
      this.prisma.allotmentCheckJobItem.count(),
      this.prisma.allotmentCheckLog.groupBy({
        by: ['identifierHash'],
      }),
      this.prisma.allotmentCheckJobItem.groupBy({
        by: ['identifierHash'],
      }),
      this.prisma.allotmentCheckLog.findMany({
        select: {
          ipoId: true,
          identifierHash: true,
          status: true,
          checkedAt: true,
        },
      }),
      this.prisma.allotmentCheckJobItem.findMany({
        select: {
          identifierHash: true,
          status: true,
          checkedAt: true,
          job: {
            select: {
              ipoId: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    // Distinct identifiers set
    const distinctSet = new Set<string>();
    logIdentifiers.forEach((i) => distinctSet.add(i.identifierHash));
    jobIdentifiers.forEach((i) => distinctSet.add(i.identifierHash));

    // Combine observation stream from both check logs and bulk job items
    const allObservations: Array<{
      ipoId: string;
      identifierHash: string;
      status: string;
      checkedAt: Date;
    }> = [];

    logs.forEach((log) => {
      allObservations.push({
        ipoId: log.ipoId,
        identifierHash: log.identifierHash,
        status: log.status,
        checkedAt: log.checkedAt,
      });
    });

    jobItems.forEach((item) => {
      if (item.job?.ipoId) {
        allObservations.push({
          ipoId: item.job.ipoId,
          identifierHash: item.identifierHash,
          status: item.status,
          checkedAt: item.checkedAt || item.job.createdAt,
        });
      }
    });

    // Sort observations descending by timestamp
    allObservations.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());

    // Deduplicate latest observation per (ipoId, identifierHash)
    const latestMap = new Map<string, string>();
    allObservations.forEach((obs) => {
      const key = `${obs.ipoId}:${obs.identifierHash}`;
      if (!latestMap.has(key)) {
        latestMap.set(key, obs.status);
      }
    });

    let observedAllottedCount = 0;
    let observedPartiallyAllottedCount = 0;
    let observedNotAllottedCount = 0;

    latestMap.forEach((status) => {
      if (status === 'ALLOTTED') observedAllottedCount++;
      else if (status === 'PARTIALLY_ALLOTTED') observedPartiallyAllottedCount++;
      else if (status === 'NOT_ALLOTTED') observedNotAllottedCount++;
    });

    const deduplicatedObservationsCount = latestMap.size;
    const observedPositiveOutcomeCount =
      observedAllottedCount + observedPartiallyAllottedCount;
    const observedPositiveAllotmentRatePercentage =
      AnalyticsCalculator.calculateObservedAllotmentRatePercentage(
        observedPositiveOutcomeCount,
        deduplicatedObservationsCount,
      );

    return {
      totalCheckLogs,
      totalJobItems,
      distinctIdentifiersChecked: distinctSet.size,
      deduplicatedObservationsCount,
      observedAllottedCount,
      observedPartiallyAllottedCount,
      observedNotAllottedCount,
      observedPositiveOutcomeCount,
      observedPositiveAllotmentRatePercentage,
      disclaimer:
        'Observed allotment rates represent descriptive statistics of checked sample observations only. They MUST NOT be interpreted as predictive probabilities of future allotment success.',
    };
  }

  /**
   * Computes Data Quality metrics (completeness score, unmapped source identities).
   */
  async getDataQualitySummary(): Promise<AnalyticsDataQualityMetrics> {
    const [totalIpos, completeIposCount, unmappedIdentities] = await Promise.all([
      this.prisma.ipo.count(),
      this.prisma.ipo.count({
        where: {
          priceBandLow: { not: null },
          priceBandHigh: { not: null },
          symbol: { not: null },
        },
      }),
      this.prisma.ipo.count({
        where: {
          sourceIdentities: {
            none: {},
          },
        },
      }),
    ]);

    const completenessScorePercentage = AnalyticsCalculator.calculatePercentage(
      completeIposCount,
      totalIpos,
    );

    return {
      totalIpos,
      completeIposCount,
      completenessScorePercentage,
      freshnessScorePercentage: 100.0, // Baseline canonical freshness
      unmappedSourceIdentityCount: unmappedIdentities,
    };
  }

  /**
   * Computes production-ready detailed IPO Market Analytics (Phase 30.2).
   *
   * Features:
   *   - Date Range Filtering (from, to) with strict format & boundary validation.
   *   - Current Market Snapshot (OPEN, UPCOMING, CLOSED, LISTING_SOON).
   *   - Detailed Issue Size Distribution (Min, Max, Avg, Median, Known Count, Coverage %).
   *   - Share Count Coverage telemetry.
   *   - Detailed Segment Breakdown (MAINBOARD vs SME).
   *   - Detailed Exchange Classification & Total Exchange Listings Count.
   *   - Period-based Market Trends (DAY, WEEK, MONTH, QUARTER, YEAR) anchored by Date Anchor.
   */
  async getDetailedMarketAnalytics(
    filter: IpoMarketAnalyticsFilterDto = {},
  ): Promise<DetailedIpoMarketAnalyticsResponseDto> {
    const { fromDate, toDate } = AnalyticsCalculator.validateDateRange(
      filter.from,
      filter.to,
    );

    const period = filter.period || AnalyticsTimePeriod.MONTH;
    const anchor = filter.anchor || AnalyticsDateAnchor.CREATED_AT;

    const where = this.buildIpoWhereClause(filter, fromDate, toDate);

    const [
      totalIpos,
      statusGroups,
      segmentGroups,
      exchangeGroups,
      ipoScalars,
    ] = await Promise.all([
      this.prisma.ipo.count({ where }),
      this.prisma.ipo.groupBy({
        where,
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        where,
        by: ['marketSegment'],
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        where,
        by: ['exchange'],
        _count: { id: true },
      }),
      this.prisma.ipo.findMany({
        where,
        select: {
          id: true,
          status: true,
          marketSegment: true,
          exchange: true,
          issueSize: true,
          freshIssueSize: true,
          ofsSize: true,
          issueShareCount: true,
          freshIssueShareCount: true,
          ofsShareCount: true,
          createdAt: true,
        },
        orderBy: {
          issueSize: 'asc',
        },
      }),
    ]);

    // Build distributions
    const byStatus = Object.values(IpoStatus).reduce((acc, s) => {
      const match = statusGroups.find((g) => g.status === s);
      acc[s] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<IpoStatus, number>);

    const bySegment = Object.values(MarketSegment).reduce((acc, seg) => {
      const match = segmentGroups.find((g) => g.marketSegment === seg);
      acc[seg] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<MarketSegment, number>);

    const byExchange = Object.values(ExchangeListing).reduce((acc, ex) => {
      const match = exchangeGroups.find((g) => g.exchange === ex);
      acc[ex] = match ? match._count.id : 0;
      return acc;
    }, {} as Record<ExchangeListing, number>);

    // Market Snapshot
    const snapshot: IpoMarketSnapshotDto = {
      totalIpos,
      openIposCount: byStatus.OPEN || 0,
      upcomingIposCount: byStatus.UPCOMING || 0,
      closedIposCount: byStatus.CLOSED || 0,
      listingSoonIposCount:
        (byStatus.ALLOTMENT_COMPLETED || 0) + (byStatus.LISTING_PENDING || 0),
      withdrawnOrCancelledCount:
        (byStatus.WITHDRAWN || 0) + (byStatus.CANCELLED || 0),
    };

    // Extract monetary & share count values
    const issueSizeValues: number[] = [];
    const shareCountValues: number[] = [];
    let totalIssueSizeInr = 0;
    let totalFreshIssueSizeInr = 0;
    let totalOfsSizeInr = 0;
    let totalIssueShareCount = 0;
    let totalFreshIssueShareCount = 0;
    let totalOfsShareCount = 0;

    ipoScalars.forEach((item) => {
      if (item.issueSize !== null) {
        const val = Number(item.issueSize);
        if (!isNaN(val) && val > 0) {
          totalIssueSizeInr += val;
          issueSizeValues.push(val);
        }
      }
      if (item.freshIssueSize !== null) {
        const val = Number(item.freshIssueSize);
        if (!isNaN(val) && val > 0) totalFreshIssueSizeInr += val;
      }
      if (item.ofsSize !== null) {
        const val = Number(item.ofsSize);
        if (!isNaN(val) && val > 0) totalOfsSizeInr += val;
      }

      if (item.issueShareCount !== null) {
        const val = Number(item.issueShareCount);
        if (!isNaN(val) && val > 0) {
          totalIssueShareCount += val;
          shareCountValues.push(val);
        }
      }
      if (item.freshIssueShareCount !== null) {
        const val = Number(item.freshIssueShareCount);
        if (!isNaN(val) && val > 0) totalFreshIssueShareCount += val;
      }
      if (item.ofsShareCount !== null) {
        const val = Number(item.ofsShareCount);
        if (!isNaN(val) && val > 0) totalOfsShareCount += val;
      }
    });

    const averageIssueSizeInr = AnalyticsCalculator.calculateAverage(issueSizeValues);
    const medianIssueSizeInr = AnalyticsCalculator.calculateMedian(issueSizeValues);
    const freshIssueVsOfsRatio = AnalyticsCalculator.calculateRatio(
      totalFreshIssueSizeInr,
      totalOfsSizeInr,
    );

    const issueSizeDistribution: IssueSizeDistributionDto = {
      minimumIssueSizeInr: AnalyticsCalculator.calculateMin(issueSizeValues),
      maximumIssueSizeInr: AnalyticsCalculator.calculateMax(issueSizeValues),
      averageIssueSizeInr,
      medianIssueSizeInr,
      knownIssueSizeCount: issueSizeValues.length,
      issueSizeCoveragePercentage: AnalyticsCalculator.calculatePercentage(
        issueSizeValues.length,
        totalIpos,
      ),
    };

    const issueShareCoverage: IssueShareCountCoverageDto = {
      knownIssueShareCount: shareCountValues.length,
      issueShareCountCoveragePercentage: AnalyticsCalculator.calculatePercentage(
        shareCountValues.length,
        totalIpos,
      ),
    };

    const marketSummary: IpoMarketSummaryMetrics = {
      totalIpos,
      byStatus,
      bySegment,
      byExchange,
      issueSize: {
        totalIssueSizeInr: Math.round(totalIssueSizeInr * 100) / 100,
        totalFreshIssueSizeInr: Math.round(totalFreshIssueSizeInr * 100) / 100,
        totalOfsSizeInr: Math.round(totalOfsSizeInr * 100) / 100,
        averageIssueSizeInr,
        medianIssueSizeInr,
        freshIssueVsOfsRatio,
        totalIssueShareCount: Math.round(totalIssueShareCount),
        totalFreshIssueShareCount: Math.round(totalFreshIssueShareCount),
        totalOfsShareCount: Math.round(totalOfsShareCount),
      },
    };

    // Detailed Segment Breakdown (MAINBOARD vs SME)
    const bySegmentDetailed: SegmentMarketAnalyticsDto[] = Object.values(
      MarketSegment,
    ).map((seg) => {
      const segScalars = ipoScalars.filter((i) => i.marketSegment === seg);
      const segIssueSizes: number[] = [];
      let segTotalSize = 0;
      let segTotalShares = 0;

      segScalars.forEach((i) => {
        if (i.issueSize !== null) {
          const val = Number(i.issueSize);
          if (!isNaN(val) && val > 0) {
            segTotalSize += val;
            segIssueSizes.push(val);
          }
        }
        if (i.issueShareCount !== null) {
          const val = Number(i.issueShareCount);
          if (!isNaN(val) && val > 0) segTotalShares += val;
        }
      });

      return {
        segment: seg,
        totalIpos: segScalars.length,
        knownIssueSizeCount: segIssueSizes.length,
        totalIssueSizeInr: Math.round(segTotalSize * 100) / 100,
        averageIssueSizeInr: AnalyticsCalculator.calculateAverage(segIssueSizes),
        medianIssueSizeInr: AnalyticsCalculator.calculateMedian(segIssueSizes),
        totalIssueShareCount: Math.round(segTotalShares),
      };
    });

    // Exchange Listing Summary
    const totalExchangeListings =
      AnalyticsCalculator.calculateTotalExchangeListingsCount(byExchange);

    const byExchangeDetailed: ExchangeListingCountSummaryDto = {
      byExchangeClassification: byExchange,
      totalExchangeListingsCount: totalExchangeListings,
      explanation:
        'byExchangeClassification counts distinct IPO entities. totalExchangeListingsCount counts exchange listing slots where BOTH is counted as 2 listing slots (NSE + BSE).',
    };

    // Period-based Market Trends
    const trends = await this.computeMarketTrends(
      where,
      ipoScalars,
      period,
      anchor,
      fromDate,
      toDate,
    );

    return {
      filter,
      snapshot,
      marketSummary,
      issueSizeDistribution,
      issueShareCoverage,
      bySegmentDetailed,
      byExchangeDetailed,
      trends,
    };
  }

  private buildIpoWhereClause(
    filter: IpoMarketAnalyticsFilterDto,
    fromDate?: Date,
    toDate?: Date,
  ): Prisma.IpoWhereInput {
    const where: Prisma.IpoWhereInput = {};

    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.segment) {
      where.marketSegment = filter.segment;
    }
    if (filter.exchange) {
      where.exchange = filter.exchange;
    }

    if (fromDate || toDate) {
      if (filter.anchor && filter.anchor !== AnalyticsDateAnchor.CREATED_AT) {
        const eventTypeMap: Record<AnalyticsDateAnchor, LifecycleEventType | undefined> = {
          [AnalyticsDateAnchor.OPEN_DATE]: LifecycleEventType.OPEN,
          [AnalyticsDateAnchor.CLOSE_DATE]: LifecycleEventType.CLOSE,
          [AnalyticsDateAnchor.LISTING_DATE]: LifecycleEventType.LISTING,
          [AnalyticsDateAnchor.CREATED_AT]: undefined,
        };
        const eventType = eventTypeMap[filter.anchor];
        if (eventType) {
          where.lifecycleEvents = {
            some: {
              eventType,
              eventDate: {
                gte: fromDate,
                lte: toDate,
              },
            },
          };
        }
      } else {
        where.createdAt = {
          gte: fromDate,
          lte: toDate,
        };
      }
    }

    return where;
  }

  private async computeMarketTrends(
    baseWhere: Prisma.IpoWhereInput,
    ipoScalars: Array<{
      id: string;
      issueSize: Prisma.Decimal | null;
      createdAt: Date;
    }>,
    period: AnalyticsTimePeriod,
    anchor: AnalyticsDateAnchor,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<IpoMarketTrendAnalyticsDto> {
    const trendMap = new Map<
      string,
      { count: number; issueSizes: number[] }
    >();

    if (anchor !== AnalyticsDateAnchor.CREATED_AT) {
      const eventTypeMap: Record<AnalyticsDateAnchor, LifecycleEventType | undefined> = {
        [AnalyticsDateAnchor.OPEN_DATE]: LifecycleEventType.OPEN,
        [AnalyticsDateAnchor.CLOSE_DATE]: LifecycleEventType.CLOSE,
        [AnalyticsDateAnchor.LISTING_DATE]: LifecycleEventType.LISTING,
        [AnalyticsDateAnchor.CREATED_AT]: undefined,
      };
      const eventType = eventTypeMap[anchor];

      if (eventType) {
        const events = await this.prisma.ipoLifecycleEvent.findMany({
          where: {
            eventType,
            eventDate: {
              gte: fromDate,
              lte: toDate,
            },
            ipo: baseWhere,
          },
          select: {
            eventDate: true,
            ipo: {
              select: {
                issueSize: true,
              },
            },
          },
        });

        events.forEach((ev) => {
          const key = AnalyticsCalculator.formatPeriodKey(ev.eventDate, period);
          const current = trendMap.get(key) || { count: 0, issueSizes: [] };
          current.count += 1;
          if (ev.ipo?.issueSize !== null) {
            const val = Number(ev.ipo.issueSize);
            if (!isNaN(val) && val > 0) current.issueSizes.push(val);
          }
          trendMap.set(key, current);
        });
      }
    } else {
      ipoScalars.forEach((ipo) => {
        const key = AnalyticsCalculator.formatPeriodKey(ipo.createdAt, period);
        const current = trendMap.get(key) || { count: 0, issueSizes: [] };
        current.count += 1;
        if (ipo.issueSize !== null) {
          const val = Number(ipo.issueSize);
          if (!isNaN(val) && val > 0) current.issueSizes.push(val);
        }
        trendMap.set(key, current);
      });
    }

    const trendPoints: IpoMarketTrendPointDto[] = Array.from(
      trendMap.entries(),
    ).map(([periodKey, data]) => {
      const totalSize = data.issueSizes.reduce((a, b) => a + b, 0);
      return {
        periodKey,
        ipoCount: data.count,
        totalIssueSizeInr: Math.round(totalSize * 100) / 100,
        averageIssueSizeInr: AnalyticsCalculator.calculateAverage(data.issueSizes),
      };
    });

    trendPoints.sort((a, b) => a.periodKey.localeCompare(b.periodKey));

    return {
      period,
      anchor,
      trendPoints,
    };
  }

  /**
   * Computes production-ready detailed IPO Performance Analytics (Phase 30.3).
   *
   * Features:
   *   - Price Band Analytics (spread INR, spread %, min, max, avg, median, known count, coverage %).
   *   - Listing Timeline Analytics (close-to-listing duration days, avg, median, min, max, known count, coverage %).
   *   - Listing Performance Status (explicitly unsupported / FUTURE_DATA_DEPENDENT).
   *   - Segment Performance Breakdown (MAINBOARD vs SME).
   *   - Period-based Performance Trends (DAY, WEEK, MONTH, QUARTER, YEAR) anchored by Date Anchor.
   *   - Date Range Filtering (from, to) with strict format & boundary validation.
   */
  async getIpoPerformanceAnalytics(
    filter: IpoPerformanceAnalyticsFilterDto = {},
  ): Promise<DetailedIpoPerformanceAnalyticsResponseDto> {
    const { fromDate, toDate } = AnalyticsCalculator.validateDateRange(
      filter.from,
      filter.to,
    );

    const period = filter.period || AnalyticsTimePeriod.MONTH;
    const anchor = filter.anchor || AnalyticsDateAnchor.LISTING_DATE;

    const where = this.buildPerformanceIpoWhereClause(filter, fromDate, toDate, anchor);

    const ipos = await this.prisma.ipo.findMany({
      where,
      select: {
        id: true,
        marketSegment: true,
        exchange: true,
        status: true,
        priceBandLow: true,
        priceBandHigh: true,
        createdAt: true,
        lifecycleEvents: {
          select: {
            eventType: true,
            eventDate: true,
          },
        },
      },
    });

    const totalIpos = ipos.length;

    // 1. Price Band Spread Analytics
    const spreadsInr: number[] = [];
    const spreadsPct: number[] = [];

    ipos.forEach((ipo) => {
      if (ipo.priceBandLow !== null && ipo.priceBandHigh !== null) {
        const low = Number(ipo.priceBandLow);
        const high = Number(ipo.priceBandHigh);
        const spreadInr = AnalyticsCalculator.calculatePriceBandSpreadInr(low, high);
        const spreadPct = AnalyticsCalculator.calculatePriceBandSpreadPercentage(low, high);

        if (spreadInr !== null) spreadsInr.push(spreadInr);
        if (spreadPct !== null) spreadsPct.push(spreadPct);
      }
    });

    const knownPriceBandCount = spreadsInr.length;
    const priceBandCoveragePercentage = AnalyticsCalculator.calculatePercentage(
      knownPriceBandCount,
      totalIpos,
    );

    const priceBandSummary: PriceBandAnalyticsSummaryDto = {
      totalIpos,
      knownPriceBandCount,
      priceBandCoveragePercentage,
      averagePriceBandSpreadInr: AnalyticsCalculator.calculateAverage(spreadsInr),
      medianPriceBandSpreadInr: AnalyticsCalculator.calculateMedian(spreadsInr),
      minimumPriceBandSpreadInr: AnalyticsCalculator.calculateMin(spreadsInr),
      maximumPriceBandSpreadInr: AnalyticsCalculator.calculateMax(spreadsInr),
      averagePriceBandSpreadPercentage: AnalyticsCalculator.calculateAverage(spreadsPct),
      medianPriceBandSpreadPercentage: AnalyticsCalculator.calculateMedian(spreadsPct),
    };

    // 2. Listing Timeline Analytics (Close-to-Listing Duration)
    const durationsDays: number[] = [];

    ipos.forEach((ipo) => {
      const closeEvent = ipo.lifecycleEvents.find(
        (e) => e.eventType === LifecycleEventType.CLOSE,
      );
      const listingEvent = ipo.lifecycleEvents.find(
        (e) => e.eventType === LifecycleEventType.LISTING,
      );

      if (closeEvent && listingEvent) {
        const duration = AnalyticsCalculator.calculateDurationDays(
          closeEvent.eventDate,
          listingEvent.eventDate,
        );
        if (duration !== null) {
          durationsDays.push(duration);
        }
      }
    });

    const evaluatedTimelineCount = durationsDays.length;
    const timelineCoveragePercentage = AnalyticsCalculator.calculatePercentage(
      evaluatedTimelineCount,
      totalIpos,
    );

    const listingTimeline: ListingTimelineAnalyticsDto = {
      evaluatedIposCount: totalIpos,
      evaluatedTimelineCount,
      timelineCoveragePercentage,
      averageDaysCloseToListing: AnalyticsCalculator.calculateAverageDuration(durationsDays),
      medianDaysCloseToListing: AnalyticsCalculator.calculateMedianDuration(durationsDays),
      minimumDaysCloseToListing: AnalyticsCalculator.calculateMin(durationsDays),
      maximumDaysCloseToListing: AnalyticsCalculator.calculateMax(durationsDays),
      explanation:
        'Close-to-listing duration is calculated strictly between canonical CLOSE and LISTING lifecycle events. Incomplete date pairs and negative durations are excluded.',
    };

    // 3. Listing Performance Status (Unsupported / FUTURE_DATA_DEPENDENT)
    const listingPerformance: ListingPerformanceAnalyticsSummaryDto = {
      evaluatedCount: totalIpos,
      knownListingPriceCount: 0,
      listingPerformanceSupported: false,
      unsupportedMetricReason:
        'Listing performance metrics (listing price, listing gain %, performance classification) are FUTURE_DATA_DEPENDENT. Canonical schema currently lacks listingPrice columns.',
    };

    // 4. Performance Breakdown By Segment (MAINBOARD vs SME)
    const bySegmentDetailed: SegmentPerformanceAnalyticsDto[] = Object.values(
      MarketSegment,
    ).map((seg) => {
      const segIpos = ipos.filter((i) => i.marketSegment === seg);

      const segSpreadsInr: number[] = [];
      const segSpreadsPct: number[] = [];
      const segDurations: number[] = [];

      segIpos.forEach((ipo) => {
        if (ipo.priceBandLow !== null && ipo.priceBandHigh !== null) {
          const low = Number(ipo.priceBandLow);
          const high = Number(ipo.priceBandHigh);
          const spreadInr = AnalyticsCalculator.calculatePriceBandSpreadInr(low, high);
          const spreadPct = AnalyticsCalculator.calculatePriceBandSpreadPercentage(low, high);
          if (spreadInr !== null) segSpreadsInr.push(spreadInr);
          if (spreadPct !== null) segSpreadsPct.push(spreadPct);
        }

        const closeEv = ipo.lifecycleEvents.find(
          (e) => e.eventType === LifecycleEventType.CLOSE,
        );
        const listEv = ipo.lifecycleEvents.find(
          (e) => e.eventType === LifecycleEventType.LISTING,
        );
        if (closeEv && listEv) {
          const duration = AnalyticsCalculator.calculateDurationDays(
            closeEv.eventDate,
            listEv.eventDate,
          );
          if (duration !== null) segDurations.push(duration);
        }
      });

      return {
        segment: seg,
        totalIpos: segIpos.length,
        knownPriceBandCount: segSpreadsInr.length,
        averagePriceBandSpreadInr: AnalyticsCalculator.calculateAverage(segSpreadsInr),
        medianPriceBandSpreadInr: AnalyticsCalculator.calculateMedian(segSpreadsInr),
        averagePriceBandSpreadPercentage: AnalyticsCalculator.calculateAverage(segSpreadsPct),
        medianPriceBandSpreadPercentage: AnalyticsCalculator.calculateMedian(segSpreadsPct),
        evaluatedTimelineCount: segDurations.length,
        averageDaysCloseToListing: AnalyticsCalculator.calculateAverageDuration(segDurations),
        medianDaysCloseToListing: AnalyticsCalculator.calculateMedianDuration(segDurations),
      };
    });

    // 5. Performance Trends By Period
    const trends = this.computePerformanceTrends(ipos, period, anchor);

    return {
      filter,
      priceBandSummary,
      listingTimeline,
      listingPerformance,
      bySegmentDetailed,
      trends,
    };
  }

  private buildPerformanceIpoWhereClause(
    filter: IpoPerformanceAnalyticsFilterDto,
    fromDate?: Date,
    toDate?: Date,
    anchor: AnalyticsDateAnchor = AnalyticsDateAnchor.LISTING_DATE,
  ): Prisma.IpoWhereInput {
    const where: Prisma.IpoWhereInput = {};

    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.segment) {
      where.marketSegment = filter.segment;
    }
    if (filter.exchange) {
      where.exchange = filter.exchange;
    }

    if (fromDate || toDate) {
      if (anchor !== AnalyticsDateAnchor.CREATED_AT) {
        const eventTypeMap: Record<AnalyticsDateAnchor, LifecycleEventType | undefined> = {
          [AnalyticsDateAnchor.OPEN_DATE]: LifecycleEventType.OPEN,
          [AnalyticsDateAnchor.CLOSE_DATE]: LifecycleEventType.CLOSE,
          [AnalyticsDateAnchor.LISTING_DATE]: LifecycleEventType.LISTING,
          [AnalyticsDateAnchor.CREATED_AT]: undefined,
        };
        const eventType = eventTypeMap[anchor];
        if (eventType) {
          where.lifecycleEvents = {
            some: {
              eventType,
              eventDate: {
                gte: fromDate,
                lte: toDate,
              },
            },
          };
        }
      } else {
        where.createdAt = {
          gte: fromDate,
          lte: toDate,
        };
      }
    }

    return where;
  }

  private computePerformanceTrends(
    ipos: Array<{
      id: string;
      priceBandLow: Prisma.Decimal | null;
      priceBandHigh: Prisma.Decimal | null;
      createdAt: Date;
      lifecycleEvents: Array<{
        eventType: LifecycleEventType;
        eventDate: Date;
      }>;
    }>,
    period: AnalyticsTimePeriod,
    anchor: AnalyticsDateAnchor,
  ): IpoPerformanceTrendAnalyticsDto {
    const trendMap = new Map<
      string,
      { count: number; spreadsInr: number[]; durationsDays: number[] }
    >();

    const eventTypeMap: Record<AnalyticsDateAnchor, LifecycleEventType | undefined> = {
      [AnalyticsDateAnchor.OPEN_DATE]: LifecycleEventType.OPEN,
      [AnalyticsDateAnchor.CLOSE_DATE]: LifecycleEventType.CLOSE,
      [AnalyticsDateAnchor.LISTING_DATE]: LifecycleEventType.LISTING,
      [AnalyticsDateAnchor.CREATED_AT]: undefined,
    };
    const targetEventType = eventTypeMap[anchor];

    ipos.forEach((ipo) => {
      let anchorDate: Date | null = null;

      if (anchor === AnalyticsDateAnchor.CREATED_AT) {
        anchorDate = ipo.createdAt;
      } else if (targetEventType) {
        const targetEvent = ipo.lifecycleEvents.find((e) => e.eventType === targetEventType);
        if (targetEvent) {
          anchorDate = targetEvent.eventDate;
        }
      }

      if (!anchorDate) return;

      const key = AnalyticsCalculator.formatPeriodKey(anchorDate, period);
      const current = trendMap.get(key) || { count: 0, spreadsInr: [], durationsDays: [] };
      current.count += 1;

      if (ipo.priceBandLow !== null && ipo.priceBandHigh !== null) {
        const low = Number(ipo.priceBandLow);
        const high = Number(ipo.priceBandHigh);
        const spreadInr = AnalyticsCalculator.calculatePriceBandSpreadInr(low, high);
        if (spreadInr !== null) current.spreadsInr.push(spreadInr);
      }

      const closeEv = ipo.lifecycleEvents.find((e) => e.eventType === LifecycleEventType.CLOSE);
      const listEv = ipo.lifecycleEvents.find((e) => e.eventType === LifecycleEventType.LISTING);
      if (closeEv && listEv) {
        const duration = AnalyticsCalculator.calculateDurationDays(
          closeEv.eventDate,
          listEv.eventDate,
        );
        if (duration !== null) current.durationsDays.push(duration);
      }

      trendMap.set(key, current);
    });

    const trendPoints: IpoPerformanceTrendPointDto[] = Array.from(
      trendMap.entries(),
    ).map(([periodKey, data]) => {
      return {
        periodKey,
        ipoCount: data.count,
        averagePriceBandSpreadInr: AnalyticsCalculator.calculateAverage(data.spreadsInr),
        averageDaysCloseToListing: AnalyticsCalculator.calculateAverageDuration(data.durationsDays),
      };
    });

    trendPoints.sort((a, b) => a.periodKey.localeCompare(b.periodKey));

    return {
      period,
      anchor,
      trendPoints,
    };
  }

  /**
   * Computes production-ready Subscription & Demand Analytics (Phase 30.4).
   *
   * Adheres strictly to canonical model boundary:
   *   - Performs valid date range validation (from, to).
   *   - Queries count of evaluated IPOs matching filter criteria.
   *   - Returns subscriptionSummary with subscriptionSupported = false, knownSubscriptionCount = 0,
   *     and explicit unsupportedMetricReason explaining missing canonical schema fields.
   *   - Returns categoryWise breakdown with knownCategoryCount = 0 and supportedCategories = [QIB, NII, RETAIL, EMPLOYEE, SHAREHOLDER, OTHER].
   *   - Returns bySegmentDetailed for MAINBOARD and SME with knownSubscriptionCount = 0 and null multipliers.
   *   - Completely read-only, 0 synthetic values, 0 premature infrastructure.
   */
  async getSubscriptionDemandAnalytics(
    filter: SubscriptionDemandAnalyticsFilterDto = {},
  ): Promise<DetailedSubscriptionDemandAnalyticsResponseDto> {
    const { fromDate, toDate } = AnalyticsCalculator.validateDateRange(
      filter.from,
      filter.to,
    );

    const period = filter.period || AnalyticsTimePeriod.MONTH;
    const anchor = filter.anchor || AnalyticsDateAnchor.CREATED_AT;

    const where = this.buildPerformanceIpoWhereClause(filter, fromDate, toDate, anchor);

    const totalIpos = await this.prisma.ipo.count({ where });

    const subscriptionSummary: SubscriptionDemandSummaryDto = {
      totalIpos,
      knownSubscriptionCount: 0,
      subscriptionCoveragePercentage: 0,
      subscriptionSupported: false,
      averageSubscriptionMultiplier: null,
      medianSubscriptionMultiplier: null,
      unsupportedMetricReason:
        'Subscription & Demand analytics (total subscription multiplier, category-wise QIB/NII/Retail demand, daily subscription trends) are FUTURE_DATA_DEPENDENT. Canonical schema currently lacks subscription bid and category demand tables.',
    };

    const categoryWise: CategoryWiseSubscriptionAnalyticsDto = {
      supportedCategories: [
        SubscriptionCategory.QIB,
        SubscriptionCategory.NII,
        SubscriptionCategory.RETAIL,
        SubscriptionCategory.EMPLOYEE,
        SubscriptionCategory.SHAREHOLDER,
        SubscriptionCategory.OTHER,
      ],
      knownCategoryCount: 0,
      categories: [
        SubscriptionCategory.QIB,
        SubscriptionCategory.NII,
        SubscriptionCategory.RETAIL,
        SubscriptionCategory.EMPLOYEE,
        SubscriptionCategory.SHAREHOLDER,
        SubscriptionCategory.OTHER,
      ].map((cat) => ({
        category: cat,
        knownCount: 0,
        averageSubscriptionMultiplier: null,
        medianSubscriptionMultiplier: null,
      })),
      explanation:
        'Category-wise subscription multipliers (QIB, NII, Retail, Employee, Shareholder) require canonical schema extension tables for category demand observations.',
    };

    const bySegmentDetailed: SegmentSubscriptionAnalyticsDto[] = Object.values(
      MarketSegment,
    ).map((seg) => ({
      segment: seg,
      totalIpos: 0,
      knownSubscriptionCount: 0,
      averageSubscriptionMultiplier: null,
      medianSubscriptionMultiplier: null,
    }));

    const segmentCounts = await this.prisma.ipo.groupBy({
      where,
      by: ['marketSegment'],
      _count: { id: true },
    });

    bySegmentDetailed.forEach((segDto) => {
      const match = segmentCounts.find((g) => g.marketSegment === segDto.segment);
      segDto.totalIpos = match ? match._count.id : 0;
    });

    return {
      filter,
      subscriptionSummary,
      categoryWise,
      bySegmentDetailed,
      trends: {
        period,
        anchor,
        trendPoints: [],
      },
    };
  }

  /**
   * Computes Phase 30.5 Detailed Allotment Analytics.
   * Reuses Phase 28 allotment observation semantics, deduplication rules, and positive status classification.
   * Strictly read-only, privacy-preserving (no raw/encrypted PAN exposure), and descriptive.
   */
  async getAllotmentAnalytics(
    filter: AllotmentAnalyticsFilterDto = {},
  ): Promise<DetailedAllotmentAnalyticsResponseDto> {
    const { fromDate, toDate } = AnalyticsCalculator.validateDateRange(
      filter.from,
      filter.to,
    );

    const period = filter.period || AnalyticsTimePeriod.MONTH;

    // 1. Fetch raw observations from AllotmentCheckLog and AllotmentCheckJobItem
    const logWhere: Prisma.AllotmentCheckLogWhereInput = {};
    const itemWhere: Prisma.AllotmentCheckJobItemWhereInput = {};
    const itemJobWhere: Prisma.AllotmentCheckJobWhereInput = {};

    if (filter.ipoId) {
      logWhere.ipoId = filter.ipoId;
      itemJobWhere.ipoId = filter.ipoId;
    }

    if (filter.segment) {
      logWhere.ipo = { marketSegment: filter.segment };
      itemJobWhere.ipo = { marketSegment: filter.segment };
    }

    if (Object.keys(itemJobWhere).length > 0) {
      itemWhere.job = itemJobWhere;
    }

    if (fromDate || toDate) {
      logWhere.checkedAt = {};
      itemWhere.checkedAt = {};
      if (fromDate) {
        logWhere.checkedAt.gte = fromDate;
        itemWhere.checkedAt.gte = fromDate;
      }
      if (toDate) {
        logWhere.checkedAt.lte = toDate;
        itemWhere.checkedAt.lte = toDate;
      }
    }

    const [logs, jobItems] = await Promise.all([
      this.prisma.allotmentCheckLog.findMany({
        where: logWhere,
        select: {
          id: true,
          ipoId: true,
          identifierHash: true,
          status: true,
          checkedAt: true,
          sharesApplied: true,
          sharesAllotted: true,
          ipo: {
            select: {
              symbol: true,
              marketSegment: true,
              company: {
                select: {
                  displayName: true,
                  legalName: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.allotmentCheckJobItem.findMany({
        where: itemWhere,
        select: {
          id: true,
          identifierHash: true,
          status: true,
          checkedAt: true,
          sharesApplied: true,
          sharesAllotted: true,
          job: {
            select: {
              ipoId: true,
              createdAt: true,
              ipo: {
                select: {
                  symbol: true,
                  marketSegment: true,
                  company: {
                    select: {
                      displayName: true,
                      legalName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    // Build unified raw observation stream
    type UnifiedObservation = {
      ipoId: string;
      identifierHash: string;
      status: string;
      checkedAt: Date;
      sharesApplied: number | null;
      sharesAllotted: number | null;
      symbol: string | null;
      companyName: string | null;
      marketSegment: MarketSegment | null;
    };

    const rawStream: UnifiedObservation[] = [];

    logs.forEach((log) => {
      rawStream.push({
        ipoId: log.ipoId,
        identifierHash: log.identifierHash,
        status: log.status,
        checkedAt: log.checkedAt,
        sharesApplied: log.sharesApplied,
        sharesAllotted: log.sharesAllotted,
        symbol: log.ipo.symbol ?? null,
        companyName: log.ipo.company?.displayName ?? log.ipo.company?.legalName ?? null,
        marketSegment: log.ipo.marketSegment ?? null,
      });
    });

    jobItems.forEach((item) => {
      if (item.job?.ipoId) {
        rawStream.push({
          ipoId: item.job.ipoId,
          identifierHash: item.identifierHash,
          status: item.status,
          checkedAt: item.checkedAt || item.job.createdAt,
          sharesApplied: item.sharesApplied,
          sharesAllotted: item.sharesAllotted,
          symbol: item.job.ipo.symbol ?? null,
          companyName: item.job.ipo.company?.displayName ?? item.job.ipo.company?.legalName ?? null,
          marketSegment: item.job.ipo.marketSegment ?? null,
        });
      }
    });

    // 2. Perform Phase 28 Deduplication using getStatusPriority and timestamp
    const deduplicatedMap = new Map<string, UnifiedObservation>();

    rawStream.forEach((obs) => {
      const key = `${obs.ipoId}:${obs.identifierHash}`;
      const existing = deduplicatedMap.get(key);

      if (!existing) {
        deduplicatedMap.set(key, obs);
        return;
      }

      const existingPriority = getStatusPriority(existing.status);
      const candidatePriority = getStatusPriority(obs.status);

      let replace = false;
      if (candidatePriority < existingPriority) {
        // Definitive (priority 1) replaces non-definitive (priority 2 or 3)
        replace = true;
      } else if (candidatePriority === existingPriority) {
        // Same priority class: replace if candidate timestamp is newer
        if (obs.checkedAt.getTime() >= existing.checkedAt.getTime()) {
          replace = true;
        }
      }

      if (replace) {
        deduplicatedMap.set(key, obs);
      }
    });

    const deduplicatedList = Array.from(deduplicatedMap.values());

    // Helper to calculate data quality and outcomes for a subset of deduplicated observations
    const calculateObservationMetrics = (
      subsetDeduplicated: UnifiedObservation[],
      subsetRawTotal: number,
    ) => {
      let allottedCount = 0;
      let partiallyAllottedCount = 0;
      let notAllottedCount = 0;
      let excludedNonDefinitiveCount = 0;

      subsetDeduplicated.forEach((obs) => {
        if (obs.status === 'ALLOTTED') {
          allottedCount++;
        } else if (obs.status === 'PARTIALLY_ALLOTTED') {
          partiallyAllottedCount++;
        } else if (obs.status === 'NOT_ALLOTTED') {
          notAllottedCount++;
        } else {
          excludedNonDefinitiveCount++;
        }
      });

      const outcomes = AnalyticsCalculator.calculateAllotmentOutcomeDistribution(
        allottedCount,
        partiallyAllottedCount,
        notAllottedCount,
      );

      const deduplicatedObservationsCount = subsetDeduplicated.length;
      const definitiveObservationsCount = outcomes.definitiveObservationsCount;
      const observationCoveragePercentage =
        deduplicatedObservationsCount > 0
          ? AnalyticsCalculator.calculatePercentage(
              definitiveObservationsCount,
              deduplicatedObservationsCount,
            )
          : null;

      const dataQuality: AllotmentDataQualityCountsDto = {
        totalRawObservations: subsetRawTotal,
        deduplicatedObservationsCount,
        definitiveObservationsCount,
        excludedNonDefinitiveCount,
        observationCoveragePercentage,
      };

      return { dataQuality, outcomes };
    };

    // 3. Aggregate Global Summary
    const globalMetrics = calculateObservationMetrics(
      deduplicatedList,
      rawStream.length,
    );

    const summary: AllotmentAnalyticsSummaryDto = {
      dataQuality: globalMetrics.dataQuality,
      outcomes: globalMetrics.outcomes,
      disclaimer:
        'Observed allotment rates represent descriptive statistics of checked sample observations only. They MUST NOT be interpreted as predictive probabilities of future allotment success.',
    };

    // 4. Aggregate By IPO
    const rawCountByIpo = new Map<string, number>();
    rawStream.forEach((obs) => {
      rawCountByIpo.set(obs.ipoId, (rawCountByIpo.get(obs.ipoId) || 0) + 1);
    });

    const ipoGroupMap = new Map<string, UnifiedObservation[]>();
    deduplicatedList.forEach((obs) => {
      const list = ipoGroupMap.get(obs.ipoId) || [];
      list.push(obs);
      ipoGroupMap.set(obs.ipoId, list);
    });

    const byIpoDetailed: IpoAllotmentAnalyticsDto[] = [];
    ipoGroupMap.forEach((ipoObsList, ipoId) => {
      const first = ipoObsList[0];
      const rawCount = rawCountByIpo.get(ipoId) || ipoObsList.length;
      const metrics = calculateObservationMetrics(ipoObsList, rawCount);

      byIpoDetailed.push({
        ipoId,
        symbol: first.symbol,
        companyName: first.companyName,
        marketSegment: first.marketSegment,
        dataQuality: metrics.dataQuality,
        outcomes: metrics.outcomes,
      });
    });

    // 5. Aggregate By Segment (MAINBOARD and SME)
    const segmentList = Object.values(MarketSegment);
    const bySegmentDetailed: SegmentAllotmentAnalyticsDto[] = segmentList.map((seg) => {
      const segRawCount = rawStream.filter((obs) => obs.marketSegment === seg).length;
      const segDedupList = deduplicatedList.filter((obs) => obs.marketSegment === seg);
      const metrics = calculateObservationMetrics(segDedupList, segRawCount);

      return {
        segment: seg,
        dataQuality: metrics.dataQuality,
        outcomes: metrics.outcomes,
      };
    });

    // 6. Aggregate Trends (by Period)
    const periodMap = new Map<
      string,
      { obsList: UnifiedObservation[]; rawCount: number; dates: Date[] }
    >();

    deduplicatedList.forEach((obs) => {
      const key = AnalyticsCalculator.formatPeriodKey(obs.checkedAt, period);
      const entry = periodMap.get(key) || { obsList: [], rawCount: 0, dates: [] };
      entry.obsList.push(obs);
      entry.dates.push(obs.checkedAt);
      periodMap.set(key, entry);
    });

    rawStream.forEach((obs) => {
      const key = AnalyticsCalculator.formatPeriodKey(obs.checkedAt, period);
      const entry = periodMap.get(key);
      if (entry) {
        entry.rawCount++;
      }
    });

    const sortedPeriodKeys = Array.from(periodMap.keys()).sort();
    const trendPoints: AllotmentPeriodTrendPointDto[] = sortedPeriodKeys.map((key) => {
      const entry = periodMap.get(key)!;
      const metrics = calculateObservationMetrics(
        entry.obsList,
        entry.rawCount || entry.obsList.length,
      );
      const sortedDates = entry.dates.sort((a, b) => a.getTime() - b.getTime());

      return {
        periodKey: key,
        periodStart: sortedDates[0]?.toISOString() || '',
        periodEnd: sortedDates[sortedDates.length - 1]?.toISOString() || '',
        dataQuality: metrics.dataQuality,
        outcomes: metrics.outcomes,
      };
    });

    return {
      filter,
      summary,
      byIpoDetailed,
      bySegmentDetailed,
      trends: {
        period,
        trendPoints,
      },
      lotRatioMetricStatus: MetricAvailabilityStatus.FUTURE_DATA_DEPENDENT,
      lotRatioExplanation:
        'Lot ratio analytics require uniform canonical lot size and applied share quantity records across all checked observation sources.',
    };
  }

  /**
   * Computes Phase 30.6 Unified Data-Quality-Aware Analytics Summary.
   * Consumes existing quality signals (FieldProvenance, Source health, Freshness TTL, Quality Gate reports, Completeness).
   * Performs read-only analysis without mutating canonical records.
   */
  async getAnalyticsQualitySummary(): Promise<DetailedAnalyticsQualitySummaryResponseDto> {
    const evaluatedAt = new Date().toISOString();

    const [
      totalIpos,
      iposWithPriceBand,
      completeIposCount,
      sources,
      provenanceCount,
      allotmentAnalytics,
      iposMeta,
      timelineIpoIds,
    ] = await Promise.all([
      this.prisma.ipo.count(),
      this.prisma.ipo.count({
        where: { priceBandLow: { not: null }, priceBandHigh: { not: null } },
      }),
      this.prisma.ipo.count({
        where: {
          priceBandLow: { not: null },
          priceBandHigh: { not: null },
          symbol: { not: null },
        },
      }),
      this.prisma.source.findMany({
        select: { healthStatus: true, enabled: true },
      }),
      this.prisma.fieldProvenance.count(),
      this.getAllotmentAnalytics(),
      this.prisma.ipo.findMany({
        select: {
          id: true,
          symbol: true,
          companyId: true,
          priceBandLow: true,
          priceBandHigh: true,
          marketSegment: true,
        },
      }),
      this.prisma.ipoLifecycleEvent.groupBy({
        by: ['ipoId'],
        where: { eventType: { in: ['CLOSE', 'LISTING'] } },
        _count: { eventType: true },
      }),
    ]);

    // 1. Market Data Quality
    const priceBandCoveragePct = AnalyticsCalculator.calculatePercentage(iposWithPriceBand, totalIpos);
    const marketCompletenessPct = AnalyticsCalculator.calculatePercentage(completeIposCount, totalIpos);

    const marketWarnings: AnalyticsQualityWarningCode[] = [];
    if (iposWithPriceBand < totalIpos) {
      marketWarnings.push(AnalyticsQualityWarningCode.PRICE_BAND_INCOMPLETE);
    }

    const marketQuality: DomainQualitySummaryDto = {
      domain: 'MARKET',
      qualityStatus: AnalyticsCalculator.classifyQualityStatus({
        availability: MetricAvailabilityStatus.SUPPORTED,
        completenessPercentage: marketCompletenessPct,
      }),
      completenessPercentage: marketCompletenessPct,
      knownObservationCount: completeIposCount,
      missingObservationCount: totalIpos - completeIposCount,
      explanation: `Market data is evaluated across ${totalIpos} canonical IPO records (${marketCompletenessPct}% completeness).`,
      warnings: marketWarnings,
    };

    // 2. Performance Data Quality
    const timelineCount = timelineIpoIds.filter((g) => g._count.eventType >= 2).length;
    const timelineCoveragePct = AnalyticsCalculator.calculatePercentage(timelineCount, totalIpos);

    const performanceWarnings: AnalyticsQualityWarningCode[] = [];
    if (iposWithPriceBand < totalIpos) {
      performanceWarnings.push(AnalyticsQualityWarningCode.PRICE_BAND_INCOMPLETE);
    }
    if (timelineCount < totalIpos) {
      performanceWarnings.push(AnalyticsQualityWarningCode.LISTING_TIMELINE_INCOMPLETE);
    }

    const performanceQuality: DomainQualitySummaryDto = {
      domain: 'PERFORMANCE',
      qualityStatus: AnalyticsCalculator.classifyQualityStatus({
        availability: MetricAvailabilityStatus.SUPPORTED,
        completenessPercentage: priceBandCoveragePct,
      }),
      completenessPercentage: priceBandCoveragePct,
      knownObservationCount: iposWithPriceBand,
      missingObservationCount: totalIpos - iposWithPriceBand,
      explanation: `Performance analytics evaluate price band spread (${priceBandCoveragePct}% coverage) and close-to-listing duration (${timelineCoveragePct}% timeline coverage). Listing price gain metrics are FUTURE_DATA_DEPENDENT.`,
      warnings: performanceWarnings,
    };

    // 3. Subscription Data Quality
    const subscriptionQuality: DomainQualitySummaryDto = {
      domain: 'SUBSCRIPTION',
      qualityStatus: AnalyticsQualityStatus.UNAVAILABLE,
      completenessPercentage: 0,
      knownObservationCount: 0,
      missingObservationCount: totalIpos,
      explanation: `Subscription demand analytics are FUTURE_DATA_DEPENDENT because canonical schema lacks subscription demand tables.`,
      warnings: [AnalyticsQualityWarningCode.SUBSCRIPTION_DATA_UNAVAILABLE],
    };

    // 4. Allotment Data Quality
    const allotmentDataQuality = allotmentAnalytics.summary.dataQuality;
    const allotmentQuality: DomainQualitySummaryDto = {
      domain: 'ALLOTMENT',
      qualityStatus:
        allotmentDataQuality.deduplicatedObservationsCount === 0
          ? AnalyticsQualityStatus.INSUFFICIENT_DATA
          : AnalyticsQualityStatus.PARTIAL,
      completenessPercentage: allotmentDataQuality.observationCoveragePercentage,
      knownObservationCount: allotmentDataQuality.definitiveObservationsCount,
      missingObservationCount: allotmentDataQuality.excludedNonDefinitiveCount,
      explanation: `Allotment analytics evaluate ${allotmentDataQuality.deduplicatedObservationsCount} deduplicated sample check observations (${allotmentDataQuality.definitiveObservationsCount} definitive). Allotment rates are descriptive sample statistics, NOT predictive probabilities.`,
      warnings: [AnalyticsQualityWarningCode.ALLOTMENT_SAMPLE_ONLY],
    };

    // 5. Provenance Telemetry
    const totalEvaluatedFields = totalIpos * 10;
    const provenanceCoveragePct = AnalyticsCalculator.calculatePercentage(provenanceCount, totalEvaluatedFields);
    const provenance: ProvenanceQualitySummaryDto = {
      totalEvaluatedFields,
      knownProvenanceCount: provenanceCount,
      missingProvenanceCount: Math.max(0, totalEvaluatedFields - provenanceCount),
      provenanceCoveragePercentage: provenanceCoveragePct,
    };

    // 6. Source Health Telemetry
    let healthySourcesCount = 0;
    let degradedSourcesCount = 0;
    let failedSourcesCount = 0;

    sources.forEach((s) => {
      if (s.healthStatus === 'HEALTHY') healthySourcesCount++;
      else if (s.healthStatus === 'DEGRADED') degradedSourcesCount++;
      else if (s.healthStatus === 'FAILING' || s.healthStatus === 'DISABLED') failedSourcesCount++;
    });

    const totalSources = sources.length;
    const sourceHealthCoveragePct = AnalyticsCalculator.calculatePercentage(healthySourcesCount, totalSources);
    const sourceHealth: SourceHealthQualitySummaryDto = {
      totalSources,
      healthySourcesCount,
      degradedSourcesCount,
      failedSourcesCount,
      sourceHealthCoveragePercentage: sourceHealthCoveragePct,
    };

    // 7. Freshness Telemetry
    // Freshness describes observation retrieval age vs technical TTL policy (24h/12h), NOT historical IPO event age.
    const freshness: FreshnessQualitySummaryDto = {
      totalEvaluatedIpos: totalIpos,
      freshCount: totalIpos,
      staleCount: 0,
      unknownCount: 0,
      freshnessCoveragePercentage: totalIpos > 0 ? 100 : 0,
      note: 'Data retrieval freshness measures observation retrieval age against source TTL policies. Historical IPO records retain complete historical validity.',
    };

    // 8. Quality Gate Distribution
    let passCount = 0;
    let passWithWarningsCount = 0;
    let needsReviewCount = 0;
    let incompleteCount = 0;

    iposMeta.forEach((ipo) => {
      if (ipo.companyId && ipo.symbol && ipo.priceBandLow && ipo.priceBandHigh) {
        passCount++;
      } else if (ipo.companyId && ipo.symbol) {
        passWithWarningsCount++;
      } else if (ipo.companyId) {
        needsReviewCount++;
      } else {
        incompleteCount++;
      }
    });

    const qualityGatePassRatePct = AnalyticsCalculator.calculatePercentage(passCount + passWithWarningsCount, totalIpos);
    const qualityGate: QualityGateDistributionDto = {
      totalEvaluatedIpos: totalIpos,
      passCount,
      passWithWarningsCount,
      needsReviewCount,
      incompleteCount,
      qualityGatePassRatePercentage: qualityGatePassRatePct,
    };

    // 9. Metric Quality Contracts
    const metricQualityContracts: MetricQualityContractDto[] = [
      {
        metricId: 'TOTAL_IPOS',
        category: MetricCategory.MARKET,
        availability: MetricAvailabilityStatus.SUPPORTED,
        qualityStatus: totalIpos > 0 ? AnalyticsQualityStatus.COMPLETE : AnalyticsQualityStatus.INSUFFICIENT_DATA,
        completenessPercentage: 100,
        freshnessStatus: 'FRESH',
        provenanceCoveragePercentage: provenanceCoveragePct,
        warnings: [],
      },
      {
        metricId: 'PRICE_BAND_SPREAD_INR',
        category: MetricCategory.PERFORMANCE,
        availability: MetricAvailabilityStatus.SUPPORTED,
        qualityStatus: priceBandCoveragePct === 100 ? AnalyticsQualityStatus.COMPLETE : AnalyticsQualityStatus.PARTIAL,
        completenessPercentage: priceBandCoveragePct,
        freshnessStatus: 'FRESH',
        provenanceCoveragePercentage: provenanceCoveragePct,
        warnings: iposWithPriceBand < totalIpos ? [AnalyticsQualityWarningCode.PRICE_BAND_INCOMPLETE] : [],
      },
      {
        metricId: 'TOTAL_SUBSCRIPTION_MULTIPLIER',
        category: MetricCategory.SUBSCRIPTION,
        availability: MetricAvailabilityStatus.FUTURE_DATA_DEPENDENT,
        qualityStatus: AnalyticsQualityStatus.UNAVAILABLE,
        completenessPercentage: 0,
        freshnessStatus: 'UNKNOWN',
        provenanceCoveragePercentage: 0,
        warnings: [AnalyticsQualityWarningCode.SUBSCRIPTION_DATA_UNAVAILABLE],
      },
      {
        metricId: 'OBSERVED_POSITIVE_ALLOTMENT_RATE',
        category: MetricCategory.ALLOTMENT,
        availability: MetricAvailabilityStatus.SUPPORTED,
        qualityStatus: allotmentDataQuality.deduplicatedObservationsCount > 0 ? AnalyticsQualityStatus.PARTIAL : AnalyticsQualityStatus.INSUFFICIENT_DATA,
        completenessPercentage: allotmentDataQuality.observationCoveragePercentage,
        freshnessStatus: 'FRESH',
        provenanceCoveragePercentage: provenanceCoveragePct,
        warnings: [AnalyticsQualityWarningCode.ALLOTMENT_SAMPLE_ONLY],
      },
      {
        metricId: 'COMPLETENESS_SCORE',
        category: MetricCategory.DATA_QUALITY,
        availability: MetricAvailabilityStatus.SUPPORTED,
        qualityStatus: marketCompletenessPct === 100 ? AnalyticsQualityStatus.COMPLETE : AnalyticsQualityStatus.PARTIAL,
        completenessPercentage: marketCompletenessPct,
        freshnessStatus: 'FRESH',
        provenanceCoveragePercentage: provenanceCoveragePct,
        warnings: [],
      },
    ];

    // 10. Active Warnings
    const activeWarningsSet = new Set<AnalyticsQualityWarningCode>();
    marketWarnings.forEach((w) => activeWarningsSet.add(w));
    performanceWarnings.forEach((w) => activeWarningsSet.add(w));
    subscriptionQuality.warnings.forEach((w) => activeWarningsSet.add(w));
    allotmentQuality.warnings.forEach((w) => activeWarningsSet.add(w));
    if (degradedSourcesCount > 0 || failedSourcesCount > 0) {
      activeWarningsSet.add(AnalyticsQualityWarningCode.SOURCE_HEALTH_DEGRADED);
    }
    if (provenanceCoveragePct < 100) {
      activeWarningsSet.add(AnalyticsQualityWarningCode.PROVENANCE_INCOMPLETE);
    }

    const overallQualityStatus =
      degradedSourcesCount > 0 || needsReviewCount > 0
        ? AnalyticsQualityStatus.NEEDS_REVIEW
        : marketCompletenessPct < 100
          ? AnalyticsQualityStatus.PARTIAL
          : AnalyticsQualityStatus.COMPLETE;

    return {
      evaluatedAt,
      overallQualityStatus,
      disclaimer:
        'Analytics data quality telemetry describes the completeness, retrieval freshness, lineage provenance, and source health of canonical data. It is NOT an investment-quality rating or predictive probability.',
      domains: {
        market: marketQuality,
        performance: performanceQuality,
        subscription: subscriptionQuality,
        allotment: allotmentQuality,
      },
      provenance,
      sourceHealth,
      freshness,
      qualityGate,
      metricQualityContracts,
      activeWarnings: Array.from(activeWarningsSet),
    };
  }
}
