import { NseParseError } from './nse-parse.error';

export type NseParsedPayload = {
  company: {
    legalName: string;
    displayName: string | null;
    cin: string | null;
  };
  ipo: {
    marketSegment: 'MAINBOARD' | 'SME';
    exchange: 'NSE';
    status: string | null;
    symbol: string | null;
    issueSize: number | null;
    freshIssueSize: number | null;
    ofsSize: number | null;
    faceValue: number | null;
    priceBandLow: number | null;
    priceBandHigh: number | null;
    lotSize: number | null;
    minimumLots: number | null;
  };
  lifecycle: {
    openDate: string | null;
    closeDate: string | null;
    listingDate: string | null;
  };
  source: {
    externalId: string | null;
    reference: string | null;
  };
};

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapIssue(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object') {
    throw new NseParseError('NSE payload must be an object');
  }

  const root = asRecord(raw);
  if (Array.isArray(root.data)) {
    const first = root.data[0];
    if (first === null || typeof first !== 'object' || Array.isArray(first)) {
      throw new NseParseError('NSE payload data[0] must be an issue object');
    }
    return first as Record<string, unknown>;
  }

  return root;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCroresToRupees(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NseParseError('issue size is not a finite number');
    }
    return value < 10_000_000 ? value * 10_000_000 : value;
  }

  if (typeof value !== 'string') {
    throw new NseParseError('issue size must be a string or number');
  }

  const numeric = Number(value.replace(/,/g, '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric)) {
    throw new NseParseError(`unparseable issue size: ${value}`);
  }

  return numeric * 10_000_000;
}

function parseRupees(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new NseParseError('monetary value must be a positive number');
    }
    return value;
  }

  if (typeof value !== 'string') {
    throw new NseParseError('monetary value must be a string or number');
  }

  const numeric = Number(value.replace(/,/g, '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new NseParseError(`unparseable monetary value: ${value}`);
  }

  return numeric;
}

function parsePriceBand(value: unknown): { low: number; high: number } | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new NseParseError('price band must be a string');
  }

  const numbers = [...value.matchAll(/(\d+(?:\.\d+)?)/g)].map((match) =>
    Number(match[1]),
  );

  if (numbers.length < 2 || !numbers.every(Number.isFinite)) {
    throw new NseParseError(`unparseable price band: ${value}`);
  }

  return { low: numbers[0], high: numbers[1] };
}

function parseInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric =
    typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));

  if (!Number.isInteger(numeric)) {
    throw new NseParseError(`unparseable integer: ${String(value)}`);
  }

  return numeric;
}

function parseDateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new NseParseError('date must be a string');
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const dmy = trimmed.match(/^(\d{1,2})[/-]([A-Za-z]{3})[/-](\d{4})$/);
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()];
    if (!month) {
      throw new NseParseError(`unparseable date: ${value}`);
    }
    return `${dmy[3]}-${month}-${dmy[1].padStart(2, '0')}`;
  }

  throw new NseParseError(`unparseable date: ${value}`);
}

function parseMarketSegment(value: unknown): 'MAINBOARD' | 'SME' {
  const raw = text(value)?.toLowerCase() ?? '';
  if (raw.includes('sme')) {
    return 'SME';
  }
  return 'MAINBOARD';
}

function parseStatus(value: unknown): string | null {
  const raw = text(value)?.toLowerCase();
  if (!raw) {
    return null;
  }

  if (raw.includes('open') || raw === 'active') {
    return 'OPEN';
  }
  if (raw.includes('close')) {
    return 'CLOSED';
  }
  if (raw.includes('list')) {
    return 'LISTED';
  }
  if (raw.includes('forthcoming') || raw.includes('upcoming')) {
    return 'UPCOMING';
  }

  return null;
}

export function parseNseIpo(raw: unknown): NseParsedPayload {
  const issue = unwrapIssue(raw);
  const companyName = text(issue.companyName);

  if (!companyName) {
    throw new NseParseError('companyName is required');
  }

  const symbol = text(issue.symbol) ?? text(issue.tradingSymbol);
  const priceBand = parsePriceBand(issue.priceBand);

  return {
    company: {
      legalName: companyName,
      displayName: text(issue.displayName) ?? companyName,
      cin: text(issue.cin),
    },
    ipo: {
      marketSegment: parseMarketSegment(issue.issueType ?? issue.category),
      exchange: 'NSE',
      status: parseStatus(issue.status),
      symbol,
      issueSize: parseCroresToRupees(issue.issueSize),
      freshIssueSize: parseCroresToRupees(issue.freshIssue),
      ofsSize: parseCroresToRupees(issue.ofs),
      faceValue: parseRupees(issue.faceValue),
      priceBandLow: priceBand?.low ?? null,
      priceBandHigh: priceBand?.high ?? null,
      lotSize: parseInteger(issue.lotSize),
      minimumLots: parseInteger(issue.minBidQuantity),
    },
    lifecycle: {
      openDate: parseDateOnly(issue.issueOpenDate),
      closeDate: parseDateOnly(issue.issueCloseDate),
      listingDate: parseDateOnly(issue.listingDate),
    },
    source: {
      externalId: symbol,
      reference: symbol ? `nse://ipo/${symbol}` : 'nse://ipo',
    },
  };
}
