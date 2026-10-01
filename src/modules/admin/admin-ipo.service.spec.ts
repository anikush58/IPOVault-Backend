import { Test, TestingModule } from '@nestjs/testing';
import { AdminIpoService } from './admin-ipo.service';
import { AdminValidationService } from './admin-validation.service';
import { PrismaService } from '../../database/prisma.service';
import { ExchangeListing, MarketSegment, PublicationStatus } from '@prisma/client';

describe('AdminIpoService & AdminValidationService', () => {
  let adminIpoService: AdminIpoService;
  let validationService: AdminValidationService;

  const mockPrisma = {
    $transaction: jest.fn().mockImplementation((cb) => cb(mockPrisma)),
    source: {
      upsert: jest.fn().mockResolvedValue({ id: 'admin-source-id', code: 'ADMIN' }),
    },
    company: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        id: 'company-uuid-1',
        legalName: 'TEST ENTERPRISES LIMITED',
        displayName: 'TEST ENTERPRISES LIMITED',
        cin: 'U27109HR1974PLC007126',
      }),
      update: jest.fn().mockResolvedValue({ id: 'company-uuid-1' }),
      delete: jest.fn().mockResolvedValue({ id: 'company-uuid-1' }),
    },
    ipo: {
      create: jest.fn().mockResolvedValue({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
      }),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({
        id: 'ipo-uuid-1',
        publicationStatus: PublicationStatus.DRAFT,
      }),
      delete: jest.fn().mockResolvedValue({ id: 'ipo-uuid-1' }),
    },
    ipoLifecycleEvent: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    companyFinancial: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoOfferCategory: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoParticipant: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoAllotmentConfig: {
      upsert: jest.fn().mockResolvedValue({ registrar: 'kfintech', registrarIpoCode: 'MANIKA2026', enabled: true }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoDocument: {
      create: jest.fn().mockResolvedValue({ id: 'doc-uuid-1', parsingStatus: 'PARSED' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'doc-uuid-1' }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    gmpObservation: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    subscriptionObservation: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    fieldProvenance: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoSourceIdentity: {
      upsert: jest.fn().mockResolvedValue({ id: 'source-id-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    allotmentCheckLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    allotmentCheckJob: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    allotmentCheckJobItem: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoChangeEvent: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminIpoService,
        AdminValidationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    adminIpoService = module.get<AdminIpoService>(AdminIpoService);
    validationService = module.get<AdminValidationService>(AdminValidationService);
    jest.clearAllMocks();
  });

  describe('Validation Engine', () => {
    it('rejects IPO publication when price band high < low', () => {
      const report = validationService.validateIpo({
        legalName: 'Acme Ltd',
        priceBandLow: 100,
        priceBandHigh: 50,
      });

      expect(report.isValid).toBe(false);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].code).toBe('INVALID_PRICE_BAND_RANGE');
    });

    it('rejects IPO publication when open date > close date', () => {
      const report = validationService.validateIpo({
        legalName: 'Acme Ltd',
        openDate: '2026-09-20',
        closeDate: '2026-09-15',
      });

      expect(report.isValid).toBe(false);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].code).toBe('INVALID_DATE_SEQUENCE_OPEN_CLOSE');
    });

    it('emits warning when lot size is missing but allows validity if mandatory fields present', () => {
      const report = validationService.validateIpo({
        legalName: 'Acme Ltd',
        openDate: '2026-09-10',
        closeDate: '2026-09-15',
      });

      expect(report.isValid).toBe(true);
      expect(report.hasWarnings).toBe(true);
      expect(report.warnings.some((w) => w.code === 'MISSING_LOT_SIZE')).toBe(true);
    });
  });

  describe('Canonical JSON Import Service', () => {
    it('validates and imports a complete JSON payload into DRAFT status', async () => {
      const payload = {
        company: {
          legalName: 'JSON TEST ENTERPRISES LIMITED',
          displayName: 'JSON TEST ENTERPRISES',
          cin: 'U12345MH2026PLC000001',
        },
        ipo: {
          symbol: 'JSONTEST',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'UPCOMING',
          publicationStatus: 'PUBLISHED', // Must be forced to DRAFT
          priceBandLow: 100,
          priceBandHigh: 105,
        },
        lifecycle: {
          openDate: '2026-10-01',
          closeDate: '2026-10-05',
        },
      };

      const res = await adminIpoService.importIpoFromJson(payload);

      expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
      expect(res.id).toBe('ipo-uuid-1');
      expect(mockPrisma.ipo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          publicationStatus: PublicationStatus.DRAFT,
          symbol: 'JSONTEST',
        }),
      });
    });

    it('rejects JSON import when legalName is missing', async () => {
      await expect(
        adminIpoService.importIpoFromJson({
          company: {},
          ipo: { marketSegment: 'MAINBOARD' },
        }),
      ).rejects.toThrow('Company name (legalName or companyName) is required');
    });

    it('rejects JSON import when price band low > high', async () => {
      await expect(
        adminIpoService.importIpoFromJson({
          company: { legalName: 'Invalid Price Band Co' },
          ipo: { priceBandLow: 150, priceBandHigh: 100 },
        }),
      ).rejects.toThrow('cannot be greater than');
    });

    describe('Monetary Size Decimal-Safety (Dhoot Transmission Regression)', () => {
      const basePayload = {
        company: { legalName: 'Dhoot Transmission Limited' },
        ipo: { marketSegment: 'MAINBOARD', exchange: 'NSE' },
      };

      it('1. accepts equal monetary size sum (3066.89 == 1400.00 + 1666.89)', async () => {
        const payload = {
          ...basePayload,
          ipo: {
            ...basePayload.ipo,
            issueSize: 3066.89,
            freshIssueSize: 1400.0,
            ofsSize: 1666.89,
          },
        };
        const res = await adminIpoService.importIpoFromJson(payload);
        expect(res).toBeDefined();
        expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
      });

      it('2. rejects slightly smaller issueSize (3066.88 < 1400.00 + 1666.89)', async () => {
        const payload = {
          ...basePayload,
          ipo: {
            ...basePayload.ipo,
            issueSize: 3066.88,
            freshIssueSize: 1400.0,
            ofsSize: 1666.89,
          },
        };
        await expect(adminIpoService.importIpoFromJson(payload)).rejects.toThrow(
          'issueSize cannot be less than the sum of freshIssueSize and ofsSize',
        );
      });

      it('3. rejects clearly smaller issueSize (3000.00 < 1400.00 + 1666.89)', async () => {
        const payload = {
          ...basePayload,
          ipo: {
            ...basePayload.ipo,
            issueSize: 3000.0,
            freshIssueSize: 1400.0,
            ofsSize: 1666.89,
          },
        };
        await expect(adminIpoService.importIpoFromJson(payload)).rejects.toThrow(
          'issueSize cannot be less than the sum of freshIssueSize and ofsSize',
        );
      });

      it('4. accepts larger issueSize (3067.00 > 1400.00 + 1666.89)', async () => {
        const payload = {
          ...basePayload,
          ipo: {
            ...basePayload.ipo,
            issueSize: 3067.0,
            freshIssueSize: 1400.0,
            ofsSize: 1666.89,
          },
        };
        const res = await adminIpoService.importIpoFromJson(payload);
        expect(res).toBeDefined();
        expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
      });

      it('5. handles null values safely without inventing zeroes', async () => {
        const payload = {
          ...basePayload,
          ipo: {
            ...basePayload.ipo,
            issueSize: 3066.89,
            freshIssueSize: null,
            ofsSize: 1666.89,
          },
        };
        const res = await adminIpoService.importIpoFromJson(payload);
        expect(res).toBeDefined();
        expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
      });
    });
  });

  describe('Admin CRUD & Publication Lifecycle', () => {
    it('creates draft IPO with provenance records', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        company: { legalName: 'TEST ENTERPRISES LIMITED', displayName: 'TEST ENTERPRISES LIMITED' },
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'UPCOMING',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        lifecycleEvents: [{ eventType: 'OPEN', eventDate: new Date('2026-09-20') }],
        documents: [],
        allotmentConfig: null,
        sourceIdentities: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await adminIpoService.createIpo({
        legalName: 'TEST ENTERPRISES LIMITED',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        openDate: '2026-09-20',
      });

      expect(mockPrisma.company.create).toHaveBeenCalled();
      expect(mockPrisma.ipo.create).toHaveBeenCalled();
      expect(mockPrisma.fieldProvenance.create).toHaveBeenCalled();
      expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
    });

    it('publishes IPO when validation passes', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        company: { legalName: 'TEST ENTERPRISES LIMITED', displayName: 'TEST ENTERPRISES LIMITED' },
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'OPEN',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
        priceBandLow: 100,
        priceBandHigh: 110,
        lotSize: 100,
        issueSize: 1000000,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: 10,
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-09-10') },
          { eventType: 'CLOSE', eventDate: new Date('2026-09-15') },
        ],
        documents: [],
        allotmentConfig: null,
        sourceIdentities: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      mockPrisma.ipo.update.mockResolvedValueOnce({
        id: 'ipo-uuid-1',
        publicationStatus: PublicationStatus.PUBLISHED,
      });

      const res = await adminIpoService.publishIpo('ipo-uuid-1');

      expect(res.publicationStatus).toBe(PublicationStatus.PUBLISHED);
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith({
        where: { id: 'ipo-uuid-1' },
        data: { publicationStatus: PublicationStatus.PUBLISHED },
      });
    });

    it('configures registrar allotment mapping for an IPO', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({ id: 'ipo-uuid-1' });

      const config = await adminIpoService.configureAllotment('ipo-uuid-1', {
        registrar: 'kfintech',
        registrarIpoCode: 'MANIKA2026',
        enabled: true,
      });

      expect(mockPrisma.ipoAllotmentConfig.upsert).toHaveBeenCalled();
      expect(config.registrar).toBe('kfintech');
    });

    it('enforces ADMIN and IPOGURU source identity filter on listIpos so background discovery IPOs without ADMIN/IPOGURU identity are excluded', async () => {
      await adminIpoService.listIpos({ publicationStatus: 'DRAFT' });

      expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceIdentities: { some: { source: { code: { in: ['ADMIN', 'IPOGURU'] } } } },
            publicationStatus: 'DRAFT',
          }),
        }),
      );
    });

    it('creates ADMIN source identity when a manual IPO is created', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        company: { legalName: 'TEST ENTERPRISES LIMITED' },
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'UPCOMING',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
        lifecycleEvents: [],
        documents: [],
        allotmentConfig: null,
        sourceIdentities: [{ source: { code: 'ADMIN' } }],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adminIpoService.createIpo({
        legalName: 'TEST ENTERPRISES LIMITED',
        symbol: 'TESTENT',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
      });

      expect(mockPrisma.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ipoId_sourceId: {
              ipoId: 'ipo-uuid-1',
              sourceId: 'admin-source-id',
            },
          },
          create: expect.objectContaining({
            ipoId: 'ipo-uuid-1',
            sourceId: 'admin-source-id',
            symbol: 'TESTENT',
          }),
        }),
      );
    });
  });

  describe('Phase 35.6 Data Mapping Verification', () => {
    it('returns top-level allotmentDate and all 4 financial periods from getIpoDetail', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'manika-uuid-1',
        companyId: 'company-manika-1',
        company: {
          legalName: 'Manika Plastech Limited',
          displayName: 'Manika Plastech',
          cin: 'U74999DN1996PLC000469',
          financials: [
            { fiscalPeriod: 'Q1 FY27', totalRevenue: '100.5' },
            { fiscalPeriod: 'FY26', totalRevenue: '350.2' },
            { fiscalPeriod: 'FY25', totalRevenue: '310.0' },
            { fiscalPeriod: 'FY24', totalRevenue: '280.0' },
          ],
        },
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.BOTH,
        status: 'OPEN',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        faceValue: '2',
        freshIssueSize: '92.5',
        ofsShareCount: '7674418',
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-09-11') },
          { eventType: 'CLOSE', eventDate: new Date('2026-09-16') },
          { eventType: 'BASIS_OF_ALLOTMENT', eventDate: new Date('2026-09-17') },
          { eventType: 'LISTING', eventDate: new Date('2026-09-21') },
        ],
        documents: [],
        allotmentConfig: { registrar: 'MUFG_INTIME', registrarIpoCode: null },
        offerCategories: [
          { category: 'QIB', allocationPct: '50' },
          { category: 'NII', allocationPct: '15' },
          { category: 'RETAIL', allocationPct: '35', minLots: null, maxLots: null },
        ],
        participants: [
          { role: 'REGISTRAR', name: 'MUFG Intime India Private Limited' },
          { role: 'BRLM', name: 'Pantomath Capital Advisors Private Limited' },
        ],
        gmpObservations: [],
        subscriptionObservations: [],
        sourceIdentities: [],
      });

      const detail = await adminIpoService.getIpoDetail('manika-uuid-1');

      expect(detail.freshIssueSize).toBe(92.5);
      expect(detail.allotmentDate).toBe('2026-09-17');
      expect(detail.financials).toHaveLength(4);
      expect(detail.financials.map((f: any) => f.fiscalPeriod)).toEqual(['Q1 FY27', 'FY26', 'FY25', 'FY24']);
      expect(detail.priceBandLow).toBeNull();
      expect(detail.priceBandHigh).toBeNull();
      expect(detail.lotSize).toBeNull();
      expect(detail.offerCategories.find((c: any) => c.category === 'RETAIL')?.minLots).toBeNull();
      expect(detail.offerCategories.find((c: any) => c.category === 'RETAIL')?.maxLots).toBeNull();
    });

    it('imports Hero Motors Limited RHP JSON successfully without throwing errors', async () => {
      const fs = require('fs');
      const heroJson = JSON.parse(
        fs.readFileSync('C:/Users/Anish/Downloads/Hero-Motors-Limited-RHP-IPO.json', 'utf8'),
      );

      mockPrisma.ipo.findUnique.mockResolvedValue(null);
      mockPrisma.company.findFirst.mockResolvedValue(null);

      mockPrisma.ipo.create.mockResolvedValue({
        id: 'hero-uuid-1',
        companyId: 'hero-company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.BOTH,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: null,
      });

      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'hero-uuid-1',
        companyId: 'hero-company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.BOTH,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        issueSize: 1000.0,
        freshIssueSize: 600.0,
        ofsSize: 400.0,
        company: {
          id: 'hero-company-uuid-1',
          legalName: 'Hero Motors Limited',
          displayName: 'Hero Motors Limited',
          cin: 'U29299PB1998PLC039602',
          website: 'https://www.heromotors.com',
          financials: [],
        },
        lifecycleEvents: [],
        offerCategories: [],
        participants: [],
        gmpObservations: [],
        subscriptionObservations: [],
        sourceIdentities: [],
      });

      const res = await adminIpoService.importIpoFromJson(heroJson);
      expect(res).toBeDefined();
    });

    it('imports Jindal Supreme (India) Limited RHP JSON successfully, preserving null fields', async () => {
      const fs = require('fs');
      const jindalJson = JSON.parse(
        fs.readFileSync('C:/Users/Anish/Downloads/Jindal-Supreme_RHP-IPO.json', 'utf8'),
      );

      mockPrisma.ipo.findUnique.mockResolvedValue(null);
      mockPrisma.company.findFirst.mockResolvedValue(null);

      mockPrisma.ipo.create.mockResolvedValue({
        id: 'jindal-uuid-1',
        companyId: 'jindal-company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.BOTH,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: null,
      });

      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'jindal-uuid-1',
        companyId: 'jindal-company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.BOTH,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        issueSize: 90.0,
        freshIssueSize: 90.0,
        ofsSize: 0,
        company: {
          id: 'jindal-company-uuid-1',
          legalName: 'Jindal Supreme (India) Limited',
          displayName: 'Jindal Supreme',
          cin: 'U27109HR1974PLC007126',
          financials: [],
        },
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-09-17') },
          { eventType: 'CLOSE', eventDate: new Date('2026-09-21') },
        ],
        offerCategories: [],
        participants: [],
        gmpObservations: [],
        subscriptionObservations: [],
        sourceIdentities: [],
      });

      const res = await adminIpoService.importIpoFromJson(jindalJson);
      expect(res).toBeDefined();
      expect(res.id).toBe('jindal-uuid-1');
      expect(res.publicationStatus).toBe(PublicationStatus.DRAFT);
      expect(mockPrisma.ipo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          publicationStatus: PublicationStatus.DRAFT,
          priceBandLow: null,
          priceBandHigh: null,
          lotSize: null,
        }),
      });
    });

    it('rejects JSON import overwrite when target IPO is PUBLISHED', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'published-ipo-id',
        publicationStatus: PublicationStatus.PUBLISHED,
      });

      await expect(
        adminIpoService.importIpoFromJson(
          {
            company: { legalName: 'Jindal Supreme (India) Limited' },
            ipo: {},
          },
          'published-ipo-id',
        ),
      ).rejects.toThrow('Cannot overwrite a PUBLISHED IPO via JSON import. Unpublish first.');
    });

    it('rejects JSON import overwrite when target IPO is ARCHIVED', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'archived-ipo-id',
        publicationStatus: PublicationStatus.ARCHIVED,
      });

      await expect(
        adminIpoService.importIpoFromJson(
          {
            company: { legalName: 'Jindal Supreme (India) Limited' },
            ipo: {},
          },
          'archived-ipo-id',
        ),
      ).rejects.toThrow('Cannot overwrite a ARCHIVED IPO via JSON import. Unpublish first.');
    });
  });

  describe('IPO Document Link Management & Safety', () => {
    it('saves valid documents and skips documents with empty URLs during update', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-doc-test-1',
        companyId: 'company-uuid-1',
        lifecycleEvents: [],
      });
      mockPrisma.ipoDocument.findMany.mockResolvedValueOnce([
        { id: 'old-doc-1', documentType: 'DRHP', sourceUrl: 'https://example.com/old-drhp.pdf', fileName: 'Old DRHP' },
      ]);

      await adminIpoService.updateIpo('ipo-doc-test-1', {
        documents: [
          { id: 'old-doc-1', documentType: 'DRHP', title: 'Updated DRHP', url: 'https://example.com/new-drhp.pdf' },
          { documentType: 'RHP', title: 'New RHP', url: 'https://example.com/rhp.pdf' },
          { documentType: 'PROSPECTUS', title: 'Empty Prospectus', url: '   ' }, // Should be skipped
        ],
      });

      expect(mockPrisma.ipoDocument.update).toHaveBeenCalledWith({
        where: { id: 'old-doc-1' },
        data: expect.objectContaining({
          documentType: 'DRHP',
          sourceUrl: 'https://example.com/new-drhp.pdf',
          fileName: 'Updated DRHP',
        }),
      });

      expect(mockPrisma.ipoDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ipoId: 'ipo-doc-test-1',
          documentType: 'RHP',
          sourceUrl: 'https://example.com/rhp.pdf',
          fileName: 'New RHP',
          source: 'MANUAL_UPLOAD',
        }),
      });

      // Verification: 2 valid docs processed, 0 empty doc records created
      const createCalls = mockPrisma.ipoDocument.create.mock.calls;
      const createdEmptyUrl = createCalls.some((call: any) => !call[0]?.data?.sourceUrl?.trim());
      expect(createdEmptyUrl).toBe(false);
    });

    it('removes documents when omitted from submitted document list', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-doc-test-2',
        companyId: 'company-uuid-1',
        lifecycleEvents: [],
      });
      mockPrisma.ipoDocument.findMany.mockResolvedValueOnce([
        { id: 'doc-to-keep', documentType: 'DRHP', sourceUrl: 'https://example.com/drhp.pdf' },
        { id: 'doc-to-delete', documentType: 'OTHER', sourceUrl: 'https://example.com/other.pdf' },
      ]);
      mockPrisma.ipoDocument.delete = jest.fn().mockResolvedValue({});

      await adminIpoService.updateIpo('ipo-doc-test-2', {
        documents: [
          { id: 'doc-to-keep', documentType: 'DRHP', title: 'DRHP', url: 'https://example.com/drhp.pdf' },
        ],
      });

      expect(mockPrisma.ipoDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-to-delete' },
      });
    });

    it('preserves uploaded ANCHOR_LIST document with extractionData even when documents array is submitted without ANCHOR_LIST', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-anchor-test-1',
        companyId: 'company-uuid-1',
        lifecycleEvents: [],
      });
      mockPrisma.ipoDocument.findMany.mockResolvedValueOnce([
        { id: 'doc-drhp', documentType: 'DRHP', sourceUrl: 'https://example.com/drhp.pdf' },
        {
          id: 'doc-anchor-list',
          documentType: 'ANCHOR_LIST',
          sourceUrl: null,
          extractionData: {
            anchorInvestors: [{ anchorName: 'Goldman Sachs', sharesAllotted: 50000, amtCr: 2.5 }],
          },
        },
      ]);
      mockPrisma.ipoDocument.delete = jest.fn().mockResolvedValue({});

      await adminIpoService.updateIpo('ipo-anchor-test-1', {
        documents: [
          { id: 'doc-drhp', documentType: 'DRHP', title: 'DRHP', url: 'https://example.com/drhp.pdf' },
        ],
      });

      // Verification: doc-anchor-list MUST NOT be deleted because it contains anchor investor extractionData
      expect(mockPrisma.ipoDocument.delete).not.toHaveBeenCalledWith({
        where: { id: 'doc-anchor-list' },
      });
    });

    it('creates or updates ANCHOR_LIST document when anchorInvestors array is supplied without document URL', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-anchor-test-2',
        companyId: 'company-uuid-1',
        lifecycleEvents: [],
      });
      mockPrisma.ipoDocument.findMany.mockResolvedValueOnce([]);

      await adminIpoService.updateIpo('ipo-anchor-test-2', {
        anchorInvestors: [
          { anchorName: 'Morgan Stanley', sharesAllotted: 100000, amtCr: 5.0 },
        ],
        documents: [
          { documentType: 'DRHP', title: 'DRHP', url: 'https://example.com/drhp.pdf' },
        ],
      });

      // Verification: ANCHOR_LIST document was created with anchor investors extractionData
      expect(mockPrisma.ipoDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipoId: 'ipo-anchor-test-2',
            documentType: 'ANCHOR_LIST',
            extractionData: expect.objectContaining({
              anchorInvestors: expect.arrayContaining([
                expect.objectContaining({ anchorName: 'Morgan Stanley' }),
              ]),
            }),
          }),
        }),
      );
    });
  });

  describe('Allotment Configuration Contract Tests', () => {
    it('1. allows importing JSON with null registrarIpoCode', async () => {
      mockPrisma.company.findFirst.mockResolvedValueOnce({ id: 'c-null-code', legalName: 'Null Code Corp' });
      mockPrisma.company.update.mockResolvedValueOnce({ id: 'c-null-code' });
      mockPrisma.ipo.create.mockResolvedValueOnce({
        id: 'ipo-null-code-1',
        companyId: 'c-null-code',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
      });

      const imported = await adminIpoService.importIpoFromJson({
        companyName: 'Null Code Corp',
        registrar: 'KFINTECH',
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: null,
          enabled: true,
        },
      });

      expect(imported.id).toBe('ipo-null-code-1');
      expect(mockPrisma.ipoAllotmentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            registrar: 'KFINTECH',
            registrarIpoCode: null,
            enabled: true,
          }),
        }),
      );
    });

    it('2. IPO can remain DRAFT with null registrarIpoCode', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-draft-null-code',
        publicationStatus: PublicationStatus.DRAFT,
        status: 'DRAFT',
        companyId: 'company-uuid-1',
        sourceIdentities: [{ source: { sourceType: 'REGISTRAR', code: 'MUFG_INTIME' } }],
        lifecycleEvents: [],
        offerCategories: [],
        participants: [],
        documents: [],
      });
      mockPrisma.ipo.update.mockResolvedValueOnce({
        id: 'ipo-draft-null-code',
        publicationStatus: PublicationStatus.DRAFT,
      });

      const updated = await adminIpoService.updateIpo('ipo-draft-null-code', {
        publicationStatus: PublicationStatus.DRAFT,
        allotmentConfig: {
          registrar: 'MUFG_INTIME',
          registrarIpoCode: undefined,
          enabled: true,
        },
      });

      expect(updated.publicationStatus).toBe(PublicationStatus.DRAFT);
    });

    it('3. IPO can be published with null registrarIpoCode without throwing validation error', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-pub-null-code',
        legalName: 'Test Legal Name',
        publicationStatus: PublicationStatus.DRAFT,
        status: 'OPEN',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        companyId: 'company-uuid-1',
        company: { legalName: 'Test Legal Name' },
        sourceIdentities: [{ source: { sourceType: 'REGISTRAR', code: 'MUFG_INTIME' } }],
        lifecycleEvents: [],
        offerCategories: [],
        participants: [],
        documents: [],
        allotmentConfig: { registrar: 'MUFG_INTIME', registrarIpoCode: null, enabled: true },
      });
      mockPrisma.ipo.update.mockResolvedValue({
        id: 'ipo-pub-null-code',
        publicationStatus: PublicationStatus.PUBLISHED,
      });

      const published = await adminIpoService.publishIpo('ipo-pub-null-code');
      expect(published.publicationStatus).toBe(PublicationStatus.PUBLISHED);
    });

    it('4. preserves leading-zero registrarIpoCode as a string without converting to number', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'c-leading-zero', legalName: 'Leading Zero Corp' }]);
      mockPrisma.company.update.mockResolvedValueOnce({ id: 'c-leading-zero' });
      mockPrisma.ipo.create.mockResolvedValueOnce({
        id: 'ipo-lz-1',
        companyId: 'c-leading-zero',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
      });

      await adminIpoService.importIpoFromJson({
        companyName: 'Leading Zero Corp',
        registrar: 'KFINTECH',
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: '00142',
          enabled: true,
        },
      });

      expect(mockPrisma.ipoAllotmentConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            registrarIpoCode: '00142',
          }),
        }),
      );
    });
  });

  describe('Company Identity & Resolution Safety', () => {
    it('1. resolves successfully when CIN and Legal Name match the same existing company', async () => {
      const existingCompany = {
        id: 'nse-company-1',
        legalName: 'National Stock Exchange of India Limited',
        displayName: 'NSE',
        cin: 'U67120MH1992PLC069769',
      };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.cin) {
          return Promise.resolve([existingCompany]);
        }
        if (args?.where?.legalName) {
          return Promise.resolve([existingCompany]);
        }
        return Promise.resolve([]);
      });

      mockPrisma.company.update.mockResolvedValue(existingCompany);
      mockPrisma.ipo.create.mockResolvedValue({
        id: 'ipo-nse-1',
        companyId: 'nse-company-1',
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
      });

      const res = await adminIpoService.importIpoFromJson({
        company: {
          legalName: 'National Stock Exchange of India Limited',
          cin: 'U67120MH1992PLC069769',
        },
      });

      expect(res).toBeDefined();
      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nse-company-1' },
        }),
      );
    });

    it('2. fails with explicit ambiguity error when CIN and Legal Name match two different existing companies', async () => {
      const companyA = {
        id: 'company-a',
        legalName: 'Old NSE Ltd',
        cin: 'U67120MH1992PLC069769',
      };
      const companyB = {
        id: 'company-b',
        legalName: 'National Stock Exchange of India Limited',
        cin: null,
      };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.cin) {
          return Promise.resolve([companyA]);
        }
        if (args?.where?.legalName) {
          return Promise.resolve([companyB]);
        }
        return Promise.resolve([]);
      });

      await expect(
        adminIpoService.importIpoFromJson({
          company: {
            legalName: 'National Stock Exchange of India Limited',
            cin: 'U67120MH1992PLC069769',
          },
        }),
      ).rejects.toThrow(
        "Ambiguous company match: CIN 'U67120MH1992PLC069769' and Legal Name 'National Stock Exchange of India Limited' match different existing companies.",
      );
    });

    it('3. fails with explicit conflict error when Legal Name matches company with a different conflicting CIN', async () => {
      const companyWithDifferentCin = {
        id: 'company-diff-cin',
        legalName: 'National Stock Exchange of India Limited',
        cin: 'U99999MH1999PLC999999',
      };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.cin) {
          return Promise.resolve([]);
        }
        if (args?.where?.legalName) {
          return Promise.resolve([companyWithDifferentCin]);
        }
        return Promise.resolve([]);
      });

      await expect(
        adminIpoService.importIpoFromJson({
          company: {
            legalName: 'National Stock Exchange of India Limited',
            cin: 'U67120MH1992PLC069769',
          },
        }),
      ).rejects.toThrow(
        "Ambiguous company match: existing company with Legal Name 'National Stock Exchange of India Limited' has CIN 'U99999MH1999PLC999999', which conflicts with supplied CIN 'U67120MH1992PLC069769'.",
      );
    });

    it('4. fails safely with ambiguity error when multiple database records share the same Legal Name', async () => {
      const dup1 = { id: 'dup-1', legalName: 'National Stock Exchange of India Limited', cin: null };
      const dup2 = { id: 'dup-2', legalName: 'National Stock Exchange of India Limited', cin: null };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.legalName) {
          return Promise.resolve([dup1, dup2]);
        }
        return Promise.resolve([]);
      });

      await expect(
        adminIpoService.importIpoFromJson({
          company: {
            legalName: 'National Stock Exchange of India Limited',
          },
        }),
      ).rejects.toThrow(
        "Ambiguous company match: multiple existing companies match Legal Name 'National Stock Exchange of India Limited'.",
      );
    });

    it('5. fails safely with ambiguity error when multiple database records share the same CIN', async () => {
      const dupCin1 = { id: 'dup-cin-1', legalName: 'NSE Corp 1', cin: 'U67120MH1992PLC069769' };
      const dupCin2 = { id: 'dup-cin-2', legalName: 'NSE Corp 2', cin: 'U67120MH1992PLC069769' };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.cin) {
          return Promise.resolve([dupCin1, dupCin2]);
        }
        return Promise.resolve([]);
      });

      await expect(
        adminIpoService.importIpoFromJson({
          company: {
            legalName: 'National Stock Exchange of India Limited',
            cin: 'U67120MH1992PLC069769',
          },
        }),
      ).rejects.toThrow(
        "Ambiguous company match: multiple existing companies match CIN 'U67120MH1992PLC069769'.",
      );
    });

    it('6. resolves case-insensitive and trimmed whitespace differences cleanly', async () => {
      const existingCompany = {
        id: 'nse-case-comp',
        legalName: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED',
        displayName: 'NSE',
        cin: null,
      };

      mockPrisma.company.findMany.mockImplementation((args: any) => {
        if (args?.where?.legalName) {
          return Promise.resolve([existingCompany]);
        }
        return Promise.resolve([]);
      });
      mockPrisma.company.update.mockResolvedValue(existingCompany);
      mockPrisma.ipo.create.mockResolvedValue({
        id: 'ipo-nse-case',
        companyId: 'nse-case-comp',
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
      });

      const res = await adminIpoService.importIpoFromJson({
        company: {
          legalName: '  national stock exchange of india limited  ',
          cin: '  U67120MH1992PLC069769  ',
        },
      });

      expect(res).toBeDefined();
      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'nse-case-comp' },
          data: expect.objectContaining({
            cin: 'U67120MH1992PLC069769',
          }),
        }),
      );
    });
  });

  describe('Transactional IPO Deletion Lifecycle', () => {
    it('1. deletes all IPO-owned child records and deletes orphaned company when no other IPOs reference it', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'del-ipo-1',
        companyId: 'del-comp-1',
        company: { id: 'del-comp-1' },
      });
      mockPrisma.ipo.count.mockResolvedValueOnce(0); // 0 remaining IPOs

      const result = await adminIpoService.deleteIpo('del-ipo-1');

      expect(result).toEqual({
        id: 'del-ipo-1',
        message: 'IPO and associated unshared records deleted permanently.',
      });

      expect(mockPrisma.gmpObservation.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.subscriptionObservation.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoLifecycleEvent.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoOfferCategory.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoParticipant.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoSourceIdentity.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoDocument.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoAllotmentConfig.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.allotmentCheckLog.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.allotmentCheckJobItem.deleteMany).toHaveBeenCalledWith({ where: { job: { ipoId: 'del-ipo-1' } } });
      expect(mockPrisma.allotmentCheckJob.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.ipoChangeEvent.deleteMany).toHaveBeenCalledWith({ where: { ipoId: 'del-ipo-1' } });
      expect(mockPrisma.fieldProvenance.deleteMany).toHaveBeenCalledWith({ where: { entityId: 'del-ipo-1', entityType: 'IPO' } });
      expect(mockPrisma.ipo.delete).toHaveBeenCalledWith({ where: { id: 'del-ipo-1' } });

      // Cleaned unshared company
      expect(mockPrisma.companyFinancial.deleteMany).toHaveBeenCalledWith({ where: { companyId: 'del-comp-1' } });
      expect(mockPrisma.fieldProvenance.deleteMany).toHaveBeenCalledWith({ where: { entityId: 'del-comp-1', entityType: 'COMPANY' } });
      expect(mockPrisma.company.delete).toHaveBeenCalledWith({ where: { id: 'del-comp-1' } });
    });

    it('2. retains company and its financials when other IPOs still reference the company', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'del-ipo-shared',
        companyId: 'del-comp-shared',
        company: { id: 'del-comp-shared' },
      });
      mockPrisma.ipo.count.mockResolvedValueOnce(1); // 1 other IPO remains

      const result = await adminIpoService.deleteIpo('del-ipo-shared');

      expect(result).toEqual({
        id: 'del-ipo-shared',
        message: 'IPO and associated unshared records deleted permanently.',
      });

      expect(mockPrisma.ipo.delete).toHaveBeenCalledWith({ where: { id: 'del-ipo-shared' } });
      expect(mockPrisma.company.delete).not.toHaveBeenCalled();
      expect(mockPrisma.companyFinancial.deleteMany).not.toHaveBeenCalled();
    });

    it('3. throws NotFoundException when deleting a non-existent IPO', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce(null);

      await expect(adminIpoService.deleteIpo('non-existent-id')).rejects.toThrow(
        'IPO with ID non-existent-id not found.',
      );
    });
  });

  describe('Add-Only JSON Import (Preview & Commit)', () => {
    it('1. populates empty/null fields in preview and commit', async () => {
      const existingIpo = {
        id: 'ipo-test-1',
        companyId: 'comp-test-1',
        symbol: 'EMPTYCO',
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        company: {
          id: 'comp-test-1',
          legalName: 'Empty Company Limited',
          displayName: 'Empty Co',
          website: null,
          phone: '',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);

      const inputPayload = {
        companyName: 'Empty Company Limited',
        symbol: 'EMPTYCO',
        website: 'https://emptyco.example.com',
        priceBandMin: 250,
        priceBandMax: 275,
        lotSize: 50,
        openDate: '2026-09-24',
      };

      // Preview test
      const preview = await adminIpoService.previewAddOnlyJsonImport(inputPayload);
      expect(preview.matchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBe(5); // website, priceBandLow, priceBandHigh, lotSize, openDate
      expect(preview.items[0].matchStatus).toBe('MATCHED');

      // Commit test
      const commitResult = await adminIpoService.commitAddOnlyJsonImport(inputPayload);
      expect(commitResult.updatedCount).toBe(1);
      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'comp-test-1' },
        data: expect.objectContaining({
          website: 'https://emptyco.example.com',
        }),
      });
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith({
        where: { id: 'ipo-test-1' },
        data: expect.objectContaining({
          priceBandLow: 250,
          priceBandHigh: 275,
          lotSize: 50,
        }),
      });
    });

    it('2. preserves existing fields and does not overwrite existing values', async () => {
      const existingIpo = {
        id: 'ipo-test-2',
        companyId: 'comp-test-2',
        symbol: 'FILLEDCO',
        priceBandLow: 100,
        priceBandHigh: 110,
        lotSize: 100,
        issueSize: 500,
        company: {
          id: 'comp-test-2',
          legalName: 'Filled Company Limited',
          displayName: 'Filled Co',
          website: 'https://original-website.com',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);

      const inputPayload = {
        companyName: 'Filled Company Limited',
        symbol: 'FILLEDCO',
        website: 'https://new-inbound-website.com', // Should be skipped
        priceBandMin: 999, // Should be skipped
        issueSize: 9999, // Should be skipped
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(inputPayload);
      expect(preview.matchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBe(0);
      expect(preview.items[0].fieldsSkipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'website' }),
          expect.objectContaining({ field: 'priceBandLow' }),
          expect.objectContaining({ field: 'issueSize' }),
        ]),
      );

      const commitResult = await adminIpoService.commitAddOnlyJsonImport(inputPayload);
      expect(commitResult.updatedCount).toBe(0);
      expect(commitResult.skippedCount).toBe(1);
      expect(commitResult.items[0].status).toBe('SKIPPED_NO_CHANGES');
    });

    it('3. strictly preserves 0 and false as existing non-empty values', async () => {
      const existingIpo = {
        id: 'ipo-test-3',
        companyId: 'comp-test-3',
        symbol: 'ZEROCO',
        faceValue: 0, // Explicit zero
        lotSize: 0,
        company: {
          id: 'comp-test-3',
          legalName: 'Zero Co Limited',
          displayName: 'Zero Co',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [
          {
            id: 'cat-1',
            category: 'RETAIL',
            allocationPct: 0,
            isUpiEligible: false, // Explicit false
          },
        ],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);

      const inputPayload = {
        companyName: 'Zero Co Limited',
        symbol: 'ZEROCO',
        ipo: {
          faceValue: 10, // Should be skipped because existing is 0
          lotSize: 50, // Should be skipped because existing is 0
        },
        offerCategories: [
          {
            category: 'RETAIL',
            allocationPct: 35, // Should be skipped because existing is 0
            isUpiEligible: true, // Should be skipped because existing is false
          },
        ],
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(inputPayload);
      expect(preview.matchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBe(0);

      // Verify reasons note explicit 0 / false preservation
      const zeroReasons = preview.items[0].fieldsSkipped.filter((s) =>
        s.reason.includes('0') || s.reason.includes('false'),
      );
      expect(zeroReasons.length).toBeGreaterThanOrEqual(3);
    });

    it('4. does not modify unmatched or ambiguous IPOs', async () => {
      const existingIpos = [
        {
          id: 'ipo-dup-1',
          companyId: 'comp-dup-1',
          company: { id: 'comp-dup-1', legalName: 'Ambiguous Tech Limited', displayName: 'Ambiguous Tech' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-dup-2',
          companyId: 'comp-dup-2',
          company: { id: 'comp-dup-2', legalName: 'Ambiguous Tech Limited', displayName: 'Ambiguous Tech' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(existingIpos);

      const multiPayload = [
        { companyName: 'Ambiguous Tech Limited', lotSize: 50 }, // Ambiguous
        { companyName: 'Completely Unknown Corp', lotSize: 100 }, // Unmatched
      ];

      const preview = await adminIpoService.previewAddOnlyJsonImport(multiPayload);
      expect(preview.totalRecords).toBe(2);
      expect(preview.matchedCount).toBe(0);
      expect(preview.ambiguousCount).toBe(1);
      expect(preview.unmatchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBe(0);

      const commitResult = await adminIpoService.commitAddOnlyJsonImport(multiPayload);
      expect(commitResult.updatedCount).toBe(0);
      expect(commitResult.skippedCount).toBe(2);
      expect(commitResult.items[0].status).toBe('SKIPPED_AMBIGUOUS');
      expect(commitResult.items[1].status).toBe('SKIPPED_UNMATCHED');
    });
  });

  describe('Admin IPO List Sorting & Tab Counts', () => {
    it('1. sorts OPEN ipos by closing date ASC (closing soonest on top)', async () => {
      const ipoOpenFar = {
        id: 'ipo-far',
        company: { legalName: 'Far Close Corp', displayName: 'Far Close' },
        status: 'OPEN',
        publicationStatus: 'PUBLISHED',
        lifecycleEvents: [{ eventType: 'CLOSE', eventDate: new Date('2026-09-30T17:00:00.000Z') }],
        createdAt: new Date('2026-09-01'),
        updatedAt: new Date('2026-09-01'),
      };
      const ipoOpenNear = {
        id: 'ipo-near',
        company: { legalName: 'Near Close Corp', displayName: 'Near Close' },
        status: 'OPEN',
        publicationStatus: 'PUBLISHED',
        lifecycleEvents: [{ eventType: 'CLOSE', eventDate: new Date('2026-09-24T17:00:00.000Z') }],
        createdAt: new Date('2026-09-02'),
        updatedAt: new Date('2026-09-02'),
      };

      mockPrisma.ipo.findMany.mockResolvedValueOnce([ipoOpenFar, ipoOpenNear]).mockResolvedValueOnce([ipoOpenFar, ipoOpenNear]);

      const res = await adminIpoService.listIpos({ status: 'OPEN' });
      expect(res.items.length).toBe(2);
      expect(res.items[0].id).toBe('ipo-near');
      expect(res.items[1].id).toBe('ipo-far');
    });

    it('2. sorts CLOSED ipos by closing date DESC (closed recently on top)', async () => {
      const ipoClosedOld = {
        id: 'ipo-old-closed',
        company: { legalName: 'Old Closed Corp', displayName: 'Old Closed' },
        status: 'CLOSED',
        publicationStatus: 'PUBLISHED',
        lifecycleEvents: [{ eventType: 'CLOSE', eventDate: new Date('2026-08-01T17:00:00.000Z') }],
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01'),
      };
      const ipoClosedRecent = {
        id: 'ipo-recent-closed',
        company: { legalName: 'Recent Closed Corp', displayName: 'Recent Closed' },
        status: 'CLOSED',
        publicationStatus: 'PUBLISHED',
        lifecycleEvents: [{ eventType: 'CLOSE', eventDate: new Date('2026-09-20T17:00:00.000Z') }],
        createdAt: new Date('2026-09-20'),
        updatedAt: new Date('2026-09-20'),
      };

      mockPrisma.ipo.findMany.mockResolvedValueOnce([ipoClosedOld, ipoClosedRecent]).mockResolvedValueOnce([ipoClosedOld, ipoClosedRecent]);

      const res = await adminIpoService.listIpos({ status: 'CLOSED' });
      expect(res.items.length).toBe(2);
      expect(res.items[0].id).toBe('ipo-recent-closed');
      expect(res.items[1].id).toBe('ipo-old-closed');
    });

    it('3. queries CLOSED status', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await adminIpoService.listIpos({ status: 'CLOSED' });
      expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'CLOSED',
          }),
        }),
      );
    });

    it('4. queries ALLOTMENT_PENDING status', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await adminIpoService.listIpos({ status: 'ALLOTMENT_PENDING' });
      expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ALLOTMENT_PENDING',
          }),
        }),
      );
    });

    it('5. queries comma-separated status values properly', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await adminIpoService.listIpos({ status: 'CLOSED,ALLOTMENT_PENDING' });
      expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['CLOSED', 'ALLOTMENT_PENDING'] },
          }),
        }),
      );
    });

    it('6. returns status and publication breakdown counts including ALLOTMENT_PENDING', async () => {
      const ipos = [
        { id: '1', status: 'OPEN', publicationStatus: 'PUBLISHED', lifecycleEvents: [] },
        { id: '2', status: 'UPCOMING', publicationStatus: 'DRAFT', lifecycleEvents: [] },
        { id: '3', status: 'CLOSED', publicationStatus: 'PUBLISHED', lifecycleEvents: [] },
        { id: '4', status: 'ALLOTMENT_PENDING', publicationStatus: 'PUBLISHED', lifecycleEvents: [] },
        { id: '5', status: 'ALLOTMENT_COMPLETED', publicationStatus: 'PUBLISHED', lifecycleEvents: [] },
        { id: '6', status: 'LISTED', publicationStatus: 'PUBLISHED', lifecycleEvents: [] },
      ];

      mockPrisma.ipo.findMany.mockResolvedValueOnce(ipos).mockResolvedValueOnce(ipos);

      const res = await adminIpoService.listIpos({});
      expect(res.counts).toBeDefined();
      expect(res.counts.statuses.ALL).toBe(6);
      expect(res.counts.statuses.OPEN).toBe(1);
      expect(res.counts.statuses.UPCOMING).toBe(1);
      expect(res.counts.statuses.CLOSED).toBe(1);
      expect(res.counts.statuses.ALLOTMENT_PENDING).toBe(1);
      expect(res.counts.statuses.ALLOTMENT_COMPLETED).toBe(1);
      expect(res.counts.statuses.LISTED).toBe(1);
      expect(res.counts.publication.PUBLISHED).toBe(5);
      expect(res.counts.publication.DRAFT).toBe(1);
    });
  });
});
