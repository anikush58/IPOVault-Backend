import { Injectable } from '@nestjs/common';
import { IpoStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { IpoListQuery } from './ipo.dto';
import { IpoWithRelations } from './ipo.types';

const ipoInclude = {
  company: {
    include: {
      financials: {
        orderBy: { fiscalPeriod: 'asc' },
      },
    },
  },
  lifecycleEvents: true,
  offerCategories: {
    orderBy: { category: 'asc' },
  },
  participants: {
    orderBy: { displayOrder: 'asc' },
  },
  documents: {
    orderBy: { uploadedAt: 'desc' },
  },
  allotmentConfig: true,
  gmpObservations: {
    orderBy: { observedAt: 'desc' },
    take: 1,
    include: { source: true },
  },
  subscriptionObservations: {
    orderBy: { observedAt: 'desc' },
    take: 10,
    include: { source: true },
  },
} satisfies Prisma.IpoInclude;

@Injectable()
export class IpoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: IpoListQuery,
    skip: number,
  ): Promise<IpoWithRelations[]> {
    const rows = await this.prisma.ipo.findMany({
      where: this.where(query),
      include: ipoInclude,
      orderBy: this.orderBy(query),
    });

    const sorted = this.sortIposSmartly(rows, query);
    return sorted.slice(skip, skip + query.limit);
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

  async findGmpHistory(ipoId: string) {
    return this.prisma.gmpObservation.findMany({
      where: { ipoId },
      include: { source: true },
      orderBy: { observedAt: 'asc' },
    });
  }

  async findSubscriptionHistory(ipoId: string) {
    return this.prisma.subscriptionObservation.findMany({
      where: { ipoId },
      include: { source: true },
      orderBy: { observedAt: 'asc' },
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
        const statuses = query.status.map((s) =>
          s === 'ALLOTMENT_OUT' ? ('ALLOTMENT_COMPLETED' as IpoStatus) : (s as IpoStatus),
        );
        where.status = { in: statuses };
      } else {
        const s = query.status === 'ALLOTMENT_OUT' ? 'ALLOTMENT_COMPLETED' : query.status;
        where.status = s as IpoStatus;
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

  private sortIposSmartly(items: IpoWithRelations[], query: IpoListQuery): IpoWithRelations[] {
    const extractDate = (ipo: IpoWithRelations, eventType: string): Date | null => {
      if (!ipo || !ipo.lifecycleEvents) return null;
      const ev = ipo.lifecycleEvents.find((e) => e.eventType === eventType);
      if (!ev || !ev.eventDate) return null;
      return ev.eventDate instanceof Date ? ev.eventDate : new Date(ev.eventDate);
    };

    const extractAllotmentDate = (ipo: IpoWithRelations): Date | null => {
      if (ipo?.allotmentResultAvailableAt) {
        return ipo.allotmentResultAvailableAt instanceof Date
          ? ipo.allotmentResultAvailableAt
          : new Date(ipo.allotmentResultAvailableAt);
      }
      return extractDate(ipo, 'BASIS_OF_ALLOTMENT') || extractDate(ipo, 'ALLOTMENT');
    };

    const extractGmp = (ipo: IpoWithRelations): number | null => {
      if (ipo.gmpObservations && ipo.gmpObservations.length > 0 && ipo.gmpObservations[0].gmpAmount !== null && ipo.gmpObservations[0].gmpAmount !== undefined) {
        return Number(ipo.gmpObservations[0].gmpAmount);
      }
      return null;
    };

    const sort = query.sort;
    const order = query.order ?? (sort === 'companyName' || sort === 'legalName' || sort === 'openDate' || sort === 'closeDate' ? 'asc' : 'desc');

    if (sort && sort !== 'smart') {
      return [...items].sort((a, b) => {
        let diff = 0;
        if (sort === 'closeDate') {
          const dA = extractDate(a, 'CLOSE');
          const dB = extractDate(b, 'CLOSE');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'openDate') {
          const dA = extractDate(a, 'OPEN');
          const dB = extractDate(b, 'OPEN');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'listingDate') {
          const dA = extractDate(a, 'LISTING');
          const dB = extractDate(b, 'LISTING');
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'allotmentDate') {
          const dA = extractAllotmentDate(a);
          const dB = extractAllotmentDate(b);
          if (dA && dB) diff = dA.getTime() - dB.getTime();
          else if (dA) return -1;
          else if (dB) return 1;
        } else if (sort === 'gmp') {
          const gA = extractGmp(a);
          const gB = extractGmp(b);
          if (gA !== null && gB !== null) diff = gA - gB;
          else if (gA !== null) return -1;
          else if (gB !== null) return 1;
        } else if (sort === 'companyName' || sort === 'legalName') {
          const nA = (a.company?.displayName || a.company?.legalName || '').toLowerCase();
          const nB = (b.company?.displayName || b.company?.legalName || '').toLowerCase();
          diff = nA.localeCompare(nB);
        } else if (sort === 'issueSize') {
          const sA = a.issueSize ? Number(a.issueSize) : null;
          const sB = b.issueSize ? Number(b.issueSize) : null;
          if (sA !== null && sB !== null) diff = sA - sB;
          else if (sA !== null) return -1;
          else if (sB !== null) return 1;
        } else if (sort === 'price' || sort === 'priceBandLow') {
          const pA = a.priceBandLow ? Number(a.priceBandLow) : null;
          const pB = b.priceBandLow ? Number(b.priceBandLow) : null;
          if (pA !== null && pB !== null) diff = pA - pB;
          else if (pA !== null) return -1;
          else if (pB !== null) return 1;
        } else if (sort === 'lotSize') {
          const lA = a.lotSize ?? null;
          const lB = b.lotSize ?? null;
          if (lA !== null && lB !== null) diff = lA - lB;
          else if (lA !== null) return -1;
          else if (lB !== null) return 1;
        } else if (sort === 'updatedAt') {
          diff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        } else {
          diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }

        return order === 'asc' ? diff : -diff;
      });
    }

    // Default Smart status-aware sorting:
    return [...items].sort((a, b) => {
      const getStatusRank = (st: string) => {
        switch (st) {
          case 'CLOSING_TODAY': return 1;
          case 'OPEN': return 2;
          case 'UPCOMING': return 3;
          case 'CLOSED':
          case 'ALLOTMENT_PENDING': return 4;
          case 'ALLOTMENT_COMPLETED': return 5;
          case 'LISTING_PENDING':
          case 'LISTED': return 6;
          default: return 7;
        }
      };

      const rankA = getStatusRank(a.status);
      const rankB = getStatusRank(b.status);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      if (a.status === 'OPEN' || a.status === 'CLOSING_TODAY') {
        // Closing soon comes on top (ASC closeDate)
        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cA.getTime() - cB.getTime();
          if (diff !== 0) return diff;
        } else if (cA) return -1;
        else if (cB) return 1;

        const oA = extractDate(a, 'OPEN');
        const oB = extractDate(b, 'OPEN');
        if (oA && oB) {
          const diff = oA.getTime() - oB.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'UPCOMING') {
        // Opening / closing soon comes on top (ASC openDate, then ASC closeDate)
        const oA = extractDate(a, 'OPEN');
        const oB = extractDate(b, 'OPEN');
        if (oA && oB) {
          const diff = oA.getTime() - oB.getTime();
          if (diff !== 0) return diff;
        } else if (oA) return -1;
        else if (oB) return 1;

        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cA.getTime() - cB.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'CLOSED' || a.status === 'ALLOTMENT_PENDING') {
        // Closed recently comes on top (DESC closeDate)
        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cB.getTime() - cA.getTime();
          if (diff !== 0) return diff;
        } else if (cA) return -1;
        else if (cB) return 1;
      } else if (a.status === 'ALLOTMENT_COMPLETED') {
        // Allotment out recently comes on top (DESC allotmentDate)
        const alA = extractAllotmentDate(a);
        const alB = extractAllotmentDate(b);
        if (alA && alB) {
          const diff = alB.getTime() - alA.getTime();
          if (diff !== 0) return diff;
        } else if (alA) return -1;
        else if (alB) return 1;

        const cA = extractDate(a, 'CLOSE');
        const cB = extractDate(b, 'CLOSE');
        if (cA && cB) {
          const diff = cB.getTime() - cA.getTime();
          if (diff !== 0) return diff;
        }
      } else if (a.status === 'LISTED' || a.status === 'LISTING_PENDING') {
        // Listed recently comes on top (DESC listingDate)
        const lA = extractDate(a, 'LISTING');
        const lB = extractDate(b, 'LISTING');
        if (lA && lB) {
          const diff = lB.getTime() - lA.getTime();
          if (diff !== 0) return diff;
        } else if (lA) return -1;
        else if (lB) return 1;
      }

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
}
