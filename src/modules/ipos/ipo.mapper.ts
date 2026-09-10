import { LifecycleEventType, Prisma } from '@prisma/client';

import {
  CompareIpoItemDto,
  DataReadinessStatus,
  IpoChangesResponseDto,
  IpoCompareResponseDto,
  IpoDataReadinessDto,
  IpoFieldLineageDto,
  IpoFieldObservationDto,
  IpoLifecycleDto,
  IpoLineageQuery,
  IpoLineageResponseDto,
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

export function toCompareIpoItemDto(ipo: IpoWithRelations): CompareIpoItemDto {
  const lifecycle = emptyLifecycle();

  for (const event of ipo.lifecycleEvents ?? []) {
    lifecycle[LIFECYCLE_FIELD[event.eventType]] = toDateOnly(event.eventDate);
  }

  return {
    id: ipo.id,
    companyName: ipo.company.displayName,
    legalName: ipo.company.legalName,
    symbol: ipo.symbol,
    cin: ipo.company.cin,
    status: ipo.status,
    marketSegment: ipo.marketSegment,
    exchange: ipo.exchange,
    issueSize: decimalToString(ipo.issueSize),
    freshIssueSize: decimalToString(ipo.freshIssueSize),
    ofsSize: decimalToString(ipo.ofsSize),
    issueShareCount: decimalToString(ipo.issueShareCount),
    freshIssueShareCount: decimalToString(ipo.freshIssueShareCount),
    ofsShareCount: decimalToString(ipo.ofsShareCount),
    priceBandLow: decimalToString(ipo.priceBandLow),
    priceBandHigh: decimalToString(ipo.priceBandHigh),
    lotSize: ipo.lotSize,
    minimumLots: ipo.minimumLots,
    faceValue: decimalToString(ipo.faceValue),
    openDate: lifecycle.openDate,
    closeDate: lifecycle.closeDate,
    listingDate: lifecycle.listingDate,
  };
}

export function toIpoCompareResponseDto(
  ipos: IpoWithRelations[],
  requestedIds: string[],
): IpoCompareResponseDto {
  const ipoMap = new Map<string, IpoWithRelations>();
  for (const ipo of ipos) {
    ipoMap.set(ipo.id, ipo);
  }

  const orderedItems: CompareIpoItemDto[] = [];
  for (const id of requestedIds) {
    const ipo = ipoMap.get(id);
    if (ipo) {
      orderedItems.push(toCompareIpoItemDto(ipo));
    }
  }

  return {
    data: {
      ipos: orderedItems,
    },
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

export type IpoChangeEventWithSource = Prisma.IpoChangeEventGetPayload<{
  include: { source: true };
}>;

export function toIpoChangesResponseDto(
  ipoId: string,
  events: IpoChangeEventWithSource[],
): IpoChangesResponseDto {
  return {
    ipoId,
    changes: events.map((e) => ({
      id: e.id,
      fieldName: e.fieldName,
      oldValue: e.oldValue,
      newValue: e.newValue,
      changeType: e.changeType,
      source: e.source
        ? {
            id: e.source.id,
            code: e.source.code,
            name: e.source.name,
            sourceType: e.source.sourceType,
          }
        : null,
      sourceReference: e.sourceReference,
      detectedAt: e.detectedAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
  };
}


export type FieldProvenanceWithSource = Prisma.FieldProvenanceGetPayload<{
  include: { source: true };
}>;

const STORAGE_TO_PUBLIC_FIELD: Record<string, string> = {
  legal_name: 'company.legalName',
  cin: 'company.cin',
  face_value: 'faceValue',
  issue_size: 'issueSize',
  fresh_issue_size: 'freshIssueSize',
  ofs_size: 'ofsSize',
  issue_share_count: 'issueShareCount',
  fresh_issue_share_count: 'freshIssueShareCount',
  ofs_share_count: 'ofsShareCount',
  price_band_low: 'priceBandLow',
  price_band_high: 'priceBandHigh',
  lot_size: 'lotSize',
  'lifecycle.open_date': 'openDate',
  'lifecycle.close_date': 'closeDate',
  'lifecycle.listing_date': 'listingDate',
  'lifecycle.drhp_date': 'drhpDate',
  'lifecycle.rhp_date': 'rhpDate',
  'lifecycle.anchor_date': 'anchorDate',
  'lifecycle.basis_of_allotment_date': 'basisOfAllotmentDate',
  'lifecycle.refund_initiation_date': 'refundInitiationDate',
  'lifecycle.demat_credit_date': 'dematCreditDate',
  symbol: 'symbol',
  status: 'status',
  market_segment: 'marketSegment',
  exchange: 'exchange',
};

const CANONICAL_FIELD_PRIORITY: Record<string, number> = {
  'company.legalName': 1,
  'company.cin': 2,
  faceValue: 3,
  issueSize: 4,
  freshIssueSize: 5,
  ofsSize: 6,
  issueShareCount: 7,
  freshIssueShareCount: 8,
  ofsShareCount: 9,
  priceBandLow: 10,
  priceBandHigh: 11,
  lotSize: 12,
  openDate: 13,
  closeDate: 14,
  listingDate: 15,
};

export function getPublicFieldName(storageFieldName: string): string {
  return STORAGE_TO_PUBLIC_FIELD[storageFieldName] ?? storageFieldName;
}

export function getCanonicalValue(
  ipo: IpoWithRelations,
  publicFieldName: string,
): string | null {
  switch (publicFieldName) {
    case 'company.legalName':
      return ipo.company?.legalName ?? null;
    case 'company.cin':
      return ipo.company?.cin ?? null;
    case 'faceValue':
      return decimalToString(ipo.faceValue);
    case 'issueSize':
      return decimalToString(ipo.issueSize);
    case 'freshIssueSize':
      return decimalToString(ipo.freshIssueSize);
    case 'ofsSize':
      return decimalToString(ipo.ofsSize);
    case 'issueShareCount':
      return ipo.issueShareCount ? String(ipo.issueShareCount) : null;
    case 'freshIssueShareCount':
      return ipo.freshIssueShareCount ? String(ipo.freshIssueShareCount) : null;
    case 'ofsShareCount':
      return ipo.ofsShareCount ? String(ipo.ofsShareCount) : null;
    case 'priceBandLow':
      return decimalToString(ipo.priceBandLow);
    case 'priceBandHigh':
      return decimalToString(ipo.priceBandHigh);
    case 'lotSize':
      return ipo.lotSize !== null ? String(ipo.lotSize) : null;
    case 'openDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'OPEN');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'closeDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'CLOSE');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'listingDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'LISTING');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'drhpDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'DRHP');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'rhpDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'RHP');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'anchorDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'ANCHOR');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'basisOfAllotmentDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'BASIS_OF_ALLOTMENT');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'refundInitiationDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'REFUND_INITIATION');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'dematCreditDate': {
      const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'DEMAT_CREDIT');
      return evt ? toDateOnly(evt.eventDate) : null;
    }
    case 'symbol':
      return ipo.symbol;
    case 'status':
      return ipo.status;
    case 'marketSegment':
      return ipo.marketSegment;
    case 'exchange':
      return ipo.exchange;
    default:
      return null;
  }
}

export function toIpoLineageResponseDto(
  ipoId: string,
  ipo: IpoWithRelations,
  provenances: FieldProvenanceWithSource[],
  query?: IpoLineageQuery,
): IpoLineageResponseDto {
  let filtered = provenances;

  if (query?.field) {
    const filterField = query.field.trim();
    filtered = filtered.filter((p) => {
      const publicName = getPublicFieldName(p.fieldName);
      return (
        publicName.toLowerCase() === filterField.toLowerCase() ||
        p.fieldName.toLowerCase() === filterField.toLowerCase()
      );
    });
  }

  if (query?.source) {
    const filterSource = query.source.trim().toLowerCase();
    filtered = filtered.filter(
      (p) => p.source?.code.toLowerCase() === filterSource,
    );
  }

  // Group by public field name
  const grouped = new Map<string, FieldProvenanceWithSource[]>();
  for (const prov of filtered) {
    const publicName = getPublicFieldName(prov.fieldName);
    const list = grouped.get(publicName) ?? [];
    list.push(prov);
    grouped.set(publicName, list);
  }

  const fields: IpoFieldLineageDto[] = [];

  for (const [fieldName, provList] of grouped.entries()) {
    // Pick the latest provenance observation per source for this field
    const bySource = new Map<string, FieldProvenanceWithSource>();
    for (const p of provList) {
      const existing = bySource.get(p.sourceId);
      if (
        !existing ||
        p.retrievedAt > existing.retrievedAt ||
        (p.retrievedAt.getTime() === existing.retrievedAt.getTime() &&
          p.createdAt > existing.createdAt)
      ) {
        bySource.set(p.sourceId, p);
      }
    }

    // Sort latest source observations by retrievedAt DESC, then source.code ASC
    const latestObservationsBySource = Array.from(bySource.values()).sort(
      (a, b) => {
        const timeDiff = b.retrievedAt.getTime() - a.retrievedAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        const codeA = a.source?.code ?? '';
        const codeB = b.source?.code ?? '';
        return codeA.localeCompare(codeB);
      },
    );

    const canonicalVal = getCanonicalValue(ipo, fieldName);

    const observations: IpoFieldObservationDto[] = latestObservationsBySource.map(
      (p) => ({
        source: {
          code: p.source.code,
          name: p.source.name,
          sourceType: p.source.sourceType,
        },
        observedValue: p.value,
        observedAt: p.retrievedAt.toISOString(),
        sourceReference: p.sourceReference,
      }),
    );

    const primary = latestObservationsBySource[0] ?? null;

    fields.push({
      fieldName,
      canonicalValue: canonicalVal,
      source: primary
        ? {
            code: primary.source.code,
            name: primary.source.name,
            sourceType: primary.source.sourceType,
          }
        : null,
      observedValue: primary ? primary.value : null,
      observedAt: primary ? primary.retrievedAt.toISOString() : null,
      observations,
    });
  }

  // Deterministic sorting of fields
  fields.sort((a, b) => {
    const rankA = CANONICAL_FIELD_PRIORITY[a.fieldName] ?? 999;
    const rankB = CANONICAL_FIELD_PRIORITY[b.fieldName] ?? 999;
    if (rankA !== rankB) return rankA - rankB;
    return a.fieldName.localeCompare(b.fieldName);
  });

  return {
    ipoId,
    fields,
  };
}
