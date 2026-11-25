import { Test, TestingModule } from '@nestjs/testing';
import { MissingFieldDetectorService } from './missing-field-detector.service';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, MarketSegment, IpoStatus } from '@prisma/client';

describe('MissingFieldDetectorService', () => {
  let service: MissingFieldDetectorService;

  const mockPrismaService = {
    ipo: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MissingFieldDetectorService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<MissingFieldDetectorService>(MissingFieldDetectorService);
    jest.clearAllMocks();
  });

  it('should detect all missing fields on an empty/newly created IPO', async () => {
    const mockIpo = {
      id: 'ipo-1',
      slug: 'test-ipo',
      marketSegment: MarketSegment.MAINBOARD,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('500.0'),
      companyId: 'comp-1',
      preIpoPe: null,
      postIpoPe: null,
      preIpoPromoterHolding: null,
      postIpoPromoterHolding: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      freshIssueSize: null,
      ofsSize: null,
      company: {
        id: 'comp-1',
        legalName: 'Test Technologies Limited',
        displayName: 'Test Technologies',
        aboutDescription: null,
        industry: null,
        sector: null,
        strengths: [],
        risks: [],
        financials: [],
      },
      participants: [],
      documents: [],
    };

    mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpo);

    const inspection = await service.detect('ipo-1');
    expect(inspection).not.toBeNull();
    expect(inspection!.hasMissingFields).toBe(true);
    expect(inspection!.missingFields).toEqual(
      expect.arrayContaining([
        'aboutDescription',
        'industry',
        'sector',
        'strengthsAndRisks',
        'financials',
        'preIpoPe',
        'postIpoPe',
        'preIpoPromoterHolding',
        'postIpoPromoterHolding',
        'freshIssueShareCount',
        'ofsShareCount',
        'freshIssueSize',
        'ofsSize',
        'leadManagers',
        'anchorDetails',
      ]),
    );
  });

  it('should report NO missing fields when all fields and 3-year financials are present', async () => {
    const mockIpo = {
      id: 'ipo-2',
      slug: 'complete-ipo',
      marketSegment: MarketSegment.MAINBOARD,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('300.0'),
      companyId: 'comp-2',
      preIpoPe: new Prisma.Decimal('25.5'),
      postIpoPe: new Prisma.Decimal('28.2'),
      preIpoPromoterHolding: new Prisma.Decimal('75.0'),
      postIpoPromoterHolding: new Prisma.Decimal('60.0'),
      freshIssueShareCount: BigInt(10000000),
      ofsShareCount: BigInt(5000000),
      freshIssueSize: new Prisma.Decimal('200.0'),
      ofsSize: new Prisma.Decimal('100.0'),
      company: {
        id: 'comp-2',
        legalName: 'Complete Corp Ltd',
        displayName: 'Complete Corp',
        aboutDescription: 'A robust technology enterprise providing cloud services.',
        industry: 'Software',
        sector: 'Information Technology',
        strengths: ['High profit margins', 'Strong moat'],
        risks: ['Customer concentration risk'],
        financials: [
          { fiscalPeriod: 'FY2024', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(100) },
          { fiscalPeriod: 'FY2023', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(80) },
          { fiscalPeriod: 'FY2022', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(60) },
        ],
      },
      participants: [
        { role: 'BRLM', legalName: 'Kotak Mahindra Capital' },
        { role: 'REGISTRAR', name: 'KFin Technologies Limited' },
      ],
      documents: [
        {
          documentType: 'RHP',
          extractionData: {
            strengths: ['Growth rate'],
            risks: ['Market volatility'],
          },
        },
        {
          documentType: 'ANCHOR_LIST',
          extractionData: { portion: 50 },
        },
      ],
    };

    mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpo);

    const inspection = await service.detect('ipo-2');
    expect(inspection).not.toBeNull();
    expect(inspection!.hasMissingFields).toBe(false);
    expect(inspection!.missingFields).toHaveLength(0);
  });

  it('should find IPO IDs eligible for backfill', async () => {
    const eligibleIpos = [{ id: 'ipo-backfill-1' }];
    mockPrismaService.ipo.findMany.mockResolvedValue(eligibleIpos);
    mockPrismaService.ipo.findUnique.mockResolvedValue({
      id: 'ipo-backfill-1',
      slug: 'bf-1',
      marketSegment: MarketSegment.MAINBOARD,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('500'),
      preIpoPe: null,
      postIpoPe: null,
      preIpoPromoterHolding: null,
      postIpoPromoterHolding: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      freshIssueSize: null,
      ofsSize: null,
      company: {
        id: 'comp-bf-1',
        legalName: 'Backfill Corp',
        displayName: 'Backfill Corp',
        aboutDescription: null,
        industry: null,
        sector: null,
        strengths: [],
        risks: [],
        financials: [],
      },
      participants: [],
      documents: [],
    });

    const results = await service.findIposEligibleForEnrichment(10);
    expect(results).toHaveLength(1);
    expect(results[0]).toBe('ipo-backfill-1');
  });

  it('should detect placeholder strings as missing fields', async () => {
    const mockIpoWithPlaceholders = {
      id: 'ipo-placeholders',
      slug: 'placeholder-ipo',
      marketSegment: MarketSegment.MAINBOARD,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('300.0'),
      companyId: 'comp-ph',
      preIpoPe: new Prisma.Decimal('25.5'),
      postIpoPe: new Prisma.Decimal('28.2'),
      preIpoPromoterHolding: new Prisma.Decimal('75.0'),
      postIpoPromoterHolding: new Prisma.Decimal('60.0'),
      freshIssueShareCount: BigInt(10000000),
      ofsShareCount: BigInt(5000000),
      freshIssueSize: new Prisma.Decimal('200.0'),
      ofsSize: new Prisma.Decimal('100.0'),
      company: {
        id: 'comp-ph',
        legalName: 'Placeholder Corp Ltd',
        displayName: 'Placeholder Corp',
        aboutDescription: 'N/A', // Placeholder!
        industry: '-',          // Placeholder!
        sector: 'TBD',          // Placeholder!
        strengths: ['Growth'],
        risks: ['Risk'],
        financials: [
          { fiscalPeriod: 'FY24', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(100) },
          { fiscalPeriod: 'FY23', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(80) },
        ],
      },
      participants: [{ role: 'BRLM', legalName: 'Lead Banker' }],
      documents: [
        { documentType: 'RHP', extractionData: { strengths: ['A'], risks: ['B'] } },
        { documentType: 'ANCHOR_LIST', extractionData: { portion: 50 } },
      ],
    };

    mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpoWithPlaceholders);

    const inspection = await service.detect('ipo-placeholders');
    expect(inspection).not.toBeNull();
    expect(inspection!.hasMissingFields).toBe(true);
    expect(inspection!.missingFields).toContain('aboutDescription');
    expect(inspection!.missingFields).toContain('industry');
    expect(inspection!.missingFields).toContain('sector');
  });

  it('should independently detect decoupled preIpoPe / postIpoPe when only one is missing', async () => {
    const mockIpoPartialPe = {
      id: 'ipo-partial-pe',
      slug: 'partial-pe',
      marketSegment: MarketSegment.SME,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('50.0'),
      companyId: 'comp-sme',
      preIpoPe: new Prisma.Decimal('18.5'), // Populated
      postIpoPe: null,                      // Missing!
      preIpoPromoterHolding: new Prisma.Decimal('90.0'), // Populated
      postIpoPromoterHolding: null,                      // Missing!
      freshIssueShareCount: BigInt(5000000),
      ofsShareCount: BigInt(0),
      freshIssueSize: new Prisma.Decimal('50.0'),
      ofsSize: new Prisma.Decimal('0.0'),
      company: {
        id: 'comp-sme',
        legalName: 'SME Corp',
        displayName: 'SME Corp',
        aboutDescription: 'Valid description',
        industry: 'Precision Engineering',
        sector: 'Manufacturing',
        financials: [
          { fiscalPeriod: 'FY24', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(40) },
          { fiscalPeriod: 'FY23', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(30) },
        ],
      },
      participants: [{ role: 'BRLM', legalName: 'SME Merchant Banker' }],
      documents: [
        { documentType: 'RHP', extractionData: { strengths: ['A'], risks: ['B'] } },
      ],
    };

    mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpoPartialPe);

    const inspection = await service.detect('ipo-partial-pe');
    expect(inspection).not.toBeNull();
    expect(inspection!.hasMissingFields).toBe(true);
    // postIpoPe and postIpoPromoterHolding are detected as missing, while pre ones are not
    expect(inspection!.missingFields).toContain('postIpoPe');
    expect(inspection!.missingFields).not.toContain('preIpoPe');
    expect(inspection!.missingFields).toContain('postIpoPromoterHolding');
    expect(inspection!.missingFields).not.toContain('preIpoPromoterHolding');
  });

  it('should detect missing registrar across allotmentConfig, participants, and sourceIdentities and treat placeholders as missing', async () => {
    mockPrismaService.ipo.findUnique.mockResolvedValue({
      id: 'ipo-missing-rta',
      slug: 'missing-rta',
      marketSegment: MarketSegment.MAINBOARD,
      status: IpoStatus.UPCOMING,
      issueSize: new Prisma.Decimal('100'),
      preIpoPe: new Prisma.Decimal('15'),
      postIpoPe: new Prisma.Decimal('18'),
      preIpoPromoterHolding: new Prisma.Decimal('80'),
      postIpoPromoterHolding: new Prisma.Decimal('60'),
      freshIssueShareCount: BigInt(1000000),
      ofsShareCount: BigInt(0),
      freshIssueSize: new Prisma.Decimal('100'),
      ofsSize: new Prisma.Decimal('0'),
      company: {
        id: 'comp-rta',
        legalName: 'No RTA Corp',
        displayName: 'No RTA Corp',
        aboutDescription: 'Description present',
        industry: 'Engineering',
        sector: 'Industrials',
        financials: [
          { fiscalPeriod: 'FY24', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(50) },
          { fiscalPeriod: 'FY23', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(40) },
          { fiscalPeriod: 'FY22', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(30) },
        ],
      },
      allotmentConfig: { registrar: 'TBD', enabled: true },
      participants: [
        { role: 'BRLM', name: 'Lead Bank' },
        { role: 'REGISTRAR', name: 'N/A' },
      ],
      sourceIdentities: [],
      documents: [
        { documentType: 'RHP', extractionData: { strengths: ['S1'], risks: ['R1'] } },
        { documentType: 'ANCHOR_LIST', extractionData: { portion: 25 } },
      ],
    });

    const inspection = await service.detect('ipo-missing-rta');
    expect(inspection!.hasMissingFields).toBe(true);
    expect(inspection!.missingFields).toEqual(['registrar']);
  });

  it('should NOT flag registrar when present via allotmentConfig or REGISTRAR sourceIdentity', async () => {
    mockPrismaService.ipo.findUnique.mockResolvedValue({
      id: 'ipo-has-rta-si',
      slug: 'has-rta-si',
      marketSegment: MarketSegment.SME,
      status: IpoStatus.OPEN,
      issueSize: new Prisma.Decimal('40'),
      preIpoPe: new Prisma.Decimal('12'),
      postIpoPe: new Prisma.Decimal('14'),
      preIpoPromoterHolding: new Prisma.Decimal('75'),
      postIpoPromoterHolding: new Prisma.Decimal('55'),
      freshIssueShareCount: BigInt(400000),
      ofsShareCount: BigInt(0),
      freshIssueSize: new Prisma.Decimal('40'),
      ofsSize: new Prisma.Decimal('0'),
      company: {
        id: 'comp-has-rta',
        legalName: 'RTA Source Corp',
        displayName: 'RTA Source Corp',
        aboutDescription: 'Description present',
        industry: 'Logistics',
        sector: 'Services',
        financials: [
          { fiscalPeriod: 'FY24', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(20) },
          { fiscalPeriod: 'FY23', periodType: 'ANNUAL', totalRevenue: new Prisma.Decimal(15) },
        ],
      },
      allotmentConfig: null,
      participants: [{ role: 'BRLM', name: 'SME Bank' }],
      sourceIdentities: [
        { externalId: 'BGS-10', source: { code: 'BIGSHARE', name: 'Bigshare Services', sourceType: 'REGISTRAR' } },
      ],
      documents: [
        { documentType: 'RHP', extractionData: { strengths: ['S1'], risks: ['R1'] } },
      ],
    });

    const inspection = await service.detect('ipo-has-rta-si');
    expect(inspection!.hasMissingFields).toBe(false);
    expect(inspection!.missingFields).not.toContain('registrar');
  });
});
