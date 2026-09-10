import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  paginationMeta,
  paginationOffset,
} from '../../common/pagination/pagination';
import {
  IpoAnalyticsResponseDto,
  IpoChangesQuery,
  IpoChangesResponseDto,
  IpoCompareQuery,
  IpoCompareResponseDto,
  IpoLineageQuery,
  IpoLineageResponseDto,
  IpoListQuery,
  IpoResponseDto,
  IpoSourcesResponseDto,
  IpoTimelineResponseDto,
} from './ipo.dto';
import { calculateIpoAnalytics } from './ipo-analytics.calculator';
import {
  toDateOnly,
  toIpoChangesResponseDto,
  toIpoCompareResponseDto,
  toIpoDataReadinessDto,
  toIpoLineageResponseDto,
  toIpoResponseDto,
} from './ipo.mapper';
import { PrismaService } from '../../database/prisma.service';
import { ReconciliationService } from '../discovery/reconciliation.service';
import { DiscoveryRefreshService } from '../discovery/discovery-refresh.service';
import {
  DiscoveryRefreshExecutionService,
  RefreshExecutionStatus,
} from '../discovery/discovery-refresh-execution.service';
import {
  DiscoveryRefreshVerificationService,
  RefreshVerificationRequest,
} from '../discovery/discovery-refresh-verification.service';
import { DiscoverySmartRefreshService } from '../discovery/discovery-smart-refresh.service';
import { DiscoveryCoverageService } from '../discovery/discovery-coverage.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';
import { IpoRepository } from './ipo.repository';

@Injectable()
export class IpoService {
  constructor(
    private readonly ipos: IpoRepository,
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
    private readonly refresh: DiscoveryRefreshService,
    private readonly execution: DiscoveryRefreshExecutionService,
    private readonly verification: DiscoveryRefreshVerificationService,
    private readonly smartRefreshService: DiscoverySmartRefreshService,
    private readonly coverageService?: DiscoveryCoverageService,
    private readonly qualityGateService?: DiscoveryQualityGateService,
  ) {}

  async list(query: IpoListQuery): Promise<{
    data: IpoResponseDto[];
    meta: ReturnType<typeof paginationMeta>;
  }> {
    const skip = paginationOffset(query.page, query.limit);
    const [rows, total] = await Promise.all([
      this.ipos.findMany(query, skip),
      this.ipos.count(query),
    ]);

    return {
      data: rows.map((ipo) => toIpoResponseDto(ipo)),
      meta: paginationMeta(query.page, query.limit, total),
    };
  }

  async compare(query: IpoCompareQuery): Promise<IpoCompareResponseDto> {
    const ipos = await this.ipos.findByIds(query.ids);
    const foundMap = new Map(ipos.map((ipo) => [ipo.id, ipo]));

    for (const requestedId of query.ids) {
      if (!foundMap.has(requestedId)) {
        throw new AppException(
          ErrorCode.IPO_NOT_FOUND,
          `IPO with ID "${requestedId}" was not found`,
          404,
        );
      }
    }

    return toIpoCompareResponseDto(ipos, query.ids);
  }

  async getAnalytics(id: string): Promise<IpoAnalyticsResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return calculateIpoAnalytics(ipo);
  }

  async getById(id: string): Promise<IpoResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    try {
      const qualitySvc =
        this.qualityGateService ?? new DiscoveryQualityGateService();
      const qualityReport = await qualitySvc.evaluateQualityGate(this.prisma, id);
      const dataReadiness = toIpoDataReadinessDto(qualityReport);
      return toIpoResponseDto(ipo, dataReadiness);
    } catch (err) {
      if (err instanceof AppException && err.httpStatus === 404) {
        throw err;
      }
      return toIpoResponseDto(ipo);
    }
  }

  async getTimeline(id: string): Promise<IpoTimelineResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const events = await this.ipos.findTimelineEvents(id);

    return {
      ipoId: id,
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventDate: toDateOnly(e.eventDate),
        sourceId: e.sourceId,
        sourceReference: e.sourceReference,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async getSources(id: string): Promise<IpoSourcesResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const identities = await this.ipos.findSources(id);

    return {
      ipoId: id,
      sources: identities.map((i) => ({
        id: i.id,
        sourceId: i.sourceId,
        sourceCode: i.source.code,
        sourceName: i.source.name,
        sourceType: i.source.sourceType,
        externalId: i.externalId,
        symbol: i.symbol,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  async getChanges(
    id: string,
    query?: IpoChangesQuery,
  ): Promise<IpoChangesResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const events = await this.ipos.findChangeEvents(id, query);
    return toIpoChangesResponseDto(id, events);
  }

  async getLineage(
    id: string,
    query?: IpoLineageQuery,
  ): Promise<IpoLineageResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const provenances = await this.ipos.findFieldProvenances(
      id,
      ipo.companyId,
      query,
    );

    return toIpoLineageResponseDto(id, ipo, provenances, query);
  }


  async getReconciliation(id: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return this.reconciliation.reconcileIpo(this.prisma, id);
  }

  async getRefreshPlan(id: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return this.refresh.generatePlan(this.prisma, id);
  }

  async executeRefresh(id: string, sourceCode: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return this.execution.execute(this.prisma, { ipoId: id, sourceCode });
  }

  async verifyRefresh(
    id: string,
    sourceCode: string,
    executionStatus: RefreshExecutionStatus,
    refreshStartedAt: Date,
    refreshCompletedAt: Date,
  ) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const req: RefreshVerificationRequest = {
      ipoId: id,
      sourceCode,
      executionStatus,
      refreshStartedAt,
      refreshCompletedAt,
    };

    return this.verification.verify(this.prisma, req);
  }

  async smartRefresh(id: string, sourceCode: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const svc =
      this.smartRefreshService ?? new DiscoverySmartRefreshService();

    return svc.smartRefresh(this.prisma, { ipoId: id, sourceCode });
  }

  async getCoverage(id: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const svc = this.coverageService ?? new DiscoveryCoverageService();
    return svc.evaluateCoverage(this.prisma, id);
  }

  async getQuality(id: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    const svc = this.qualityGateService ?? new DiscoveryQualityGateService();
    return svc.evaluateQualityGate(this.prisma, id);
  }
}
