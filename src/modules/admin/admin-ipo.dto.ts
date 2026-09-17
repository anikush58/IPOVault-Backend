import {
  DocumentType,
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  OfferCategoryType,
  ParticipantRole,
  PublicationStatus,
} from '@prisma/client';

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
  offerCategories?: OfferCategoryDto[];
  financials?: CompanyFinancialDto[];
  participants?: ParticipantDto[];
  allotmentConfig?: ConfigureAllotmentDto;
  gmp?: ManualGmpDto;
  subscription?: ManualSubscriptionDto[];
}

export class ConfigureAllotmentDto {
  registrar!: string;
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
  netWorth?: number;
  nav?: number; // Alias for netWorth
  ronw?: number; // Alias for netWorth
  roePercent?: number; // Alias for roePercentage
  roePercentage?: number;
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
  website?: string;
  email?: string;
  companyEmail?: string; // Intuitive alias
  phone?: string;
  companyPhone?: string; // Intuitive alias
  contactPerson?: string;
  industry?: string;
  sector?: string;
  notes?: string;
  financials?: ImportCompanyFinancialDto[];
}

export class ImportIpoCoreDto {
  ipoName?: string; // Added form field
  symbol?: string;
  marketSegment?: MarketSegment | string;
  issueType?: string; // Intuitive alias ('Mainboard' | 'SME')
  exchange?: ExchangeListing | string; // Intuitive ('BSE' | 'NSE' | 'BSE / NSE' | 'BOTH')
  status?: IpoStatus;
  publicationStatus?: PublicationStatus;
  priceBandLow?: number;
  priceBandMin?: number; // Intuitive alias
  priceBandHigh?: number;
  priceBandMax?: number; // Intuitive alias
  lotSize?: number;
  faceValue?: number;
  issueSize?: number;
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  freshIssueShareCount?: number;
  ofsShareCount?: number;
  openDate?: string;
  closeDate?: string;
  allotmentDate?: string;
  listingDate?: string;
  drhpUrl?: string;
  rhpUrl?: string;
  notes?: string;
}

export class ImportIpoLifecycleDto {
  drhpDate?: string;
  rhpDate?: string;
  anchorDate?: string;
  openDate?: string;
  closeDate?: string;
  allotmentDate?: string;
  listingDate?: string;
}

export class ImportOfferCategoryDto {
  category!: OfferCategoryType | string;
  categoryCode?: string;
  allocationPct?: number;
  allocationPercentage?: number;
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
  registrarIpoCode?: string;
  allotmentSourceUrl?: string;
  expectedAllotmentDate?: string;
  enabled?: boolean;
}

export class ImportDocumentDto {
  documentType!: DocumentType | string;
  fileName?: string;
  sourceUrl?: string;
  url?: string;
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
  subscriptionMultiple?: number;
  sharesBid?: number;
  sharesOffered?: number;
  observedAt?: string;
}

export class ImportAdminIpoJsonDto {
  meta?: {
    version?: string;
    sourceSystem?: string;
    exportedAt?: string;
  };

  // Top-level intuitive shortcuts aligned with Manual IPO Form
  ipoName?: string;
  companyName?: string;
  logoUrl?: string;
  symbol?: string;
  exchange?: ExchangeListing | string;
  issueType?: MarketSegment | string;
  sector?: string;
  industry?: string;

  priceBandMin?: number;
  priceBandMax?: number;
  lotSize?: number;
  issueSize?: number;

  gmpAmount?: number;
  gmpPercent?: number;

  openDate?: string;
  closeDate?: string;
  allotmentDate?: string;
  listingDate?: string;

  registrar?: string;
  registrarPhone?: string;
  registrarEmail?: string;
  leadManager?: string;

  website?: string;
  companyPhone?: string;
  companyEmail?: string;

  drhpUrl?: string;
  rhpUrl?: string;
  notes?: string;

  // Canonical nested structures
  company?: ImportCompanyDto;
  ipo?: ImportIpoCoreDto;
  lifecycle?: ImportIpoLifecycleDto;
  offerCategories?: ImportOfferCategoryDto[];
  participants?: ImportParticipantDto[];
  allotmentConfig?: ImportAllotmentConfigDto;
  documents?: ImportDocumentDto[];
  gmp?: ImportGmpDto;
  subscription?: ImportSubscriptionDto[];
}
