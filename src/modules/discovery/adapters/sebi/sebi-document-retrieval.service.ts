import { Injectable, Logger } from '@nestjs/common';
import { DocumentParsingStatus, DocumentType } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import { isOfficialSebiUrl, SebiHttpClient } from './sebi.fetcher';
import { SebiDocumentMatcherService } from './sebi-document-matcher.service';
import {
  extractSebiDocumentSections,
  SEBI_PARSER_VERSION,
} from './sebi-section.extractor';
import { SebiRetrievalResult } from './sebi-section.types';

@Injectable()
export class SebiDocumentRetrievalService {
  private readonly logger = new Logger(SebiDocumentRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: SebiHttpClient,
    private readonly matcher: SebiDocumentMatcherService,
  ) {}

  /**
   * Retrieves an official SEBI RHP/DRHP document for an IPO and deterministically extracts key sections.
   *
   * Idempotent & non-blocking: Never throws, never mutates canonical IPO values.
   */
  async retrieveAndExtractSections(
    ipoId: string,
    options?: {
      forceRefresh?: boolean;
      fetchImpl?: typeof fetch;
      maxSectionChars?: number;
    },
  ): Promise<SebiRetrievalResult> {
    const now = new Date().toISOString();

    // 1. Match IPO to official document
    const matched = await this.matcher.findOfficialDocumentForIpo(ipoId);
    if (!matched || !matched.sourceUrl) {
      this.logger.log(
        `No official SEBI document URL resolved for IPO '${ipoId}'. Skipping retrieval.`,
      );
      return {
        status: 'DOCUMENT_UNRESOLVED',
        ipoId,
        error: 'No official SEBI document or filing URL found for this IPO',
        retrievedAt: now,
      };
    }

    // 2. Check cached parsed document in database
    if (matched.documentId && !options?.forceRefresh) {
      const existingDoc = await this.prisma.ipoDocument.findUnique({
        where: { id: matched.documentId },
      });

      if (
        existingDoc &&
        existingDoc.parsingStatus === DocumentParsingStatus.PARSED &&
        existingDoc.extractionData &&
        typeof existingDoc.extractionData === 'object' &&
        (existingDoc.extractionData as any).sections
      ) {
        const ext = existingDoc.extractionData as any;
        this.logger.log(
          `Returning cached extracted sections for IPO '${ipoId}' (Doc ID: ${existingDoc.id})`,
        );
        return {
          status: 'CACHED',
          ipoId,
          documentId: existingDoc.id,
          sourceUrl: existingDoc.sourceUrl || matched.sourceUrl,
          documentHash: ext.documentHash,
          pageCount: ext.totalPageCount,
          sections: ext.sections,
          unresolvedSections: ext.unresolvedSections,
          retrievedAt: existingDoc.updatedAt.toISOString(),
        };
      }
    }

    // 3. Validate official authoritative URL safety (SEBI, BSE, NSE, or verified issuer fallback)
    if (!isOfficialSebiUrl(matched.sourceUrl, matched.companyWebsite)) {
      this.logger.warn(
        `Rejecting document download from non-authoritative URL '${matched.sourceUrl}' for IPO '${ipoId}'`,
      );
      return {
        status: 'DOWNLOAD_FAILED',
        ipoId,
        documentId: matched.documentId,
        sourceUrl: matched.sourceUrl,
        error: `Non-authoritative official URL rejected: ${matched.sourceUrl}`,
        retrievedAt: now,
      };
    }

    // 4. Download document buffer via existing HTTP client
    this.logger.log(
      `Downloading official statutory document for IPO '${ipoId}' from ${matched.sourceUrl}...`,
    );

    let downloadResult;
    try {
      downloadResult = await this.client.downloadDocument(
        matched.sourceUrl,
        options?.fetchImpl,
        matched.companyWebsite,
      );
    } catch (downloadErr: unknown) {
      const msg =
        downloadErr instanceof Error
          ? downloadErr.message
          : String(downloadErr);
      this.logger.warn(
        `Failed to download SEBI document for IPO '${ipoId}': ${msg}`,
      );

      if (matched.documentId) {
        await this.prisma.ipoDocument.update({
          where: { id: matched.documentId },
          data: {
            parsingStatus: DocumentParsingStatus.FAILED,
            errorMessage: `Download failed: ${msg}`,
          },
        }).catch(() => {});
      }

      return {
        status: 'DOWNLOAD_FAILED',
        ipoId,
        documentId: matched.documentId,
        sourceUrl: matched.sourceUrl,
        error: `Download failed: ${msg}`,
        retrievedAt: now,
      };
    }

    if (
      !downloadResult.documentBuffer ||
      downloadResult.status !== 200 ||
      downloadResult.documentBuffer.length === 0
    ) {
      this.logger.warn(
        `SEBI document download returned invalid HTTP status ${downloadResult.status} for IPO '${ipoId}'`,
      );
      return {
        status: 'DOWNLOAD_FAILED',
        ipoId,
        documentId: matched.documentId,
        sourceUrl: matched.sourceUrl,
        error: `Download returned HTTP ${downloadResult.status} or empty buffer`,
        retrievedAt: now,
      };
    }

    // 5. Deterministically extract sections from PDF buffer
    this.logger.log(
      `Extracting SEBI document sections for IPO '${ipoId}' (${downloadResult.documentBuffer.length} bytes)...`,
    );

    let extractedSections;
    try {
      extractedSections = await extractSebiDocumentSections(
        downloadResult.documentBuffer,
        {
          maxSectionChars: options?.maxSectionChars,
        },
      );
    } catch (parseErr: unknown) {
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      this.logger.warn(
        `Section extraction failed for IPO '${ipoId}': ${msg}`,
      );

      if (matched.documentId) {
        await this.prisma.ipoDocument.update({
          where: { id: matched.documentId },
          data: {
            parsingStatus: DocumentParsingStatus.FAILED,
            errorMessage: `Section extraction failed: ${msg}`,
          },
        }).catch(() => {});
      }

      return {
        status: 'PARSE_FAILED',
        ipoId,
        documentId: matched.documentId,
        sourceUrl: matched.sourceUrl,
        error: `Section extraction failed: ${msg}`,
        retrievedAt: now,
      };
    }

    // 6. Persist structured extraction to ipo_documents table
    let savedDocumentId = matched.documentId;
    try {
      if (savedDocumentId) {
        await this.prisma.ipoDocument.update({
          where: { id: savedDocumentId },
          data: {
            parsingStatus: DocumentParsingStatus.PARSED,
            parserVersion: SEBI_PARSER_VERSION,
            extractionData: extractedSections as any,
            fileSizeBytes: downloadResult.documentBuffer.length,
            mimeType: downloadResult.contentType || 'application/pdf',
            errorMessage: null,
          },
        });
      } else {
        const docSource = matched.matchSource === 'ISSUER_MATCH'
          ? 'ISSUER'
          : matched.matchSource.includes('BSE')
          ? 'BSE'
          : matched.matchSource.includes('NSE')
          ? 'NSE'
          : 'SEBI';

        const createdDoc = await this.prisma.ipoDocument.create({
          data: {
            ipoId,
            documentType: (matched.documentType as DocumentType) || DocumentType.RHP,
            sourceUrl: matched.sourceUrl,
            fileName:
              matched.fileName ||
              `${matched.companyName.replace(/[^A-Za-z0-9]/g, '_')}_${matched.documentType}.pdf`,
            mimeType: downloadResult.contentType || 'application/pdf',
            fileSizeBytes: downloadResult.documentBuffer.length,
            source: docSource,
            parsingStatus: DocumentParsingStatus.PARSED,
            parserVersion: SEBI_PARSER_VERSION,
            extractionData: extractedSections as any,
          },
        });
        savedDocumentId = createdDoc.id;
      }

      this.logger.log(
        `Successfully extracted and stored ${Object.keys(extractedSections.sections).length} SEBI sections for IPO '${ipoId}' (Doc ID: ${savedDocumentId})`,
      );
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      this.logger.error(
        `Failed to persist extracted sections for IPO '${ipoId}': ${msg}`,
      );
    }

    return {
      status: 'SUCCESS',
      ipoId,
      documentId: savedDocumentId,
      sourceUrl: matched.sourceUrl,
      documentHash: extractedSections.documentHash,
      pageCount: extractedSections.totalPageCount,
      sections: extractedSections.sections,
      unresolvedSections: extractedSections.unresolvedSections,
      retrievedAt: extractedSections.extractedAt,
    };
  }
}
