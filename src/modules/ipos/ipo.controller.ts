import { Controller, Get, Param, Query } from '@nestjs/common';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  IpoIdParam,
  ipoIdParamSchema,
  IpoListQuery,
  ipoListQuerySchema,
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

  @Get(':id')
  getById(@Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam) {
    return this.ipos.getById(params.id);
  }
}
