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

export type SebiFieldEvidence = {
  rawTextSnippet: string;
  pageNumber?: number;
  sectionName?: string;
};

export type SebiFieldStatus = 'EXTRACTED' | 'UNRESOLVED' | 'MISMATCH_WARNING';

export type SebiExtractedField<T> = {
  value: T | null;
  status: SebiFieldStatus;
  evidence?: SebiFieldEvidence;
  warning?: string;
};

export type SebiPdfIssueObservation = {
  externalId: string;
  sourceUrl?: string | null;
  extractedAt: string;

  // IDENTITY
  legalName: SebiExtractedField<string>;
  cin: SebiExtractedField<string>;

  // PRICING
  faceValue: SebiExtractedField<number>;

  // ISSUE STRUCTURE - SHARES
  issueShareCount: SebiExtractedField<number>;
  freshIssueShareCount: SebiExtractedField<number>;
  ofsShareCount: SebiExtractedField<number>;

  // ISSUE STRUCTURE - INR AMOUNTS
  issueSize: SebiExtractedField<number>;
  freshIssueSize: SebiExtractedField<number>;
  ofsSize: SebiExtractedField<number>;

  // OVERALL VALIDATION
  warnings: string[];
};
