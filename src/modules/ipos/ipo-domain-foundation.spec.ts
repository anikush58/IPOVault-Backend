import { Test, TestingModule } from '@nestjs/testing';
import { OfferCategoryType, ParticipantRole } from '@prisma/client';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';

describe('Phase 34.1 — IPO Detail Domain Database Foundation', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let testCompanyId: string;
  let testIpoId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [DatabaseModule],
    }).compile();

    prisma = module.get<PrismaService>(PrismaService);

    // Create test company
    const company = await prisma.company.create({
      data: {
        legalName: 'Test Foundation Tech Limited',
        displayName: 'Foundation Tech',
        cin: `L${Math.floor(10000 + Math.random() * 90000)}MH2026PLC999999`,
        industry: 'Software & Technology',
        sector: 'Information Technology',
        aboutDescription: 'Test company for Phase 34.1 domain foundation verification.',
        phone: '+91 22 1234 5678',
        email: 'investors@foundationtech.com',
        contactPerson: 'Jane Doe, CS',
      },
    });
    testCompanyId = company.id;

    // Create test canonical IPO
    const ipo = await prisma.ipo.create({
      data: {
        companyId: testCompanyId,
        marketSegment: 'MAINBOARD',
        exchange: 'BOTH',
        status: 'UPCOMING',
        symbol: 'FOUNDATION',
        issueSize: 500.0,
        freshIssueSize: 300.0,
        ofsSize: 200.0,
        priceBandLow: 100.0,
        priceBandHigh: 108.0,
        lotSize: 138,
      },
    });
    testIpoId = ipo.id;
  }, 30000);

  afterAll(async () => {
    if (testIpoId) {
      await prisma.gmpObservation.deleteMany({ where: { ipoId: testIpoId } });
      await prisma.subscriptionObservation.deleteMany({ where: { ipoId: testIpoId } });
      await prisma.ipoParticipant.deleteMany({ where: { ipoId: testIpoId } });
      await prisma.ipoOfferCategory.deleteMany({ where: { ipoId: testIpoId } });
      await prisma.ipo.deleteMany({ where: { id: testIpoId } });
    }
    if (testCompanyId) {
      await prisma.companyFinancial.deleteMany({ where: { companyId: testCompanyId } });
      await prisma.company.deleteMany({ where: { id: testCompanyId } });
    }
    if (module) {
      await module.close();
    }
  }, 30000);

  // STEP 2 — IpoOfferCategory Verification
  describe('IpoOfferCategory', () => {
    it('creates offer categories with explicit zero and null values correctly', async () => {
      const qibCategory = await prisma.ipoOfferCategory.create({
        data: {
          ipoId: testIpoId,
          category: OfferCategoryType.QIB,
          allocationPct: 50.0,
          minLots: 1,
          minShares: 138,
          minAmount: 14904.0,
          isUpiEligible: false,
        },
      });

      const retailCategory = await prisma.ipoOfferCategory.create({
        data: {
          ipoId: testIpoId,
          category: OfferCategoryType.RETAIL,
          allocationPct: 35.0,
          minLots: 1,
          maxLots: 13,
          minShares: 138,
          maxShares: 1794,
          minAmount: 14904.0,
          maxAmount: 193752.0,
          isUpiEligible: true,
        },
      });

      const employeeCategory = await prisma.ipoOfferCategory.create({
        data: {
          ipoId: testIpoId,
          category: OfferCategoryType.EMPLOYEE,
          allocationPct: 0.0, // Explicit zero
          minLots: null, // Null = unknown
        },
      });

      expect(qibCategory.category).toBe('QIB');
      expect(Number(qibCategory.allocationPct)).toBe(50.0);
      expect(qibCategory.isUpiEligible).toBe(false);

      expect(retailCategory.category).toBe('RETAIL');
      expect(Number(retailCategory.allocationPct)).toBe(35.0);

      // Null vs Zero Semantics check
      expect(Number(employeeCategory.allocationPct)).toBe(0.0); // Preserved as explicit zero
      expect(employeeCategory.minLots).toBeNull(); // Preserved as null
    });

    it('enforces uniqueness on [ipoId, category]', async () => {
      await expect(
        prisma.ipoOfferCategory.create({
          data: {
            ipoId: testIpoId,
            category: OfferCategoryType.QIB,
            allocationPct: 50.0,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // STEP 3 — CompanyFinancial Verification
  describe('CompanyFinancial', () => {
    it('stores multi-period financial history for Company', async () => {
      const fy24 = await prisma.companyFinancial.create({
        data: {
          companyId: testCompanyId,
          fiscalPeriod: 'FY24',
          periodType: 'ANNUAL',
          totalRevenue: 1200.5,
          pat: 150.25,
          ebitda: 210.0,
          netWorth: 800.0,
          roePercentage: 18.78,
          rocePercentage: 21.4,
          eps: 12.5,
          patMarginPercent: 12.51,
        },
      });

      const fy25 = await prisma.companyFinancial.create({
        data: {
          companyId: testCompanyId,
          fiscalPeriod: 'FY25',
          periodType: 'ANNUAL',
          totalRevenue: 1650.0,
          pat: 220.0,
          ebitda: 310.0,
          netWorth: 1020.0,
          roePercentage: 21.57,
          rocePercentage: 24.2,
          eps: 18.3,
          patMarginPercent: 13.33,
        },
      });

      expect(fy24.fiscalPeriod).toBe('FY24');
      expect(Number(fy24.totalRevenue)).toBe(1200.5);
      expect(fy25.fiscalPeriod).toBe('FY25');
      expect(Number(fy25.pat)).toBe(220.0);

      const companyWithFinancials = await prisma.company.findUnique({
        where: { id: testCompanyId },
        include: { financials: { orderBy: { fiscalPeriod: 'asc' } } },
      });

      expect(companyWithFinancials?.financials).toHaveLength(2);
      expect(companyWithFinancials?.financials[0].fiscalPeriod).toBe('FY24');
      expect(companyWithFinancials?.financials[1].fiscalPeriod).toBe('FY25');
      expect(companyWithFinancials?.aboutDescription).toBe(
        'Test company for Phase 34.1 domain foundation verification.',
      );
    });

    it('enforces uniqueness on [companyId, fiscalPeriod, periodType]', async () => {
      await expect(
        prisma.companyFinancial.create({
          data: {
            companyId: testCompanyId,
            fiscalPeriod: 'FY24',
            periodType: 'ANNUAL',
            totalRevenue: 1300.0,
          },
        }),
      ).rejects.toThrow();
    });
  });

  // STEP 4 — IpoParticipant Verification
  describe('IpoParticipant', () => {
    it('creates participant records for Registrar and BRLMs', async () => {
      const registrar = await prisma.ipoParticipant.create({
        data: {
          ipoId: testIpoId,
          role: ParticipantRole.REGISTRAR,
          name: 'Link Intime India Private Limited',
          phone: '+91 22 4918 6270',
          email: 'ipovault@linkintime.co.in',
          website: 'https://linkintime.co.in',
          displayOrder: 1,
        },
      });

      const brlm1 = await prisma.ipoParticipant.create({
        data: {
          ipoId: testIpoId,
          role: ParticipantRole.BRLM,
          name: 'Kotak Mahindra Capital Company Limited',
          website: 'https://investmentbank.kotak.com',
          displayOrder: 2,
        },
      });

      expect(registrar.role).toBe('REGISTRAR');
      expect(registrar.name).toBe('Link Intime India Private Limited');
      expect(brlm1.role).toBe('BRLM');

      const ipoParticipants = await prisma.ipoParticipant.findMany({
        where: { ipoId: testIpoId },
        orderBy: { displayOrder: 'asc' },
      });

      expect(ipoParticipants).toHaveLength(2);
      expect(ipoParticipants[0].name).toBe('Link Intime India Private Limited');
      expect(ipoParticipants[1].name).toBe('Kotak Mahindra Capital Company Limited');
    });
  });

  // STEP 5 — GmpObservation Verification
  describe('GmpObservation', () => {
    it('stores market-signal time-series GMP observations cleanly', async () => {
      const now = new Date();
      const earlier = new Date(now.getTime() - 86400000);

      await prisma.gmpObservation.create({
        data: {
          ipoId: testIpoId,
          gmpAmount: 42.0,
          gmpPercentage: 38.89,
          estProfitPerLot: 5796.0,
          observedAt: earlier,
          sourceReference: 'Market Signal Feed A',
        },
      });

      await prisma.gmpObservation.create({
        data: {
          ipoId: testIpoId,
          gmpAmount: 55.0,
          gmpPercentage: 50.93,
          estProfitPerLot: 7590.0,
          observedAt: now,
          sourceReference: 'Market Signal Feed B',
        },
      });

      const history = await prisma.gmpObservation.findMany({
        where: { ipoId: testIpoId },
        orderBy: { observedAt: 'desc' },
      });

      expect(history).toHaveLength(2);
      expect(Number(history[0].gmpAmount)).toBe(55.0); // Latest observation
      expect(Number(history[1].gmpAmount)).toBe(42.0); // Earlier observation
    });
  });

  // STEP 6 — SubscriptionObservation Verification
  describe('SubscriptionObservation', () => {
    it('stores category subscription demand observations cleanly', async () => {
      const obsDate = new Date();

      await prisma.subscriptionObservation.create({
        data: {
          ipoId: testIpoId,
          category: OfferCategoryType.QIB,
          subscriptionMultiple: 12.45,
          sharesBid: 12450000,
          sharesOffered: 1000000,
          observedAt: obsDate,
        },
      });

      await prisma.subscriptionObservation.create({
        data: {
          ipoId: testIpoId,
          category: OfferCategoryType.RETAIL,
          subscriptionMultiple: 3.8,
          sharesBid: 3800000,
          sharesOffered: 1000000,
          observedAt: obsDate,
        },
      });

      const subs = await prisma.subscriptionObservation.findMany({
        where: { ipoId: testIpoId },
        orderBy: { category: 'asc' },
      });

      expect(subs).toHaveLength(2);
      const qib = subs.find((item) => item.category === 'QIB');
      const retail = subs.find((item) => item.category === 'RETAIL');

      expect(Number(qib?.subscriptionMultiple)).toBe(12.45);
      expect(Number(retail?.subscriptionMultiple)).toBe(3.8);
    });
  });
});
