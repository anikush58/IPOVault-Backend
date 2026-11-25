import { SebiSectionKey } from '../discovery/adapters/sebi/sebi-section.types';

export type EnrichableField =
  | 'aboutDescription'
  | 'sector'
  | 'industry'
  | 'financials'
  | 'strengthsAndRisks'
  | 'preIpoPe'
  | 'postIpoPe'
  | 'preIpoPromoterHolding'
  | 'postIpoPromoterHolding'
  | 'freshIssueShareCount'
  | 'ofsShareCount'
  | 'freshIssueSize'
  | 'ofsSize'
  | 'leadManagers'
  | 'anchorDetails'
  | 'registrar';

export interface MissingFieldReport {
  ipoId: string;
  companyId: string;
  companyName: string;
  missingFields: EnrichableField[];
  hasMissingFields: boolean;
  evaluatedAt: string;
}

export interface ExtractedFinancialPeriod {
  fiscalPeriod: string; // e.g. "FY24", "FY23", "FY22"
  periodType?: 'ANNUAL' | 'QUARTERLY';
  totalRevenue?: number | null; // in ₹ Cr
  pat?: number | null; // in ₹ Cr
  ebitda?: number | null; // in ₹ Cr
  netWorth?: number | null; // in ₹ Cr
  totalAssets?: number | null; // in ₹ Cr
  eps?: number | null;
  roePercentage?: number | null;
  rocePercentage?: number | null;
}

export interface ExtractedAnchorInvestor {
  anchorName: string;
  amtCr?: number | null;
  sharesAllotted?: number | null;
  pctAllocated?: number | null;
}

export interface ExtractedAnchorDetails {
  portion?: number | null;
  bidDate?: string | null;
  details?: string | null;
  investors?: ExtractedAnchorInvestor[];
}

export interface AiExtractedIpoData {
  aboutDescription?: string | null;
  sector?: string | null;
  industry?: string | null;
  strengths?: string[];
  risks?: string[];
  financials?: ExtractedFinancialPeriod[];
  preIpoPe?: number | null;
  postIpoPe?: number | null;
  preIpoPromoterHolding?: number | null;
  postIpoPromoterHolding?: number | null;
  freshIssueShareCount?: number | null;
  ofsShareCount?: number | null;
  freshIssueSize?: number | null;
  ofsSize?: number | null;
  leadManagers?: string[];
  anchorDetails?: ExtractedAnchorDetails | null;
  registrar?: string | null;
  sourceConfidence?: number;
  extractedSectionReferences?: Record<string, string>;
}

export interface AiExtractionRequest {
  ipoId: string;
  companyName: string;
  symbol?: string | null;
  missingFields: EnrichableField[];
  documentSections: Partial<Record<SebiSectionKey, string>>;
}

export type EnrichmentJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'DOCUMENT_UNRESOLVED'
  | 'FAILED';

export interface EnrichmentJobResult {
  ipoId: string;
  status: EnrichmentJobStatus;
  missingFieldsDetected: EnrichableField[];
  enrichedFields: string[];
  skippedFields: string[];
  documentHash?: string;
  modelUsed?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}
