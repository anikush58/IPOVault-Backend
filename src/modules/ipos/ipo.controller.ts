import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  IpoIdParam,
  ipoIdParamSchema,
  IpoListQuery,
  ipoListQuerySchema,
  RefreshIpoDto,
  refreshIpoSchema,
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

  @Get(':id')
  getById(@Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam) {
    return this.ipos.getById(params.id);
  }
}
