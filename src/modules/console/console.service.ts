import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IpoService } from '../ipos/ipo.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { NotificationDeliveryOperationsService } from '../notifications/notification-delivery-operations.service';
import { ExchangeListing, IpoStatus, MarketSegment, Prisma, SourceType } from '@prisma/client';
import {
  ConsoleDashboardSummaryDto,
  ConsoleDataQualitySummaryDto,
  ConsoleIpoListQueryDto,
  ConsoleSourceHealthResponseDto,
} from './console.types';

@Injectable()
export class ConsoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ipoService: IpoService,
    private readonly analyticsService: AnalyticsService,
    private readonly notificationOpsService: NotificationDeliveryOperationsService,
  ) {}

  /**
   * Aggregates top-level read-only backend observability metrics for the Console Dashboard.
   */
  async getDashboardSummary(): Promise<ConsoleDashboardSummaryDto> {
    const manualIpoWhere: Prisma.IpoWhereInput = {
      OR: [
        {
          sourceIdentities: {
            some: {
              OR: [
                {
                  source: {
                    code: {
                      in: [
                        'ADMIN',
                        'IPOGURU',
                        'IPOGURU_COMMERCIAL',
                        'IPO_GURU',
                        'IPOGURU_V2',
                        'ipoguru',
                        'admin',
                        'MANUAL',
                        'MANUAL_UPLOAD',
                      ],
                    },
                  },
                },
                {
                  source: {
                    sourceType: SourceType.SECONDARY,
                  },
                },
                {
                  source: {
                    code: {
                      contains: 'guru',
                      mode: 'insensitive' as Prisma.QueryMode,
                    },
                  },
                },
                {
                  source: {
                    code: {
                      contains: 'admin',
                      mode: 'insensitive' as Prisma.QueryMode,
                    },
                  },
                },
              ],
            },
          },
        },
        {
          sourceIdentities: {
            none: {},
          },
        },
      ],
    };

    const [
      totalIpos,
      ipoStatusGroup,
      ipoPubGroup,
      ipoSegmentGroup,
      ipoExchangeGroup,
      sourcesCount,
      activeSourcesCount,
      deliveredNotifs,
      allotmentJobStats,
      allotmentObsStats,
    ] = await Promise.all([
      this.prisma.ipo.count({ where: manualIpoWhere }),
      this.prisma.ipo.groupBy({
        by: ['status'],
        where: manualIpoWhere,
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        by: ['publicationStatus'],
        where: manualIpoWhere,
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        by: ['marketSegment'],
        where: manualIpoWhere,
        _count: { id: true },
      }),
      this.prisma.ipo.groupBy({
        by: ['exchange'],
        where: manualIpoWhere,
        _count: { id: true },
      }),
      this.prisma.source.count(),
      this.prisma.source.count({ where: { enabled: true } }),
      this.notificationOpsService.getDeliveryOperationsSummary().catch(() => ({
        totalDeliveries: 0,
        deliveredCount: 0,
        failedCount: 0,
        pendingCount: 0,
        processingCount: 0,
        deliverySuccessRatePercentage: 100,
      })),
      this.prisma.allotmentCheckJob
        .groupBy({
          by: ['status'],
          _count: { id: true },
        })
        .catch(() => []),
      this.prisma.allotmentCheckJobItem
        .groupBy({
          by: ['status'],
          _count: { id: true },
        })
        .catch(() => []),
    ]);

    const statusMap = ipoStatusGroup.reduce(
      (acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const segmentMap = ipoSegmentGroup.reduce(
      (acc, item) => {
        acc[item.marketSegment] = item._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const exchangeMap = ipoExchangeGroup.reduce(
      (acc, item) => {
        acc[item.exchange] = item._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const qualitySummary = await this.getDataQualitySummary();

    const jobCounts = allotmentJobStats.reduce(
      (acc, curr) => {
        acc[curr.status] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const obsCounts = allotmentObsStats.reduce(
      (acc, curr) => {
        acc[curr.status] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const pubMap = ipoPubGroup.reduce(
      (acc, item) => {
        acc[item.publicationStatus] = item._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      ipoCounts: {
        total: totalIpos,
        upcoming: statusMap.UPCOMING || 0,
        open: (statusMap.OPEN || 0) + (statusMap.CLOSING_TODAY || 0),
        closed: statusMap.CLOSED || 0,
        listingSoon: statusMap.LISTING_PENDING || 0,
        withdrawn: statusMap.WITHDRAWN || 0,
        cancelled: statusMap.CANCELLED || 0,
      },
      publicationBreakdown: {
        published: pubMap.PUBLISHED || 0,
        draft: pubMap.DRAFT || 0,
        archived: pubMap.ARCHIVED || 0,
      },
      marketBreakdown: {
        mainboard: segmentMap.MAINBOARD || 0,
        sme: segmentMap.SME || 0,
      },
      exchangeBreakdown: {
        nse: exchangeMap.NSE || 0,
        bse: exchangeMap.BSE || 0,
        both: exchangeMap.BOTH || 0,
      },
      dataQuality: {
        totalEvaluated: qualitySummary.evaluatedCount,
        complete: qualitySummary.statusBreakdown.COMPLETE,
        partial: qualitySummary.statusBreakdown.PARTIAL,
        insufficientData: qualitySummary.statusBreakdown.INSUFFICIENT_DATA,
        unavailable: qualitySummary.statusBreakdown.UNAVAILABLE,
        needsReview: qualitySummary.statusBreakdown.NEEDS_REVIEW,
      },
      sourceHealth: {
        totalSources: sourcesCount,
        activeSources: activeSourcesCount,
        healthyCount: activeSourcesCount,
        degradedCount: sourcesCount - activeSourcesCount,
      },
      notifications: {
        totalDeliveries: deliveredNotifs.totalDeliveries,
        deliveredCount: deliveredNotifs.deliveredCount,
        failedCount: deliveredNotifs.failedCount,
        pendingCount: deliveredNotifs.pendingCount,
        processingCount: deliveredNotifs.processingCount,
        deliverySuccessRatePercentage:
          deliveredNotifs.deliverySuccessRatePercentage,
      },
      allotment: {
        totalJobs: Object.values(jobCounts).reduce((a, b) => a + b, 0),
        completedJobs: jobCounts['COMPLETED'] || 0,
        failedJobs: jobCounts['FAILED'] || 0,
        processingJobs:
          (jobCounts['PROCESSING'] || 0) + (jobCounts['PENDING'] || 0),
        totalObservations: Object.values(obsCounts).reduce((a, b) => a + b, 0),
        positiveAllotments:
          (obsCounts['ALLOTTED'] || 0) + (obsCounts['PARTIALLY_ALLOTTED'] || 0),
      },
    };
  }

  /**
   * Searchable canonical IPO list query reusing existing IpoService.
   */
  async listIpos(query: ConsoleIpoListQueryDto) {
    return this.ipoService.list({
      q: query.q,
      status: query.status as IpoStatus,
      marketSegment: query.marketSegment as MarketSegment,
      exchange: query.exchange as ExchangeListing,
      page: query.page || 1,
      limit: query.limit || 20,
    });
  }

  /**
   * Comprehensive IPO Inspection (Company, Structure, Quality, Timeline, Provenance, Lineage).
   */
  async getIpoDetail(id: string) {
    const ipo = await this.ipoService.getById(id);
    const [timeline, lineage, sources, quality] = await Promise.all([
      this.ipoService.getTimeline(id).catch(() => ({ events: [] })),
      this.ipoService.getLineage(id).catch(() => ({ provenances: [] })),
      this.ipoService.getSources(id).catch(() => ({ sources: [] })),
      this.ipoService.getQuality(id).catch(() => null),
    ]);

    return {
      ...ipo,
      timeline: timeline.events,
      provenances: (lineage as { provenances?: unknown[] }).provenances || [],
      sources: sources.sources,
      qualityReport: quality,
    };
  }

  /**
   * Field provenance & lineage for a canonical IPO.
   */
  async getIpoLineage(id: string) {
    return this.ipoService.getLineage(id);
  }

  /**
   * Read-only Data Quality Summary across backend canonical records.
   */
  async getDataQualitySummary(): Promise<ConsoleDataQualitySummaryDto> {
    const qualitySummary = await this.analyticsService.getDataQualitySummary();
    const totalEvaluated = qualitySummary.totalIpos;
    const completeCount = qualitySummary.completeIposCount;
    const partialCount = totalEvaluated - completeCount;

    return {
      evaluatedCount: totalEvaluated,
      statusBreakdown: {
        COMPLETE: completeCount,
        PARTIAL: partialCount,
        INSUFFICIENT_DATA: 0,
        UNAVAILABLE: 0,
        NEEDS_REVIEW: qualitySummary.unmappedSourceIdentityCount,
      },
      averageCompletenessPercentage: qualitySummary.completenessScorePercentage,
      overallQualityGateStatus:
        completeCount === totalEvaluated ? 'COMPLETE' : 'PARTIAL',
    };
  }

  /**
   * Read-only Source Health Summary.
   */
  async getSourceHealth(): Promise<ConsoleSourceHealthResponseDto> {
    const sources = await this.prisma.source.findMany();
    const recordsPerSource = await this.prisma.discoveryRecord.groupBy({
      by: ['sourceId'],
      _count: { id: true },
    });

    const countsMap = new Map(
      recordsPerSource.map((r) => [r.sourceId, r._count.id]),
    );

    const sourceItems = sources.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      sourceType: s.sourceType,
      isActive: s.enabled,
      totalRecords: countsMap.get(s.id) || 0,
      healthState: (s.enabled ? 'HEALTHY' : 'INACTIVE') as
        'HEALTHY' | 'DEGRADED' | 'INACTIVE',
    }));

    return {
      sources: sourceItems,
      totalSources: sources.length,
      activeSources: sources.filter((s) => s.enabled).length,
    };
  }

  /**
   * Notification pipeline operational summary (100% Zero-Recipient Secrets).
   */
  async getNotificationOpsSummary() {
    return this.notificationOpsService.getDeliveryOperationsSummary();
  }

  /**
   * Allotment check operations aggregate summary (100% Zero-PAN / Zero-identifierHash).
   */
  async getAllotmentOpsSummary() {
    const [jobs, observations] = await Promise.all([
      this.prisma.allotmentCheckJob.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.allotmentCheckJobItem.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    const jobCounts = jobs.reduce(
      (acc, curr) => {
        acc[curr.status] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    const obsCounts = observations.reduce(
      (acc, curr) => {
        acc[curr.status] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      totalJobs: Object.values(jobCounts).reduce((a, b) => a + b, 0),
      completedJobs: jobCounts['COMPLETED'] || 0,
      failedJobs: jobCounts['FAILED'] || 0,
      processingJobs:
        (jobCounts['PROCESSING'] || 0) + (jobCounts['PENDING'] || 0),
      totalObservations: Object.values(obsCounts).reduce((a, b) => a + b, 0),
      positiveAllotments:
        (obsCounts['ALLOTTED'] || 0) + (obsCounts['PARTIALLY_ALLOTTED'] || 0),
      jobStatusBreakdown: jobCounts,
      observationOutcomeBreakdown: obsCounts,
    };
  }
}
