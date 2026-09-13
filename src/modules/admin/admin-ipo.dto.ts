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
  offerCategories?: OfferCategoryDto[];
  financials?: CompanyFinancialDto[];
  participants?: ParticipantDto[];
  allotmentConfig?: ConfigureAllotmentDto;
  gmp?: ManualGmpDto;
  subscription?: ManualSubscriptionDto[];
}

export class ParseDocumentUrlDto {
  url!: string;
  documentType?: DocumentType;
  ipoId?: string;
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
