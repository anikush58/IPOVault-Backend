import {
  DocumentType,
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  PublicationStatus,
} from '@prisma/client';

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
  registrar?: string;
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
  registrar?: string;
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
