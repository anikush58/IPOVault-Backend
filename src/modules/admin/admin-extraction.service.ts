import { Injectable } from '@nestjs/common';
import { parseSebiPdfBuffer } from '../discovery/adapters/sebi/sebi-pdf.parser';
import { resolveSebiPdfUrlFromHtml } from '../discovery/adapters/sebi/sebi.fetcher';
import { SebiExtractedField } from '../discovery/adapters/sebi/sebi.types';

export type ExtractionFieldStatus =
  | 'FOUND'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'INVALID';

export interface AdminExtractedField<T = unknown> {
  value: T | null;
  status: ExtractionFieldStatus;
  rawText?: string | null;
  source: string;
  evidence?: string | null;
}

export interface AdminExtractionReview {
  parserVersion: string;
  sourceType: string;
  sourceUrl?: string | null;
  extractedAt: string;
  fields: {
    legalName: AdminExtractedField<string>;
    cin: AdminExtractedField<string>;
    faceValue: AdminExtractedField<number>;
    priceBandLow: AdminExtractedField<number>;
    priceBandHigh: AdminExtractedField<number>;
    lotSize: AdminExtractedField<number>;
    issueSize: AdminExtractedField<number>;
    freshIssueSize: AdminExtractedField<number>;
    ofsSize: AdminExtractedField<number>;
    issueShareCount: AdminExtractedField<number>;
    freshIssueShareCount: AdminExtractedField<number>;
    ofsShareCount: AdminExtractedField<number>;
    openDate: AdminExtractedField<string>;
    closeDate: AdminExtractedField<string>;
    listingDate: AdminExtractedField<string>;
    registrar: AdminExtractedField<string>;
  };
}

@Injectable()
export class AdminExtractionService {
  /**
   * Parses a PDF buffer and constructs a deterministic Extraction Review model.
   */
  async extractFromPdfBuffer(
    pdfBuffer: Buffer,
    sourceUrl?: string,
  ): Promise<AdminExtractionReview> {
    const rawResult = await parseSebiPdfBuffer(pdfBuffer, {
      externalId: sourceUrl || 'uploaded-pdf',
      sourceUrl: sourceUrl || null,
    });

    const sourceName = sourceUrl ? 'SEBI_URL' : 'MANUAL_PDF_UPLOAD';

    return {
      parserVersion: 'sebi-pdf-parser-1.0.0',
      sourceType: 'SEBI_PDF',
      sourceUrl: sourceUrl || null,
      extractedAt: new Date().toISOString(),
      fields: {
        legalName: this.mapField(rawResult.legalName, sourceName),
        cin: this.mapField(rawResult.cin, sourceName),
        faceValue: this.mapField(rawResult.faceValue, sourceName),
        priceBandLow: this.mapField(rawResult.priceBandLow, sourceName),
        priceBandHigh: this.mapField(rawResult.priceBandHigh, sourceName),
        lotSize: this.mapField(rawResult.lotSize, sourceName),
        issueSize: this.mapField(rawResult.issueSize, sourceName),
        freshIssueSize: this.mapField(rawResult.freshIssueSize, sourceName),
        ofsSize: this.mapField(rawResult.ofsSize, sourceName),
        issueShareCount: this.mapField(rawResult.issueShareCount, sourceName),
        freshIssueShareCount: this.mapField(
          rawResult.freshIssueShareCount,
          sourceName,
        ),
        ofsShareCount: this.mapField(rawResult.ofsShareCount, sourceName),
        openDate: this.mapField(rawResult.issueOpenDate, sourceName),
        closeDate: this.mapField(rawResult.issueCloseDate, sourceName),
        listingDate: this.mapField(undefined, sourceName),
        registrar: this.mapField(undefined, sourceName),
      },
    };
  }

  /**
   * Resolves SEBI detail page HTML or direct PDF URL and parses the target PDF.
   */
  async extractFromUrl(
    url: string,
    fetchHtmlOrBuffer: (targetUrl: string) => Promise<{ content: Buffer; contentType: string }>,
  ): Promise<{ review: AdminExtractionReview; pdfUrl: string }> {
    let targetPdfUrl = url;

    // Check if URL is an HTML page that needs resolving
    const initialFetch = await fetchHtmlOrBuffer(url);

    if (
      initialFetch.contentType.includes('text/html') ||
      url.endsWith('.html') ||
      url.endsWith('.htm') ||
      url.includes('/web/?file=')
    ) {
      const htmlText = initialFetch.content.toString('utf-8');
      const resolved = resolveSebiPdfUrlFromHtml(htmlText, url);
      if (!resolved) {
        throw new Error(`Failed to extract direct PDF URL from SEBI HTML page: ${url}`);
      }
      targetPdfUrl = resolved;
      const pdfFetch = await fetchHtmlOrBuffer(targetPdfUrl);
      const review = await this.extractFromPdfBuffer(pdfFetch.content, targetPdfUrl);
      return { review, pdfUrl: targetPdfUrl };
    }

    const review = await this.extractFromPdfBuffer(initialFetch.content, targetPdfUrl);
    return { review, pdfUrl: targetPdfUrl };
  }

  private mapField<T>(
    field: SebiExtractedField<T> | undefined,
    sourceName: string,
  ): AdminExtractedField<T> {
    if (!field || field.value === null || field.value === undefined) {
      return {
        value: null,
        status: 'NOT_FOUND',
        rawText: null,
        source: sourceName,
        evidence: field?.evidence?.rawTextSnippet || null,
      };
    }

    return {
      value: field.value,
      status: 'FOUND',
      rawText: null,
      source: sourceName,
      evidence: field.evidence?.rawTextSnippet || null,
    };
  }
}
