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

export function decimalToString(
  value: Prisma.Decimal | number | bigint | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof (value as any).toFixed === 'function') {
    return (value as any).toFixed(2);
  }
  return String(value);
}

export function decimalToNumber(
  value: Prisma.Decimal | number | bigint | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  if (typeof value === 'object' && typeof (value as any).toNumber === 'function') {
    return (value as any).toNumber();
  }
  return Number(value);
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
    cin: ipo.company.cin ?? null,
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
    listingPrice: decimalToString(ipo.listingPrice),
    listingGainPct: decimalToString(ipo.listingGainPct),
    profitAmount: decimalToString(ipo.profitAmount),
    profitPercentage: decimalToString(ipo.profitPercentage),
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

  for (const event of ipo.lifecycleEvents ?? []) {
    lifecycle[LIFECYCLE_FIELD[event.eventType]] = toDateOnly(event.eventDate);
  }

  // Derived minimum investment amount (lotSize * priceBandHigh)
  let minimumInvestmentAmount: string | null = null;
  if (ipo.lotSize != null && ipo.priceBandHigh != null) {
    const minVal = ipo.lotSize * Number(ipo.priceBandHigh);
    if (!isNaN(minVal) && minVal > 0) {
      minimumInvestmentAmount = minVal.toFixed(2);
    }
  }

  // Current GMP snapshot from latest observation
  let currentGmp = null;
  const latestGmp = ipo.gmpObservations?.[0];
  if (latestGmp) {
    currentGmp = {
      gmpAmount: decimalToString(latestGmp.gmpAmount)!,
      gmpPercentage: decimalToString(latestGmp.gmpPercentage),
      estProfitPerLot: decimalToString(latestGmp.estProfitPerLot),
      observedAt: latestGmp.observedAt.toISOString(),
    };
  }

  // Current Subscription snapshot from latest observations
  let currentSubscription = null;
  if (ipo.subscriptionObservations && ipo.subscriptionObservations.length > 0) {
    const obsList = ipo.subscriptionObservations;
    const latestDate = obsList[0].observedAt;
    const catList = obsList
      .filter((s) => s.observedAt.getTime() === latestDate.getTime())
      .map((s) => ({
        category: s.category,
        subscriptionMultiple: decimalToString(s.subscriptionMultiple)!,
      }));

    const totalItem = catList.find((c) => c.category === 'OTHER' || c.category === 'QIB');
    currentSubscription = {
      totalSubscriptionMultiple: totalItem ? totalItem.subscriptionMultiple : catList[0]?.subscriptionMultiple ?? null,
      categories: catList,
      observedAt: latestDate.toISOString(),
    };
  }

  return {
    id: ipo.id,
    logoUrl: ipo.company.logoUrl ?? null,
    company: {
      id: ipo.company.id,
      legalName: ipo.company.legalName,
      displayName: ipo.company.displayName,
      logoUrl: ipo.company.logoUrl ?? null,
      cin: ipo.company.cin ?? null,
      website: ipo.company.website ?? null,
      industry: ipo.company.industry ?? null,
      sector: ipo.company.sector ?? null,
      aboutDescription: ipo.company.aboutDescription ?? null,
      phone: ipo.company.phone ?? null,
      email: ipo.company.email ?? null,
      contactPerson: ipo.company.contactPerson ?? null,
      financials: (ipo.company.financials ?? []).map((f) => ({
        id: f.id,
        fiscalPeriod: f.fiscalPeriod,
        periodType: f.periodType,
        totalAssets: decimalToString(f.totalAssets),
        totalRevenue: decimalToString(f.totalRevenue),
        pat: decimalToString(f.pat),
        ebitda: decimalToString(f.ebitda),
        netWorth: decimalToString(f.netWorth),
        roePercentage: decimalToString(f.roePercentage),
        rocePercentage: decimalToString(f.rocePercentage),
        eps: decimalToString(f.eps),
        patMarginPercent: decimalToString(f.patMarginPercent),
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    },
    marketSegment: ipo.marketSegment,
    exchange: ipo.exchange,
    status: ipo.status,
    symbol: ipo.symbol,
    issueSize: decimalToString(ipo.issueSize),
    freshIssueSize: decimalToString(ipo.freshIssueSize),
    ofsSize: decimalToString(ipo.ofsSize),
    issueShareCount: decimalToString(ipo.issueShareCount),
    freshIssueShareCount: decimalToString(ipo.freshIssueShareCount),
    ofsShareCount: decimalToString(ipo.ofsShareCount),
    faceValue: decimalToString(ipo.faceValue),
    priceBandLow: decimalToString(ipo.priceBandLow),
    priceBandHigh: decimalToString(ipo.priceBandHigh),
    lotSize: ipo.lotSize,
    minimumLots: ipo.minimumLots,
    listingPrice: decimalToNumber(ipo.listingPrice),
    listingGainPct: decimalToNumber(ipo.listingGainPct),
    profitAmount: decimalToNumber(ipo.profitAmount),
    profitPercentage: decimalToNumber(ipo.profitPercentage),
    minimumInvestmentAmount,
    lifecycle,
    offerCategories: (ipo.offerCategories ?? []).map((c) => ({
      id: c.id,
      category: c.category,
      allocationPct: decimalToString(c.allocationPct),
      minLots: c.minLots,
      maxLots: c.maxLots,
      minShares: c.minShares,
      maxShares: c.maxShares,
      minAmount: decimalToString(c.minAmount),
      maxAmount: decimalToString(c.maxAmount),
      isUpiEligible: c.isUpiEligible,
    })),
    participants: (ipo.participants ?? []).map((p) => ({
      id: p.id,
      role: p.role,
      name: p.name,
      phone: p.phone,
      email: p.email,
      website: p.website,
      displayOrder: p.displayOrder,
    })),
    drhpUrl: (ipo.documents ?? []).find((d) => d.documentType === 'DRHP' && d.sourceUrl?.trim())?.sourceUrl?.trim() ?? null,
    rhpUrl: (ipo.documents ?? []).find((d) => d.documentType === 'RHP' && d.sourceUrl?.trim())?.sourceUrl?.trim() ?? null,
    prospectusUrl: (ipo.documents ?? []).find((d) => d.documentType === 'PROSPECTUS' && d.sourceUrl?.trim())?.sourceUrl?.trim() ?? null,
    anchorListUrl: (ipo.documents ?? []).find((d) => d.documentType === 'ANCHOR_LIST' && d.sourceUrl?.trim())?.sourceUrl?.trim() ?? null,
    anchorDetails: (() => {
      const anchorDoc = (ipo.documents ?? []).find((d) => d.documentType === 'ANCHOR_LIST');
      const ext = (anchorDoc?.extractionData as any) || {};
      const hasInvestors = Array.isArray(ext.anchorInvestors) && ext.anchorInvestors.length > 0;
      if (!anchorDoc && !ext.anchorPortion && !ext.anchorDetails && !hasInvestors && !ext.anchorBidDate) return null;
      return {
        portion: ext.anchorPortion ?? null,
        bidDate: ext.anchorBidDate ?? null,
        lockIn: ext.anchorLockIn ?? null,
        details: ext.anchorDetails ?? null,
        documentUrl: anchorDoc?.sourceUrl?.trim() ?? null,
        price: ext.anchorPrice ?? null,
        qibPct: ext.anchorQibPct ?? null,
        lockIn30: ext.anchorLockIn30 ?? null,
        lockIn90: ext.anchorLockIn90 ?? null,
        investors: Array.isArray(ext.anchorInvestors) ? ext.anchorInvestors : [],
      };
    })(),
    documents: (ipo.documents ?? [])
      .filter((d) => d.sourceUrl && d.sourceUrl.trim() !== '')
      .map((d) => {
        const cleanUrl = d.sourceUrl!.trim();
        let displayTitle = d.fileName?.trim() || '';
        if (!displayTitle) {
          switch (d.documentType) {
            case 'DRHP': displayTitle = 'Draft Red Herring Prospectus (DRHP)'; break;
            case 'RHP': displayTitle = 'Red Herring Prospectus (RHP)'; break;
            case 'PROSPECTUS': displayTitle = 'Final Prospectus'; break;
            case 'ANCHOR_LIST': displayTitle = 'Anchor Allocation List'; break;
            case 'BASIS_OF_ALLOTMENT': displayTitle = 'Basis of Allotment'; break;
            default: displayTitle = 'IPO Document'; break;
          }
        }
        return {
          id: d.id,
          documentType: d.documentType,
          title: displayTitle,
          fileName: d.fileName?.trim() || null,
          sourceUrl: cleanUrl,
          fileUrl: cleanUrl,
          documentUrl: cleanUrl,
          mimeType: d.mimeType || null,
          fileSizeBytes: d.fileSizeBytes || null,
          parsingStatus: d.parsingStatus,
          uploadedAt: d.uploadedAt.toISOString(),
        };
      }),
    allotment: ipo.allotmentConfig
      ? {
          registrar: ipo.allotmentConfig.registrar,
          registrarIpoCode: ipo.allotmentConfig.registrarIpoCode,
          sourceUrl: ipo.allotmentConfig.allotmentSourceUrl,
          allotmentSourceUrl: ipo.allotmentConfig.allotmentSourceUrl,
          expectedDate: ipo.allotmentConfig.expectedAllotmentDate
            ? toDateOnly(ipo.allotmentConfig.expectedAllotmentDate)
            : null,
          expectedAllotmentDate: ipo.allotmentConfig.expectedAllotmentDate
            ? toDateOnly(ipo.allotmentConfig.expectedAllotmentDate)
            : null,
          enabled: ipo.allotmentConfig.enabled,
        }
      : null,
    currentGmp,
    currentSubscription,
    ...(dataReadiness ? { dataReadiness } : {}),
    createdAt: ipo.createdAt.toISOString(),
    updatedAt: ipo.updatedAt.toISOString(),
  };
}

export type GmpObservationWithSource = Prisma.GmpObservationGetPayload<{
  include: { source: true };
}>;

export function toIpoGmpHistoryResponseDto(
  ipoId: string,
  observations: GmpObservationWithSource[],
) {
  return {
    ipoId,
    observations: observations.map((o) => ({
      id: o.id,
      gmpAmount: decimalToString(o.gmpAmount)!,
      gmpPercentage: decimalToString(o.gmpPercentage),
      estProfitPerLot: decimalToString(o.estProfitPerLot),
      source: o.source
        ? {
            code: o.source.code,
            name: o.source.name,
          }
        : null,
      observedAt: o.observedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
    })),
    totalCount: observations.length,
  };
}

export type SubscriptionObservationWithSource = Prisma.SubscriptionObservationGetPayload<{
  include: { source: true };
}>;

export function toIpoSubscriptionHistoryResponseDto(
  ipoId: string,
  observations: SubscriptionObservationWithSource[],
) {
  return {
    ipoId,
    subscriptionSupported: observations.length > 0,
    observations: observations.map((s) => ({
      id: s.id,
      category: s.category,
      subscriptionMultiple: decimalToString(s.subscriptionMultiple)!,
      sharesBid: decimalToString(s.sharesBid),
      sharesOffered: decimalToString(s.sharesOffered),
      source: s.source
        ? {
            code: s.source.code,
            name: s.source.name,
          }
        : null,
      observedAt: s.observedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
    totalCount: observations.length,
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
