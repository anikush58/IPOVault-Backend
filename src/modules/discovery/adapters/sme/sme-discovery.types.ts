import { DocumentType, ExchangeListing, MarketSegment } from '@prisma/client';

export interface SmeFilingItem {
  companyName: string;
  marketSegment: MarketSegment | 'SME';
  exchange: ExchangeListing | 'BSE' | 'NSE' | 'BOTH';
  documentUrl: string;
  filingType?: DocumentType | 'PROSPECTUS' | 'RHP' | 'DRHP';
  filingTitle?: string;
  symbol?: string | null;
  scripCode?: string | null;
  cin?: string | null;
  issueStartDate?: string | null;
  issueEndDate?: string | null;
  issueSize?: string | number | null;
  lotSize?: number | null;
  priceBandLow?: number | null;
  priceBandHigh?: number | null;
  externalId?: string | null;
  sourceReference?: string | null;
}

export interface SmeDiscoveryResult {
  sourceCode: string;
  totalDiscovered: number;
  createdRecordsCount: number;
  duplicateCount: number;
  failedCount: number;
  records: Array<{
    discoveryRecordId: string;
    companyName: string;
    outcome: string;
  }>;
}
