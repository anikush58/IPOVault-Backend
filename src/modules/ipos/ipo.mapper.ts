import { LifecycleEventType, Prisma } from '@prisma/client';

import {
  DataReadinessStatus,
  IpoDataReadinessDto,
  IpoLifecycleDto,
  IpoResponseDto,
} from './ipo.dto';
import { IpoWithRelations } from './ipo.types';
import { IpoQualityGateReport } from '../discovery/discovery-quality-gate.service';

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

export function toIpoDataReadinessDto(
  report: IpoQualityGateReport,
): IpoDataReadinessDto {
  let readinessStatus: DataReadinessStatus = 'READY';
  let isReady = true;
  let summary =
    'IPO data is complete, fresh, and ready for production consumption.';

  switch (report.status) {
    case 'PASS':
      readinessStatus = 'READY';
      isReady = true;
      summary =
        'IPO data is complete, fresh, and ready for production consumption.';
      break;
    case 'PASS_WITH_WARNINGS':
      readinessStatus = 'READY_WITH_WARNINGS';
      isReady = true;
      summary =
        'IPO data is ready for consumption with minor non-blocking warnings.';
      break;
    case 'NEEDS_REVIEW':
      readinessStatus = 'NEEDS_REVIEW';
      isReady = false;
      summary =
        'IPO data requires review due to source conflicts or stale authoritative data.';
      break;
    case 'INCOMPLETE':
      readinessStatus = 'INCOMPLETE';
      isReady = false;
      summary =
        'IPO data is incomplete and missing required terms or lifecycle information.';
      break;
  }

  return {
    status: readinessStatus,
    isReady,
    summary,
    missingFieldCount:
      report.coverageSummary.missing + report.coverageSummary.unknown,
    staleFieldCount: report.coverageSummary.stale,
    conflictFieldCount: report.coverageSummary.conflict,
    refreshRecommended: report.refreshRecommendations.length > 0,
  };
}

export function toIpoResponseDto(
  ipo: IpoWithRelations,
  dataReadiness?: IpoDataReadinessDto,
): IpoResponseDto {
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
    ...(dataReadiness ? { dataReadiness } : {}),
    createdAt: ipo.createdAt.toISOString(),
    updatedAt: ipo.updatedAt.toISOString(),
  };
}
