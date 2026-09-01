import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  paginationMeta,
  paginationOffset,
} from '../../common/pagination/pagination';
import { IpoListQuery, IpoResponseDto } from './ipo.dto';
import { toIpoResponseDto } from './ipo.mapper';
import { IpoRepository } from './ipo.repository';

@Injectable()
export class IpoService {
  constructor(private readonly ipos: IpoRepository) {}

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
      data: rows.map(toIpoResponseDto),
      meta: paginationMeta(query.page, query.limit, total),
    };
  }

  async getById(id: string): Promise<IpoResponseDto> {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return toIpoResponseDto(ipo);
  }
}
