import { LifecycleEventType, Prisma } from '@prisma/client';

import { IpoLifecycleDto, IpoResponseDto } from './ipo.dto';
import { IpoWithRelations } from './ipo.types';

const LIFECYCLE_FIELD: Record<LifecycleEventType, keyof IpoLifecycleDto> = {
  DRHP: 'drhpDate',
  RHP: 'rhpDate',
  ANCHOR: 'anchorDate',
  OPEN: 'openDate',
  CLOSE: 'closeDate',
  BASIS_OF_ALLOTMENT: 'basisOfAllotmentDate',
  REFUND_INITIATION: 'refundInitiationDate',
  DEMAT_CREDIT: 'dematCreditDate',
  LISTING: 'listingDate',
};

export function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(2);
}

export function emptyLifecycle(): IpoLifecycleDto {
  return {
    drhpDate: null,
    rhpDate: null,
    anchorDate: null,
    openDate: null,
    closeDate: null,
    basisOfAllotmentDate: null,
    refundInitiationDate: null,
    dematCreditDate: null,
    listingDate: null,
  };
}

export function toIpoResponseDto(ipo: IpoWithRelations): IpoResponseDto {
  const lifecycle = emptyLifecycle();

  for (const event of ipo.lifecycleEvents) {
    lifecycle[LIFECYCLE_FIELD[event.eventType]] = toDateOnly(event.eventDate);
  }

  return {
    id: ipo.id,
    company: {
      id: ipo.company.id,
      legalName: ipo.company.legalName,
      displayName: ipo.company.displayName,
      cin: ipo.company.cin,
      website: ipo.company.website,
      industry: ipo.company.industry,
      sector: ipo.company.sector,
    },
    marketSegment: ipo.marketSegment,
    exchange: ipo.exchange,
    status: ipo.status,
    symbol: ipo.symbol,
    issueSize: decimalToString(ipo.issueSize),
    freshIssueSize: decimalToString(ipo.freshIssueSize),
    ofsSize: decimalToString(ipo.ofsSize),
    faceValue: decimalToString(ipo.faceValue),
    priceBandLow: decimalToString(ipo.priceBandLow),
    priceBandHigh: decimalToString(ipo.priceBandHigh),
    lotSize: ipo.lotSize,
    minimumLots: ipo.minimumLots,
    lifecycle,
    createdAt: ipo.createdAt.toISOString(),
    updatedAt: ipo.updatedAt.toISOString(),
  };
}
