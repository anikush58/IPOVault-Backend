import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { IpoListQuery } from './ipo.dto';
import { IpoWithRelations } from './ipo.types';

const ipoInclude = {
  company: true,
  lifecycleEvents: true,
} satisfies Prisma.IpoInclude;

@Injectable()
export class IpoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: IpoListQuery,
    skip: number,
  ): Promise<IpoWithRelations[]> {
    return this.prisma.ipo.findMany({
      where: this.where(query),
      include: ipoInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: query.limit,
    });
  }

  async count(query: IpoListQuery): Promise<number> {
    return this.prisma.ipo.count({
      where: this.where(query),
    });
  }

  async findById(id: string): Promise<IpoWithRelations | null> {
    return this.prisma.ipo.findUnique({
      where: { id },
      include: ipoInclude,
    });
  }

  async findTimelineEvents(ipoId: string) {
    return this.prisma.ipoLifecycleEvent.findMany({
      where: { ipoId },
      orderBy: { eventDate: 'asc' },
    });
  }

  async findSources(ipoId: string) {
    return this.prisma.ipoSourceIdentity.findMany({
      where: { ipoId },
      include: { source: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findChangeEvents(
    ipoId: string,
    query?: { field?: string; source?: string },
  ) {
    const where: Prisma.IpoChangeEventWhereInput = {
      ipoId,
      ...(query?.field ? { fieldName: query.field } : {}),
      ...(query?.source ? { source: { code: query.source } } : {}),
    };

    return this.prisma.ipoChangeEvent.findMany({
      where,
      include: { source: true },
      orderBy: [{ detectedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findFieldProvenances(
    ipoId: string,
    companyId?: string,
    query?: { field?: string; source?: string },
  ) {
    const entityConditions: Prisma.FieldProvenanceWhereInput[] = [
      { entityType: 'IPO', entityId: ipoId },
    ];
    if (companyId) {
      entityConditions.push({ entityType: 'COMPANY', entityId: companyId });
    }

    const where: Prisma.FieldProvenanceWhereInput = {
      OR: entityConditions,
      ...(query?.source ? { source: { code: query.source } } : {}),
    };

    return this.prisma.fieldProvenance.findMany({
      where,
      include: { source: true },
      orderBy: [{ retrievedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }


  private where(query: IpoListQuery): Prisma.IpoWhereInput {
    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.marketSegment ? { marketSegment: query.marketSegment } : {}),
      ...(query.exchange ? { exchange: query.exchange } : {}),
    };
  }
}
