import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';

export const MOCK_SOURCE_CODE = 'mock';
export const MOCK_EXTERNAL_ID = 'MOCK-IPO-001';
export const MOCK_CIN = 'U12345MH2024PLC000001';

export type MockObservationPayload = {
  company: {
    legalName: string;
    displayName: string | null;
    cin: string | null;
  };
  ipo: {
    marketSegment: MarketSegment;
    exchange: ExchangeListing;
    status: IpoStatus | null;
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

export function mockObservationPayload(
  overrides: Partial<{
    company: Partial<MockObservationPayload['company']>;
    ipo: Partial<MockObservationPayload['ipo']>;
    lifecycle: Partial<MockObservationPayload['lifecycle']>;
    source: Partial<MockObservationPayload['source']>;
  }> = {},
): MockObservationPayload {
  return {
    company: {
      legalName: 'Mock Technologies Limited',
      displayName: 'Mock Tech',
      cin: MOCK_CIN,
      ...overrides.company,
    },
    ipo: {
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'UPCOMING',
      symbol: 'MOCK',
      issueSize: 12500000000,
      freshIssueSize: 10000000000,
      ofsSize: 2500000000,
      faceValue: 10,
      priceBandLow: 120,
      priceBandHigh: 126,
      lotSize: 120,
      minimumLots: 1,
      ...overrides.ipo,
    },
    lifecycle: {
      openDate: '2026-09-10',
      closeDate: '2026-09-12',
      listingDate: '2026-09-18',
      ...overrides.lifecycle,
    },
    source: {
      externalId: MOCK_EXTERNAL_ID,
      reference: 'mock://ipo/MOCK-IPO-001',
      ...overrides.source,
    },
  };
}
