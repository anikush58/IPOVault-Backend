import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  IpoChangesQuery,
  ipoChangesQuerySchema,
  IpoCompareQuery,
  ipoCompareQuerySchema,
  IpoIdParam,
  ipoIdParamSchema,
  IpoLineageQuery,
  ipoLineageQuerySchema,
  IpoListQuery,
  ipoListQuerySchema,
  RefreshIpoDto,
  refreshIpoSchema,
  SmartRefreshIpoDto,
  smartRefreshIpoSchema,
  VerifyRefreshDto,
  verifyRefreshSchema,
} from './ipo.dto';
import { IpoService } from './ipo.service';

@Controller('ipos')
export class IpoController {
  constructor(private readonly ipos: IpoService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ipoListQuerySchema)) query: IpoListQuery) {
    return this.ipos.list(query);
  }

  @Get('upcoming')
  upcoming(
    @Query(new ZodValidationPipe(ipoListQuerySchema)) query: IpoListQuery,
  ) {
    return this.ipos.list({ ...query, status: 'UPCOMING' });
  }

  @Get('open')
  open(@Query(new ZodValidationPipe(ipoListQuerySchema)) query: IpoListQuery) {
    return this.ipos.list({ ...query, status: 'OPEN' });
  }

  @Get('closed')
  closed(
    @Query(new ZodValidationPipe(ipoListQuerySchema)) query: IpoListQuery,
  ) {
    return this.ipos.list({ ...query, status: 'CLOSED' });
  }

  @Get('listing-soon')
  listingSoon(
    @Query(new ZodValidationPipe(ipoListQuerySchema)) query: IpoListQuery,
  ) {
    return this.ipos.list({ ...query, status: 'LISTING_PENDING' });
  }

  /**
   * GET /ipos/compare?ids=<id1>,<id2>
   *
   * Phase 26 — IPO Comparison API.
   * Read-only endpoint allowing side-by-side comparison of 2 to 5 canonical IPO records.
   */
  @Get('compare')
  compare(
    @Query(new ZodValidationPipe(ipoCompareQuerySchema)) query: IpoCompareQuery,
  ) {
    return this.ipos.compare(query);
  }

  /**
   * GET /ipos/:id/analytics
   *
   * Phase 27 — IPO Analytics & Derived Metrics API.
   * Read-only endpoint exposing deterministic financial, term, issue-structure,
   * and lifecycle date metrics derived from canonical IPO data.
   */
  @Get(':id/analytics')
  getAnalytics(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getAnalytics(params.id);
  }

  @Get(':id/timeline')
  getTimeline(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getTimeline(params.id);
  }

  @Get(':id/sources')
  getSources(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getSources(params.id);
  }

  /**
   * GET /ipos/:id/changes
   *
   * Phase 23 — IPO Change History & Data Audit API.
   * Read-only endpoint returning deterministic, historical canonical field change events.
   * Supports optional query filtering by exact field name (?field=price_band_low)
   * and/or source code (?source=sebi).
   */
  @Get(':id/changes')
  getChanges(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
    @Query(new ZodValidationPipe(ipoChangesQuerySchema)) query: IpoChangesQuery,
  ) {
    return this.ipos.getChanges(params.id, query);
  }

  /**
   * GET /ipos/:id/lineage
   *
   * Phase 24 — Field-Level IPO Data Lineage & Provenance.
   * Read-only endpoint exposing field-level provenance/lineage for a canonical IPO.
   * Supports optional query filtering by exact field name (?field=priceBandLow)
   * and/or source code (?source=sebi).
   */
  @Get(':id/lineage')
  getLineage(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
    @Query(new ZodValidationPipe(ipoLineageQuerySchema)) query: IpoLineageQuery,
  ) {
    return this.ipos.getLineage(params.id, query);
  }


  @Get(':id/reconciliation')
  getReconciliation(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getReconciliation(params.id);
  }

  @Get(':id/refresh-plan')
  getRefreshPlan(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getRefreshPlan(params.id);
  }

  @Post(':id/refresh')
  @HttpCode(200)
  executeRefresh(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
    @Body(new ZodValidationPipe(refreshIpoSchema)) body: RefreshIpoDto,
  ) {
    return this.ipos.executeRefresh(params.id, body.source);
  }

  /**
   * POST /ipos/:id/refresh-verification
   *
   * Phase 15 — post-refresh verification (Corrected).
   *
   * POST is used rather than GET because the request body carries
   * execution context from Phase 14 (executionStatus, ISO timestamps)
   * that cannot be safely reconstructed from query parameters in a
   * deterministic way. The endpoint is read-only and performs zero
   * writes — POST here is a "compute" operation, not a mutation.
   *
   * Accepts the Phase 14 execution result context and returns a
   * deterministic, read-only verification report:
   *  - Was the requested IPO actually observed by the requested source?
   *  - Did canonical field values change (backed by IpoChangeEvent)?
   *  - What quality/conflict issues remain?
   *  - Is another refresh still needed?
   *
   * This endpoint does NOT execute a refresh.
   */
  @Post(':id/refresh-verification')
  @HttpCode(200)
  verifyRefresh(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
    @Body(new ZodValidationPipe(verifyRefreshSchema)) body: VerifyRefreshDto,
  ) {
    return this.ipos.verifyRefresh(
      params.id,
      body.source,
      body.executionStatus,
      body.refreshStartedAt,
      body.refreshCompletedAt,
    );
  }

  /**
   * POST /ipos/:id/smart-refresh
   *
   * Phase 16 — Smart IPO Refresh Workflow Orchestration.
   * Synchronous, single-request workflow that orchestrates:
   *  1. Phase 13 Refresh Plan generation
   *  2. Phase 14 Controlled Execution (only if RECOMMENDED by plan)
   *  3. Phase 15 Post-Refresh Verification & Reconciliation (if execution COMPLETED)
   *  4. Combined SmartRefreshResult with clear final outcome status.
   */
  @Post(':id/smart-refresh')
  @HttpCode(200)
  smartRefresh(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
    @Body(new ZodValidationPipe(smartRefreshIpoSchema)) body: SmartRefreshIpoDto,
  ) {
    return this.ipos.smartRefresh(params.id, body.source);
  }

  /**
   * GET /ipos/:id/coverage
   *
   * Phase 19 — Smart IPO Data Coverage & Source Reconciliation Intelligence.
   * Deterministic, read-only analysis of field-level data completeness, provenances,
   * cross-source reconciliation outcomes, and refresh recommendations.
   */
  @Get(':id/coverage')
  getCoverage(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getCoverage(params.id);
  }

  /**
   * GET /ipos/:id/quality
   *
   * Phase 20 — IPO Data Completeness & Canonical Quality Gate.
   * Read-only production-quality assessment for an IPO canonical record.
   * Combines Quality Engine, Reconciliation, Freshness, Coverage, and Lifecycle
   * semantics into a single deterministic quality gate report.
   */
  @Get(':id/quality')
  getQuality(
    @Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam,
  ) {
    return this.ipos.getQuality(params.id);
  }

  @Get(':id')
  getById(@Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam) {
    return this.ipos.getById(params.id);
  }
}
