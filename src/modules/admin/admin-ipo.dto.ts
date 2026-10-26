import {
  DocumentType,
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  OfferCategoryType,
  ParticipantRole,
  PublicationStatus,
} from '@prisma/client';

export type ProvenanceStatus =
  | 'IPOGURU'
  | 'AI_ENRICHED'
  | 'OFFICIAL_SOURCE'
  | 'MANUAL'
  | 'NO_VERIFIED_DATA'
  | 'CONFLICT_REVIEW';

export interface FieldProvenanceVisualDto {
  fieldName: string;
  fieldKey: string;
  value: string | number | null;
  status: ProvenanceStatus;
  statusLabel: string;
  sourceLabel: string;
  sourceCode: string;
  sourceType?: string;
  sourceUrl?: string | null;
  confidence?: number | null;
  section?: string | null;
  documentHash?: string | null;
  model?: string | null;
  retrievedAt?: string | null;
  extractedAt?: string | null;
  hasConflict?: boolean;
  conflictingSources?: { sourceName: string; value: string }[];
}

export class OfferCategoryDto {
  category!: OfferCategoryType;
  allocationPct?: number;
  minLots?: number;
  maxLots?: number;
  minShares?: number;
  maxShares?: number;
  minAmount?: number;
  maxAmount?: number;
  isUpiEligible?: boolean;
}

export class CompanyFinancialDto {
  fiscalPeriod!: string;
  periodType?: string;
  totalAssets?: number;
  totalRevenue?: number;
  pat?: number;
  ebitda?: number;
  netWorth?: number;
  roePercentage?: number;
  rocePercentage?: number;
  eps?: number;
  patMarginPercent?: number;
  ebitdaMarginPercent?: number;
}

export class ParticipantDto {
  role!: ParticipantRole;
  name!: string;
  phone?: string;
  email?: string;
  website?: string;
  displayOrder?: number;
}

export class ManualGmpDto {
  gmpAmount!: number;
  gmpPercentage?: number;
  estProfitPerLot?: number;
  observedAt?: string;
}

export class ManualSubscriptionDto {
  category!: OfferCategoryType;
  subscriptionMultiple!: number;
  sharesBid?: number;
  sharesOffered?: number;
  observedAt?: string;
}

export class AnchorInvestorRowDto {
  anchorName!: string;
  sharesAllotted?: number;
  amtCr?: number;
  pctAllocated?: number;
  pctOfIssue?: number;
}

export class DocumentDto {
  id?: string;
  documentType!: DocumentType | string;
  fileName?: string;
  title?: string;
  sourceUrl?: string;
  url?: string;
}

export class CreateAdminIpoDto {
  legalName!: string;
  displayName?: string;
  cin?: string;
  symbol?: string;
  marketSegment!: MarketSegment;
  exchange!: ExchangeListing;
  status?: IpoStatus;
  publicationStatus?: PublicationStatus;
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  listingPrice?: number;
  listingGainPct?: number;
  profitAmount?: number;
  profitPercentage?: number;
  preIpoEps?: number;
  postIpoEps?: number;
  preIpoPe?: number;
  postIpoPe?: number;
  preIpoPromoterHolding?: number;
  postIpoPromoterHolding?: number;
  preIpoMarketCap?: number;
  postIpoMarketCap?: number;
  issueSize?: number;
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  freshIssueShareCount?: number;
  ofsShareCount?: number;
  faceValue?: number;
  openDate?: string;
  closeDate?: string;
  listingDate?: string;
  allotmentDate?: string;
  refundDate?: string;
  website?: string;
  industry?: string;
  sector?: string;
  aboutDescription?: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  logoUrl?: string;
  rhpUrl?: string;
  drhpUrl?: string;
  prospectusUrl?: string;
  anchorListUrl?: string;
  anchorPortion?: number;
  anchorBidDate?: string;
  anchorLockIn?: string;
  anchorDetails?: string;
  anchorPrice?: number;
  anchorQibPct?: number;
  anchorLockIn30?: string;
  anchorLockIn90?: string;
  anchorInvestors?: AnchorInvestorRowDto[];
  documents?: DocumentDto[];
  offerCategories?: OfferCategoryDto[];
  financials?: CompanyFinancialDto[];
  participants?: ParticipantDto[];
  allotmentConfig?: ConfigureAllotmentDto;
  gmp?: ManualGmpDto;
  subscription?: ManualSubscriptionDto[];
}

export class UpdateAdminIpoDto {
  legalName?: string;
  displayName?: string;
  cin?: string;
  symbol?: string;
  marketSegment?: MarketSegment;
  exchange?: ExchangeListing;
  status?: IpoStatus;
  publicationStatus?: PublicationStatus;
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  listingPrice?: number;
  listingGainPct?: number;
  profitAmount?: number;
  profitPercentage?: number;
  preIpoEps?: number;
  postIpoEps?: number;
  preIpoPe?: number;
  postIpoPe?: number;
  preIpoPromoterHolding?: number;
  postIpoPromoterHolding?: number;
  preIpoMarketCap?: number;
  postIpoMarketCap?: number;
  issueSize?: number;
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  freshIssueShareCount?: number;
  ofsShareCount?: number;
  faceValue?: number;
  openDate?: string;
  closeDate?: string;
  listingDate?: string;
  allotmentDate?: string;
  refundDate?: string;
  website?: string;
  industry?: string;
  sector?: string;
  aboutDescription?: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  logoUrl?: string;
  rhpUrl?: string;
  drhpUrl?: string;
  prospectusUrl?: string;
  anchorListUrl?: string;
  anchorPortion?: number;
  anchorBidDate?: string;
  anchorLockIn?: string;
  anchorDetails?: string;
  anchorPrice?: number;
  anchorQibPct?: number;
  anchorLockIn30?: string;
  anchorLockIn90?: string;
  anchorInvestors?: AnchorInvestorRowDto[];
  documents?: DocumentDto[];
  offerCategories?: OfferCategoryDto[];
  financials?: CompanyFinancialDto[];
  participants?: ParticipantDto[];
  allotmentConfig?: ConfigureAllotmentDto;
  gmp?: ManualGmpDto;
  subscription?: ManualSubscriptionDto[];
}

export class ConfigureAllotmentDto {
  registrar?: string;
  registrarCode?: string;
  registrarIpoCode?: string;
  allotmentSourceUrl?: string;
  expectedAllotmentDate?: string;
  enabled?: boolean;
}

export class AdminIpoQueryDto {
  q?: string;
  status?: IpoStatus | string;
  publicationStatus?: PublicationStatus;
  marketSegment?: MarketSegment;
  exchange?: ExchangeListing;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

// ==========================================
// CANONICAL MANUAL IPO JSON IMPORT CONTRACT
// ==========================================

export class ImportCompanyFinancialDto {
  fiscalPeriod!: string;
  periodType?: string;
  totalAssets?: number;
  totalRevenue?: number;
  revenue?: number; // Alias for totalRevenue
  pat?: number;
  netProfit?: number; // Alias for pat
  ebitda?: number;
  ebitdaPercent?: number; // Alias for ebitda margin
  ebitdaMarginPercent?: number;
  netWorth?: number;
  nav?: number; // Alias for netWorth
  ronw?: number; // Alias for netWorth
  roePercent?: number; // Alias for roePercentage
  roePercentage?: number;
  rocePercent?: number; // Alias for rocePercentage
  rocePercentage?: number;
  eps?: number;
  patPercent?: number; // Alias for patMarginPercent
  patMarginPercent?: number;
}

export class ImportCompanyDto {
  legalName?: string;
  displayName?: string;
  companyName?: string; // Intuitive alias
  logoUrl?: string; // Added form field
  cin?: string;
  aboutDescription?: string;
  about?: string; // Master JSON alias
  website?: string;
  email?: string;
  companyEmail?: string; // Intuitive alias
  phone?: string;
  companyPhone?: string; // Intuitive alias
  contactPerson?: string;
  industry?: string;
  sector?: string;
  notes?: string;
  strengths?: string[];
  risks?: string[];
  keyRisks?: string[];
  objectsOfIssue?: string[] | string;
  objects?: string[] | string;
  financials?: ImportCompanyFinancialDto[];
}

export class ImportIpoCoreDto {
  ipoName?: string; // Added form field
  symbol?: string;
  isin?: string;
  nseSymbol?: string;
  bseSymbol?: string;
  marketSegment?: MarketSegment | string;
  issueType?: string; // Intuitive alias ('Mainboard' | 'SME')
  exchange?: ExchangeListing | string; // Intuitive ('BSE' | 'NSE' | 'BSE / NSE' | 'BOTH')
  status?: IpoStatus;
  publicationStatus?: PublicationStatus;
  priceBandLow?: number;
  priceBandMin?: number; // Intuitive alias
  floorPrice?: number; // Master JSON alias
  minPrice?: number;
  priceBandHigh?: number;
  priceBandMax?: number; // Intuitive alias
  capPrice?: number; // Master JSON alias
  issuePrice?: number;
  maxPrice?: number;
  lotSize?: number;
  marketLot?: number; // Master JSON alias
  minimumLots?: number;
  minLots?: number;
  faceValue?: number;
  issueSize?: number;
  totalIssueSize?: number; // Master JSON alias
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  totalShares?: number; // Master JSON alias
  freshIssueShareCount?: number;
  ofsShareCount?: number;
  listingPrice?: number;
  listingGainPct?: number;
  profitAmount?: number;
  profitPercentage?: number;
  preIpoEps?: number;
  postIpoEps?: number;
  preIpoPe?: number;
  postIpoPe?: number;
  preIpoPromoterHolding?: number;
  postIpoPromoterHolding?: number;
  preIpoMarketCap?: number;
  postIpoMarketCap?: number;
  openDate?: string;
  closeDate?: string;
  allotmentDate?: string;
  listingDate?: string;
  refundDate?: string;
  refundInitiationDate?: string;
  dematCreditDate?: string;
  creditToDematDate?: string;
  drhpUrl?: string;
  rhpUrl?: string;
  prospectusUrl?: string;
  anchorListUrl?: string;
  notes?: string;
}

export class ImportIpoLifecycleDto {
  drhpDate?: string;
  rhpDate?: string;
  anchorDate?: string;
  anchorBidDate?: string;
  openDate?: string;
  issueOpenDate?: string;
  closeDate?: string;
  issueCloseDate?: string;
  allotmentDate?: string;
  basisOfAllotmentDate?: string;
  refundDate?: string;
  refundInitiationDate?: string;
  dematCreditDate?: string;
  creditToDematDate?: string;
  listingDate?: string;
}

export class ImportOfferCategoryDto {
  category!: OfferCategoryType | string;
  categoryCode?: string;
  allocationPct?: number;
  allocationPercentage?: number;
  percentage?: number;
  minLots?: number;
  maxLots?: number;
  minShares?: number;
  maxShares?: number;
  minAmount?: number;
  maxAmount?: number;
  isUpiEligible?: boolean;
}

export class ImportParticipantDto {
  role!: ParticipantRole | string;
  name!: string;
  phone?: string;
  email?: string;
  website?: string;
  displayOrder?: number;
}

export class ImportAllotmentConfigDto {
  registrar!: string;
  registrarPhone?: string; // Added form field
  registrarEmail?: string; // Added form field
  registrarWebsite?: string;
  registrarIpoCode?: string;
  allotmentSourceUrl?: string;
  allotmentUrl?: string;
  expectedAllotmentDate?: string;
  enabled?: boolean;
}

export class ImportDocumentDto {
  documentType!: DocumentType | string;
  type?: string;
  fileName?: string;
  title?: string;
  sourceUrl?: string;
  url?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  extractionData?: Record<string, any>;
}

export class ImportGmpDto {
  gmpAmount?: number; // Intuitive alias
  gmpPercent?: number; // Intuitive alias
  gmpPercentage?: number;
  estProfitPerLot?: number;
  observedAt?: string;
}

export class ImportSubscriptionDto {
  category!: OfferCategoryType | string;
  categoryCode?: string;
  subscriptionMultiple?: number;
  sharesBid?: number;
  sharesOffered?: number;
  observedAt?: string;
}

export class ImportAnchorInvestorDto {
  anchorName?: string;
  investorName?: string;
  name?: string;
  sharesAllotted?: number;
  shares?: number;
  amtCr?: number;
  amountCr?: number;
  amount?: number;
  pctAllocated?: number;
  pctOfIssue?: number;
  percentage?: number;
}

export class ImportAdminIpoJsonDto {
  id?: string;
  ipoId?: string;
  targetIpoId?: string;

  meta?: {
    version?: string;
    sourceSystem?: string;
    exportedAt?: string;
  };

  // Identifiers
  isin?: string;
  cin?: string;
  symbol?: string;
  nseSymbol?: string;
  bseSymbol?: string;

  // Top-level intuitive shortcuts aligned with Manual IPO Form & Master JSON
  ipoName?: string;
  companyName?: string;
  legalName?: string;
  displayName?: string;
  logoUrl?: string;
  exchange?: ExchangeListing | string;
  issueType?: MarketSegment | string;
  marketSegment?: MarketSegment | string;
  sector?: string;
  industry?: string;

  priceBandMin?: number;
  priceBandLow?: number;
  floorPrice?: number;
  priceBandMax?: number;
  priceBandHigh?: number;
  capPrice?: number;
  issuePrice?: number;
  lotSize?: number;
  marketLot?: number;
  minimumLots?: number;
  faceValue?: number;

  issueSize?: number;
  totalIssueSize?: number;
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  totalShares?: number;
  freshIssueShareCount?: number;
  ofsShareCount?: number;

  listingPrice?: number;
  listingGainPct?: number;
  profitAmount?: number;
  profitPercentage?: number;

  preIpoEps?: number;
  postIpoEps?: number;
  preIpoPe?: number;
  postIpoPe?: number;
  preIpoPromoterHolding?: number;
  postIpoPromoterHolding?: number;
  preIpoMarketCap?: number;
  postIpoMarketCap?: number;

  openDate?: string;
  issueOpenDate?: string;
  closeDate?: string;
  issueCloseDate?: string;
  allotmentDate?: string;
  basisOfAllotmentDate?: string;
  listingDate?: string;
  refundDate?: string;
  refundInitiationDate?: string;
  dematCreditDate?: string;
  creditToDematDate?: string;
  drhpDate?: string;
  rhpDate?: string;
  anchorDate?: string;

  registrar?: string;
  registrarPhone?: string;
  registrarEmail?: string;
  registrarWebsite?: string;
  registrarIpoCode?: string;
  allotmentSourceUrl?: string;
  leadManager?: string | string[];
  leadManagers?: string | string[];
  coLeadManager?: string | string[];
  brlm?: string | string[];

  website?: string;
  companyPhone?: string;
  companyEmail?: string;
  contactPerson?: string;

  aboutDescription?: string;
  about?: string;
  notes?: string;

  strengths?: string[];
  risks?: string[];
  keyRisks?: string[];
  objectsOfIssue?: string[] | string;
  objects?: string[] | string;

  drhpUrl?: string;
  drhp?: string;
  rhpUrl?: string;
  rhp?: string;
  prospectusUrl?: string;
  anchorListUrl?: string;

  gmpAmount?: number;
  gmpPercent?: number;
  gmpPercentage?: number;
  estProfitPerLot?: number;

  anchorPortion?: number;
  anchorBidDate?: string;
  anchorLockIn?: string;
  anchorDetails?: string;
  anchorPrice?: number;
  anchorQibPct?: number;
  anchorLockIn30?: string;
  anchorLockIn90?: string;
  anchorInvestors?: ImportAnchorInvestorDto[];

  retailMinLots?: number;
  retailMaxLots?: number;
  retailMinShares?: number;
  retailMaxShares?: number;
  retailMinAmount?: number;
  retailMaxAmount?: number;
  retailAllocationPct?: number;

  // Canonical nested structures
  company?: ImportCompanyDto;
  ipo?: ImportIpoCoreDto;
  lifecycle?: ImportIpoLifecycleDto;
  offerCategories?: ImportOfferCategoryDto[];
  offerBreakup?: ImportOfferCategoryDto[];
  reservation?: ImportOfferCategoryDto[];
  participants?: ImportParticipantDto[];
  allotmentConfig?: ImportAllotmentConfigDto;
  documents?: ImportDocumentDto[];
  financials?: ImportCompanyFinancialDto[];
  gmp?: ImportGmpDto;
  subscription?: ImportSubscriptionDto[] | Record<string, any>;
}

export type FieldReportStatus =
  | 'FILLED'
  | 'UNCHANGED'
  | 'CONFLICT'
  | 'SKIPPED'
  | 'UNAVAILABLE'
  | 'INVALID'
  | 'OVERWRITTEN';

export interface FieldDiffToFill {
  field: string;
  section: string;
  key?: string;
  oldValue?: any;
  newValue: any;
  status?: FieldReportStatus;
}

export interface FieldDiffSkipped {
  field: string;
  section: string;
  existingValue: any;
  skippedValue: any;
  reason: string;
  status?: FieldReportStatus;
}

export interface FieldReportItem {
  field: string;
  section: string;
  status: FieldReportStatus;
  existingValue?: any;
  incomingValue?: any;
  reason?: string;
  hasManualProvenance?: boolean;
}

export interface JsonIpoPreviewItem {
  index: number;
  inputName: string;
  inputSymbol?: string;
  matchStatus: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS';
  matchReason: string;
  matchedIpoId?: string;
  matchedIpoName?: string;
  matchedSymbol?: string;
  fieldsToFill: FieldDiffToFill[];
  fieldsSkipped: FieldDiffSkipped[];
  fieldReport?: FieldReportItem[];
  overwriteCount?: number;
  conflictCount?: number;
  error?: string;
}

export interface JsonImportPreviewResponse {
  totalRecords: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  fieldsToFillTotal: number;
  fieldsToOverwriteTotal?: number;
  mode?: 'FILL_MISSING' | 'AUTHORITATIVE_OVERWRITE';
  items: JsonIpoPreviewItem[];
}

export interface JsonIpoCommitResultItem {
  index: number;
  ipoId?: string;
  ipoName: string;
  inputName?: string;
  matchedIpoName?: string;
  matchReason?: string;
  success: boolean;
  status:
    | 'UPDATED'
    | 'SKIPPED_NO_CHANGES'
    | 'SKIPPED_UNMATCHED'
    | 'SKIPPED_AMBIGUOUS'
    | 'FAILED';
  fieldsFilledCount: number;
  fieldsFilled: string[];
  fieldReport?: FieldReportItem[];
  error?: string;
}

export interface JsonImportCommitResponse {
  totalRecords: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  items: JsonIpoCommitResultItem[];
}

export class JsonImportCommitDto {
  items?: ImportAdminIpoJsonDto[];
  payload?: any;
  selectedIpoIds?: string[];
  selectedFields?: Record<string, string[]> | string[];
  overwriteExisting?: boolean;
}

export class BulkAdminIpoActionDto {
  ids!: string[];
}

export class BulkUpdateLifecycleStatusDto {
  ids!: string[];
  status!: IpoStatus;
}


