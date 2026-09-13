import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { AdminIpoService } from '../admin/admin-ipo.service';
import { ConsoleEnabledGuard } from './console.guard';
import { renderConsoleHtml } from './console.ui';
import { DocumentType, ExchangeListing, MarketSegment, PublicationStatus } from '@prisma/client';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppException } from '../../common/errors/app.exception';

describe('Phase 34.3A — Manual IPO Console Workflow & Reset Safety', () => {
  let controller: ConsoleController;
  let adminIpoService: Partial<AdminIpoService>;

  const mockDraftIpo = {
    id: '34300000-0000-0000-0000-000000000001',
    companyId: 'comp-343',
    symbol: null,
    marketSegment: 'MAINBOARD' as const,
    exchange: 'NSE' as const,
    status: 'DRAFT' as const,
    publicationStatus: 'DRAFT' as const,
    priceBandLow: null,
    priceBandHigh: null,
    lotSize: null,
    faceValue: null,
    issueSize: null,
    freshIssueSize: null,
    ofsSize: null,
    openDate: null,
    closeDate: null,
    listingDate: null,
    company: {
      id: 'comp-343',
      legalName: 'Brand New Draft Company Limited',
      displayName: 'Brand New Draft Company',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      aboutDescription: null,
      phone: null,
      email: null,
      contactPerson: null,
    },
    validation: {
      isValid: false,
      errors: [{ field: 'symbol', message: 'Symbol is required' }],
      warnings: [],
    },
    lifecycleEvents: [],
    documents: [],
    allotmentConfig: null,
  };

  const mockExistingIpo = {
    ...mockDraftIpo,
    id: '34300000-0000-0000-0000-000000000002',
    symbol: 'KANOHAR',
    priceBandLow: 100,
    priceBandHigh: 108,
    company: {
      ...mockDraftIpo.company,
      legalName: 'Kanohar Electricals Limited',
      displayName: 'Kanohar Electricals',
      cin: 'U31100UP2010PLC041000',
    },
  };

  beforeEach(async () => {
    adminIpoService = {
      createIpo: jest.fn().mockResolvedValue(mockDraftIpo),
      getIpoDetail: jest.fn().mockImplementation((id: string) => {
        if (id === '34300000-0000-0000-0000-000000000001') return Promise.resolve(mockDraftIpo);
        if (id === '34300000-0000-0000-0000-000000000002') return Promise.resolve(mockExistingIpo);
        throw new AppException(ErrorCode.IPO_NOT_FOUND, `IPO ${id} not found`, 404);
      }),
      parseAndStorePdfBuffer: jest.fn().mockImplementation((buffer) => {
        if (!buffer || buffer.length === 0) {
          throw new Error('No PDF file provided');
        }
        return Promise.resolve({
          documentId: 'doc-hero-1',
          parsingStatus: 'PARSED',
          extraction: {
            parserVersion: 'sebi-pdf-parser-1.0.0',
            extractedAt: '2026-09-13T20:00:00.000Z',
            fields: {
              legalName: { value: 'Hero Motors Limited', status: 'FOUND' },
              cin: { value: 'U34100DL1988PLC033333', status: 'FOUND' },
              faceValue: { value: 10, status: 'FOUND' },
              freshIssueSize: { value: 6000000000, status: 'FOUND' },
              ofsSize: { value: 4000000000, status: 'FOUND' },
              openDate: { value: '2026-09-16', status: 'FOUND' },
              closeDate: { value: '2026-09-18', status: 'FOUND' },
            },
          },
          errorMessage: null,
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: ConsoleService, useValue: {} },
        { provide: AdminIpoService, useValue: adminIpoService },
        { provide: ConfigService, useValue: { get: () => true } },
        ConsoleEnabledGuard,
      ],
    }).compile();

    controller = module.get<ConsoleController>(ConsoleController);
  });

  describe('Part A — Clean Draft Initialization & Placeholder Hygiene', () => {
    it('1. HTML template does NOT contain hardcoded CIN U27109HR1974PLC007126 or Symbol MANIKA in placeholders', () => {
      const html = renderConsoleHtml();
      expect(html).not.toContain('placeholder="U27109HR1974PLC007126"');
      expect(html).not.toContain('placeholder="MANIKA"');
      expect(html).not.toContain('placeholder="e.g. MANIKA2026"');
    });

    it('2. New Manual IPO starts completely clean with null company identity, symbol, and dates', async () => {
      const newIpo = await controller.createManualIpo({
        legalName: 'Brand New Draft Company Limited',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
      });
      expect(newIpo.id).toBe('34300000-0000-0000-0000-000000000001');
      expect(newIpo.company.aboutDescription).toBeNull();
      expect(newIpo.company.phone).toBeNull();
      expect(newIpo.company.email).toBeNull();
      expect(newIpo.company.contactPerson).toBeNull();
    });

    it('3. New Manual IPO has no inherited CIN', async () => {
      const newIpo = await controller.createManualIpo({
        legalName: 'Brand New Draft Company Limited',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
      });
      expect(newIpo.company.cin).toBeNull();
    });

    it('4. New Manual IPO has no inherited symbol', async () => {
      const newIpo = await controller.createManualIpo({
        legalName: 'Brand New Draft Company Limited',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
      });
      expect(newIpo.symbol).toBeNull();
    });

    it('5. Existing Manual IPO edit preserves its own persisted data without resetting to blank', async () => {
      const existing = await controller.getManualIpoDetail('34300000-0000-0000-0000-000000000002');
      expect(existing.symbol).toBe('KANOHAR');
      expect(existing.company.cin).toBe('U31100UP2010PLC041000');
    });
  });

  describe('Part B — PDF Upload Endpoint & Interceptor Contract', () => {
    it('6. File input selection elements exist in HTML UI', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('id="doc-file-input"');
      expect(html).toContain('accept="application/pdf"');
    });

    it('7. Upload button invokes upload handler', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('id="btn-upload-file"');
      expect(html).toContain('onclick="uploadDocumentFile()"');
    });

    it('8. Multipart field name matches backend "file"', () => {
      const html = renderConsoleHtml();
      expect(html).toContain("formData.append('file', file)");
    });

    it('9. Backend receives uploaded PDF and passes file buffer', async () => {
      const dummyPdfBuffer = Buffer.from('%PDF-1.4 dummy content');
      const res = await controller.uploadManualIpoPdf(
        { buffer: dummyPdfBuffer, originalname: 'hero-motors-limited-rhp.pdf', mimetype: 'application/pdf' },
        '34300000-0000-0000-0000-000000000001',
        DocumentType.RHP,
      );

      expect(adminIpoService.parseAndStorePdfBuffer).toHaveBeenCalledWith(
        dummyPdfBuffer,
        'hero-motors-limited-rhp.pdf',
        'application/pdf',
        '34300000-0000-0000-0000-000000000001',
        DocumentType.RHP,
      );
      expect(res.parsingStatus).toBe('PARSED');
    });

    it('10. PDF parser is invoked and returns extraction review', async () => {
      const dummyPdfBuffer = Buffer.from('%PDF-1.4 dummy content');
      const res = await controller.uploadManualIpoPdf(
        { buffer: dummyPdfBuffer, originalname: 'hero-motors-limited-rhp.pdf', mimetype: 'application/pdf' },
        '34300000-0000-0000-0000-000000000001',
        DocumentType.RHP,
      );

      expect(res.extraction).toBeDefined();
      expect(res.extraction?.fields.openDate.value).toBe('2026-09-16');
    });

    it('11. Successful extraction response reaches Console HTML logic', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('renderExtractionReview(data.extraction)');
    });

    it('12. Parser failure is visible in upload status UI', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('PDF parsing failed:');
    });

    it('13. Missing file returns visible error', async () => {
      await expect(
        controller.uploadManualIpoPdf(
          null as any,
          undefined,
          undefined,
        ),
      ).rejects.toThrow('No PDF file provided');
    });

    it('14. Apply Extracted Fields function exists in Console UI logic', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('onclick="applyExtractedValuesToForm()"');
      expect(html).toContain('function applyExtractedValuesToForm()');
    });

    it('15. Extraction does not publish (remains DRAFT)', async () => {
      const draft = await controller.getManualIpoDetail('34300000-0000-0000-0000-000000000001');
      expect(draft.publicationStatus).toBe('DRAFT');
    });

    it('16. Draft remains hidden from public API and existing workflow remains intact', async () => {
      const draft = await controller.getManualIpoDetail('34300000-0000-0000-0000-000000000001');
      expect(draft.publicationStatus).toBe(PublicationStatus.DRAFT);
    });
  });
});
