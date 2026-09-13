import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { IpoController } from './ipo.controller';
import { IpoRepository } from './ipo.repository';
import { IpoService } from './ipo.service';
import { IpoWithRelations } from './ipo.types';
import {
  calculateIpoAnalytics,
  dateDiffInDays,
  deriveIssueComposition,
} from './ipo-analytics.calculator';
import { ReconciliationService } from '../discovery/reconciliation.service';
import { DiscoveryRefreshService } from '../discovery/discovery-refresh.service';
import { DiscoveryRefreshExecutionService } from '../discovery/discovery-refresh-execution.service';
import { DiscoveryRefreshVerificationService } from '../discovery/discovery-refresh-verification.service';
import { DiscoverySmartRefreshService } from '../discovery/discovery-smart-refresh.service';
import { DiscoveryCoverageService } from '../discovery/discovery-coverage.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';

describe('Phase 27 — IPO Analytics / Derived Metrics (Unit)', () => {
  let controller: IpoController;
  let repository: jest.Mocked<IpoRepository>;
  let qualityGateService: jest.Mocked<DiscoveryQualityGateService>;
  let coverageService: jest.Mocked<DiscoveryCoverageService>;

  const id1 = '11111111-1111-4111-8111-111111111111';
  const refDate = new Date('2026-09-10T00:00:00.000Z');

  const baseIpo: IpoWithRelations = {
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
        eventDate: new Date('2026-09-15T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'evt-2',
        ipoId: id1,
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-18T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: 'evt-3',
        ipoId: id1,
        eventType: 'LISTING',
        eventDate: new Date('2026-09-25T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
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

  describe('Pure Derivation Logic (ipo-analytics.calculator.ts)', () => {
    it('1. calculates metrics for a FRESH + OFS IPO accurately with decimal precision', () => {
      const result = calculateIpoAnalytics(baseIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssuePercentage).toBe('60.00');
      expect(metrics.ofsPercentage).toBe('40.00');
      expect(metrics.freshIssueSharePercentage).toBe('60.00');
      expect(metrics.ofsSharePercentage).toBe('40.00');
      expect(metrics.priceBandSpread).toBe('8.00');
      expect(metrics.priceBandSpreadPercentage).toBe('8.00');
      expect(metrics.minimumApplicationAmount).toBe('10800.00');
      expect(metrics.issueComposition).toBe('FRESH_AND_OFS');
      expect(metrics.daysToOpen).toBe(5);
      expect(metrics.daysToClose).toBe(8);
      expect(metrics.daysToListing).toBe(15);
    });

    it('2. calculates metrics for a FRESH-ONLY IPO', () => {
      const freshIpo: IpoWithRelations = {
        ...baseIpo,
        issueSize: new Prisma.Decimal('500.00'),
        freshIssueSize: new Prisma.Decimal('500.00'),
        ofsSize: new Prisma.Decimal('0.00'),
        freshIssueShareCount: new Prisma.Decimal('5000000'),
        ofsShareCount: new Prisma.Decimal('0'),
      };

      const result = calculateIpoAnalytics(freshIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssuePercentage).toBe('100.00');
      expect(metrics.ofsPercentage).toBe('0.00');
      expect(metrics.issueComposition).toBe('FRESH_ONLY');
    });

    it('3. calculates metrics for an OFS-ONLY IPO', () => {
      const ofsIpo: IpoWithRelations = {
        ...baseIpo,
        issueSize: new Prisma.Decimal('500.00'),
        freshIssueSize: new Prisma.Decimal('0.00'),
        ofsSize: new Prisma.Decimal('500.00'),
        freshIssueShareCount: new Prisma.Decimal('0'),
        ofsShareCount: new Prisma.Decimal('5000000'),
      };

      const result = calculateIpoAnalytics(ofsIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssuePercentage).toBe('0.00');
      expect(metrics.ofsPercentage).toBe('100.00');
      expect(metrics.issueComposition).toBe('OFS_ONLY');
    });

    it('4. handles missing issueSize cleanly (returns null percentages & UNKNOWN composition)', () => {
      const missingSizeIpo: IpoWithRelations = {
        ...baseIpo,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
      };

      const result = calculateIpoAnalytics(missingSizeIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssuePercentage).toBeNull();
      expect(metrics.ofsPercentage).toBeNull();
      expect(metrics.freshIssueSharePercentage).toBeNull();
      expect(metrics.ofsSharePercentage).toBeNull();
      expect(metrics.issueComposition).toBe('UNKNOWN');
    });

    it('5. protects against zero or invalid denominator', () => {
      const zeroSizeIpo: IpoWithRelations = {
        ...baseIpo,
        issueSize: new Prisma.Decimal('0.00'),
        freshIssueSize: new Prisma.Decimal('100.00'),
        issueShareCount: new Prisma.Decimal('0'),
      };

      const result = calculateIpoAnalytics(zeroSizeIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssuePercentage).toBeNull();
      expect(metrics.ofsPercentage).toBeNull();
      expect(metrics.freshIssueSharePercentage).toBeNull();
      expect(metrics.ofsSharePercentage).toBeNull();
    });

    it('6. handles missing share counts', () => {
      const missingSharesIpo: IpoWithRelations = {
        ...baseIpo,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
      };

      const result = calculateIpoAnalytics(missingSharesIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.freshIssueSharePercentage).toBeNull();
      expect(metrics.ofsSharePercentage).toBeNull();
    });

    it('7. calculates price band spread and spread percentage accurately', () => {
      const spreadIpo: IpoWithRelations = {
        ...baseIpo,
        priceBandLow: new Prisma.Decimal('200.00'),
        priceBandHigh: new Prisma.Decimal('220.00'),
      };

      const result = calculateIpoAnalytics(spreadIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.priceBandSpread).toBe('20.00');
      expect(metrics.priceBandSpreadPercentage).toBe('10.00');
    });

    it('8. returns null for price band spread when price band is missing', () => {
      const noBandIpo: IpoWithRelations = {
        ...baseIpo,
        priceBandLow: null,
        priceBandHigh: null,
      };

      const result = calculateIpoAnalytics(noBandIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.priceBandSpread).toBeNull();
      expect(metrics.priceBandSpreadPercentage).toBeNull();
    });

    it('9. calculates minimum application amount accurately', () => {
      const lotIpo: IpoWithRelations = {
        ...baseIpo,
        priceBandHigh: new Prisma.Decimal('150.00'),
        lotSize: 50,
        minimumLots: 2,
      };

      const result = calculateIpoAnalytics(lotIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.minimumApplicationAmount).toBe('15000.00');
    });

    it('10. returns null minimumApplicationAmount if lotSize or minimumLots is missing', () => {
      const noLotIpo: IpoWithRelations = {
        ...baseIpo,
        lotSize: null,
        minimumLots: null,
      };

      const result = calculateIpoAnalytics(noLotIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.minimumApplicationAmount).toBeNull();
    });

    it('11. returns null for missing lifecycle dates', () => {
      const noDatesIpo: IpoWithRelations = {
        ...baseIpo,
        lifecycleEvents: [],
      };

      const result = calculateIpoAnalytics(noDatesIpo, refDate);
      const { metrics } = result.data;

      expect(metrics.daysToOpen).toBeNull();
      expect(metrics.daysToClose).toBeNull();
      expect(metrics.daysToListing).toBeNull();
    });

    it('12. dateDiffInDays calculates exact day differences across calendar bounds', () => {
      const d1 = new Date('2026-09-20T00:00:00.000Z');
      const ref = new Date('2026-09-10T00:00:00.000Z');
      expect(dateDiffInDays(d1, ref)).toBe(10);
    });

    it('13. deriveIssueComposition helper operates correctly', () => {
      expect(
        deriveIssueComposition({
          issueSize: new Prisma.Decimal('100'),
          freshIssueSize: new Prisma.Decimal('100'),
          ofsSize: new Prisma.Decimal('0'),
          issueShareCount: null,
          freshIssueShareCount: null,
          ofsShareCount: null,
        }),
      ).toBe('FRESH_ONLY');
    });
  });

  describe('Service & Controller Integration', () => {
    it('14. GET /ipos/:id/analytics returns derived metrics for valid IPO ID', async () => {
      repository.findById.mockResolvedValue(baseIpo);

      const res = await controller.getAnalytics({ id: id1 });

      expect(repository.findById).toHaveBeenCalledTimes(1);
      expect(repository.findById).toHaveBeenCalledWith(id1);
      expect(res.data.ipoId).toBe(id1);
      expect(res.data.metrics.issueComposition).toBe('FRESH_AND_OFS');
      expect(res.data.evaluatedAt).toBeDefined();
    });

    it('15. GET /ipos/:id/analytics throws 404 (IPO_NOT_FOUND) when IPO does not exist', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getAnalytics({ id: id1 })).rejects.toThrow(
        AppException,
      );

      try {
        await controller.getAnalytics({ id: id1 });
      } catch (err: any) {
        expect(err.httpStatus).toBe(404);
        expect(err.code).toBe('IPO_NOT_FOUND');
      }
    });

    it('16. Analytics execution does NOT invoke Quality Gate, Coverage, Lineage, or Freshness engines', async () => {
      repository.findById.mockResolvedValue(baseIpo);

      await controller.getAnalytics({ id: id1 });

      expect(qualityGateService.evaluateQualityGate).not.toHaveBeenCalled();
      expect(coverageService.evaluateCoverage).not.toHaveBeenCalled();
    });
  });
});
