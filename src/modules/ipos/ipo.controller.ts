import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  IpoIdParam,
  ipoIdParamSchema,
  IpoListQuery,
  ipoListQuerySchema,
  RefreshIpoDto,
  refreshIpoSchema,
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

  @Get(':id')
  getById(@Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam) {
    return this.ipos.getById(params.id);
  }
}
