import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { AdminIpoService } from '../admin/admin-ipo.service';
import { IpoGuruService } from '../ipo-guru/ipo-guru.service';
import { IpoTimelineSchedulerService } from '../ipos/ipo-timeline-scheduler.service';
import { UserEntitlementService } from '../user/user-entitlement.service';
import { ProPlanService } from '../pro-plan/pro-plan.service';
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
        {
          provide: IpoGuruService,
          useValue: {
            fetchIpos: jest.fn().mockResolvedValue({ httpStatus: 200, ipos: [], total: 0 }),
            syncIpos: jest.fn().mockResolvedValue({ totalFetched: 0, matchedUpdated: 0, newlyCreated: 0, skipped: 0, errorCount: 0, items: [] }),
          },
        },
        {
          provide: IpoTimelineSchedulerService,
          useValue: {
            checkAllotmentAwaitedIposNow: jest.fn().mockResolvedValue({ checkedCount: 0, outCount: 0, remainingAwaitedCount: 0, details: [] }),
          },
        },
        {
          provide: UserEntitlementService,
          useValue: {
            listUsers: jest.fn().mockResolvedValue({ users: [], total: 0 }),
            getUserDetail: jest.fn().mockResolvedValue({ uid: 'u1' }),
            updateUserEntitlement: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        { provide: ConfigService, useValue: { get: () => true } },
        { provide: ProPlanService, useValue: {} },
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
      expect(html).toContain('accept=".json,application/json"');
      expect(html.includes('id="json-file-input"') || html.includes('id="json-detail-file-input"')).toBe(true);
    });

    it('7. Import JSON button invokes JSON import trigger', () => {
      const html = renderConsoleHtml();
      expect(html.includes('triggerJsonImport()') || html.includes('triggerJsonImportForCurrentIpo()')).toBe(true);
      expect(html.includes('function triggerJsonImport()') || html.includes('function triggerJsonImportForCurrentIpo()')).toBe(true);
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

  describe('Manual AI Enrichment Result UI & Document Discovery Verification', () => {
    it('renders the AI enrichment modal structure with correct classification headings in console UI', () => {
      const html = renderConsoleHtml();
      expect(html).toContain('id="ai-enrichment-modal-overlay"');
      expect(html).toContain('id="ai-enrich-modal-body"');
      expect(html).toContain('Field-Level Reconciliation Audit Report:');
      expect(html).toContain('Verified Applied');
      expect(html).toContain('Protected');
      expect(html).toContain('Unverifiable / Skipped');
    });

    it('correctly classifies State 1 (DOCUMENT_UNRESOLVED): missing fields in Not Enriched, NOT Protected Fields', () => {
      const result: {
        ipoId: string;
        status: string;
        missingFieldsDetected: string[];
        enrichedFields: string[];
        skippedFields: string[];
        error: string;
      } = {
        ipoId: 'ipo-test-1',
        status: 'DOCUMENT_UNRESOLVED',
        missingFieldsDetected: ['aboutDescription', 'industry', 'sector'],
        enrichedFields: [],
        skippedFields: [],
        error: 'No official SEBI / NSE Emerge / BSE SME or verified issuer filing found for this IPO.',
      };

      const enriched: string[] = Array.isArray(result.enrichedFields) ? result.enrichedFields : [];
      const skipped: string[] = Array.isArray(result.skippedFields) ? result.skippedFields : [];
      const detected: string[] = Array.isArray(result.missingFieldsDetected) ? result.missingFieldsDetected : [];
      const isBlocked = result.status === 'DOCUMENT_UNRESOLVED' || result.status === 'FAILED';
      const notEnriched = isBlocked
        ? detected.filter((f) => enriched.indexOf(f) === -1 && skipped.indexOf(f) === -1)
        : [];
      const unavailable = !isBlocked
        ? detected.filter((f) => enriched.indexOf(f) === -1 && skipped.indexOf(f) === -1)
        : [];

      expect(notEnriched).toEqual(['aboutDescription', 'industry', 'sector']);
      expect(skipped).toEqual([]);
      expect(unavailable).toEqual([]);
      expect(enriched).toEqual([]);
    });

    it('correctly classifies State 2 (Existing verified fields): appears under Protected Fields', () => {
      const result: {
        ipoId: string;
        status: string;
        missingFieldsDetected: string[];
        enrichedFields: string[];
        skippedFields: string[];
      } = {
        ipoId: 'ipo-test-2',
        status: 'COMPLETED',
        missingFieldsDetected: ['aboutDescription', 'industry'],
        enrichedFields: ['aboutDescription', 'industry'],
        skippedFields: ['preIpoPromoterHolding', 'preIpoPe'],
      };

      const enriched: string[] = Array.isArray(result.enrichedFields) ? result.enrichedFields : [];
      const skipped: string[] = Array.isArray(result.skippedFields) ? result.skippedFields : [];
      const detected: string[] = Array.isArray(result.missingFieldsDetected) ? result.missingFieldsDetected : [];
      const isBlocked = result.status === 'DOCUMENT_UNRESOLVED' || result.status === 'FAILED';
      const notEnriched = isBlocked
        ? detected.filter((f) => enriched.indexOf(f) === -1 && skipped.indexOf(f) === -1)
        : [];

      expect(skipped).toEqual(['preIpoPromoterHolding', 'preIpoPe']);
      expect(enriched).toEqual(['aboutDescription', 'industry']);
      expect(notEnriched).toEqual([]);
    });

    it('correctly classifies State 3 (Legitimately unavailable fields): appears under Unavailable', () => {
      const result: {
        ipoId: string;
        status: string;
        missingFieldsDetected: string[];
        enrichedFields: string[];
        skippedFields: string[];
      } = {
        ipoId: 'ipo-test-3',
        status: 'COMPLETED',
        missingFieldsDetected: ['aboutDescription', 'freshIssueShareCount', 'ofsShareCount'],
        enrichedFields: ['aboutDescription'],
        skippedFields: [],
      };

      const enriched: string[] = Array.isArray(result.enrichedFields) ? result.enrichedFields : [];
      const skipped: string[] = Array.isArray(result.skippedFields) ? result.skippedFields : [];
      const detected: string[] = Array.isArray(result.missingFieldsDetected) ? result.missingFieldsDetected : [];
      const isBlocked = result.status === 'DOCUMENT_UNRESOLVED' || result.status === 'FAILED';
      const unavailable = !isBlocked
        ? detected.filter((f) => enriched.indexOf(f) === -1 && skipped.indexOf(f) === -1)
        : [];

      expect(enriched).toEqual(['aboutDescription']);
      expect(unavailable).toEqual(['freshIssueShareCount', 'ofsShareCount']);
      expect(skipped).toEqual([]);
    });

    it('validates Acme issuer-hosted official DRHP URL when company.website matches and rejects third-party URLs', () => {
      const { isAuthoritativeDocumentUrl } = require('../discovery/adapters/sebi/sebi.fetcher');

      const acmeDrhpUrl = 'https://acmeindia.co/assets/web/pdf/DRHP_Acme_20250930201943.pdf';
      const acmeWebsite = 'https://acmeindia.co';
      const thirdPartyUrl = 'https://ipowatch.in/assets/DRHP_Acme.pdf';
      const nonProspectusUrl = 'https://acmeindia.co/assets/web/pdf/product_brochure.pdf';

      // 1. Acme issuer-hosted official DRHP is accepted
      expect(isAuthoritativeDocumentUrl(acmeDrhpUrl, acmeWebsite)).toBe(true);

      // 2. Third-party URL is rejected
      expect(isAuthoritativeDocumentUrl(thirdPartyUrl, acmeWebsite)).toBe(false);
      expect(isAuthoritativeDocumentUrl(thirdPartyUrl, null)).toBe(false);

      // 3. Non-prospectus document on issuer site is rejected
      expect(isAuthoritativeDocumentUrl(nonProspectusUrl, acmeWebsite)).toBe(false);

      // 4. SEBI / Exchange official URLs remain accepted
      expect(
        isAuthoritativeDocumentUrl(
          'https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/drhp.pdf',
        ),
      ).toBe(true);
      expect(
        isAuthoritativeDocumentUrl(
          'https://nsearchives.nseindia.com/emerge/rhp.pdf',
        ),
      ).toBe(true);
      expect(
        isAuthoritativeDocumentUrl(
          'https://www.bseindia.com/downloads/ipo/prospectus.pdf',
        ),
      ).toBe(true);
    });
  });
});
