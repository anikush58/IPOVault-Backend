import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { IpoController } from './ipo.controller';
import { ipoCompareQuerySchema } from './ipo.dto';
import { IpoRepository } from './ipo.repository';
import { IpoService } from './ipo.service';
import { IpoWithRelations } from './ipo.types';
import { ReconciliationService } from '../discovery/reconciliation.service';
import { DiscoveryRefreshService } from '../discovery/discovery-refresh.service';
import { DiscoveryRefreshExecutionService } from '../discovery/discovery-refresh-execution.service';
import { DiscoveryRefreshVerificationService } from '../discovery/discovery-refresh-verification.service';
import { DiscoverySmartRefreshService } from '../discovery/discovery-smart-refresh.service';
import { DiscoveryCoverageService } from '../discovery/discovery-coverage.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';

describe('Phase 26 — IPO Comparison API (Unit)', () => {
  let controller: IpoController;
  let repository: jest.Mocked<IpoRepository>;
  let qualityGateService: jest.Mocked<DiscoveryQualityGateService>;
  let coverageService: jest.Mocked<DiscoveryCoverageService>;

  const id1 = '11111111-1111-4111-8111-111111111111';
  const id2 = '22222222-2222-4222-8222-222222222222';
  const id3 = '33333333-3333-4333-8333-333333333333';
  const id4 = '44444444-4444-4444-8444-444444444444';
  const id5 = '55555555-5555-4555-8555-555555555555';
  const id6 = '66666666-6666-4666-8666-666666666666';

  const mockIpo1: IpoWithRelations = {
    id: id1,
    companyId: 'comp-1',
    marketSegment: 'MAINBOARD',
    exchange: 'BOTH',
    status: 'OPEN',
    publicationStatus: 'PUBLISHED',
    symbol: 'ALPHA',
    issueSize: new Prisma.Decimal('500.00'),
    freshIssueSize: new Prisma.Decimal('300.00'),
    ofsSize: new Prisma.Decimal('200.00'),
    issueShareCount: new Prisma.Decimal('5000000'),
    freshIssueShareCount: new Prisma.Decimal('3000000'),
    ofsShareCount: new Prisma.Decimal('2000000'),
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('100.00'),
    priceBandHigh: new Prisma.Decimal('108.00'),
    lotSize: 100,
    minimumLots: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    company: {
      id: 'comp-1',
      legalName: 'Alpha Tech Limited',
      displayName: 'Alpha Tech',
      cin: 'L12345MH2020PLC123456',
      website: 'https://alpha.example.com',
      industry: 'Technology',
      sector: 'Software',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    lifecycleEvents: [
      {
        id: 'evt-1',
        ipoId: id1,
        eventType: 'OPEN',
        eventDate: new Date('2026-02-01T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'evt-2',
        ipoId: id1,
        eventType: 'CLOSE',
        eventDate: new Date('2026-02-05T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  };

  const mockIpo2: IpoWithRelations = {
    id: id2,
    companyId: 'comp-2',
    marketSegment: 'SME',
    exchange: 'NSE',
    status: 'UPCOMING',
    publicationStatus: 'PUBLISHED',
    symbol: 'BETA',
    issueSize: null,
    freshIssueSize: null,
    ofsSize: null,
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
    faceValue: null,
    priceBandLow: null,
    priceBandHigh: null,
    lotSize: null,
    minimumLots: null,
    createdAt: new Date('2026-01-03T00:00:00.000Z'),
    updatedAt: new Date('2026-01-04T00:00:00.000Z'),
    company: {
      id: 'comp-2',
      legalName: 'Beta Infra Private Limited',
      displayName: 'Beta Infra',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    },
    lifecycleEvents: [],
  };

  const mockIpo3: IpoWithRelations = {
    ...mockIpo1,
    id: id3,
    symbol: 'GAMMA',
  };
  const mockIpo4: IpoWithRelations = {
    ...mockIpo1,
    id: id4,
    symbol: 'DELTA',
  };
  const mockIpo5: IpoWithRelations = {
    ...mockIpo1,
    id: id5,
    symbol: 'EPSILON',
  };

  beforeEach(async () => {
    const mockRepo = {
      findMany: jest.fn(),
      count: jest.fn(),
      findById: jest.fn(),
      findByIds: jest.fn(),
      findTimelineEvents: jest.fn(),
      findSources: jest.fn(),
      findChangeEvents: jest.fn(),
      findFieldProvenances: jest.fn(),
    };

    qualityGateService = {
      evaluateQualityGate: jest.fn(),
    } as any;

    coverageService = {
      evaluateCoverage: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpoController],
      providers: [
        IpoService,
        { provide: IpoRepository, useValue: mockRepo },
        { provide: PrismaService, useValue: {} },
        { provide: ReconciliationService, useValue: {} },
        { provide: DiscoveryRefreshService, useValue: {} },
        { provide: DiscoveryRefreshExecutionService, useValue: {} },
        { provide: DiscoveryRefreshVerificationService, useValue: {} },
        { provide: DiscoverySmartRefreshService, useValue: {} },
        { provide: DiscoveryCoverageService, useValue: coverageService },
        { provide: DiscoveryQualityGateService, useValue: qualityGateService },
      ],
    }).compile();

    controller = module.get<IpoController>(IpoController);
    repository = module.get(IpoRepository);
  });

  describe('Validation (ipoCompareQuerySchema)', () => {
    it('parses comma-separated string ids correctly', () => {
      const parsed = ipoCompareQuerySchema.parse({
        ids: `${id1}, ${id2}`,
      });
      expect(parsed.ids).toEqual([id1, id2]);
    });

    it('parses array of string ids correctly', () => {
      const parsed = ipoCompareQuerySchema.parse({
        ids: [id1, id2],
      });
      expect(parsed.ids).toEqual([id1, id2]);
    });

    it('fails when fewer than 2 IDs are provided', () => {
      const result = ipoCompareQuerySchema.safeParse({ ids: [id1] });
      expect(result.success).toBe(false);
    });

    it('fails when more than 5 IDs are provided', () => {
      const result = ipoCompareQuerySchema.safeParse({
        ids: [id1, id2, id3, id4, id5, id6],
      });
      expect(result.success).toBe(false);
    });

    it('fails when malformed UUID is provided', () => {
      const result = ipoCompareQuerySchema.safeParse({
        ids: [id1, 'invalid-uuid'],
      });
      expect(result.success).toBe(false);
    });

    it('fails when duplicate IDs are provided', () => {
      const result = ipoCompareQuerySchema.safeParse({
        ids: [id1, id1],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Compare Logic & Field Mapping', () => {
    it('compares two IPOs and maps complete canonical fields', async () => {
      repository.findByIds.mockResolvedValue([mockIpo1, mockIpo2]);

      const res = await controller.compare({ ids: [id1, id2] });

      expect(repository.findByIds).toHaveBeenCalledTimes(1);
      expect(repository.findByIds).toHaveBeenCalledWith([id1, id2]);
      expect(res.data.ipos).toHaveLength(2);

      const first = res.data.ipos[0];
      expect(first.id).toBe(id1);
      expect(first.companyName).toBe('Alpha Tech');
      expect(first.legalName).toBe('Alpha Tech Limited');
      expect(first.symbol).toBe('ALPHA');
      expect(first.cin).toBe('L12345MH2020PLC123456');
      expect(first.status).toBe('OPEN');
      expect(first.marketSegment).toBe('MAINBOARD');
      expect(first.exchange).toBe('BOTH');
      expect(first.issueSize).toBe('500.00');
      expect(first.freshIssueSize).toBe('300.00');
      expect(first.ofsSize).toBe('200.00');
      expect(first.issueShareCount).toBe('5000000.00');
      expect(first.priceBandLow).toBe('100.00');
      expect(first.priceBandHigh).toBe('108.00');
      expect(first.lotSize).toBe(100);
      expect(first.minimumLots).toBe(1);
      expect(first.openDate).toBe('2026-02-01');
      expect(first.closeDate).toBe('2026-02-05');
      expect(first.listingDate).toBeNull();
    });

    it('compares three IPOs and preserves null canonical values', async () => {
      repository.findByIds.mockResolvedValue([mockIpo1, mockIpo2, mockIpo3]);

      const res = await controller.compare({ ids: [id1, id2, id3] });

      expect(res.data.ipos).toHaveLength(3);
      const second = res.data.ipos[1];
      expect(second.id).toBe(id2);
      expect(second.companyName).toBe('Beta Infra');
      expect(second.cin).toBeNull();
      expect(second.issueSize).toBeNull();
      expect(second.priceBandLow).toBeNull();
      expect(second.lotSize).toBeNull();
      expect(second.openDate).toBeNull();
    });

    it('supports maximum allowed comparison size of 5 IPOs', async () => {
      repository.findByIds.mockResolvedValue([
        mockIpo1,
        mockIpo2,
        mockIpo3,
        mockIpo4,
        mockIpo5,
      ]);

      const res = await controller.compare({
        ids: [id1, id2, id3, id4, id5],
      });

      expect(res.data.ipos).toHaveLength(5);
    });

    it('preserves requested ID ordering regardless of database returned order', async () => {
      // Database returns in order id2, id1
      repository.findByIds.mockResolvedValue([mockIpo2, mockIpo1]);

      // Caller requests id1, id2
      const res = await controller.compare({ ids: [id1, id2] });

      expect(res.data.ipos[0].id).toBe(id1);
      expect(res.data.ipos[1].id).toBe(id2);
    });

    it('throws 404 (IPO_NOT_FOUND) when any requested IPO is missing', async () => {
      // Return only 1 found IPO out of 2 requested
      repository.findByIds.mockResolvedValue([mockIpo1]);

      await expect(controller.compare({ ids: [id1, id2] })).rejects.toThrow(
        AppException,
      );

      try {
        await controller.compare({ ids: [id1, id2] });
      } catch (err: any) {
        expect(err.httpStatus).toBe(404);
        expect(err.code).toBe('IPO_NOT_FOUND');
        expect(err.message).toContain(id2);
      }
    });

    it('does NOT invoke Quality Gate, Coverage, Lineage, or Freshness engines', async () => {
      repository.findByIds.mockResolvedValue([mockIpo1, mockIpo2]);

      await controller.compare({ ids: [id1, id2] });

      expect(qualityGateService.evaluateQualityGate).not.toHaveBeenCalled();
      expect(coverageService.evaluateCoverage).not.toHaveBeenCalled();
    });
  });
});
