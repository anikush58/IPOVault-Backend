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
      create: jest.fn().mockResolvedValue({
        id: 'company-uuid-1',
        legalName: 'TEST ENTERPRISES LIMITED',
        displayName: 'TEST ENTERPRISES LIMITED',
        cin: 'U27109HR1974PLC007126',
      }),
      update: jest.fn().mockResolvedValue({ id: 'company-uuid-1' }),
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
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({
        id: 'ipo-uuid-1',
        publicationStatus: PublicationStatus.DRAFT,
      }),
    },
    ipoLifecycleEvent: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    companyFinancial: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    ipoOfferCategory: {
      upsert: jest.fn().mockResolvedValue({}),
    },
    ipoParticipant: {
      create: jest.fn().mockResolvedValue({}),
    },
    ipoAllotmentConfig: {
      upsert: jest.fn().mockResolvedValue({ registrar: 'kfintech', registrarIpoCode: 'MANIKA2026', enabled: true }),
    },
    ipoDocument: {
      create: jest.fn().mockResolvedValue({ id: 'doc-uuid-1', parsingStatus: 'PARSED' }),
    },
    gmpObservation: {
      create: jest.fn().mockResolvedValue({}),
    },
    subscriptionObservation: {
      create: jest.fn().mockResolvedValue({}),
    },
    fieldProvenance: {
      create: jest.fn().mockResolvedValue({}),
    },
    ipoSourceIdentity: {
      upsert: jest.fn().mockResolvedValue({ id: 'source-id-1' }),
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
      ).rejects.toThrow('company.legalName is required');
    });

    it('rejects JSON import when price band low > high', async () => {
      await expect(
        adminIpoService.importIpoFromJson({
          company: { legalName: 'Invalid Price Band Co' },
          ipo: { priceBandLow: 150, priceBandHigh: 100 },
        }),
      ).rejects.toThrow('priceBandLow (150) cannot be greater than priceBandHigh (100)');
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

    it('enforces ADMIN source identity filter on listIpos so background discovery IPOs without ADMIN identity are excluded', async () => {
      await adminIpoService.listIpos({ publicationStatus: 'DRAFT' });

      expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceIdentities: { some: { source: { code: 'ADMIN' } } },
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
  });
});
