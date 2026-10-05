import { DocumentParsingStatus } from '@prisma/client';

import { SebiDocumentMatcherService } from './sebi-document-matcher.service';
import { SebiDocumentRetrievalService } from './sebi-document-retrieval.service';

describe('SebiDocumentRetrievalService (Phase 1)', () => {
  let retrievalService: SebiDocumentRetrievalService;
  let matcherService: SebiDocumentMatcherService;
  let mockPrisma: any;
  let mockHttpClient: any;

  beforeEach(() => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn(),
      },
      source: {
        findUnique: jest.fn(),
      },
      discoveryRecord: {
        findMany: jest.fn(),
      },
      ipoDocument: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockHttpClient = {
      downloadDocument: jest.fn(),
    };

    const mockSmeMatcher: any = {
      findSmeOfficialDocument: jest.fn().mockResolvedValue(null),
    };

    matcherService = new SebiDocumentMatcherService(mockPrisma, mockSmeMatcher);
    retrievalService = new SebiDocumentRetrievalService(
      mockPrisma,
      mockHttpClient,
      matcherService,
    );
  });

  describe('Document Matching (SebiDocumentMatcherService)', () => {
    it('matches IPO to official SEBI document via linked IpoDocument', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-1',
        company: { id: 'comp-1', displayName: 'Jindal Supreme', legalName: 'Jindal Supreme (India) Ltd', cin: 'U27109HR1974PLC007126' },
        documents: [
          {
            id: 'doc-1',
            documentType: 'RHP',
            sourceUrl: 'https://www.sebi.gov.in/filings/jindal-rhp.pdf',
            fileName: 'jindal_rhp.pdf',
          },
        ],
        sourceIdentities: [],
      });

      const matched = await matcherService.findOfficialDocumentForIpo('ipo-1');
      expect(matched).not.toBeNull();
      expect(matched!.documentId).toBe('doc-1');
      expect(matched!.documentType).toBe('RHP');
      expect(matched!.sourceUrl).toBe('https://www.sebi.gov.in/filings/jindal-rhp.pdf');
      expect(matched!.matchSource).toBe('IPO_DOCUMENT');
    });

    it('matches IPO to SEBI document via Company CIN in DiscoveryRecord', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-2',
        company: { id: 'comp-2', displayName: 'Tempsens', legalName: 'Tempsens Instruments Ltd', cin: 'U31402GJ1990PLC149769' },
        documents: [],
        sourceIdentities: [],
      });

      mockPrisma.source.findUnique.mockResolvedValue({ id: 'sebi-src-id', code: 'SEBI' });
      mockPrisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          sourceReference: 'https://www.sebi.gov.in/filings/tempsens.pdf',
          companyName: 'Tempsens Instruments Ltd',
          rawPayload: {
            cin: { value: 'U31402GJ1990PLC149769' },
            filingType: 'RHP',
            documentUrl: 'https://www.sebi.gov.in/filings/tempsens.pdf',
          },
        },
      ]);

      const matched = await matcherService.findOfficialDocumentForIpo('ipo-2');
      expect(matched).not.toBeNull();
      expect(matched!.sourceUrl).toBe('https://www.sebi.gov.in/filings/tempsens.pdf');
      expect(matched!.matchSource).toBe('CIN_MATCH');
    });

    it('returns null when no official document or filing URL is found', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-3',
        company: { id: 'comp-3', displayName: 'Unknown Ltd', legalName: 'Unknown Ltd', cin: null },
        documents: [],
        sourceIdentities: [],
      });
      mockPrisma.source.findUnique.mockResolvedValue({ id: 'sebi-src-id', code: 'SEBI' });
      mockPrisma.discoveryRecord.findMany.mockResolvedValue([]);

      const matched = await matcherService.findOfficialDocumentForIpo('ipo-3');
      expect(matched).toBeNull();
    });
  });

  describe('Document Retrieval & Section Extraction', () => {
    it('returns cached sections if document was already parsed', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-1',
        company: { id: 'comp-1', displayName: 'Jindal Supreme', legalName: 'Jindal Supreme (India) Ltd' },
        documents: [
          {
            id: 'doc-1',
            documentType: 'RHP',
            sourceUrl: 'https://www.sebi.gov.in/filings/jindal-rhp.pdf',
          },
        ],
        sourceIdentities: [],
      });

      mockPrisma.ipoDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        sourceUrl: 'https://www.sebi.gov.in/filings/jindal-rhp.pdf',
        parsingStatus: DocumentParsingStatus.PARSED,
        updatedAt: new Date('2026-10-05T12:00:00.000Z'),
        extractionData: {
          documentHash: 'cached-hash',
          totalPageCount: 150,
          sections: {
            OUR_BUSINESS: {
              sectionKey: 'OUR_BUSINESS',
              sectionTitle: 'Our Business',
              pageRange: { startPage: 40, endPage: 55 },
              content: 'Manufacturing precision parts',
              charCount: 29,
              contentHash: 'section-hash',
              isTruncated: false,
            },
          },
          unresolvedSections: [],
        },
      });

      const result = await retrievalService.retrieveAndExtractSections('ipo-1');

      expect(result.status).toBe('CACHED');
      expect(result.documentId).toBe('doc-1');
      expect(result.sections!.OUR_BUSINESS).toBeDefined();
      expect(mockHttpClient.downloadDocument).not.toHaveBeenCalled();
    });

    it('returns DOCUMENT_UNRESOLVED when no official SEBI document URL exists', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-unresolved',
        company: { id: 'comp-4', displayName: 'No Doc IPO', legalName: 'No Doc IPO Ltd' },
        documents: [],
        sourceIdentities: [],
      });
      mockPrisma.source.findUnique.mockResolvedValue(null);

      const result = await retrievalService.retrieveAndExtractSections('ipo-unresolved');
      expect(result.status).toBe('DOCUMENT_UNRESOLVED');
      expect(result.error).toContain('No official SEBI document');
    });

    it('rejects download from non-SEBI URL safely', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-unsafe',
        company: { id: 'comp-5', displayName: 'Unsafe URL Corp', legalName: 'Unsafe URL Corp' },
        documents: [
          {
            id: 'doc-unsafe',
            documentType: 'RHP',
            sourceUrl: 'https://malicious-site.com/fake-rhp.pdf',
          },
        ],
        sourceIdentities: [],
      });

      const result = await retrievalService.retrieveAndExtractSections('ipo-unsafe');
      expect(result.status).toBe('DOWNLOAD_FAILED');
      expect(result.error).toContain('official URL rejected');
      expect(mockHttpClient.downloadDocument).not.toHaveBeenCalled();
    });

    it('handles download failure gracefully and marks document FAILED without crashing', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-down-fail',
        company: { id: 'comp-6', displayName: 'Download Fail Ltd', legalName: 'Download Fail Ltd' },
        documents: [
          {
            id: 'doc-down-fail',
            documentType: 'RHP',
            sourceUrl: 'https://www.sebi.gov.in/filings/unavailable.pdf',
          },
        ],
        sourceIdentities: [],
      });

      mockPrisma.ipoDocument.findUnique.mockResolvedValue({
        id: 'doc-down-fail',
        parsingStatus: DocumentParsingStatus.PENDING,
      });

      mockHttpClient.downloadDocument.mockRejectedValue(
        new Error('ETIMEDOUT: Connection timed out'),
      );
      mockPrisma.ipoDocument.update.mockResolvedValue({});

      const result = await retrievalService.retrieveAndExtractSections('ipo-down-fail');

      expect(result.status).toBe('DOWNLOAD_FAILED');
      expect(result.error).toContain('ETIMEDOUT');
      expect(mockPrisma.ipoDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-down-fail' },
          data: expect.objectContaining({
            parsingStatus: DocumentParsingStatus.FAILED,
          }),
        }),
      );
    });

    it('handles corrupt PDF buffer and marks document FAILED gracefully', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-corrupt',
        company: { id: 'comp-7', displayName: 'Corrupt PDF Ltd', legalName: 'Corrupt PDF Ltd' },
        documents: [
          {
            id: 'doc-corrupt',
            documentType: 'RHP',
            sourceUrl: 'https://www.sebi.gov.in/filings/corrupt.pdf',
          },
        ],
        sourceIdentities: [],
      });

      mockPrisma.ipoDocument.findUnique.mockResolvedValue({
        id: 'doc-corrupt',
        parsingStatus: DocumentParsingStatus.PENDING,
      });

      mockHttpClient.downloadDocument.mockResolvedValue({
        status: 200,
        contentType: 'application/pdf',
        contentLength: 15,
        documentBuffer: Buffer.from('Not a real PDF buffer'),
      });
      mockPrisma.ipoDocument.update.mockResolvedValue({});

      const result = await retrievalService.retrieveAndExtractSections('ipo-corrupt');

      expect(result.status).toBe('PARSE_FAILED');
      expect(result.error).toBeDefined();
      expect(mockPrisma.ipoDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-corrupt' },
          data: expect.objectContaining({
            parsingStatus: DocumentParsingStatus.FAILED,
          }),
        }),
      );
    });
  });
});
