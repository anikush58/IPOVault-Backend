import { IpoStatus, MarketSegment, ExchangeListing } from '@prisma/client';

export type SourceAuthorityTier =
  | 'TIER_1_STATUTORY' // SEBI, NSE, BSE official portals & circulars
  | 'TIER_2_REGISTRAR' // Link Intime, KFintech, Bigshare, Skyline, Cameo, Maashitla, Purva
  | 'TIER_3_ISSUER'    // Official company/issuer website, DRHP/RHP/Prospectus
  | 'TIER_4_SECONDARY'; // Secondary market portals / discovery / corroboration

export type ReconciliationStatus =
  | 'VERIFIED_UPDATE'     // Authoritative, non-conflicting, verified candidate ready to update DB
  | 'UNCHANGED'           // Candidate matches current DB value
  | 'CONFLICTING_SOURCES' // Candidate conflicts with verified/admin data or sources contradict
  | 'UNVERIFIABLE'        // Weak secondary source, low confidence, or speculative
  | 'MISSING_VALUE';      // Could not be located in researched sources

export interface ResearchedCandidateField<T = any> {
  fieldKey: string;
  rawValue: any;
  normalizedValue: T | null;
  sourceUrl: string;
  sourceDomain: string;
  sourceAuthority: SourceAuthorityTier;
  sourceName?: string;
  evidence: string;
  confidence: number; // 0.0 to 1.0
  retrievedAt: string;
}

export interface ResearchedFinancialPeriod {
  fiscalPeriod: string; // e.g. "FY24"
  periodType?: 'ANNUAL' | 'QUARTERLY';
  totalRevenue?: number | null; // in ₹ Cr
  pat?: number | null;          // in ₹ Cr
  ebitda?: number | null;       // in ₹ Cr
  netWorth?: number | null;     // in ₹ Cr
  totalAssets?: number | null;  // in ₹ Cr
  eps?: number | null;
  roePercentage?: number | null;
  rocePercentage?: number | null;
}

export interface IpoResearchCandidates {
  // Company Overview
  legalName?: ResearchedCandidateField<string>;
  displayName?: ResearchedCandidateField<string>;
  cin?: ResearchedCandidateField<string>;
  website?: ResearchedCandidateField<string>;
  aboutDescription?: ResearchedCandidateField<string>;
  sector?: ResearchedCandidateField<string>;
  industry?: ResearchedCandidateField<string>;
  phone?: ResearchedCandidateField<string>;
  email?: ResearchedCandidateField<string>;
  contactPerson?: ResearchedCandidateField<string>;

  // Core IPO Parameters
  marketSegment?: ResearchedCandidateField<MarketSegment>;
  exchange?: ResearchedCandidateField<ExchangeListing>;
  status?: ResearchedCandidateField<IpoStatus>;
  symbol?: ResearchedCandidateField<string>;
  isin?: ResearchedCandidateField<string>;
  nseSymbol?: ResearchedCandidateField<string>;
  bseSymbol?: ResearchedCandidateField<string>;

  // Issue Structure & Pricing
  priceBandLow?: ResearchedCandidateField<number>;
  priceBandHigh?: ResearchedCandidateField<number>;
  lotSize?: ResearchedCandidateField<number>;
  minimumLots?: ResearchedCandidateField<number>;
  faceValue?: ResearchedCandidateField<number>;
  issueSize?: ResearchedCandidateField<number>;
  freshIssueSize?: ResearchedCandidateField<number>;
  ofsSize?: ResearchedCandidateField<number>;
  issueShareCount?: ResearchedCandidateField<number>;
  freshIssueShareCount?: ResearchedCandidateField<number>;
  ofsShareCount?: ResearchedCandidateField<number>;

  // Lifecycle Dates (YYYY-MM-DD)
  openDate?: ResearchedCandidateField<string>;
  closeDate?: ResearchedCandidateField<string>;
  allotmentDate?: ResearchedCandidateField<string>;
  refundDate?: ResearchedCandidateField<string>;
  listingDate?: ResearchedCandidateField<string>;

  // Registrar & Allotment
  registrarName?: ResearchedCandidateField<string>;
  registrarIpoCode?: ResearchedCandidateField<string>;
  allotmentSourceUrl?: ResearchedCandidateField<string>;

  // Listing Performance
  listingPrice?: ResearchedCandidateField<number>;
  listingGainPct?: ResearchedCandidateField<number>;

  // Valuation & Shareholding
  preIpoPe?: ResearchedCandidateField<number>;
  postIpoPe?: ResearchedCandidateField<number>;
  preIpoEps?: ResearchedCandidateField<number>;
  postIpoEps?: ResearchedCandidateField<number>;
  preIpoPromoterHolding?: ResearchedCandidateField<number>;
  postIpoPromoterHolding?: ResearchedCandidateField<number>;
  preIpoMarketCap?: ResearchedCandidateField<number>;
  postIpoMarketCap?: ResearchedCandidateField<number>;

  // Lead Managers & Financials
  leadManagers?: ResearchedCandidateField<string[]>;
  financials?: ResearchedCandidateField<ResearchedFinancialPeriod[]>;

  // Qualitative
  strengths?: ResearchedCandidateField<string[]>;
  risks?: ResearchedCandidateField<string[]>;
}

export interface FieldReconciliationDecision {
  fieldKey: string;
  fieldLabel: string;
  entityType: 'IPO' | 'COMPANY' | 'LIFECYCLE' | 'ALLOTMENT_CONFIG' | 'FINANCIAL' | 'PARTICIPANT';
  currentValue: any;
  currentValueDisplay: string;
  existingProvenance?: {
    sourceCode: string;
    sourceType?: string;
    sourceLabel: string;
    priority: number;
    reference?: string;
  };
  candidateValue: any;
  candidateValueDisplay: string;
  status: ReconciliationStatus;
  statusReason: string;
  sourceUrl?: string;
  sourceAuthority?: SourceAuthorityTier;
  evidence?: string;
  confidence?: number;
  autoApply: boolean;
  applied: boolean;
}

export interface IpoReconciliationSummary {
  ipoId: string;
  companyName: string;
  evaluatedAt: string;
  fieldsEvaluated: number;
  verifiedUpdatesCount: number;
  unchangedCount: number;
  conflictsCount: number;
  unverifiableCount: number;
  missingCount: number;
  appliedCount: number;
  skippedCount: number;
  decisions: FieldReconciliationDecision[];
}

export type ResearchJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED';

export interface ResearchJob {
  jobId: string;
  ipoId: string;
  companyName: string;
  status: ResearchJobStatus;
  progressPercent: number;
  progressMessage: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  summary?: IpoReconciliationSummary;
}
