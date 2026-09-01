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

  @Get(':id')
  getById(@Param(new ZodValidationPipe(ipoIdParamSchema)) params: IpoIdParam) {
    return this.ipos.getById(params.id);
  }
}
