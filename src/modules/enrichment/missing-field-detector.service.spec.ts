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
});
