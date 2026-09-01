import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type IncomingObservation = {
  sourceId: string;
  externalId: string | null;
  sourceReference: string | null;
  companyName: string | null;
  rawPayload: unknown;
  discoveredAt: Date;
};

export type DiscoveredCompany = {
  legalName: string;
  displayName: string | null;
  cin: string | null;
};

export type DiscoveredIpoAttributes = {
  marketSegment: MarketSegment;
  exchange: ExchangeListing;
  status: IpoStatus | null;
  symbol: string | null;
  issueSize: string | null;
  freshIssueSize: string | null;
  ofsSize: string | null;
  faceValue: string | null;
  priceBandLow: string | null;
  priceBandHigh: string | null;
  lotSize: number | null;
  minimumLots: number | null;
};

export type DiscoveredLifecycle = {
  drhpDate: string | null;
  rhpDate: string | null;
  anchorDate: string | null;
  openDate: string | null;
  closeDate: string | null;
  basisOfAllotmentDate: string | null;
  refundInitiationDate: string | null;
  dematCreditDate: string | null;
  listingDate: string | null;
};

export type DiscoveredIpo = {
  company: DiscoveredCompany;
  ipo: DiscoveredIpoAttributes;
  lifecycle: DiscoveredLifecycle;
  source: {
    externalId: string | null;
    reference: string | null;
  };
};

export type MatchDecision =
  | {
      decision: 'CREATE';
      confidence: 'HIGH';
    }
  | {
      decision: 'MATCH_IPO';
      confidence: 'HIGH';
      ipoId: string;
      companyId: string;
    }
  | {
      decision: 'MATCH_COMPANY';
      confidence: 'HIGH';
      companyId: string;
    }
  | {
      decision: 'REJECT';
      confidence: MatchConfidence;
      reason: string;
    };

export type DiscoveryOutcome =
  'CREATED' | 'MATCHED' | 'DUPLICATE' | 'REJECTED' | 'ERROR';

export type DiscoveryProcessResult = {
  outcome: DiscoveryOutcome;
  discoveryRecordId: string;
  ipoId: string | null;
};
