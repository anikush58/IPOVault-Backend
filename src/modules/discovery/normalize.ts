import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';

import { DiscoveredIpo, DiscoveredLifecycle } from './discovery.types';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

function cin(value: unknown): string | null {
  const raw = text(value);
  return raw ? raw.replace(/\s+/g, '').toUpperCase() : null;
}

function decimalString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number =
    typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number)) {
    return null;
  }

  return number.toFixed(2);
}

function shareCountString(value: unknown): string | null {
  const number = integer(value);
  if (number === null || number < 0) {
    return null;
  }

  return String(number);
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number =
    typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(number)) {
    return null;
  }

  return number;
}

function dateOnly(value: unknown): string | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  return null;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  const raw = text(value)?.toUpperCase();
  if (!raw) {
    return null;
  }

  return allowed.includes(raw as T) ? (raw as T) : null;
}

const emptyLifecycle = (): DiscoveredLifecycle => ({
  drhpDate: null,
  rhpDate: null,
  anchorDate: null,
  openDate: null,
  closeDate: null,
  basisOfAllotmentDate: null,
  refundInitiationDate: null,
  dematCreditDate: null,
  listingDate: null,
});

export function normalizeDiscoveredIpo(payload: unknown): DiscoveredIpo {
  const root = asRecord(payload);
  const company = asRecord(root.company);
  const ipo = asRecord(root.ipo);
  const lifecycle = asRecord(root.lifecycle);
  const source = asRecord(root.source);

  const legalName = text(company.legalName) ?? '';
  const displayName = text(company.displayName) ?? legalName;

  return {
    company: {
      legalName,
      displayName: displayName || null,
      cin: cin(company.cin),
    },
    ipo: {
      marketSegment:
        enumValue(ipo.marketSegment, ['MAINBOARD', 'SME'] as const) ??
        ('MAINBOARD' as MarketSegment),
      exchange:
        enumValue(ipo.exchange, ['NSE', 'BSE', 'BOTH'] as const) ??
        ('NSE' as ExchangeListing),
      status: enumValue(ipo.status, [
        'DRAFT',
        'UPCOMING',
        'OPEN',
        'CLOSED',
        'ALLOTMENT_PENDING',
        'ALLOTMENT_COMPLETED',
        'LISTING_PENDING',
        'LISTED',
        'WITHDRAWN',
        'CANCELLED',
      ] as const) as IpoStatus | null,
      symbol: text(ipo.symbol),
      issueSize: decimalString(ipo.issueSize),
      freshIssueSize: decimalString(ipo.freshIssueSize),
      ofsSize: decimalString(ipo.ofsSize),
      issueShareCount: shareCountString(ipo.issueShareCount),
      freshIssueShareCount: shareCountString(ipo.freshIssueShareCount),
      ofsShareCount: shareCountString(ipo.ofsShareCount),
      faceValue: decimalString(ipo.faceValue),
      priceBandLow: decimalString(ipo.priceBandLow),
      priceBandHigh: decimalString(ipo.priceBandHigh),
      lotSize: integer(ipo.lotSize),
      minimumLots: integer(ipo.minimumLots),
    },
    lifecycle: {
      ...emptyLifecycle(),
      drhpDate: dateOnly(lifecycle.drhpDate),
      rhpDate: dateOnly(lifecycle.rhpDate),
      anchorDate: dateOnly(lifecycle.anchorDate),
      openDate: dateOnly(lifecycle.openDate),
      closeDate: dateOnly(lifecycle.closeDate),
      basisOfAllotmentDate: dateOnly(lifecycle.basisOfAllotmentDate),
      refundInitiationDate: dateOnly(lifecycle.refundInitiationDate),
      dematCreditDate: dateOnly(lifecycle.dematCreditDate),
      listingDate: dateOnly(lifecycle.listingDate),
    },
    source: {
      externalId: text(source.externalId),
      reference: text(source.reference),
    },
  };
}
