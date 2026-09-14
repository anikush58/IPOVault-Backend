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
  status?: IpoStatus;
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
  pat?: number;
  ebitda?: number;
  netWorth?: number;
  roePercentage?: number;
  rocePercentage?: number;
  eps?: number;
  patMarginPercent?: number;
}

export class ImportCompanyDto {
  legalName!: string;
  displayName?: string;
  cin?: string;
  aboutDescription?: string;
  website?: string;
  email?: string;
  phone?: string;
  contactPerson?: string;
  industry?: string;
  sector?: string;
  financials?: ImportCompanyFinancialDto[];
}

export class ImportIpoCoreDto {
  symbol?: string;
  marketSegment?: MarketSegment;
  exchange?: ExchangeListing;
  status?: IpoStatus;
  publicationStatus?: PublicationStatus;
  priceBandLow?: number;
  priceBandHigh?: number;
  lotSize?: number;
  faceValue?: number;
  issueSize?: number;
  freshIssueSize?: number;
  ofsSize?: number;
  issueShareCount?: number;
  freshIssueShareCount?: number;
  ofsShareCount?: number;
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

export class ImportParticipantDto {
  role!: ParticipantRole;
  name!: string;
  phone?: string;
  email?: string;
  website?: string;
  displayOrder?: number;
}

export class ImportAllotmentConfigDto {
  registrar!: string;
  registrarIpoCode?: string;
  allotmentSourceUrl?: string;
  expectedAllotmentDate?: string;
  enabled?: boolean;
}

export class ImportDocumentDto {
  documentType!: DocumentType;
  fileName?: string;
  sourceUrl?: string;
}

export class ImportGmpDto {
  gmpAmount?: number;
  gmpPercentage?: number;
  estProfitPerLot?: number;
  observedAt?: string;
}

export class ImportSubscriptionDto {
  category!: OfferCategoryType;
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
  company!: ImportCompanyDto;
  ipo!: ImportIpoCoreDto;
  lifecycle?: ImportIpoLifecycleDto;
  offerCategories?: ImportOfferCategoryDto[];
  participants?: ImportParticipantDto[];
  allotmentConfig?: ImportAllotmentConfigDto;
  documents?: ImportDocumentDto[];
  gmp?: ImportGmpDto;
  subscription?: ImportSubscriptionDto[];
}
