export type SebiFilingType =
  | 'DRHP'
  | 'RHP'
  | 'PROSPECTUS'
  | 'ABRIDGED_PROSPECTUS'
  | 'ADDENDUM'
  | 'CORRIGENDUM'
  | 'UNKNOWN';

export type SebiFilingMetadata = {
  externalId: string;
  companyName: string;
  filingTitle: string;
  filingType: SebiFilingType;
  filingDate: string; // ISO date string (YYYY-MM-DD)
  detailUrl: string;
  documentUrl?: string; // Direct PDF URL if available
};

export type SebiHttpDocument = {
  status: number;
  body: string;
};

export type SebiDownloadDocumentResult = {
  status: number;
  contentType: string;
  contentLength: number;
  documentBuffer?: Buffer;
};

export type SebiFetchOptions = {
  endpoint: string;
  page?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};
