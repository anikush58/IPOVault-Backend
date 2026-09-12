import { Test, TestingModule } from '@nestjs/testing';
import { AllotmentResultStatus, Prisma } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import {
  calculateIndicativeValue,
  calculateLotCount,
  calculateLotRatio,
  calculateObservedAllotmentRate,
  calculateQualitySummary,
  categorizeAllotmentStatus,
  deduplicateObservations,
  getStatusPriority,
} from './allotment-intelligence.calculator';
import { AllotmentIntelligenceService } from './allotment-intelligence.service';
import { AllotmentRepository } from './allotment.repository';

describe('Phase 28.1 — Allotment Intelligence (Unit)', () => {
  let service: AllotmentIntelligenceService;
  let repository: jest.Mocked<AllotmentRepository>;
  let prisma: jest.Mocked<PrismaService>;

  const userId1 = 'user-11111111-1111-4111-8111-111111111111';
  const userId2 = 'user-22222222-2222-4222-8222-222222222222';
  const ipoId1 = 'ipo-11111111-1111-4111-8111-111111111111';
  const jobId1 = 'job-11111111-1111-4111-8111-111111111111';

  const pan1Hash = 'hash-pan-1';
  const pan2Hash = 'hash-pan-2';

  const mockSavedPans = [
    {
      id: 'span-1',
      userId: userId1,
      panEncrypted: 'enc1',
      panMasked: 'ABCDE****F',
      panHash: pan1Hash,
      name: 'Primary Account',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'span-2',
      userId: userId1,
      panEncrypted: 'enc2',
      panMasked: 'XYZAB****C',
      panHash: pan2Hash,
      name: 'Spouse Account',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockJob1 = {
    id: jobId1,
    userId: userId1,
    ipoId: ipoId1,
    status: 'COMPLETED',
    totalChecks: 2,
    processedChecks: 2,
    successfulChecks: 2,
    failedChecks: 0,
    items: [
      {
        id: 'item-1',
        identifierHash: pan1Hash,
        maskedId: 'ABCDE****F',
        status: AllotmentResultStatus.ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 100,
        checkedAt: new Date(),
      },
      {
        id: 'item-2',
        identifierHash: pan2Hash,
        maskedId: 'XYZAB****C',
        status: AllotmentResultStatus.NOT_ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 0,
        checkedAt: new Date(),
      },
    ],
  };


  beforeEach(async () => {
    const mockRepo = {
      findUserJobsWithItems: jest.fn(),
      findUserSavedPans: jest.fn(),
      findIposPriceBands: jest.fn(),
      logCheckAttempt: jest.fn(),
      findHistoryByIdentifier: jest.fn(),
      findUserJobsForIpo: jest.fn(),
      findIposMetadata: jest.fn(),
    };

    const mockPrisma = {
      allotmentCheckJob: {
        findUnique: jest.fn(),
      },
      ipo: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllotmentIntelligenceService,
        { provide: AllotmentRepository, useValue: mockRepo },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AllotmentIntelligenceService>(
      AllotmentIntelligenceService,
    );
    repository = module.get(AllotmentRepository);
    prisma = module.get(PrismaService);
  });

  describe('Calculator Helpers', () => {
    it('1. categorizeAllotmentStatus categorizes outcomes correctly', () => {
      expect(categorizeAllotmentStatus(AllotmentResultStatus.ALLOTTED)).toBe(
        'ALLOTTED',
      );
      expect(
        categorizeAllotmentStatus(AllotmentResultStatus.PARTIALLY_ALLOTTED),
      ).toBe('ALLOTTED');
      expect(
        categorizeAllotmentStatus(AllotmentResultStatus.NOT_ALLOTTED),
      ).toBe('NOT_ALLOTTED');
      expect(
        categorizeAllotmentStatus(AllotmentResultStatus.SOURCE_UNAVAILABLE),
      ).toBe('FAILED');
      expect(
        categorizeAllotmentStatus(AllotmentResultStatus.NOT_YET_AVAILABLE),
      ).toBe('UNKNOWN');
    });

    it('2. calculateObservedAllotmentRate calculates rate accurately and handles zero denominator', () => {
      expect(calculateObservedAllotmentRate(1, 3)).toBe('25.00');
      expect(calculateObservedAllotmentRate(0, 5)).toBe('0.00');
      expect(calculateObservedAllotmentRate(0, 0)).toBeNull();
    });

    it('3. calculateIndicativeValue handles Decimal precision and null inputs', () => {
      expect(
        calculateIndicativeValue(100, new Prisma.Decimal('150.00')),
      ).toBe('15000.00');
      expect(calculateIndicativeValue(null, new Prisma.Decimal('150.00'))).toBeNull();
      expect(calculateIndicativeValue(100, null)).toBeNull();
    });
  });

  describe('User Summary Intelligence', () => {
    it('4. aggregates user summary intelligence accurately', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposPriceBands.mockResolvedValue([
        { id: ipoId1, priceBandHigh: new Prisma.Decimal('150.00') },
      ]);

      const res = await service.getUserSummaryIntelligence(userId1);
      const { summary, capital, panBreakdown } = res.data;

      expect(summary.totalJobs).toBe(1);
      expect(summary.totalChecks).toBe(2);
      expect(summary.completedChecks).toBe(2);
      expect(summary.allottedChecks).toBe(1);
      expect(summary.notAllottedChecks).toBe(1);
      expect(summary.observedAllotmentRate).toBe('50.00');

      expect(capital.indicativeAppliedValue).toBe('30000.00');
      expect(capital.indicativeAllottedValue).toBe('15000.00');

      expect(panBreakdown).toHaveLength(2);
      expect(panBreakdown[0].alias).toBe('Primary Account');
      expect(panBreakdown[0].allottedChecks).toBe(1);
      expect(panBreakdown[0].observedAllotmentRate).toBe('100.00');

      expect(panBreakdown[1].alias).toBe('Spouse Account');
      expect(panBreakdown[1].notAllottedChecks).toBe(1);
      expect(panBreakdown[1].observedAllotmentRate).toBe('0.00');
    });

    it('5. returns null observedAllotmentRate when user has no completed checks', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([]);
      repository.findUserSavedPans.mockResolvedValue([]);
      repository.findIposPriceBands.mockResolvedValue([]);

      const res = await service.getUserSummaryIntelligence(userId1);

      expect(res.data.summary.totalChecks).toBe(0);
      expect(res.data.summary.observedAllotmentRate).toBeNull();
      expect(res.data.capital.indicativeAppliedValue).toBeNull();
    });

    it('6. excludes failed and unknown checks from observed allotment rate denominator', async () => {
      const jobWithErrors = {
        ...mockJob1,
        items: [
          ...mockJob1.items,
          {
            id: 'item-3',
            identifierHash: pan1Hash,
            maskedId: 'ABCDE****F',
            status: AllotmentResultStatus.SOURCE_UNAVAILABLE,
            sharesApplied: null,
            sharesAllotted: null,
            checkedAt: new Date(),
          },
          {
            id: 'item-4',
            identifierHash: pan1Hash,
            maskedId: 'ABCDE****F',
            status: AllotmentResultStatus.NOT_YET_AVAILABLE,
            sharesApplied: null,
            sharesAllotted: null,
            checkedAt: new Date(),
          },
        ],
      };

      repository.findUserJobsWithItems.mockResolvedValue([jobWithErrors as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposPriceBands.mockResolvedValue([
        { id: ipoId1, priceBandHigh: new Prisma.Decimal('150.00') },
      ]);

      const res = await service.getUserSummaryIntelligence(userId1);

      expect(res.data.summary.failedChecks).toBe(1);
      expect(res.data.summary.unknownChecks).toBe(1);
      expect(res.data.summary.completedChecks).toBe(2);
      expect(res.data.summary.observedAllotmentRate).toBe('50.00');
    });

    it('7. throws 401 UNAUTHORIZED if userId is missing', async () => {
      await expect(service.getUserSummaryIntelligence('')).rejects.toThrow(
        AppException,
      );

      try {
        await service.getUserSummaryIntelligence('');
      } catch (err: any) {
        expect(err.httpStatus).toBe(401);
        expect(err.code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('Job-Specific Intelligence', () => {
    it('8. aggregates job-specific intelligence with accounts and indicative capital', async () => {
      (prisma.allotmentCheckJob.findUnique as jest.Mock).mockResolvedValue(
        mockJob1,
      );
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      (prisma.ipo.findUnique as jest.Mock).mockResolvedValue({
        priceBandHigh: new Prisma.Decimal('150.00'),
      });

      const res = await service.getJobIntelligence(jobId1, userId1);
      const { summary, capital, accounts } = res.data;

      expect(res.data.jobId).toBe(jobId1);
      expect(summary.totalChecks).toBe(2);
      expect(summary.allottedChecks).toBe(1);
      expect(summary.notAllottedChecks).toBe(1);
      expect(summary.observedAllotmentRate).toBe('50.00');

      expect(capital.indicativeAppliedValue).toBe('30000.00');
      expect(capital.indicativeAllottedValue).toBe('15000.00');

      expect(accounts).toHaveLength(2);
      expect(accounts[0].alias).toBe('Primary Account');
      expect(accounts[0].maskedPan).toBe('ABCDE****F');
      expect(accounts[0].indicativeAppliedValue).toBe('15000.00');
      expect(accounts[0].indicativeAllottedValue).toBe('15000.00');

      expect(accounts[1].alias).toBe('Spouse Account');
      expect(accounts[1].indicativeAppliedValue).toBe('15000.00');
      expect(accounts[1].indicativeAllottedValue).toBeNull();
    });

    it('9. throws 404 (NOT_FOUND) when job belongs to another user (isolation protection)', async () => {
      (prisma.allotmentCheckJob.findUnique as jest.Mock).mockResolvedValue(
        mockJob1,
      );

      await expect(
        service.getJobIntelligence(jobId1, userId2),
      ).rejects.toThrow(AppException);

      try {
        await service.getJobIntelligence(jobId1, userId2);
      } catch (err: any) {
        expect(err.httpStatus).toBe(404);
        expect(err.code).toBe('NOT_FOUND');
      }
    });

    it('10. throws 401 UNAUTHORIZED if userId is missing', async () => {
      await expect(service.getJobIntelligence(jobId1, '')).rejects.toThrow(
        AppException,
      );
    });

    it('11. returns null indicative capital values if IPO price is missing', async () => {
      (prisma.allotmentCheckJob.findUnique as jest.Mock).mockResolvedValue(
        mockJob1,
      );
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposPriceBands.mockResolvedValue([
        { id: ipoId1, priceBandHigh: null },
      ]);

      const res = await service.getJobIntelligence(jobId1, userId1);

      expect(res.data.capital.indicativeAppliedValue).toBeNull();
      expect(res.data.capital.indicativeAllottedValue).toBeNull();
      expect(res.data.accounts[0].indicativeAppliedValue).toBeNull();
    });
  });

  describe('Deduplication Engine (Phase 28.2)', () => {
    it('12. getStatusPriority returns 1 for definitive, 2 for non-definitive, 3 for failed', () => {
      expect(getStatusPriority(AllotmentResultStatus.ALLOTTED)).toBe(1);
      expect(getStatusPriority(AllotmentResultStatus.PARTIALLY_ALLOTTED)).toBe(1);
      expect(getStatusPriority(AllotmentResultStatus.NOT_ALLOTTED)).toBe(1);
      expect(getStatusPriority(AllotmentResultStatus.NOT_YET_AVAILABLE)).toBe(2);
      expect(getStatusPriority(AllotmentResultStatus.APPLICATION_NOT_FOUND)).toBe(2);
      expect(getStatusPriority(AllotmentResultStatus.SOURCE_UNAVAILABLE)).toBe(3);
      expect(getStatusPriority(AllotmentResultStatus.RATE_LIMITED)).toBe(3);
    });

    it('13. deduplicates repeated NOT_ALLOTTED checks and keeps latest checkedAt', () => {
      const d1 = new Date('2026-09-01T10:00:00Z');
      const d2 = new Date('2026-09-01T12:00:00Z');

      const jobs = [
        {
          id: 'j1',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 0,
              checkedAt: d1,
            },
          ],
        },
        {
          id: 'j2',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it2',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 0,
              checkedAt: d2,
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      expect(resMap.size).toBe(1);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs).toBeDefined();
      expect(obs?.checkedAt?.toISOString()).toBe(d2.toISOString());
    });

    it('14. updates NOT_ALLOTTED to ALLOTTED when newer job discovers allotment', () => {
      const d1 = new Date('2026-09-01T10:00:00Z');
      const d2 = new Date('2026-09-01T12:00:00Z');

      const jobs = [
        {
          id: 'j1',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 0,
              checkedAt: d1,
            },
          ],
        },
        {
          id: 'j2',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it2',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 100,
              checkedAt: d2,
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs?.status).toBe(AllotmentResultStatus.ALLOTTED);
      expect(obs?.sharesAllotted).toBe(100);
    });

    it('15. does NOT let a subsequent transient failure overwrite a definitive ALLOTTED result', () => {
      const d1 = new Date('2026-09-01T10:00:00Z');
      const d2 = new Date('2026-09-02T10:00:00Z');

      const jobs = [
        {
          id: 'j1',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 100,
              checkedAt: d1,
            },
          ],
        },
        {
          id: 'j2',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED_WITH_ERRORS',
          totalChecks: 1,
          processedChecks: 0,
          successfulChecks: 0,
          failedChecks: 1,
          items: [
            {
              id: 'it2',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.SOURCE_UNAVAILABLE,
              sharesApplied: null,
              sharesAllotted: null,
              checkedAt: d2,
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs?.status).toBe(AllotmentResultStatus.ALLOTTED);
      expect(obs?.sharesAllotted).toBe(100);
    });

    it('16. updates NOT_YET_AVAILABLE to NOT_ALLOTTED when definitive outcome arrives', () => {
      const d1 = new Date('2026-09-01T10:00:00Z');
      const d2 = new Date('2026-09-01T12:00:00Z');

      const jobs = [
        {
          id: 'j1',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_YET_AVAILABLE,
              sharesApplied: null,
              sharesAllotted: null,
              checkedAt: d1,
            },
          ],
        },
        {
          id: 'j2',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it2',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 0,
              checkedAt: d2,
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs?.status).toBe(AllotmentResultStatus.NOT_ALLOTTED);
    });

    it('17. handles PARTIALLY_ALLOTTED as a definitive allotted outcome', () => {
      const jobs = [
        {
          id: 'j1',
          userId: userId1,
          ipoId: ipoId1,
          status: 'COMPLETED',
          totalChecks: 1,
          processedChecks: 1,
          successfulChecks: 1,
          failedChecks: 0,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.PARTIALLY_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 50,
              checkedAt: new Date('2026-09-01T10:00:00Z'),
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs?.status).toBe(AllotmentResultStatus.PARTIALLY_ALLOTTED);
      expect(obs?.sharesAllotted).toBe(50);
    });

    it('18. handles identical checkedAt with deterministic tie-breaking', () => {
      const sameTime = new Date('2026-09-01T10:00:00Z');

      const jobs = [
        {
          id: 'j1',
          createdAt: new Date('2026-09-01T10:00:00Z'),
          userId: userId1,
          ipoId: ipoId1,
          items: [
            {
              id: 'it1',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.NOT_ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 0,
              checkedAt: sameTime,
            },
          ],
        },
        {
          id: 'j2',
          createdAt: new Date('2026-09-01T10:05:00Z'),
          userId: userId1,
          ipoId: ipoId1,
          items: [
            {
              id: 'it2',
              identifierHash: pan1Hash,
              maskedId: 'ABCDE****F',
              status: AllotmentResultStatus.ALLOTTED,
              sharesApplied: 100,
              sharesAllotted: 100,
              checkedAt: sameTime,
            },
          ],
        },
      ];

      const resMap = deduplicateObservations(jobs as any);
      const obs = resMap.get(`${ipoId1}:${pan1Hash}`);
      expect(obs?.status).toBe(AllotmentResultStatus.ALLOTTED);
    });
  });

  describe('User History Intelligence (GET /intelligence/history)', () => {
    it('19. returns deduplicated user history with rate, capital, and panBreakdown', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposMetadata.mockResolvedValue([
        {
          id: ipoId1,
          symbol: 'TESTIPO',
          priceBandHigh: new Prisma.Decimal('150.00'),
          lotSize: 100,
          company: { displayName: 'Test Corp', legalName: 'Test Corp' },
        },
      ]);

      const res = await service.getUserAllotmentHistory(userId1);
      const { summary, capital, panBreakdown, ipoHistory } = res.data;

      expect(summary.totalDistinctPanIpoPairs).toBe(2);
      expect(summary.totalIposChecked).toBe(1);
      expect(summary.allottedCount).toBe(1);
      expect(summary.notAllottedCount).toBe(1);
      expect(summary.observedLatestResultRate).toBe('50.00');

      expect(capital.indicativeAppliedValue).toBe('30000.00');
      expect(capital.indicativeAllottedValue).toBe('15000.00');

      expect(panBreakdown).toHaveLength(2);
      expect(ipoHistory).toHaveLength(1);
      expect(ipoHistory[0].symbol).toBe('TESTIPO');
      expect(ipoHistory[0].overallOutcome).toBe('PARTIALLY_ALLOTTED');
    });

    it('20. throws 401 UNAUTHORIZED when userId is missing', async () => {
      await expect(service.getUserAllotmentHistory('')).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('IPO-Specific Intelligence (GET /ipos/:id/intelligence)', () => {
    it('21. returns per-IPO deduplicated intelligence with account breakdown and lot math', async () => {
      (prisma.ipo.findUnique as jest.Mock).mockResolvedValue({
        id: ipoId1,
        symbol: 'TESTIPO',
        priceBandHigh: new Prisma.Decimal('150.00'),
        lotSize: 100,
        company: { displayName: 'Test Corp', legalName: 'Test Corp' },
      });
      repository.findUserJobsForIpo.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);

      const res = await service.getIpoAllotmentIntelligence(ipoId1, userId1);
      const { userSummary, capital, accounts } = res.data;

      expect(res.data.ipoId).toBe(ipoId1);
      expect(res.data.symbol).toBe('TESTIPO');
      expect(userSummary.totalDistinctPanIpoPairs).toBe(2);
      expect(userSummary.allottedCount).toBe(1);
      expect(userSummary.notAllottedCount).toBe(1);
      expect(userSummary.totalLotsApplied).toBe(2);
      expect(userSummary.totalLotsAllotted).toBe(1);
      expect(userSummary.observedLatestResultRate).toBe('50.00');

      expect(capital.indicativeAppliedValue).toBe('30000.00');
      expect(capital.indicativeAllottedValue).toBe('15000.00');

      expect(accounts).toHaveLength(2);
      expect(accounts[0].alias).toBe('Primary Account');
      expect(accounts[0].lotsApplied).toBe(1);
      expect(accounts[0].lotsAllotted).toBe(1);
    });

    it('22. throws 404 NOT_FOUND when IPO does not exist', async () => {
      (prisma.ipo.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getIpoAllotmentIntelligence('non-existent-ipo', userId1),
      ).rejects.toThrow(AppException);
    });

    it('23. throws 401 UNAUTHORIZED when userId is missing', async () => {
      await expect(
        service.getIpoAllotmentIntelligence(ipoId1, ''),
      ).rejects.toThrow(AppException);
    });
  });

  describe('Phase 28.3 — Advanced Analytics & Per-PAN Intelligence', () => {
    it('24. calculateLotCount handles exact multiples and returns null for non-divisible shares or invalid lotSize', () => {
      expect(calculateLotCount(200, 100)).toBe(2);
      expect(calculateLotCount(150, 100)).toBeNull(); // non-divisible share count
      expect(calculateLotCount(0, 100)).toBeNull();
      expect(calculateLotCount(100, 0)).toBeNull();
      expect(calculateLotCount(100, null)).toBeNull();
    });

    it('25. calculateLotRatio computes percentage ratio or returns null when applied lots is zero', () => {
      expect(calculateLotRatio(2, 4)).toBe('50.00');
      expect(calculateLotRatio(0, 4)).toBe('0.00');
      expect(calculateLotRatio(1, 0)).toBeNull();
    });

    it('26. getUserPanIntelligence returns per-PAN deduplicated observation analytics', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposMetadata.mockResolvedValue([
        {
          id: ipoId1,
          symbol: 'TESTIPO',
          priceBandHigh: new Prisma.Decimal('150.00'),
          lotSize: 100,
          company: { displayName: 'Test Corp', legalName: 'Test Corp' },
        },
      ]);

      const res = await service.getUserPanIntelligence(userId1);
      expect(res.data.pans).toHaveLength(2);

      const pan1Data = res.data.pans.find((p) => p.panId === 'span-1');
      expect(pan1Data?.alias).toBe('Primary Account');
      expect(pan1Data?.allottedCount).toBe(1);
      expect(pan1Data?.observedLatestResultRate).toBe('100.00');
      expect(pan1Data?.totalLotsApplied).toBe(1);
      expect(pan1Data?.totalLotsAllotted).toBe(1);
      expect(pan1Data?.allotmentLotRatio).toBe('100.00');

      const pan2Data = res.data.pans.find((p) => p.panId === 'span-2');
      expect(pan2Data?.alias).toBe('Spouse Account');
      expect(pan2Data?.notAllottedCount).toBe(1);
      expect(pan2Data?.observedLatestResultRate).toBe('0.00');
    });

    it('27. getUserPanIntelligence throws 401 UNAUTHORIZED when userId is missing', async () => {
      await expect(service.getUserPanIntelligence('')).rejects.toThrow(
        AppException,
      );
    });

    it('28. getUserAllotmentHistory includes monthlyTrend data', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposMetadata.mockResolvedValue([
        {
          id: ipoId1,
          symbol: 'TESTIPO',
          priceBandHigh: new Prisma.Decimal('150.00'),
          lotSize: 100,
          company: { displayName: 'Test Corp', legalName: 'Test Corp' },
        },
      ]);

      const res = await service.getUserAllotmentHistory(userId1);
      expect(res.data.monthlyTrend).toBeDefined();
      expect(res.data.summary.allotmentLotRatio).toBe('50.00');
    });
  });

  describe('Phase 28.4 — Quality & Explainability Analytics', () => {
    it('29. calculateQualitySummary handles zero observations cleanly with NO_OBSERVATIONS reason', () => {
      const q = calculateQualitySummary({ observations: [] });
      expect(q.totalObservations).toBe(0);
      expect(q.observationCoveragePercentage).toBeNull();
      expect(q.lotDataCoveragePercentage).toBeNull();
      expect(q.capitalDataCoveragePercentage).toBeNull();
      expect(q.reasons).toContain('NO_OBSERVATIONS');
      expect(q.reasons).toContain('BOUNDED_HISTORY');
      expect(q.boundedHistory).toBe(true);
    });

    it('30. calculateQualitySummary computes exact coverage percentages and reasons for mixed observations', () => {
      const observations = [
        {
          ipoId: ipoId1,
          identifierHash: pan1Hash,
          maskedId: 'ABCDE****F',
          status: AllotmentResultStatus.ALLOTTED,
          sharesApplied: 100,
          sharesAllotted: 100,
          checkedAt: new Date(),
          jobCreatedAt: new Date(),
        },
        {
          ipoId: ipoId1,
          identifierHash: pan2Hash,
          maskedId: 'XYZAB****C',
          status: AllotmentResultStatus.SOURCE_UNAVAILABLE,
          sharesApplied: 100,
          sharesAllotted: null,
          checkedAt: new Date(),
          jobCreatedAt: new Date(),
        },
      ];

      const ipoMap = new Map([
        [
          ipoId1,
          {
            priceBandHigh: new Prisma.Decimal('150.00'),
            lotSize: 100,
          },
        ],
      ]);

      const q = calculateQualitySummary({ observations, ipoMap });
      expect(q.totalObservations).toBe(2);
      expect(q.definitiveObservationCount).toBe(1);
      expect(q.failedObservationCount).toBe(1);
      expect(q.observationCoveragePercentage).toBe('50.00');
      expect(q.reasons).toContain('FAILED_RESULTS_PRESENT');
    });

    it('31. getUserAllotmentHistory includes quality object with boundedHistory flag', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposMetadata.mockResolvedValue([
        {
          id: ipoId1,
          symbol: 'TESTIPO',
          priceBandHigh: new Prisma.Decimal('150.00'),
          lotSize: 100,
          company: { displayName: 'Test Corp', legalName: 'Test Corp' },
        },
      ]);

      const res = await service.getUserAllotmentHistory(userId1);
      expect(res.data.quality).toBeDefined();
      expect(res.data.quality.totalObservations).toBe(2);
      expect(res.data.quality.definitiveObservationCount).toBe(2);
      expect(res.data.quality.observationCoveragePercentage).toBe('100.00');
      expect(res.data.quality.boundedHistory).toBe(true);
      expect(res.data.quality.historyJobLimit).toBe(100);
    });

    it('32. getIpoAllotmentIntelligence includes per-IPO quality summary', async () => {
      (prisma.ipo.findUnique as jest.Mock).mockResolvedValue({
        id: ipoId1,
        symbol: 'TESTIPO',
        priceBandHigh: new Prisma.Decimal('150.00'),
        lotSize: 100,
        company: { displayName: 'Test Corp', legalName: 'Test Corp' },
      });
      repository.findUserJobsForIpo.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);

      const res = await service.getIpoAllotmentIntelligence(ipoId1, userId1);
      expect(res.data.quality).toBeDefined();
      expect(res.data.quality.totalObservations).toBe(2);
      expect(res.data.quality.historyJobLimit).toBe(50);
    });

    it('33. getUserPanIntelligence includes per-PAN quality summary', async () => {
      repository.findUserJobsWithItems.mockResolvedValue([mockJob1 as any]);
      repository.findUserSavedPans.mockResolvedValue(mockSavedPans as any);
      repository.findIposMetadata.mockResolvedValue([
        {
          id: ipoId1,
          symbol: 'TESTIPO',
          priceBandHigh: new Prisma.Decimal('150.00'),
          lotSize: 100,
          company: { displayName: 'Test Corp', legalName: 'Test Corp' },
        },
      ]);

      const res = await service.getUserPanIntelligence(userId1);
      expect(res.data.pans[0].quality).toBeDefined();
      expect(res.data.pans[0].quality.totalObservations).toBe(1);
    });
  });
});
