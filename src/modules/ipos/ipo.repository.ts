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
      orderBy: this.orderBy(query),
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

  async findByIds(ids: string[]): Promise<IpoWithRelations[]> {
    return this.prisma.ipo.findMany({
      where: { id: { in: ids } },
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
    const where: Prisma.IpoWhereInput = {};

    const trimmedQ = query.q?.trim();
    if (trimmedQ) {
      where.OR = [
        { company: { legalName: { contains: trimmedQ, mode: 'insensitive' } } },
        { company: { displayName: { contains: trimmedQ, mode: 'insensitive' } } },
        { company: { cin: { contains: trimmedQ, mode: 'insensitive' } } },
        { symbol: { contains: trimmedQ, mode: 'insensitive' } },
      ];
    }

    if (query.publicationStatus) {
      where.publicationStatus = query.publicationStatus;
    } else {
      where.publicationStatus = 'PUBLISHED';
    }

    if (query.status) {
      if (Array.isArray(query.status)) {
        where.status = { in: query.status };
      } else {
        where.status = query.status;
      }
    }
    if (query.marketSegment) {
      where.marketSegment = query.marketSegment;
    }
    if (query.exchange) {
      where.exchange = query.exchange;
    }
    if (query.symbol) {
      where.symbol = { contains: query.symbol.trim(), mode: 'insensitive' };
    }

    if (query.priceMin !== undefined || query.priceMax !== undefined) {
      where.priceBandLow = {
        ...(query.priceMin !== undefined
          ? { gte: new Prisma.Decimal(query.priceMin) }
          : {}),
        ...(query.priceMax !== undefined
          ? { lte: new Prisma.Decimal(query.priceMax) }
          : {}),
      };
    }

    if (query.lotSizeMin !== undefined || query.lotSizeMax !== undefined) {
      where.lotSize = {
        ...(query.lotSizeMin !== undefined ? { gte: query.lotSizeMin } : {}),
        ...(query.lotSizeMax !== undefined ? { lte: query.lotSizeMax } : {}),
      };
    }

    if (query.issueSizeMin !== undefined || query.issueSizeMax !== undefined) {
      where.issueSize = {
        ...(query.issueSizeMin !== undefined
          ? { gte: new Prisma.Decimal(query.issueSizeMin) }
          : {}),
        ...(query.issueSizeMax !== undefined
          ? { lte: new Prisma.Decimal(query.issueSizeMax) }
          : {}),
      };
    }

    const lifecycleConditions: Prisma.IpoLifecycleEventWhereInput[] = [];

    if (query.openDateFrom || query.openDateTo) {
      lifecycleConditions.push({
        eventType: 'OPEN',
        eventDate: {
          ...(query.openDateFrom
            ? { gte: new Date(`${query.openDateFrom}T00:00:00.000Z`) }
            : {}),
          ...(query.openDateTo
            ? { lte: new Date(`${query.openDateTo}T23:59:59.999Z`) }
            : {}),
        },
      });
    }

    if (query.closeDateFrom || query.closeDateTo) {
      lifecycleConditions.push({
        eventType: 'CLOSE',
        eventDate: {
          ...(query.closeDateFrom
            ? { gte: new Date(`${query.closeDateFrom}T00:00:00.000Z`) }
            : {}),
          ...(query.closeDateTo
            ? { lte: new Date(`${query.closeDateTo}T23:59:59.999Z`) }
            : {}),
        },
      });
    }

    if (query.listingDateFrom || query.listingDateTo) {
      lifecycleConditions.push({
        eventType: 'LISTING',
        eventDate: {
          ...(query.listingDateFrom
            ? { gte: new Date(`${query.listingDateFrom}T00:00:00.000Z`) }
            : {}),
          ...(query.listingDateTo
            ? { lte: new Date(`${query.listingDateTo}T23:59:59.999Z`) }
            : {}),
        },
      });
    }

    if (lifecycleConditions.length > 0) {
      where.AND = lifecycleConditions.map((cond) => ({
        lifecycleEvents: { some: cond },
      }));
    }

    return where;
  }

  private orderBy(query: IpoListQuery): Prisma.IpoOrderByWithRelationInput[] {
    const order = query.order ?? 'desc';
    const sort = query.sort ?? 'createdAt';

    switch (sort) {
      case 'legalName':
      case 'companyName':
        return [{ company: { legalName: order } }, { id: 'asc' }];
      case 'symbol':
        return [{ symbol: order }, { id: 'asc' }];
      case 'status':
        return [{ status: order }, { id: 'asc' }];
      case 'issueSize':
        return [{ issueSize: order }, { id: 'asc' }];
      case 'price':
      case 'priceBandLow':
        return [{ priceBandLow: order }, { id: 'asc' }];
      case 'lotSize':
        return [{ lotSize: order }, { id: 'asc' }];
      case 'updatedAt':
        return [{ updatedAt: order }, { id: 'asc' }];
      case 'createdAt':
      default:
        return [{ createdAt: order }, { id: 'desc' }];
    }
  }
}
