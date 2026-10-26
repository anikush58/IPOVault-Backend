import { Test, TestingModule } from '@nestjs/testing';
import { AdminIpoService } from './admin-ipo.service';
import { AdminValidationService } from './admin-validation.service';
import { AdminProvenanceResolver } from './admin-provenance.resolver';
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
      findUnique: jest.fn().mockImplementation(async () => ({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
        company: {
          id: 'company-uuid-1',
          legalName: 'TEST ENTERPRISES LIMITED',
          displayName: 'TEST ENTERPRISES LIMITED',
          cin: 'U27109HR1974PLC007126',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      })),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({
        id: 'ipo-uuid-1',
        companyId: 'company-uuid-1',
        marketSegment: MarketSegment.MAINBOARD,
        exchange: ExchangeListing.NSE,
        status: 'DRAFT',
        publicationStatus: PublicationStatus.DRAFT,
        symbol: 'TESTENT',
        company: {
          id: 'company-uuid-1',
          legalName: 'TEST ENTERPRISES LIMITED',
          displayName: 'TEST ENTERPRISES LIMITED',
          cin: 'U27109HR1974PLC007126',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      })),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({
        id: 'ipo-uuid-1',
        publicationStatus: PublicationStatus.DRAFT,
      }),
      delete: jest.fn().mockResolvedValue({ id: 'ipo-uuid-1' }),
    },
    ipoLifecycleEvent: {
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    companyFinancial: {
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoOfferCategory: {
      upsert: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoParticipant: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoAllotmentConfig: {
      upsert: jest.fn().mockResolvedValue({ registrar: 'kfintech', registrarIpoCode: 'MANIKA2026', enabled: true }),
      create: jest.fn().mockResolvedValue({ registrar: 'kfintech', registrarIpoCode: 'MANIKA2026', enabled: true }),
      update: jest.fn().mockResolvedValue({ registrar: 'kfintech', registrarIpoCode: 'MANIKA2026', enabled: true }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoDocument: {
      create: jest.fn().mockResolvedValue({ id: 'doc-uuid-1', parsingStatus: 'PARSED' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'doc-uuid-1' }),
      upsert: jest.fn().mockResolvedValue({ id: 'doc-uuid-1', parsingStatus: 'PARSED' }),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    gmpObservation: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    subscriptionObservation: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    fieldProvenance: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ipoSourceIdentity: {
      upsert: jest.fn().mockResolvedValue({ id: 'source-id-1' }),
      create: jest.fn().mockResolvedValue({ id: 'source-id-1' }),
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
        AdminProvenanceResolver,
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

    it('5. imports full Master JSON format and fills missing canonical fields, financials, and anchors', async () => {
      const existingIpo = {
        id: 'ipo-master-1',
        companyId: 'comp-master-1',
        symbol: 'MASTERCO',
        isin: null,
        nseSymbol: null,
        bseSymbol: null,
        priceBandLow: null,
        priceBandHigh: null,
        faceValue: null,
        lotSize: null,
        issueSize: null,
        preIpoEps: null,
        postIpoEps: null,
        preIpoPe: null,
        postIpoPe: null,
        preIpoPromoterHolding: null,
        postIpoPromoterHolding: null,
        company: {
          id: 'comp-master-1',
          legalName: 'Master Technologies Limited',
          displayName: 'Master Technologies',
          cin: 'U72200MH2020PLC123456',
          aboutDescription: null,
          industry: null,
          sector: null,
          financials: [
            {
              id: 'fin-fy24',
              fiscalPeriod: 'FY24',
              periodType: 'ANNUAL',
              totalRevenue: 100,
              pat: 15,
              ebitda: null, // missing field in existing
              eps: null,
            },
          ],
        },
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-10-10') },
        ],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);

      const masterJsonPayload = {
        companyName: 'Master Technologies Limited',
        symbol: 'MASTERCO',
        isin: 'INE123M01010',
        nseSymbol: 'MASTERCO',
        bseSymbol: '543210',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        priceBandMin: 200,
        priceBandMax: 215,
        lotSize: 65,
        faceValue: 10,
        issueSize: 500,
        preIpoEps: 12.5,
        postIpoEps: 10.2,
        preIpoPe: 16.0,
        postIpoPe: 19.6,
        preIpoPromoterHolding: 85.5,
        postIpoPromoterHolding: 65.0,
        aboutDescription: 'Leading tech solutions provider',
        industry: 'Software',
        sector: 'Technology',
        openDate: '2026-10-10', // exact match with existing OPEN
        closeDate: '2026-10-14', // new lifecycle event
        refundInitiationDate: '2026-10-16', // refund date
        creditToDematDate: '2026-10-19', // demat credit
        retailMinLots: 1,
        retailMaxLots: 13,
        retailMinAmount: 13975,
        leadManager: ['Alpha Capital Limited', 'Beta Securities'],
        registrar: 'kfintech',
        financials: [
          {
            fiscalPeriod: 'FY24',
            periodType: 'ANNUAL',
            revenue: 100, // exact match (UNCHANGED)
            pat: 15, // exact match (UNCHANGED)
            ebitda: 25, // fills missing
            eps: 5.5, // fills missing
          },
          {
            fiscalPeriod: 'FY25',
            periodType: 'ANNUAL',
            revenue: 150, // new period
            pat: 25,
            ebitda: 40,
          },
        ],
        anchorInvestors: [
          {
            anchorName: 'Goldman Sachs Funds',
            sharesAllotted: 50000,
            amtCr: 10.75,
          },
        ],
        strengths: ['Strong market share', 'Robust balance sheet'],
        risks: ['Customer concentration risk'],
        objectsOfIssue: ['Capex financing', 'General corporate purposes'],
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(masterJsonPayload);
      expect(preview.matchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBeGreaterThan(10);
      expect(preview.items[0].fieldReport).toBeDefined();

      const filledStatuses = preview.items[0].fieldReport!.filter((r) => r.status === 'FILLED');
      const unchangedStatuses = preview.items[0].fieldReport!.filter((r) => r.status === 'UNCHANGED');
      expect(filledStatuses.length).toBeGreaterThan(0);
      expect(unchangedStatuses.length).toBeGreaterThan(0);

      const commit = await adminIpoService.commitAddOnlyJsonImport(masterJsonPayload);
      expect(commit.updatedCount).toBe(1);
      expect(commit.items[0].status).toBe('UPDATED');
      expect(commit.items[0].fieldsFilledCount).toBeGreaterThan(0);
    });

    it('6. strictly preserves existing values and marks conflicts without mutating data', async () => {
      const existingIpo = {
        id: 'ipo-conflict-1',
        companyId: 'comp-conflict-1',
        symbol: 'CONFLICTCO',
        isin: 'INE999C01019',
        priceBandLow: 100,
        priceBandHigh: 110,
        lotSize: 50,
        issueSize: 200,
        company: {
          id: 'comp-conflict-1',
          legalName: 'Conflict Co Limited',
          displayName: 'Conflict Co',
          cin: 'U11111MH2020PLC111111',
          aboutDescription: 'Official description from RHP',
          financials: [
            {
              id: 'fin-1',
              fiscalPeriod: 'FY24',
              periodType: 'ANNUAL',
              totalRevenue: 500,
              pat: 50,
            },
          ],
        },
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-10-01') },
        ],
        allotmentConfig: { registrar: 'linkintime' },
        offerCategories: [
          { id: 'cat-1', category: 'RETAIL', minLots: 1, maxLots: 13, allocationPct: 35 },
        ],
        documents: [],
        participants: [],
        gmpObservations: [{ gmpAmount: 25 }],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);

      const conflictingIncoming = {
        companyName: 'Conflict Co Limited',
        symbol: 'CONFLICTCO',
        priceBandLow: 150, // Conflicting (differs from 100)
        priceBandHigh: 110, // Exact match (UNCHANGED)
        lotSize: 100, // Conflicting (differs from 50)
        aboutDescription: 'Different description', // Conflicting
        openDate: '2026-10-01', // Exact match (UNCHANGED)
        registrar: 'kfintech', // Conflicting (differs from linkintime)
        financials: [
          {
            fiscalPeriod: 'FY24',
            periodType: 'ANNUAL',
            revenue: 999, // Conflicting (differs from 500)
            pat: 50, // Exact match (UNCHANGED)
          },
        ],
        gmpAmount: 50, // Conflicting (differs from 25)
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(conflictingIncoming);
      expect(preview.matchedCount).toBe(1);

      const conflicts = preview.items[0].fieldReport!.filter((r) => r.status === 'CONFLICT');
      const unchanged = preview.items[0].fieldReport!.filter((r) => r.status === 'UNCHANGED');

      expect(conflicts.length).toBeGreaterThanOrEqual(4);
      expect(unchanged.length).toBeGreaterThanOrEqual(2);

      // Verify reasons explain mutation prevention
      const conflictReasons = conflicts.map((c) => c.reason);
      expect(conflictReasons.some((r) => r && r.includes('mutation prevented'))).toBe(true);
    });

    it('7. skips [●], NIL, N/A, and null values without converting them into 0 or overwriting data', async () => {
      const existingIpo = {
        id: 'ipo-nil-1',
        companyId: 'comp-nil-1',
        symbol: 'NILTEST',
        priceBandLow: 100,
        priceBandHigh: 110,
        preIpoEps: 15.5,
        company: {
          id: 'comp-nil-1',
          legalName: 'Nil Test Limited',
          displayName: 'Nil Test',
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

      const placeholderIncoming = {
        companyName: 'Nil Test Limited',
        symbol: 'NILTEST',
        priceBandLow: '[●]', // Placeholder -> SKIP
        priceBandHigh: 'NIL', // Placeholder -> SKIP
        preIpoEps: 'N/A', // Placeholder -> SKIP
        postIpoEps: '-', // Placeholder -> SKIP
        issueSize: 'TBD', // Placeholder -> SKIP
        aboutDescription: null, // Null -> UNAVAILABLE
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(placeholderIncoming);
      expect(preview.matchedCount).toBe(1);
      expect(preview.fieldsToFillTotal).toBe(0);

      const skippedOrUnavailable = preview.items[0].fieldReport!.filter(
        (r) => r.status === 'SKIPPED' || r.status === 'UNAVAILABLE',
      );
      expect(skippedOrUnavailable.length).toBeGreaterThanOrEqual(5);
    });

    it('8. safe matching resolves by ISIN and rejects ambiguous match with SKIPPED_AMBIGUOUS', async () => {
      const existingIpos = [
        {
          id: 'ipo-isin-1',
          isin: 'INE000A01010',
          company: { legalName: 'ISIN Match Alpha Limited', displayName: 'ISIN Match Alpha' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-isin-2',
          isin: 'INE000B01010',
          company: { legalName: 'ISIN Match Beta Limited', displayName: 'ISIN Match Beta' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(existingIpos);

      // Test 1: Match by ISIN
      const isinMatch = await adminIpoService.previewAddOnlyJsonImport({
        companyName: 'Different Display Name',
        isin: 'INE000A01010',
        lotSize: 50,
      });
      expect(isinMatch.matchedCount).toBe(1);
      expect(isinMatch.items[0].matchedIpoId).toBe('ipo-isin-1');

      // Test 2: Ambiguous matching on duplicated CIN
      const dupCinIpos = [
        {
          id: 'ipo-cin-1',
          company: { cin: 'U12345MH2020PLC111111', legalName: 'CIN Dup 1' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-cin-2',
          company: { cin: 'U12345MH2020PLC111111', legalName: 'CIN Dup 2' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
      ];
      mockPrisma.ipo.findMany.mockResolvedValue(dupCinIpos);

      const cinDupPreview = await adminIpoService.previewAddOnlyJsonImport({
        company: { cin: 'U12345MH2020PLC111111' },
        lotSize: 50,
      });
      expect(cinDupPreview.ambiguousCount).toBe(1);
      expect(cinDupPreview.items[0].matchStatus).toBe('AMBIGUOUS');
    });

    it('9. bulkImportMasterJson processes multiple IPO JSONs independently and returns consolidated result with per-IPO status', async () => {
      const existingIpos = [
        {
          id: 'ipo-bulk-1',
          companyId: 'comp-bulk-1',
          symbol: 'BULKONE',
          priceBandLow: null,
          company: {
            id: 'comp-bulk-1',
            legalName: 'Bulk One Limited',
            displayName: 'Bulk One',
            cin: 'U11111MH2020PLC111111',
            financials: [],
          },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-dup-a',
          company: { cin: 'U22222MH2020PLC222222', legalName: 'Dup A' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-dup-b',
          company: { cin: 'U22222MH2020PLC222222', legalName: 'Dup B' },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(existingIpos);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpos[0]);

      const bulkPayload = [
        {
          company: { cin: 'U11111MH2020PLC111111' },
          priceBandLow: 120,
        },
        {
          companyName: 'Totally NonExistent Corp',
          symbol: 'NONEXISTENT',
        },
        {
          company: { cin: 'U22222MH2020PLC222222' },
          lotSize: 50,
        },
      ];

      const result = await adminIpoService.bulkImportMasterJson(bulkPayload);

      expect(result.totalRecords).toBe(3);
      expect(result.updatedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
      expect(result.failedCount).toBe(0);

      expect(result.items[0].status).toBe('UPDATED');
      expect(result.items[0].fieldsFilledCount).toBeGreaterThan(0);
      expect(result.items[0].fieldReport).toBeDefined();

      expect(result.items[1].status).toBe('SKIPPED_UNMATCHED');
      expect(result.items[2].status).toBe('SKIPPED_AMBIGUOUS');
    });

    it('10. bulkImportMasterJson ensures a failure in one IPO record does not block remaining valid records', async () => {
      const existingIpos = [
        {
          id: 'ipo-err-1',
          companyId: 'comp-err-1',
          symbol: 'ERRCO',
          company: {
            id: 'comp-err-1',
            legalName: 'Error Co Limited',
            displayName: 'Error Co',
            cin: 'U33333MH2020PLC333333',
            financials: [],
          },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
        {
          id: 'ipo-ok-2',
          companyId: 'comp-ok-2',
          symbol: 'OKCO',
          company: {
            id: 'comp-ok-2',
            legalName: 'OK Co Limited',
            displayName: 'OK Co',
            cin: 'U44444MH2020PLC444444',
            financials: [],
          },
          lifecycleEvents: [],
          allotmentConfig: null,
          offerCategories: [],
          documents: [],
          participants: [],
          gmpObservations: [],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(existingIpos);
      mockPrisma.ipo.findUniqueOrThrow
        .mockRejectedValueOnce(new Error('Simulated DB connection timeout during transaction'))
        .mockResolvedValueOnce(existingIpos[1]);

      const bulkPayload = [
        {
          company: { cin: 'U33333MH2020PLC333333' },
          priceBandLow: 100,
        },
        {
          company: { cin: 'U44444MH2020PLC444444' },
          priceBandLow: 200,
        },
      ];

      const result = await adminIpoService.bulkImportMasterJson(bulkPayload);

      expect(result.totalRecords).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.updatedCount).toBe(1);

      expect(result.items[0].status).toBe('FAILED');
      expect(result.items[0].error).toContain('Simulated DB connection timeout');

      expect(result.items[1].status).toBe('UPDATED');
      expect(result.items[1].fieldsFilledCount).toBeGreaterThan(0);
    });

    it('11. Master JSON Import: multi-period financials mapping (patNetProfit -> pat, roe -> roePercentage, roce -> rocePercentage, patMargin -> patMarginPercent, ebitdaMargin -> ebitdaMarginPercent, QUARTERLY vs ANNUAL inference)', async () => {
      const existingIpo: any = {
        id: 'ipo-hd-fire-1',
        companyId: 'comp-hd-fire',
        symbol: 'HDFIRE',
        company: {
          id: 'comp-hd-fire',
          legalName: 'HD Fire Protect Limited',
          displayName: 'HD Fire Protect',
          cin: 'U29299MH1983PLC030282',
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

      const payload = {
        ipo: {
          canonical: {
            symbol: 'HDFIRE',
          },
          company: {
            legalName: 'HD Fire Protect Limited',
            cin: 'U29299MH1983PLC030282',
          },
          financials: [
            {
              fiscalPeriod: 'FY22',
              totalAssets: 100.5,
              totalRevenue: 80.0,
              patNetProfit: 12.3,
              ebitda: 18.5,
              netWorth: 60.2,
              roe: 15.4,
              roce: 18.2,
              eps: 4.5,
              patMargin: 15.37,
              ebitdaMargin: 23.12,
            },
            {
              fiscalPeriod: 'FY23',
              periodType: 'ANNUAL',
              totalAssets: 120.0,
              totalRevenue: 95.0,
              pat: 15.0,
              ebitda: 22.0,
              netWorth: 75.0,
              roePercentage: 16.0,
              rocePercentage: 20.0,
              eps: 5.2,
              patMarginPercent: 15.78,
              ebitdaMarginPercent: 23.15,
            },
            {
              fiscalPeriod: 'Q1 FY25',
              totalAssets: 135.0,
              totalRevenue: 30.0,
              patNetProfit: 4.8,
              ebitda: 7.2,
              netWorth: 82.0,
              roe: 17.1,
              roce: 21.3,
              eps: 1.6,
              patMargin: 16.0,
              ebitdaMargin: 24.0,
            },
            {
              fiscalPeriod: '6M FY25',
              periodType: 'QUARTERLY',
              totalAssets: 140.0,
              totalRevenue: 62.0,
              patNetProfit: 9.9,
              ebitda: 14.5,
              netWorth: 88.0,
              roe: 17.5,
              roce: 21.8,
              eps: 3.3,
              patMargin: 15.96,
              ebitdaMargin: 23.38,
            },
          ],
        },
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(payload);
      expect(preview.items[0].matchStatus).toBe('MATCHED');
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('FY22 (ANNUAL)'))).toBe(true);
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('FY23 (ANNUAL)'))).toBe(true);
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('Q1 FY25 (QUARTERLY)'))).toBe(true);
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('6M FY25 (QUARTERLY)'))).toBe(true);

      const commit = await adminIpoService.commitAddOnlyJsonImport(payload);
      expect(commit.updatedCount).toBe(1);
      expect(mockPrisma.companyFinancial.create).toHaveBeenCalledTimes(4);
      expect(mockPrisma.companyFinancial.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fiscalPeriod: 'Q1 FY25',
          periodType: 'QUARTERLY',
          pat: 4.8,
          roePercentage: 17.1,
          rocePercentage: 21.3,
          patMarginPercent: 16.0,
          ebitdaMarginPercent: 24.0,
        }),
      });
    });

    it('12. Master JSON Import: anchor investors extraction and attribute normalization (investorName -> anchorName, amountCr -> amtCr, percentAllocated -> pctAllocated, percentOfIssue -> pctOfIssue)', async () => {
      const existingIpo: any = {
        id: 'ipo-acme-anchor',
        companyId: 'comp-acme-anchor',
        symbol: 'ACMEIND',
        company: {
          id: 'comp-acme-anchor',
          legalName: 'Acme India Industries Limited',
          displayName: 'Acme India',
          cin: 'U24233MH2000PLC123456',
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

      const payload = {
        ipo: {
          canonical: {
            symbol: 'ACMEIND',
          },
          company: {
            legalName: 'Acme India Industries Limited',
            cin: 'U24233MH2000PLC123456',
          },
          anchorInvestors: [
            {
              investorName: 'Goldman Sachs India Equity Fund',
              sharesAllotted: 500000,
              amountCr: 25.5,
              percentAllocated: 30.5,
              percentOfIssue: 10.2,
            },
            {
              anchorName: 'HDFC Mutual Fund',
              sharesAllotted: 400000,
              amtCr: 20.4,
              pctAllocated: 24.4,
              pctOfIssue: 8.16,
            },
          ],
        },
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(payload);
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('Goldman Sachs India Equity Fund'))).toBe(true);
      expect(preview.items[0].fieldsToFill.some((f) => f.field.includes('HDFC Mutual Fund'))).toBe(true);

      const commit = await adminIpoService.commitAddOnlyJsonImport(payload);
      expect(commit.updatedCount).toBe(1);
      expect(mockPrisma.ipoDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentType: 'ANCHOR_LIST',
          extractionData: expect.objectContaining({
            anchorInvestors: expect.arrayContaining([
              expect.objectContaining({
                anchorName: 'Goldman Sachs India Equity Fund',
                sharesAllotted: 500000,
                amtCr: 25.5,
                pctAllocated: 30.5,
                pctOfIssue: 10.2,
              }),
              expect.objectContaining({
                anchorName: 'HDFC Mutual Fund',
                sharesAllotted: 400000,
                amtCr: 20.4,
                pctAllocated: 24.4,
                pctOfIssue: 8.16,
              }),
            ]),
          }),
        }),
      });
    });

    it('13. Master JSON Import: company research (strengths, risks, objectsOfIssue) imported into document extractionData', async () => {
      const existingIpo: any = {
        id: 'ipo-research-test',
        companyId: 'comp-research-test',
        symbol: 'RESEARCHCO',
        company: {
          id: 'comp-research-test',
          legalName: 'Research Co Limited',
          displayName: 'Research Co',
          cin: 'U72200DL2010PLC999888',
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

      const payload = {
        ipo: {
          canonical: {
            symbol: 'RESEARCHCO',
          },
          company: {
            legalName: 'Research Co Limited',
            cin: 'U72200DL2010PLC999888',
            strengths: ['Pan-India distribution network', 'Strong R&D capabilities'],
            risks: ['High dependence on top 5 customers', 'Regulatory compliance changes'],
            objectsOfIssue: ['Funding capital expenditure requirements', 'General corporate purposes'],
          },
          documents: [
            {
              documentType: 'RHP',
              documentTitle: 'Red Herring Prospectus',
              documentUrl: 'https://example.com/researchco-rhp.pdf',
            },
          ],
        },
      };

      const commit = await adminIpoService.commitAddOnlyJsonImport(payload);
      expect(commit.updatedCount).toBe(1);
      expect(mockPrisma.ipoDocument.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          documentType: 'RHP',
          sourceUrl: 'https://example.com/researchco-rhp.pdf',
          extractionData: expect.objectContaining({
            strengths: ['Pan-India distribution network', 'Strong R&D capabilities'],
            risks: ['High dependence on top 5 customers', 'Regulatory compliance changes'],
            objectsOfIssue: ['Funding capital expenditure requirements', 'General corporate purposes'],
          }),
        }),
      });
    });

    it('14. Master JSON Import: SME enum safe normalization (BSE SME -> BSE, NSE Emerge -> NSE, PUBLISHED (...) -> PUBLISHED)', async () => {
      const existingIpo: any = {
        id: 'ipo-sme-test',
        companyId: 'comp-sme-test',
        symbol: 'SMETEST',
        company: {
          id: 'comp-sme-test',
          legalName: 'SME Tech Limited',
          displayName: 'SME Tech',
          cin: 'U72900GJ2021PLC123123',
          financials: [],
        },
        exchange: null,
        marketSegment: null,
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);

      const payload = {
        ipo: {
          canonical: {
            symbol: 'SMETEST',
            exchangeListing: 'BSE SME',
            marketSegment: 'SME',
          },
          company: {
            legalName: 'SME Tech Limited',
            cin: 'U72900GJ2021PLC123123',
          },
        },
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(payload);
      expect(preview.items[0].fieldsToFill.some((f) => f.field === 'exchange' && f.newValue === 'BSE')).toBe(true);
      expect(preview.items[0].fieldsToFill.some((f) => f.field === 'marketSegment' && f.newValue === 'SME')).toBe(true);

      const commit = await adminIpoService.commitAddOnlyJsonImport(payload);
      expect(commit.updatedCount).toBe(1);
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith({
        where: { id: 'ipo-sme-test' },
        data: expect.objectContaining({
          exchange: 'BSE',
          marketSegment: 'SME',
        }),
      });
    });

    it('15. Legacy import-json endpoint compatibility: routes through canonical add-only pipeline', async () => {
      const existingIpo: any = {
        id: 'ipo-legacy-route-test',
        companyId: 'comp-legacy-test',
        symbol: 'LEGACYCO',
        exchange: 'NSE',
        priceBandLow: null,
        priceBandHigh: null,
        publicationStatus: 'DRAFT',
        company: {
          id: 'comp-legacy-test',
          legalName: 'Legacy Co Limited',
          displayName: 'Legacy Co',
          cin: 'U51909WB2018PLC222333',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findFirst.mockResolvedValue(existingIpo);
      mockPrisma.ipo.findUnique.mockResolvedValue(existingIpo);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);
      mockPrisma.company.findFirst.mockResolvedValue(existingIpo.company);
      mockPrisma.company.findMany.mockResolvedValue([existingIpo.company]);

      const legacyPayload = {
        targetIpoId: 'ipo-legacy-route-test',
        legalName: 'Legacy Co Limited',
        cin: 'U51909WB2018PLC222333',
        symbol: 'LEGACYCO',
        priceBandLow: 150,
        priceBandHigh: 160,
      };

      const res = await adminIpoService.importIpoFromJson(legacyPayload);
      expect(res.id).toBe('ipo-legacy-route-test');
      expect(res.publicationStatus).toBe('DRAFT');
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith({
        where: { id: 'ipo-legacy-route-test' },
        data: expect.objectContaining({
          priceBandLow: 150,
          priceBandHigh: 160,
        }),
      });
    });

    it('16. Master JSON Import: HD Fire Protect registrar participant extraction and merge (populates name, phone, email, website and updates existing empty/manual registrar)', async () => {
      // Scenario A: No participant exists yet -> create new REGISTRAR with all 4 fields
      const freshIpo: any = {
        id: 'ipo-hdfire-reg-1',
        companyId: 'comp-hdfire-reg',
        symbol: 'HDFIRE',
        company: {
          id: 'comp-hdfire-reg',
          legalName: 'HD Fire Protect Limited',
          displayName: 'HD Fire Protect',
          cin: 'U29299MH1983PLC030282',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([freshIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(freshIpo);

      const hdFirePayload = {
        ipo: {
          canonical: {
            symbol: 'HDFIRE',
          },
          company: {
            legalName: 'HD Fire Protect Limited',
            cin: 'U29299MH1983PLC030282',
          },
          participants: {
            registrarName: 'MUFG Intime India Private Limited',
            registrarPhone: '+91 22 4918 6000',
            registrarEmail: 'hdfire.ipo@in.mpms.mufg.com',
            registrarWebsite: 'https://in.mpms.mufg.com/',
            leadManagers: ['Interactive Financial Services Limited'],
          },
        },
      };

      const previewA = await adminIpoService.previewAddOnlyJsonImport(hdFirePayload);
      expect(previewA.items[0].fieldsToFill.some((f) => f.field === 'REGISTRAR (NEW PARTICIPANT)')).toBe(true);

      const commitA = await adminIpoService.commitAddOnlyJsonImport(hdFirePayload);
      expect(commitA.updatedCount).toBe(1);
      expect(mockPrisma.ipoParticipant.create).toHaveBeenCalledWith({
        data: {
          ipoId: 'ipo-hdfire-reg-1',
          role: 'REGISTRAR',
          name: 'MUFG Intime India Private Limited',
          phone: '+91 22 4918 6000',
          email: 'hdfire.ipo@in.mpms.mufg.com',
          website: 'https://in.mpms.mufg.com/',
          displayOrder: 1,
        },
      });

      // Scenario B: Existing empty/manual registrar participant exists -> field-level merge updates empty fields without duplicate
      const ipoWithEmptyReg: any = {
        id: 'ipo-hdfire-reg-2',
        companyId: 'comp-hdfire-reg-2',
        symbol: 'HDFIRE',
        company: {
          id: 'comp-hdfire-reg-2',
          legalName: 'HD Fire Protect Limited',
          displayName: 'HD Fire Protect',
          cin: 'U29299MH1983PLC030282',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [
          {
            id: 'part-reg-existing-id',
            ipoId: 'ipo-hdfire-reg-2',
            role: 'REGISTRAR',
            name: '', // Empty manual value
            phone: null,
            email: null,
            website: null,
            displayOrder: 1,
          },
        ],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([ipoWithEmptyReg]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(ipoWithEmptyReg);

      const previewB = await adminIpoService.previewAddOnlyJsonImport(hdFirePayload);
      expect(previewB.items[0].fieldsToFill.some((f) => f.field === 'REGISTRAR.name')).toBe(true);
      expect(previewB.items[0].fieldsToFill.some((f) => f.field === 'REGISTRAR.phone')).toBe(true);
      expect(previewB.items[0].fieldsToFill.some((f) => f.field === 'REGISTRAR.email')).toBe(true);
      expect(previewB.items[0].fieldsToFill.some((f) => f.field === 'REGISTRAR.website')).toBe(true);

      const commitB = await adminIpoService.commitAddOnlyJsonImport(hdFirePayload);
      expect(commitB.updatedCount).toBe(1);
      expect(mockPrisma.ipoParticipant.update).toHaveBeenCalledWith({
        where: { id: 'part-reg-existing-id' },
        data: {
          name: 'MUFG Intime India Private Limited',
          phone: '+91 22 4918 6000',
          email: 'hdfire.ipo@in.mpms.mufg.com',
          website: 'https://in.mpms.mufg.com/',
        },
      });
    });

    it('17. Master JSON Import: timeline.refundInitiationDate extraction and merge (populates REFUND_INITIATION event when empty and preserves existing event)', async () => {
      // Scenario A: DB has no refund date -> imports timeline.refundInitiationDate
      const existingIpoNoRefund: any = {
        id: 'ipo-refund-test-1',
        companyId: 'comp-refund-test-1',
        symbol: 'REFUNDCO',
        company: {
          id: 'comp-refund-test-1',
          legalName: 'Refund Co Limited',
          displayName: 'Refund Co',
          cin: 'U11111MH2020PLC111222',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoNoRefund]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoNoRefund);

      const payloadWithRefund = {
        ipo: {
          canonical: {
            symbol: 'REFUNDCO',
          },
          company: {
            legalName: 'Refund Co Limited',
            cin: 'U11111MH2020PLC111222',
          },
          timeline: {
            openDate: '2026-10-10',
            closeDate: '2026-10-14',
            allotmentDate: '2026-10-15',
            refundInitiationDate: '2026-10-16',
            listingDate: '2026-10-17',
          },
        },
      };

      const previewA = await adminIpoService.previewAddOnlyJsonImport(payloadWithRefund);
      expect(previewA.items[0].fieldsToFill.some((f) => f.field === 'REFUND_INITIATION')).toBe(true);

      const commitA = await adminIpoService.commitAddOnlyJsonImport(payloadWithRefund);
      expect(commitA.updatedCount).toBe(1);
      expect(mockPrisma.ipoLifecycleEvent.upsert).toHaveBeenCalledWith({
        where: {
          ipoId_eventType: {
            ipoId: 'ipo-refund-test-1',
            eventType: 'REFUND_INITIATION',
          },
        },
        create: {
          ipoId: 'ipo-refund-test-1',
          eventType: 'REFUND_INITIATION',
          eventDate: new Date('2026-10-16'),
          sourceId: expect.any(String),
        },
        update: {
          eventDate: new Date('2026-10-16'),
        },
      });

      // Scenario B: DB already has a non-empty refund date -> preserves existing value
      const existingIpoWithRefund: any = {
        id: 'ipo-refund-test-2',
        companyId: 'comp-refund-test-2',
        symbol: 'REFUNDCO',
        company: {
          id: 'comp-refund-test-2',
          legalName: 'Refund Co Limited',
          displayName: 'Refund Co',
          cin: 'U11111MH2020PLC111222',
          financials: [],
        },
        lifecycleEvents: [
          {
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-10-15T00:00:00.000Z'),
          },
        ],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoWithRefund]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoWithRefund);

      const previewB = await adminIpoService.previewAddOnlyJsonImport(payloadWithRefund);
      expect(previewB.items[0].fieldsSkipped.some((f) => f.field === 'REFUND_INITIATION')).toBe(true);
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

  describe('enrichIpoWithAi', () => {
    it('throws NotFoundException when target IPO does not exist', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce(null);

      await expect(
        adminIpoService.enrichIpoWithAi('non-existent-ipo-id'),
      ).rejects.toThrow('IPO with ID \'non-existent-ipo-id\' not found.');
    });

    it('throws BadRequestException if EnrichmentOrchestratorService is not provided', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-1',
        company: { id: 'company-1' },
      });

      await expect(
        adminIpoService.enrichIpoWithAi('ipo-1'),
      ).rejects.toThrow('Enrichment orchestrator service is not available.');
    });

    it('delegates to enrichmentOrchestrator.processIpoEnrichment and returns result with updated IPO', async () => {
      const mockOrchestrator = {
        processIpoEnrichment: jest.fn().mockResolvedValue({
          ipoId: 'ipo-1',
          status: 'COMPLETED',
          missingFieldsDetected: ['aboutDescription', 'industry'],
          enrichedFields: ['aboutDescription', 'industry'],
          skippedFields: [],
          startedAt: '2026-10-07T00:00:00.000Z',
          completedAt: '2026-10-07T00:00:05.000Z',
          durationMs: 5000,
        }),
      };

      const customService = new AdminIpoService(
        mockPrisma as any,
        validationService,
        new AdminProvenanceResolver(),
        mockOrchestrator as any,
      );

      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-1',
        company: { id: 'company-1' },
      });

      jest.spyOn(customService, 'getIpoDetail').mockResolvedValueOnce({
        id: 'ipo-1',
        legalName: 'TEST ENTERPRISES LIMITED',
        company: { id: 'company-1', industry: 'Textiles', aboutDescription: 'Enriched description' },
      } as any);

      const response = await customService.enrichIpoWithAi('ipo-1', true);

      expect(mockOrchestrator.processIpoEnrichment).toHaveBeenCalledWith('ipo-1', {
        forceRefresh: true,
      });
      expect(response.result.status).toBe('COMPLETED');
      expect(response.result.enrichedFields).toEqual(['aboutDescription', 'industry']);
      expect(response.updatedIpo.id).toBe('ipo-1');
    });

    it('handles idempotent rerun when no missing fields remain (returns SKIPPED)', async () => {
      const mockOrchestrator = {
        processIpoEnrichment: jest.fn().mockResolvedValue({
          ipoId: 'ipo-1',
          status: 'SKIPPED',
          missingFieldsDetected: [],
          enrichedFields: [],
          skippedFields: [],
          startedAt: '2026-10-07T00:00:00.000Z',
          completedAt: '2026-10-07T00:00:00.100Z',
          durationMs: 100,
        }),
      };

      const customService = new AdminIpoService(
        mockPrisma as any,
        validationService,
        new AdminProvenanceResolver(),
        mockOrchestrator as any,
      );

      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-1',
        company: { id: 'company-1' },
      });

      jest.spyOn(customService, 'getIpoDetail').mockResolvedValueOnce({
        id: 'ipo-1',
        legalName: 'TEST ENTERPRISES LIMITED',
      } as any);

      const response = await customService.enrichIpoWithAi('ipo-1', false);

      expect(response.result.status).toBe('SKIPPED');
      expect(response.result.missingFieldsDetected).toEqual([]);
    });

    it('returns failure reason cleanly when document cannot be resolved', async () => {
      const mockOrchestrator = {
        processIpoEnrichment: jest.fn().mockResolvedValue({
          ipoId: 'ipo-1',
          status: 'DOCUMENT_UNRESOLVED',
          missingFieldsDetected: ['aboutDescription'],
          enrichedFields: [],
          skippedFields: ['aboutDescription'],
          startedAt: '2026-10-07T00:00:00.000Z',
          completedAt: '2026-10-07T00:00:01.000Z',
          durationMs: 1000,
          error: 'No official SEBI or SME document found for this IPO',
        }),
      };

      const customService = new AdminIpoService(
        mockPrisma as any,
        validationService,
        new AdminProvenanceResolver(),
        mockOrchestrator as any,
      );

      mockPrisma.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-1',
        company: { id: 'company-1' },
      });

      jest.spyOn(customService, 'getIpoDetail').mockResolvedValueOnce({
        id: 'ipo-1',
      } as any);

      const response = await customService.enrichIpoWithAi('ipo-1', false);

      expect(response.result.status).toBe('DOCUMENT_UNRESOLVED');
      expect(response.result.error).toBe('No official SEBI or SME document found for this IPO');
    });
  });

  describe('Confirmed IPO JSON Import & Provenance Fixes (Regression Suite)', () => {
    // 1. Tonbo Imaging India: freshIssueSize=0 and offerForSaleSize=852.18
    it('handles Tonbo issue sizes: conflict in fill-only mode, authoritative overwrite in overwrite mode', async () => {
      const tonboExistingIpo: any = {
        id: 'ipo-tonbo-id',
        companyId: 'company-tonbo-id',
        symbol: 'TONBO',
        freshIssueSize: 852.18,
        ofsSize: 0,
        company: {
          id: 'company-tonbo-id',
          legalName: 'Tonbo Imaging India Limited',
          displayName: 'Tonbo Imaging India',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const tonboIncoming = {
        company: {
          legalName: 'Tonbo Imaging India Limited',
          displayName: 'Tonbo Imaging India',
        },
        canonical: {
          freshIssueSize: 0,
          offerForSaleSize: 852.18,
        },
      };

      mockPrisma.ipo.findMany.mockResolvedValue([tonboExistingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(tonboExistingIpo);

      // A. Default Fill-Only Mode Preview: both differ, so marked as CONFLICT and preserved
      const previewFill = await adminIpoService.previewAddOnlyJsonImport(tonboIncoming, false);
      expect(previewFill.mode).toBe('FILL_MISSING');
      expect(previewFill.fieldsToFillTotal).toBe(0);
      expect(previewFill.fieldsToOverwriteTotal).toBe(0);
      expect(previewFill.items[0].fieldsSkipped.some((s) => s.field === 'freshIssueSize' && s.status === 'CONFLICT')).toBe(true);
      expect(previewFill.items[0].fieldsSkipped.some((s) => s.field === 'ofsSize' && s.status === 'CONFLICT')).toBe(true);

      // B. Authoritative Overwrite Mode Preview: marked as OVERWRITTEN with before & after values
      const previewOvr = await adminIpoService.previewAddOnlyJsonImport(tonboIncoming, true);
      expect(previewOvr.mode).toBe('AUTHORITATIVE_OVERWRITE');
      expect(previewOvr.fieldsToOverwriteTotal).toBe(2);
      const freshDiff = previewOvr.items[0].fieldsToFill.find((f) => f.field === 'freshIssueSize');
      expect(freshDiff).toBeDefined();
      expect(freshDiff?.status).toBe('OVERWRITTEN');
      expect(freshDiff?.oldValue).toBe(852.18);
      expect(freshDiff?.newValue).toBe(0);

      const ofsDiff = previewOvr.items[0].fieldsToFill.find((f) => f.field === 'ofsSize');
      expect(ofsDiff).toBeDefined();
      expect(ofsDiff?.status).toBe('OVERWRITTEN');
      expect(ofsDiff?.oldValue).toBe(0);
      expect(ofsDiff?.newValue).toBe(852.18);

      // C. Commit in Authoritative Overwrite Mode
      mockPrisma.ipo.update.mockClear();
      const commitRes = await adminIpoService.commitAddOnlyJsonImport(
        { payload: tonboIncoming, overwriteExisting: true },
      );
      expect(commitRes.updatedCount).toBe(1);
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-tonbo-id' },
          data: expect.objectContaining({
            freshIssueSize: 0,
            ofsSize: 852.18,
          }),
        }),
      );
    });

    // 2. Ravita refund date: 2026-10-19 -> 2026-10-20
    it('handles Ravita refund date: conflict in fill mode, update in overwrite mode', async () => {
      const ravitaExistingIpo: any = {
        id: 'ipo-ravita-id',
        companyId: 'company-ravita-id',
        symbol: 'RAVITA',
        company: {
          id: 'company-ravita-id',
          legalName: 'Ravita Engineering Services Limited',
          displayName: 'Ravita Engineering Services',
          financials: [],
        },
        lifecycleEvents: [
          {
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-10-19T00:00:00.000Z'),
          },
        ],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const ravitaIncoming = {
        company: {
          legalName: 'Ravita Engineering Services Limited',
          displayName: 'Ravita Engineering Services',
        },
        timeline: {
          refundInitiationDate: '2026-10-20',
        },
      };

      mockPrisma.ipo.findMany.mockResolvedValue([ravitaExistingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(ravitaExistingIpo);

      // Default fill mode: conflict
      const fillPreview = await adminIpoService.previewAddOnlyJsonImport(ravitaIncoming, false);
      expect(fillPreview.items[0].fieldsSkipped.some((s) => s.field === 'REFUND_INITIATION' && s.status === 'CONFLICT')).toBe(true);

      // Overwrite mode: overwritten
      const ovrPreview = await adminIpoService.previewAddOnlyJsonImport(ravitaIncoming, true);
      const refundDiff = ovrPreview.items[0].fieldsToFill.find((f) => f.field === 'REFUND_INITIATION');
      expect(refundDiff).toBeDefined();
      expect(refundDiff?.status).toBe('OVERWRITTEN');
      expect(refundDiff?.oldValue).toBe('2026-10-19');
      expect(refundDiff?.newValue).toBe('2026-10-20');

      // Commit in overwrite mode: updates lifecycle event date
      mockPrisma.ipoLifecycleEvent.upsert.mockClear();
      await adminIpoService.commitAddOnlyJsonImport({ payload: ravitaIncoming, overwriteExisting: true });
      expect(mockPrisma.ipoLifecycleEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ipoId_eventType: {
              ipoId: 'ipo-ravita-id',
              eventType: 'REFUND_INITIATION',
            },
          },
          update: expect.objectContaining({
            eventDate: new Date('2026-10-20'),
          }),
        }),
      );
    });

    // 3. Nested field provenance creation
    it('creates field-level provenance records for nested Master JSON fields', async () => {
      const existingIpoForProv: any = {
        id: 'ipo-prov-id',
        companyId: 'company-prov-id',
        company: {
          id: 'company-prov-id',
          legalName: 'Prov Test Corp Limited',
          displayName: 'Prov Test Corp',
          cin: null,
          financials: [],
        },
        freshIssueSize: null,
        ofsSize: null,
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const incomingMasterJson = {
        company: {
          legalName: 'Prov Test Corp Limited',
          displayName: 'Prov Test Corp',
          cin: 'U72900KA2020PTC134567',
        },
        canonical: {
          freshIssueSize: 50.5,
          offerForSaleSize: 20.0,
        },
        valuation: {
          preIpoEps: 4.25,
        },
        timeline: {
          refundInitiationDate: '2026-11-05',
        },
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoForProv]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoForProv);
      mockPrisma.fieldProvenance.create.mockClear();

      const commitRes = await adminIpoService.commitAddOnlyJsonImport(incomingMasterJson);
      expect(commitRes.updatedCount).toBe(1);

      // Check that fieldProvenance.create was called with the canonical field names
      const provenanceCalls = mockPrisma.fieldProvenance.create.mock.calls.map((c) => c[0].data);
      expect(provenanceCalls.some((p) => p.fieldName === 'fresh_issue_size' && p.value === '50.5')).toBe(true);
      expect(provenanceCalls.some((p) => p.fieldName === 'ofs_size' && p.value === '20')).toBe(true);
      expect(provenanceCalls.some((p) => (p.fieldName === 'cin' || p.fieldName === 'company.cin') && p.value === 'U72900KA2020PTC134567')).toBe(true);
      expect(provenanceCalls.some((p) => p.fieldName === 'refund_date' && p.value === '2026-11-05')).toBe(true);
    });

    // 4. Research sources ingestion
    it('safely ingests research.sources into IpoDocument without marking fields verified falsely', async () => {
      const existingIpoForResearch: any = {
        id: 'ipo-research-id',
        companyId: 'company-research-id',
        company: {
          id: 'company-research-id',
          legalName: 'Research Sources Corp Limited',
          displayName: 'Research Sources Corp',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const incomingWithResearch = {
        company: {
          legalName: 'Research Sources Corp Limited',
        },
        research: {
          sources: [
            { title: 'NSE India Official Filing', url: 'https://www.nseindia.com/ipo/test' },
            { title: 'Chittorgarh Review', url: 'https://www.chittorgarh.com/ipo/test' },
          ],
        },
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoForResearch]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoForResearch);
      mockPrisma.ipoDocument.create.mockClear();

      await adminIpoService.commitAddOnlyJsonImport({
        payload: incomingWithResearch,
        overwriteExisting: false,
      });

      expect(mockPrisma.ipoDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipoId: 'ipo-research-id',
            documentType: 'OTHER',
            fileName: 'Research Sources',
            source: 'MASTER_JSON_IMPORT',
            extractionData: expect.objectContaining({
              sources: expect.arrayContaining([
                expect.objectContaining({ title: 'NSE India Official Filing', url: 'https://www.nseindia.com/ipo/test' }),
              ]),
            }),
          }),
        }),
      );
    });

    // 5. Zero preservation in import
    it('preserves 0 as a valid numeric value rather than null/undefined', async () => {
      const existingIpoWithNullFresh: any = {
        id: 'ipo-zero-id',
        companyId: 'company-zero-id',
        freshIssueSize: null,
        company: {
          id: 'company-zero-id',
          legalName: 'Zero Preserved Corp Limited',
          displayName: 'Zero Preserved Corp',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const incomingZero = {
        company: {
          legalName: 'Zero Preserved Corp Limited',
        },
        canonical: {
          freshIssueSize: 0,
        },
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoWithNullFresh]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoWithNullFresh);

      // In fill mode, freshIssueSize=null should be filled with 0
      const preview = await adminIpoService.previewAddOnlyJsonImport(incomingZero, false);
      const fillItem = preview.items[0].fieldsToFill.find((f) => f.field === 'freshIssueSize');
      expect(fillItem).toBeDefined();
      expect(fillItem?.newValue).toBe(0);

      mockPrisma.ipo.update.mockClear();
      await adminIpoService.commitAddOnlyJsonImport({ payload: incomingZero, overwriteExisting: false });
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-zero-id' },
          data: expect.objectContaining({
            freshIssueSize: 0,
          }),
        }),
      );
    });

    // 6. Default fill-only behavior remaining unchanged
    it('does not overwrite existing values in default fill-only mode', async () => {
      const existingIpoUnchanged: any = {
        id: 'ipo-unchanged-id',
        companyId: 'comp-unchanged-id',
        symbol: 'EXISTING_SYMBOL',
        priceBandLow: 100,
        company: {
          id: 'comp-unchanged-id',
          legalName: 'Unchanged Corp Limited',
          displayName: 'Unchanged Corp',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const incomingConflicting = {
        company: {
          legalName: 'Unchanged Corp Limited',
          displayName: 'Unchanged Corp',
        },
        symbol: 'NEW_SYMBOL',
        priceBandLow: 150,
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpoUnchanged]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpoUnchanged);

      const preview = await adminIpoService.previewAddOnlyJsonImport(incomingConflicting);
      expect(preview.fieldsToFillTotal).toBe(0);
      expect(preview.items[0].fieldsSkipped.filter((s) => s.status === 'CONFLICT').length).toBe(2);

      mockPrisma.ipo.update.mockClear();
      const commitRes = await adminIpoService.commitAddOnlyJsonImport(incomingConflicting);
      expect(commitRes.skippedCount).toBe(1);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
    });
  });

  describe('Missing Data Filling & Granular Field Selection Regression Suite', () => {
    it('1. identifies genuinely missing fields on first upload while marking existing populated fields unchanged', async () => {
      const existingIpo: any = {
        id: 'ipo-first-upload',
        companyId: 'comp-first-upload',
        symbol: 'GENUINE',
        priceBandLow: 100,
        priceBandHigh: 120,
        lotSize: null, // missing
        isin: null, // missing
        publicationStatus: null, // missing
        company: {
          id: 'comp-first-upload',
          legalName: 'Genuine Industries Limited',
          displayName: 'Genuine Industries',
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

      const incoming = {
        companyName: 'Genuine Industries Limited',
        symbol: 'GENUINE',
        priceBandLow: 100, // same -> UNCHANGED
        priceBandHigh: 120, // same -> UNCHANGED
        lotSize: 50, // missing -> TO FILL
        isin: 'INE123456012', // missing -> TO FILL
        publicationStatus: 'PUBLISHED', // missing -> TO FILL
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(incoming, false);
      expect(preview.matchedCount).toBe(1);
      const fillFields = preview.items[0].fieldsToFill.map((f) => f.field);
      expect(fillFields).toContain('lotSize');
      expect(fillFields).toContain('isin');
      expect(fillFields).toContain('publicationStatus');
      expect(fillFields).not.toContain('symbol');
      expect(fillFields).not.toContain('priceBandLow');
      expect(fillFields).not.toContain('priceBandHigh');
    });

    it('2. removes completed fields from future missing-field lists after successful fill and save', async () => {
      const initialIpo: any = {
        id: 'ipo-fill-cycle',
        companyId: 'comp-fill-cycle',
        symbol: 'CYCLE',
        lotSize: null,
        publicationStatus: null,
        company: {
          id: 'comp-fill-cycle',
          legalName: 'Cycle Technologies Limited',
          displayName: 'Cycle Tech',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([initialIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(initialIpo);

      const incoming = {
        companyName: 'Cycle Technologies Limited',
        symbol: 'CYCLE',
        lotSize: 200,
        publicationStatus: 'PUBLISHED',
      };

      // 1. Initial preview: 2 fields to fill
      const preview1 = await adminIpoService.previewAddOnlyJsonImport(incoming, false);
      expect(preview1.items[0].fieldsToFill.length).toBe(2);

      // 2. Commit fill
      mockPrisma.ipo.update.mockClear();
      const commitResult = await adminIpoService.commitAddOnlyJsonImport({
        payload: incoming,
        overwriteExisting: false,
      });
      expect(commitResult.updatedCount).toBe(1);
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-fill-cycle' },
          data: expect.objectContaining({
            lotSize: 200,
            publicationStatus: 'PUBLISHED',
          }),
        }),
      );

      // 3. Now simulate updated DB state
      const updatedIpo: any = {
        ...initialIpo,
        lotSize: 200,
        publicationStatus: 'PUBLISHED',
      };
      mockPrisma.ipo.findMany.mockResolvedValue([updatedIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(updatedIpo);

      // 4. Next preview must exclude previously filled fields
      const preview2 = await adminIpoService.previewAddOnlyJsonImport(incoming, false);
      expect(preview2.items[0].fieldsToFill.length).toBe(0);
      const skippedFields = preview2.items[0].fieldsSkipped.map((s) => s.field);
      expect(skippedFields).toContain('lotSize');
      expect(skippedFields).toContain('publicationStatus');
    });

    it('3. does not show completed fields when re-uploading identical JSON', async () => {
      const persistedIpo: any = {
        id: 'ipo-repeat-upload',
        companyId: 'comp-repeat-upload',
        symbol: 'REPEAT',
        lotSize: 100,
        isin: 'INE999999999',
        publicationStatus: 'PUBLISHED',
        company: {
          id: 'comp-repeat-upload',
          legalName: 'Repeat Global Limited',
          displayName: 'Repeat Global',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: { registrar: 'linkintime' },
        offerCategories: [],
        documents: [
          {
            id: 'doc-1',
            documentType: 'ANCHOR_LIST',
            sourceUrl: 'https://example.com/anchor.pdf',
            fileName: 'Anchor List',
            parsingStatus: 'PARSED',
          },
          {
            id: 'doc-2',
            documentType: 'OTHER',
            sourceUrl: null,
            fileName: 'Research Sources',
            parsingStatus: 'PARSED',
            extractionData: { sources: ['https://bseindia.com'] },
          },
        ],
        participants: [
          {
            id: 'part-1',
            role: 'REGISTRAR',
            name: 'linkintime',
          },
        ],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([persistedIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(persistedIpo);

      const identicalPayload = {
        companyName: 'Repeat Global Limited',
        symbol: 'REPEAT',
        lotSize: 100,
        isin: 'INE999999999',
        publicationStatus: 'PUBLISHED',
        registrar: 'linkintime',
        anchorListUrl: 'https://example.com/anchor.pdf',
        researchSources: ['https://bseindia.com'],
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(identicalPayload, false);
      expect(preview.fieldsToFillTotal).toBe(0);
      expect(preview.items[0].fieldsToFill.length).toBe(0);

      mockPrisma.ipo.update.mockClear();
      const commitResult = await adminIpoService.commitAddOnlyJsonImport({
        payload: identicalPayload,
        overwriteExisting: false,
      });
      expect(commitResult.skippedCount).toBe(1);
      expect(commitResult.updatedCount).toBe(0);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
    });

    it('4. does not fill or overwrite deselected fields when selectedFields is specified', async () => {
      const existingIpo: any = {
        id: 'ipo-deselect-test',
        companyId: 'comp-deselect-test',
        symbol: 'DESELECT',
        lotSize: null,
        isin: null,
        bseScriptCode: null,
        company: {
          id: 'comp-deselect-test',
          legalName: 'Deselect Corp Limited',
          displayName: 'Deselect Corp',
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

      const incoming = {
        companyName: 'Deselect Corp Limited',
        symbol: 'DESELECT',
        lotSize: 75,
        isin: 'INE000000111',
        bseScriptCode: '540001',
      };

      mockPrisma.ipo.update.mockClear();
      // User only selects isin and lotSize; bseScriptCode is deselected
      const commitResult = await adminIpoService.commitAddOnlyJsonImport({
        payload: incoming,
        overwriteExisting: false,
        selectedFields: {
          'ipo-deselect-test': ['ipo.isin', 'ipo.lotSize'],
        },
      });

      expect(commitResult.updatedCount).toBe(1);
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-deselect-test' },
          data: expect.objectContaining({
            lotSize: 75,
            isin: 'INE000000111',
          }),
        }),
      );
      // Verify bseScriptCode was NOT included in update payload
      const updateCallData = mockPrisma.ipo.update.mock.calls[0][0].data;
      expect(updateCallData.bseScriptCode).toBeUndefined();
    });

    it('5. fills and persists only selected fields while leaving unselected fields unchanged', async () => {
      const existingIpo: any = {
        id: 'ipo-selected-only',
        companyId: 'comp-selected-only',
        symbol: 'SELONLY',
        lotSize: null,
        freshIssueSize: null,
        offerForSaleSize: null,
        company: {
          id: 'comp-selected-only',
          legalName: 'Selected Only Limited',
          displayName: 'Selected Only',
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

      const incoming = {
        companyName: 'Selected Only Limited',
        symbol: 'SELONLY',
        lotSize: 50,
        freshIssueSize: 100,
        offerForSaleSize: 50,
      };

      mockPrisma.ipo.update.mockClear();
      // Select only freshIssueSize
      await adminIpoService.commitAddOnlyJsonImport({
        payload: incoming,
        overwriteExisting: false,
        selectedFields: ['ipo.freshIssueSize'],
      });

      expect(mockPrisma.ipo.update).toHaveBeenCalledTimes(1);
      const updateData = mockPrisma.ipo.update.mock.calls[0][0].data;
      expect(updateData.freshIssueSize).toEqual(100);
      expect(updateData.lotSize).toBeUndefined();
      expect(updateData.offerForSaleSize).toBeUndefined();
    });

    it('6. strictly treats 0 and false as populated values and does not flag them as missing', async () => {
      const existingIpo: any = {
        id: 'ipo-zero-false',
        companyId: 'comp-zero-false',
        symbol: 'ZEROFALSE',
        freshIssueSize: 0,
        retailQuotaDiscount: 0,
        preIpoEps: 0,
        company: {
          id: 'comp-zero-false',
          legalName: 'Zero False Limited',
          displayName: 'Zero False',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [{ gmpAmount: 0 }],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);
      mockPrisma.ipo.findUniqueOrThrow.mockResolvedValue(existingIpo);

      const incoming = {
        companyName: 'Zero False Limited',
        symbol: 'ZEROFALSE',
        freshIssueSize: 500, // Conflict, existing is 0 (valid)
        retailQuotaDiscount: 10, // Conflict, existing is 0 (valid)
        gmpAmount: 25, // Conflict, existing is 0 (valid)
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(incoming, false);
      // 0 values must be recognized as existing, not missing!
      expect(preview.fieldsToFillTotal).toBe(0);
      expect(preview.items[0].fieldsToFill.length).toBe(0);
      const conflicts = preview.items[0].fieldsSkipped.filter((s) => s.status === 'CONFLICT');
      expect(conflicts.length).toBeGreaterThanOrEqual(2);
    });

    it('7. follows schema rules: empty arrays and objects are treated as missing, while incoming null/empty values never overwrite', async () => {
      const existingIpo: any = {
        id: 'ipo-schema-rules',
        companyId: 'comp-schema-rules',
        symbol: 'SCHEMARULES',
        lotSize: 100,
        priceBandHigh: 200,
        company: {
          id: 'comp-schema-rules',
          legalName: 'Schema Rules Limited',
          displayName: 'Schema Rules',
          financials: [], // empty array -> treated as missing
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

      // Incoming provides empty string, null, and 'N/A' alongside valid financials
      const incoming = {
        companyName: 'Schema Rules Limited',
        symbol: '', // empty string -> ignored
        lotSize: null, // null -> ignored
        priceBandHigh: 'N/A', // placeholder -> ignored
        financials: [
          {
            fiscalPeriod: 'FY25',
            periodType: 'ANNUAL',
            revenue: 1000,
            pat: 150,
          },
        ],
      };

      const preview = await adminIpoService.previewAddOnlyJsonImport(incoming, false);
      // Only the missing financial period should be marked to fill; empty/null/N/A must be ignored
      const fillFields = preview.items[0].fieldsToFill.map((f) => f.field);
      const fillKeys = preview.items[0].fieldsToFill.map((f) => f.key);
      expect(fillFields).toContain('FY25 (ANNUAL) (NEW PERIOD)');
      expect(fillKeys).toContain('financials.FY25');
      expect(fillFields).not.toContain('symbol');
      expect(fillFields).not.toContain('lotSize');
      expect(fillFields).not.toContain('priceBandHigh');
    });

    it('8. handles partial failures and retry without losing completed work', async () => {
      const ipoA: any = {
        id: 'ipo-batch-a',
        companyId: 'comp-batch-a',
        symbol: 'BATCHA',
        lotSize: null,
        company: {
          id: 'comp-batch-a',
          legalName: 'Batch A Limited',
          displayName: 'Batch A',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      const ipoB: any = {
        id: 'ipo-batch-b',
        companyId: 'comp-batch-b',
        symbol: 'BATCHB',
        lotSize: null,
        company: {
          id: 'comp-batch-b',
          legalName: 'Batch B Limited',
          displayName: 'Batch B',
          financials: [],
        },
        lifecycleEvents: [],
        allotmentConfig: null,
        offerCategories: [],
        documents: [],
        participants: [],
        gmpObservations: [],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([ipoA, ipoB]);

      // Setup findUniqueOrThrow to return the appropriate IPO
      mockPrisma.ipo.findUniqueOrThrow.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'ipo-batch-a') return ipoA;
        if (where?.id === 'ipo-batch-b') return ipoB;
        return null;
      });

      const batchPayload = [
        { companyName: 'Batch A Limited', symbol: 'BATCHA', lotSize: 50 },
        { companyName: 'Batch B Limited', symbol: 'BATCHB', lotSize: 100 },
      ];

      // Simulate transaction update failure for IPO B only
      mockPrisma.ipo.update.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'ipo-batch-b') {
          throw new Error('Simulated database write error on IPO B');
        }
        return { id: where?.id };
      });

      const commitResult1 = await adminIpoService.commitAddOnlyJsonImport({
        payload: batchPayload,
        overwriteExisting: false,
      });

      expect(commitResult1.updatedCount).toBe(1);
      expect(commitResult1.failedCount).toBe(1);
      expect(commitResult1.items.find((i) => i.ipoId === 'ipo-batch-a')?.status).toBe('UPDATED');
      expect(commitResult1.items.find((i) => i.ipoId === 'ipo-batch-b')?.status).toBe('FAILED');

      // Now simulate retry: IPO A is already updated in DB (lotSize=50), IPO B is retried and succeeds
      const ipoAUpdated = { ...ipoA, lotSize: 50 };
      mockPrisma.ipo.findMany.mockResolvedValue([ipoAUpdated, ipoB]);
      mockPrisma.ipo.findUniqueOrThrow.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'ipo-batch-a') return ipoAUpdated;
        if (where?.id === 'ipo-batch-b') return ipoB;
        return null;
      });
      mockPrisma.ipo.update.mockImplementation(async ({ where }: any) => ({ id: where?.id }));

      const commitResult2 = await adminIpoService.commitAddOnlyJsonImport({
        payload: batchPayload,
        overwriteExisting: false,
      });

      // IPO A is safely skipped without losing completed work; IPO B is updated
      expect(commitResult2.skippedCount).toBe(1);
      expect(commitResult2.updatedCount).toBe(1);
      expect(commitResult2.failedCount).toBe(0);
    });

    it('9. preserves existing records and unrelated fields during repeat uploads', async () => {
      const existingIpo: any = {
        id: 'ipo-unrelated',
        companyId: 'comp-unrelated',
        symbol: 'UNRELATED',
        lotSize: 100,
        priceBandLow: 500,
        priceBandHigh: 550,
        leadManagers: ['Kotak Mahindra Capital', 'Axis Capital'],
        company: {
          id: 'comp-unrelated',
          legalName: 'Unrelated Assets Limited',
          displayName: 'Unrelated Assets',
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

      // Incoming upload only matches by CIN or Name but has unrelated fields
      const incomingUnmatched = {
        companyName: 'Totally Different Nonexistent Company Limited',
        symbol: 'NONEXISTENT',
        lotSize: 200,
      };

      mockPrisma.ipo.update.mockClear();
      const commitResult = await adminIpoService.commitAddOnlyJsonImport({
        payload: incomingUnmatched,
        overwriteExisting: false,
      });

      expect(commitResult.skippedCount).toBe(1);
      expect(commitResult.updatedCount).toBe(0);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
    });
  });
});

