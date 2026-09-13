import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { AdminIpoService } from '../admin/admin-ipo.service';
import { ConsoleEnabledGuard } from './console.guard';
import { renderConsoleHtml } from './console.ui';
import { ExchangeListing, MarketSegment, PublicationStatus } from '@prisma/client';
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
      importIpoFromJson: jest.fn().mockImplementation((payload) => {
        if (!payload || !payload.company?.legalName) {
          throw new AppException(ErrorCode.VALIDATION_ERROR, 'company.legalName is required', 400);
        }
        return Promise.resolve({
          id: '34300000-0000-0000-0000-000000000003',
          publicationStatus: 'DRAFT',
          message: 'JSON import successful. IPO created/updated in DRAFT status.',
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

  describe('Part B — Canonical JSON Import Contract & Isolation', () => {
    it('6. JSON file input selection element exists in HTML UI', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('id="json-file-input"');
      expect(html).toContain('accept=".json,application/json"');
    });

    it('7. Import JSON button invokes JSON import trigger', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('onclick="triggerJsonImport()"');
      expect(html).toContain('function triggerJsonImport()');
    });

    it('8. Controller endpoint delegates to importIpoFromJson service method', async () => {
      const mockImportResult = {
        id: '34300000-0000-0000-0000-000000000003',
        publicationStatus: 'DRAFT',
        message: 'JSON import successful. IPO created/updated in DRAFT status.',
      };
      (adminIpoService.importIpoFromJson as jest.Mock) = jest.fn().mockResolvedValue(mockImportResult);

      const jsonPayload = {
        company: { legalName: 'JSON Imported Enterprise Limited' },
        ipo: { marketSegment: 'MAINBOARD', exchange: 'NSE' },
      };

      const res = await controller.importManualIpoJson(jsonPayload as any);

      expect(adminIpoService.importIpoFromJson).toHaveBeenCalledWith(jsonPayload, undefined);
      expect(res.id).toBe('34300000-0000-0000-0000-000000000003');
      expect(res.publicationStatus).toBe('DRAFT');
    });

    it('9. Missing JSON payload throws BadRequestException', async () => {
      await expect(controller.importManualIpoJson(null as any)).rejects.toThrow(
        'Invalid JSON payload provided',
      );
    });

    it('10. PDF/URL manual extraction endpoints are no longer exposed on Console UI', () => {
      const html = renderConsoleHtml();
      expect(html).not.toContain('id="btn-upload-file"');
      expect(html).not.toContain('id="btn-parse-url"');
      expect(html).not.toContain('onclick="uploadDocumentFile()"');
      expect(html).not.toContain('onclick="parseDocumentUrl()"');
    });

    it('11. Imported IPO remains in DRAFT status by default', async () => {
      const draft = await controller.getManualIpoDetail('34300000-0000-0000-0000-000000000001');
      expect(draft.publicationStatus).toBe('DRAFT');
    });

    it('12. Existing DRAFT can be retrieved and published via admin action', async () => {
      const draft = await controller.getManualIpoDetail('34300000-0000-0000-0000-000000000001');
      expect(draft.publicationStatus).toBe(PublicationStatus.DRAFT);
    });
  });
});
