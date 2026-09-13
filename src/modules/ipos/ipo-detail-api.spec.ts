import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { IpoController } from './ipo.controller';
import { IpoService } from './ipo.service';
import { IpoRepository } from './ipo.repository';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ReconciliationService } from '../discovery/reconciliation.service';
import { DiscoveryRefreshService } from '../discovery/discovery-refresh.service';
import { DiscoveryRefreshExecutionService } from '../discovery/discovery-refresh-execution.service';
import { DiscoveryRefreshVerificationService } from '../discovery/discovery-refresh-verification.service';
import { DiscoverySmartRefreshService } from '../discovery/discovery-smart-refresh.service';
import { DiscoveryCoverageService } from '../discovery/discovery-coverage.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';

describe('Phase 34.2 — Complete IPO Detail Public API Contract', () => {
  let controller: IpoController;
  let repository: Partial<IpoRepository>;

  const mockPublishedIpo = {
    id: '34200000-0000-0000-0000-000000000001',
    companyId: 'comp-342',
    symbol: 'KANOHAR',
    exchange: 'NSE' as const,
    marketSegment: 'MAINBOARD' as const,
    status: 'OPEN' as const,
    publicationStatus: 'PUBLISHED' as const,
    priceBandLow: new Prisma.Decimal('100.00'),
    priceBandHigh: new Prisma.Decimal('108.00'),
    faceValue: new Prisma.Decimal('10.00'),
    lotSize: 100,
    minimumLots: 1,
    issueSize: new Prisma.Decimal('500000000.00'),
    freshIssueSize: new Prisma.Decimal('500000000.00'),
    ofsSize: new Prisma.Decimal('0.00'),
    issueShareCount: BigInt(4629629),
    freshIssueShareCount: BigInt(4629629),
    ofsShareCount: BigInt(0),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    company: {
      id: 'comp-342',
      legalName: 'Kanohar Electricals Limited',
      displayName: 'Kanohar Electricals',
      cin: 'U31100UP2010PLC041000',
      website: 'https://kanohar.com',
      industry: 'Electrical Equipment',
      sector: 'Capital Goods',
      aboutDescription: 'Manufacturer of high voltage transformers and electrical sub-station equipment.',
      phone: '+91 121 2400000',
      email: 'investor@kanohar.com',
      contactPerson: 'CS John Doe',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      financials: [
        {
          id: 'fin-1',
          companyId: 'comp-342',
          fiscalPeriod: 'FY24',
          periodType: 'ANNUAL' as const,
          totalAssets: new Prisma.Decimal('1200000000.00'),
          totalRevenue: new Prisma.Decimal('1500000000.00'),
          pat: new Prisma.Decimal('150000000.00'),
          ebitda: new Prisma.Decimal('220000000.00'),
          netWorth: new Prisma.Decimal('600000000.00'),
          roePercentage: new Prisma.Decimal('25.00'),
          rocePercentage: new Prisma.Decimal('22.50'),
          eps: new Prisma.Decimal('15.50'),
          patMarginPercent: new Prisma.Decimal('10.00'),
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          id: 'fin-2',
          companyId: 'comp-342',
          fiscalPeriod: 'FY25',
          periodType: 'ANNUAL' as const,
          totalAssets: new Prisma.Decimal('1400000000.00'),
          totalRevenue: new Prisma.Decimal('1800000000.00'),
          pat: new Prisma.Decimal('200000000.00'),
          ebitda: new Prisma.Decimal('280000000.00'),
          netWorth: new Prisma.Decimal('800000000.00'),
          roePercentage: new Prisma.Decimal('25.00'),
          rocePercentage: new Prisma.Decimal('24.00'),
          eps: new Prisma.Decimal('18.20'),
          patMarginPercent: new Prisma.Decimal('11.11'),
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    },
    lifecycleEvents: [
      {
        id: 'lc-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        eventType: 'OPEN',
        eventDate: new Date('2026-09-17T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'lc-2',
        ipoId: '34200000-0000-0000-0000-000000000001',
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-21T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'lc-3',
        ipoId: '34200000-0000-0000-0000-000000000001',
        eventType: 'LISTING',
        eventDate: new Date('2026-09-24T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: null,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    offerCategories: [
      {
        id: 'cat-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        category: 'RETAIL' as const,
        allocationPct: new Prisma.Decimal('35.00'),
        minLots: 1,
        maxLots: 13,
        minShares: 100,
        maxShares: 1300,
        minAmount: new Prisma.Decimal('10800.00'),
        maxAmount: new Prisma.Decimal('140400.00'),
        isUpiEligible: true,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'cat-2',
        ipoId: '34200000-0000-0000-0000-000000000001',
        category: 'QIB' as const,
        allocationPct: new Prisma.Decimal('50.00'),
        minLots: null,
        maxLots: null,
        minShares: null,
        maxShares: null,
        minAmount: null,
        maxAmount: null,
        isUpiEligible: false,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    participants: [
      {
        id: 'part-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        role: 'REGISTRAR' as const,
        name: 'MUFG Intime India Private Limited',
        phone: '+91 22 4918 6270',
        email: 'kanohar.ipo@mufg.com',
        website: 'https://in.mpms.mufg.com',
        displayOrder: 1,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'part-2',
        ipoId: '34200000-0000-0000-0000-000000000001',
        role: 'BOOK_RUNNING_LEAD_MANAGER' as const,
        name: 'Axis Capital Limited',
        phone: '+91 22 4325 2525',
        email: 'kanohar.brms@axiscap.in',
        website: 'https://axiscapital.co.in',
        displayOrder: 2,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    documents: [
      {
        id: 'doc-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        documentType: 'RHP' as const,
        title: 'Red Herring Prospectus',
        sourceUrl: 'https://www.sebi.gov.in/filings/public-issues/sep-2026/kanohar-rhp.html',
        documentUrl: 'https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/1788774340354.pdf',
        uploadedAt: new Date('2026-09-10T00:00:00.000Z'),
        parsingStatus: 'COMPLETED' as const,
        parsedData: null,
        createdAt: new Date('2026-09-10T00:00:00.000Z'),
        updatedAt: new Date('2026-09-10T00:00:00.000Z'),
      },
    ],
    allotmentConfig: {
      id: 'cfg-1',
      ipoId: '34200000-0000-0000-0000-000000000001',
      registrar: 'MUFG_INTIME' as const,
      registrarIpoCode: 'KANOHAR',
      allotmentSourceUrl: 'https://in.mpms.mufg.com/initial_offer/public-issues.html',
      expectedAllotmentDate: new Date('2026-09-22T00:00:00.000Z'),
      panRequired: true,
      queryStrategy: 'POST' as const,
      isActive: true,
      lastVerifiedAt: new Date('2026-09-10T00:00:00.000Z'),
      createdAt: new Date('2026-09-10T00:00:00.000Z'),
      updatedAt: new Date('2026-09-10T00:00:00.000Z'),
    },
    gmpObservations: [
      {
        id: 'gmp-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        sourceId: 'src-1',
        gmpAmount: new Prisma.Decimal('25.00'),
        gmpPercentage: new Prisma.Decimal('23.15'),
        estProfitPerLot: new Prisma.Decimal('2500.00'),
        observedAt: new Date('2026-09-13T10:00:00.000Z'),
        createdAt: new Date('2026-09-13T10:00:00.000Z'),
        source: {
          id: 'src-1',
          code: 'INVESTORGAIN',
          name: 'Investor Gain',
          sourceType: 'MEDIA' as const,
        },
      },
    ],
    subscriptionObservations: [
      {
        id: 'sub-1',
        ipoId: '34200000-0000-0000-0000-000000000001',
        sourceId: 'src-nse',
        category: 'RETAIL' as const,
        subscriptionMultiple: new Prisma.Decimal('4.50'),
        sharesBid: BigInt(7296000),
        sharesOffered: BigInt(1620370),
        observedAt: new Date('2026-09-13T12:00:00.000Z'),
        createdAt: new Date('2026-09-13T12:00:00.000Z'),
        source: {
          id: 'src-nse',
          code: 'NSE',
          name: 'National Stock Exchange',
          sourceType: 'EXCHANGE' as const,
        },
      },
    ],
  };

  const mockDraftIpo = {
    ...mockPublishedIpo,
    id: '34200000-0000-0000-0000-000000000002',
    publicationStatus: 'DRAFT' as const,
  };

  const mockNoGmpSubIpo = {
    ...mockPublishedIpo,
    id: '34200000-0000-0000-0000-000000000003',
    priceBandHigh: null, // tests null minimum investment derivation
    gmpObservations: [],
    subscriptionObservations: [],
  };

  beforeEach(async () => {
    repository = {
      findById: jest.fn().mockImplementation((id: string) => {
        if (id === '34200000-0000-0000-0000-000000000001') {
          return Promise.resolve(mockPublishedIpo);
        }
        if (id === '34200000-0000-0000-0000-000000000002') {
          return Promise.resolve(mockDraftIpo);
        }
        if (id === '34200000-0000-0000-0000-000000000003') {
          return Promise.resolve(mockNoGmpSubIpo);
        }
        return Promise.resolve(null);
      }),
      findGmpHistory: jest.fn().mockImplementation((id: string) => {
        if (id === '34200000-0000-0000-0000-000000000001') {
          return Promise.resolve(mockPublishedIpo.gmpObservations);
        }
        return Promise.resolve([]);
      }),
      findSubscriptionHistory: jest.fn().mockImplementation((id: string) => {
        if (id === '34200000-0000-0000-0000-000000000001') {
          return Promise.resolve(mockPublishedIpo.subscriptionObservations);
        }
        return Promise.resolve([]);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpoController],
      providers: [
        IpoService,
        { provide: IpoRepository, useValue: repository },
        { provide: PrismaService, useValue: {} },
        { provide: ReconciliationService, useValue: {} },
        { provide: DiscoveryRefreshService, useValue: {} },
        { provide: DiscoveryRefreshExecutionService, useValue: {} },
        { provide: DiscoveryRefreshVerificationService, useValue: {} },
        { provide: DiscoverySmartRefreshService, useValue: {} },
        { provide: DiscoveryCoverageService, useValue: {} },
        { provide: DiscoveryQualityGateService, useValue: {} },
      ],
    }).compile();

    controller = module.get<IpoController>(IpoController);
  });

  it('1. GET /api/v1/ipos/:id — returns full canonical IPO detail payload', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.id).toBe('34200000-0000-0000-0000-000000000001');
    expect(res.symbol).toBe('KANOHAR');
    expect(res.company).toBeDefined();
    expect(res.company.legalName).toBe('Kanohar Electricals Limited');
  });

  it('2. Core IPO fields — exposes price bands, lot size, shares, and derives minimum investment correctly', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.priceBandLow).toBe('100.00');
    expect(res.priceBandHigh).toBe('108.00');
    expect(res.lotSize).toBe(100);
    expect(res.minimumLots).toBe(1);
    // minimumInvestmentAmount = lotSize * priceBandHigh = 100 * 108 = 10800
    expect(res.minimumInvestmentAmount).toBe('10800.00');
    expect(res.issueShareCount).toBe('4629629');
  });

  it('3. Lifecycle dates — exposes openDate, closeDate, listingDate derived from events', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.lifecycle).toBeDefined();
    expect(res.lifecycle?.openDate).toBe('2026-09-17');
    expect(res.lifecycle?.closeDate).toBe('2026-09-21');
    expect(res.lifecycle?.listingDate).toBe('2026-09-24');
  });

  it('4. Offer Categories — returns deterministic categories array with allocation metrics', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.offerCategories).toHaveLength(2);
    expect(res.offerCategories![0].category).toBe('RETAIL');
    expect(res.offerCategories![0].allocationPct).toBe('35.00');
    expect(res.offerCategories![0].minAmount).toBe('10800.00');
    expect(res.offerCategories![0].isUpiEligible).toBe(true);

    expect(res.offerCategories![1].category).toBe('QIB');
    expect(res.offerCategories![1].allocationPct).toBe('50.00');
    expect(res.offerCategories![1].minLots).toBeNull();
  });

  it('5. Company Profile — exposes legalName, CIN, contact details, description without private fields', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.company.cin).toBe('U31100UP2010PLC041000');
    expect(res.company.website).toBe('https://kanohar.com');
    expect(res.company.industry).toBe('Electrical Equipment');
    expect(res.company.aboutDescription).toContain('transformers');
    expect(res.company.phone).toBe('+91 121 2400000');
    expect(res.company.email).toBe('investor@kanohar.com');
  });

  it('6. Company Financials — returns chronological financial statements array', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.company.financials).toHaveLength(2);
    expect(res.company.financials![0].fiscalPeriod).toBe('FY24');
    expect(res.company.financials![0].totalRevenue).toBe('1500000000.00');
    expect(res.company.financials![0].pat).toBe('150000000.00');

    expect(res.company.financials![1].fiscalPeriod).toBe('FY25');
    expect(res.company.financials![1].totalRevenue).toBe('1800000000.00');
    expect(res.company.financials![1].patMarginPercent).toBe('11.11');
  });

  it('7. Participants — exposes registrar and lead manager participants with role and order', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.participants).toHaveLength(2);
    expect(res.participants![0].role).toBe('REGISTRAR');
    expect(res.participants![0].name).toBe('MUFG Intime India Private Limited');
    expect(res.participants![1].role).toBe('BOOK_RUNNING_LEAD_MANAGER');
  });

  it('8. Documents — returns public IPO filings (RHP) without leaking filesystem paths or secrets', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.documents).toHaveLength(1);
    expect(res.documents![0].documentType).toBe('RHP');
    expect(res.documents![0].sourceUrl).toBe('https://www.sebi.gov.in/filings/public-issues/sep-2026/kanohar-rhp.html');
    expect(res.documents![0].parsingStatus).toBe('COMPLETED');
    expect((res.documents![0] as any).filePath).toBeUndefined();
  });

  it('9. Allotment Summary — exposes safe public allotment configuration without internal credentials or PANs', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.allotment).toBeDefined();
    expect(res.allotment?.registrar).toBe('MUFG_INTIME');
    expect(res.allotment?.registrarIpoCode).toBe('KANOHAR');
    expect(res.allotment?.allotmentSourceUrl).toBe('https://in.mpms.mufg.com/initial_offer/public-issues.html');
    expect(res.allotment?.expectedDate).toBe('2026-09-22');
    expect((res.allotment as any).panHashes).toBeUndefined();
  });

  it('10. GET /api/v1/ipos/:id/gmp-history — returns chronological array of GMP observations with source info', async () => {
    const res = await controller.getGmpHistory({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.ipoId).toBe('34200000-0000-0000-0000-000000000001');
    expect(res.totalCount).toBe(1);
    expect(res.observations[0].gmpAmount).toBe('25.00');
    expect(res.observations[0].gmpPercentage).toBe('23.15');
    expect(res.observations[0].estProfitPerLot).toBe('2500.00');
    expect(res.observations[0].source?.code).toBe('INVESTORGAIN');
  });

  it('11. GET /api/v1/ipos/:id/subscription-history — returns category subscription observations with source info', async () => {
    const res = await controller.getSubscriptionHistory({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.ipoId).toBe('34200000-0000-0000-0000-000000000001');
    expect(res.totalCount).toBe(1);
    expect(res.observations[0].category).toBe('RETAIL');
    expect(res.observations[0].subscriptionMultiple).toBe('4.50');
    expect(res.observations[0].sharesBid).toBe('7296000');
    expect(res.observations[0].source?.code).toBe('NSE');
  });

  it('12. Null Semantics — priceBandHigh missing leads to minimumInvestmentAmount = null, not 0', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000003' });
    expect(res.priceBandHigh).toBeNull();
    expect(res.minimumInvestmentAmount).toBeNull();
  });

  it('13. Explicit Zero Semantics — ofsSize = 0 is preserved as 0, not converted to null', async () => {
    const res = await controller.getById({ id: '34200000-0000-0000-0000-000000000001' });
    expect(res.ofsSize).toBe('0.00');
  });

  it('14. Publication Isolation — DRAFT status IPO returns 404 on getById, gmp-history, and subscription-history', async () => {
    await expect(controller.getById({ id: '34200000-0000-0000-0000-000000000002' })).rejects.toThrow(AppException);
    await expect(controller.getGmpHistory({ id: '34200000-0000-0000-0000-000000000002' })).rejects.toThrow(AppException);
    await expect(controller.getSubscriptionHistory({ id: '34200000-0000-0000-0000-000000000002' })).rejects.toThrow(AppException);
  });

  it('15. Nonexistent IPO — returns 404 Not Found', async () => {
    await expect(controller.getById({ id: '99999999-9999-9999-9999-999999999999' })).rejects.toThrow(AppException);
    await expect(controller.getGmpHistory({ id: '99999999-9999-9999-9999-999999999999' })).rejects.toThrow(AppException);
    await expect(controller.getSubscriptionHistory({ id: '99999999-9999-9999-9999-999999999999' })).rejects.toThrow(AppException);
  });

  it('16. No GMP observations — returns empty array with count 0', async () => {
    const res = await controller.getGmpHistory({ id: '34200000-0000-0000-0000-000000000003' });
    expect(res.ipoId).toBe('34200000-0000-0000-0000-000000000003');
    expect(res.totalCount).toBe(0);
    expect(res.observations).toEqual([]);
  });

  it('17. No Subscription observations — returns empty array with count 0', async () => {
    const res = await controller.getSubscriptionHistory({ id: '34200000-0000-0000-0000-000000000003' });
    expect(res.ipoId).toBe('34200000-0000-0000-0000-000000000003');
    expect(res.totalCount).toBe(0);
    expect(res.observations).toEqual([]);
  });
});
