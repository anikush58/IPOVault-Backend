/**
 * Deterministic SEBI Document Section Extraction Types (Phase 1).
 *
 * Scoped to official SEBI statutory filings (DRHP, RHP, Prospectus).
 */
import { DocumentType } from '@prisma/client';

export type SebiSectionKey =
  | 'SUMMARY_OF_THE_ISSUE'
  | 'OUR_BUSINESS'
  | 'INDUSTRY_OVERVIEW'
  | 'RISK_FACTORS'
  | 'FINANCIAL_INFORMATION'
  | 'CAPITAL_STRUCTURE'
  | 'BASIS_FOR_ISSUE_PRICE'
  | 'OBJECTS_OF_THE_ISSUE'
  | 'PROMOTERS_AND_SHAREHOLDING'
  | 'FRESH_ISSUE_AND_OFS'
  | 'LEAD_MANAGERS_AND_GENERAL_INFO'
  | 'ANCHOR_INVESTOR_PORTION';

export const ALL_SEBI_SECTION_KEYS: readonly SebiSectionKey[] = [
  'SUMMARY_OF_THE_ISSUE',
  'OUR_BUSINESS',
  'INDUSTRY_OVERVIEW',
  'RISK_FACTORS',
  'FINANCIAL_INFORMATION',
  'CAPITAL_STRUCTURE',
  'BASIS_FOR_ISSUE_PRICE',
  'OBJECTS_OF_THE_ISSUE',
  'PROMOTERS_AND_SHAREHOLDING',
  'FRESH_ISSUE_AND_OFS',
  'LEAD_MANAGERS_AND_GENERAL_INFO',
  'ANCHOR_INVESTOR_PORTION',
] as const;

export interface ExtractedSectionMetadata {
  sectionKey: SebiSectionKey;
  sectionTitle: string;
  pageRange: {
    startPage: number;
    endPage: number;
  };
  content: string;
  charCount: number;
  contentHash: string;
  isTruncated: boolean;
}

export interface SebiExtractedDocumentSections {
  documentHash: string;
  totalPageCount: number;
  extractedAt: string;
  parserVersion: string;
  sections: Partial<Record<SebiSectionKey, ExtractedSectionMetadata>>;
  unresolvedSections: SebiSectionKey[];
  extractionMethod: 'DETERMINISTIC_PDF_SECTION_EXTRACTOR';
}

export interface SebiSectionExtractionOptions {
  maxSectionChars?: number;
  includeRawPdfText?: boolean;
}

export interface MatchedOfficialDocument {
  documentId?: string;
  ipoId: string;
  companyId: string;
  companyName: string;
  companyWebsite?: string | null;
  documentType: DocumentType;
  sourceUrl: string;
  fileName?: string;
  sourceReference?: string;
  filingTitle?: string;
  filingDate?: string;
  matchSource:
    | 'IPO_DOCUMENT'
    | 'DISCOVERY_RECORD'
    | 'CIN_MATCH'
    | 'SYMBOL_MATCH'
    | 'NAME_MATCH'
    | 'BSE_SME_MATCH'
    | 'NSE_EMERGE_MATCH'
    | 'EXCHANGE_MATCH'
    | 'ISSUER_MATCH';
}

export type SebiRetrievalStatus =
  | 'SUCCESS'
  | 'CACHED'
  | 'DOCUMENT_UNRESOLVED'
  | 'DOWNLOAD_FAILED'
  | 'PARSE_FAILED';

export interface SebiRetrievalResult {
  status: SebiRetrievalStatus;
  ipoId: string;
  documentId?: string;
  sourceUrl?: string;
  documentHash?: string;
  pageCount?: number;
  sections?: Partial<Record<SebiSectionKey, ExtractedSectionMetadata>>;
  unresolvedSections?: SebiSectionKey[];
  error?: string;
  retrievedAt: string;
}
