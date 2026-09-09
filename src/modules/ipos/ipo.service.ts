import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  paginationMeta,
  paginationOffset,
} from '../../common/pagination/pagination';
import {
  IpoListQuery,
  IpoResponseDto,
  IpoSourcesResponseDto,
  IpoTimelineResponseDto,
} from './ipo.dto';
import {
  toDateOnly,
  toIpoResponseDto,
} from './ipo.mapper';
import { PrismaService } from '../../database/prisma.service';
import { ReconciliationService } from '../discovery/reconciliation.service';
import { IpoRepository } from './ipo.repository';

@Injectable()
export class IpoService {
  constructor(
    private readonly ipos: IpoRepository,
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
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

  async getReconciliation(id: string) {
    const ipo = await this.ipos.findById(id);

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    return this.reconciliation.reconcileIpo(this.prisma, id);
  }
}
