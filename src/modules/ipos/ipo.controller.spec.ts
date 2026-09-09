import { Test, TestingModule } from '@nestjs/testing';
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

describe('IpoController API Endpoints', () => {
  let controller: IpoController;
  let service: IpoService;

  const mockIpoRecord = {
    id: '11111111-1111-1111-1111-111111111111',
    companyId: 'comp-1',
    company: {
      id: 'comp-1',
      legalName: 'Test Company Ltd',
      displayName: 'Test Company',
      cin: 'L12345MH2020PLC123456',
      website: 'https://example.com',
      industry: 'Technology',
      sector: 'IT',
    },
    marketSegment: 'MAINBOARD' as const,
    exchange: 'NSE' as const,
    status: 'OPEN' as const,
    symbol: 'TEST',
    issueSize: null,
    freshIssueSize: null,
    ofsSize: null,
    faceValue: null,
    priceBandLow: null,
    priceBandHigh: null,
    lotSize: 100,
    minimumLots: 1,
    lifecycleEvents: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpoController],
      providers: [
        IpoService,
        {
          provide: IpoRepository,
          useValue: {
            findMany: jest.fn().mockResolvedValue([mockIpoRecord]),
            count: jest.fn().mockResolvedValue(1),
            findById: jest.fn().mockImplementation((id: string) => {
              if (id === '11111111-1111-1111-1111-111111111111') {
                return Promise.resolve({
                  ...mockIpoRecord,
                  company: mockIpoRecord.company,
                  lifecycleEvents: [
                    {
                      id: 'evt-1',
                      ipoId: id,
                      eventType: 'OPEN',
                      eventDate: new Date('2026-09-01'),
                      sourceId: 'src-1',
                      sourceReference: 'ref-1',
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    },
                  ],
                });
              }
              return Promise.resolve(null);
            }),
            findTimelineEvents: jest.fn().mockResolvedValue([
              {
                id: 'evt-1',
                ipoId: '11111111-1111-1111-1111-111111111111',
                eventType: 'OPEN',
                eventDate: new Date('2026-09-01'),
                sourceId: 'src-1',
                sourceReference: 'ref-1',
                createdAt: new Date('2026-09-01'),
                updatedAt: new Date('2026-09-01'),
              },
            ]),
            findSources: jest.fn().mockResolvedValue([
              {
                id: 'ident-1',
                ipoId: '11111111-1111-1111-1111-111111111111',
                sourceId: 'src-1',
                externalId: 'EXT-123',
                symbol: 'TEST',
                createdAt: new Date('2026-09-01'),
                updatedAt: new Date('2026-09-01'),
                source: {
                  id: 'src-1',
                  code: 'NSE',
                  name: 'National Stock Exchange',
                  sourceType: 'EXCHANGE',
                },
              },
            ]),
          },
        },
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: ReconciliationService,
          useValue: {
            reconcileIpo: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              hasCrossSourceConflict: false,
              canonicalValues: {},
              sebiActiveObservation: {},
              exchangeActiveObservation: {},
              fieldComparisons: [],
              provenanceReport: { ipoId: '11111111-1111-1111-1111-111111111111', hasAnyConflict: false, conflicts: [] },
            }),
          },
        },
        {
          provide: DiscoveryRefreshService,
          useValue: {
            generatePlan: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              generatedAt: new Date('2026-09-10T12:00:00.000Z'),
              hasRecommendedActions: false,
              actions: [],
            }),
          },
        },
        {
          provide: DiscoveryRefreshExecutionService,
          useValue: {
            execute: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              sourceCode: 'sebi',
              status: 'SKIPPED',
              startedAt: new Date('2026-09-10T12:00:00.000Z'),
              completedAt: new Date('2026-09-10T12:00:00.000Z'),
              outcome: 'SKIPPED',
              message: 'Refresh action skipped',
              reasons: ['NO_REFRESH_REQUIRED'],
            }),
          },
        },
        {
          provide: DiscoveryRefreshVerificationService,
          useValue: {
            verify: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              sourceCode: 'sebi',
              executionStatus: 'COMPLETED',
              refreshStartedAt: new Date('2026-09-10T11:59:00.000Z'),
              refreshCompletedAt: new Date('2026-09-10T12:00:00.000Z'),
              snapshotBefore: { bySource: {}, capturedAt: new Date('2026-09-10T11:59:00.000Z') },
              snapshotAfter: { bySource: {}, capturedAt: new Date('2026-09-10T12:00:00.000Z') },
              newProvenanceRecorded: false,
              fieldChanges: [],
              changedFieldCount: 0,
              qualitySummary: { status: 'HEALTHY', findings: [], summary: { errors: 0, warnings: 0, info: 0 } },
              freshnessSummary: { ipoId: '11111111-1111-1111-1111-111111111111', overallStatus: 'UNKNOWN', highestPriority: 'NONE', sourceDecisions: [], evaluatedAt: new Date() },
              reconciliationSummary: { ipoId: '11111111-1111-1111-1111-111111111111', hasCrossSourceConflict: false, canonicalValues: {}, sebiActiveObservation: {}, exchangeActiveObservation: {}, fieldComparisons: [], provenanceReport: { ipoId: '11111111-1111-1111-1111-111111111111', hasAnyConflict: false, conflicts: [] } },
              postRefreshPlan: { ipoId: '11111111-1111-1111-1111-111111111111', overallStatus: 'UNKNOWN', highestPriority: 'NONE', hasRecommendedActions: false, generatedAt: new Date(), actions: [] },
              verdict: { adequacy: 'REFRESH_DID_NOT_HELP', reasons: ['NO_NEW_PROVENANCE_RECORDED'], furtherRefreshRecommended: false },
              verifiedAt: new Date('2026-09-10T12:00:01.000Z'),
            }),
          },
        },
        {
          provide: DiscoverySmartRefreshService,
          useValue: {
            smartRefresh: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              sourceCode: 'sebi',
              generatedAt: new Date('2026-09-10T12:00:00.000Z'),
              finalOutcome: 'REFRESHED_AND_VERIFIED',
              summaryMessage: "Successfully refreshed 'sebi'.",
              initialRefreshPlan: { ipoId: '11111111-1111-1111-1111-111111111111', overallStatus: 'STALE', actions: [] },
            }),
          },
        },
        {
          provide: DiscoveryCoverageService,
          useValue: {
            evaluateCoverage: jest.fn().mockResolvedValue({
              ipoId: '11111111-1111-1111-1111-111111111111',
              overallStatus: 'COVERED',
              summary: { totalFields: 15, covered: 15, missing: 0, stale: 0, conflict: 0, notExpected: 0, unknown: 0 },
              fields: [],
              refreshRecommendations: [],
              evaluatedAt: new Date('2026-09-10T12:00:00.000Z'),
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<IpoController>(IpoController);
    service = module.get<IpoService>(IpoService);
  });

  it('1. GET /ipos - returns paginated list of IPOs', async () => {
    const result = await controller.list({ page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual({ page: 1, limit: 10, total: 1 });
  });

  it('2. GET /ipos/upcoming - filters by status UPCOMING', async () => {
    const listSpy = jest.spyOn(service, 'list');
    await controller.upcoming({ page: 1, limit: 10 });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'UPCOMING' }),
    );
  });

  it('3. GET /ipos/open - filters by status OPEN', async () => {
    const listSpy = jest.spyOn(service, 'list');
    await controller.open({ page: 1, limit: 10 });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN' }),
    );
  });

  it('4. GET /ipos/closed - filters by status CLOSED', async () => {
    const listSpy = jest.spyOn(service, 'list');
    await controller.closed({ page: 1, limit: 10 });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CLOSED' }),
    );
  });

  it('5. GET /ipos/listing-soon - filters by status LISTING_PENDING', async () => {
    const listSpy = jest.spyOn(service, 'list');
    await controller.listingSoon({ page: 1, limit: 10 });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LISTING_PENDING' }),
    );
  });

  it('6. GET /ipos/:id/timeline - returns lifecycle timeline events', async () => {
    const result = await controller.getTimeline({
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].eventType).toBe('OPEN');
    expect(result.events[0].eventDate).toBe('2026-09-01');
  });

  it('7. GET /ipos/:id/sources - returns mapped source identities without secrets', async () => {
    const result = await controller.getSources({
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].sourceCode).toBe('NSE');
    expect(result.sources[0].externalId).toBe('EXT-123');
  });

  it('8. GET /ipos/:id/reconciliation - returns reconciliation analysis summary', async () => {
    const result = await controller.getReconciliation({
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.hasCrossSourceConflict).toBe(false);
  });

  it('9. GET /ipos/:id - 404 behavior for unknown IPO ID', async () => {
    await expect(
      controller.getById({ id: '99999999-9999-9999-9999-999999999999' }),
    ).rejects.toThrow(AppException);
  });

  it('10. GET /ipos/:id/refresh-plan - returns refresh plan', async () => {
    const result = await controller.getRefreshPlan({
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.hasRecommendedActions).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('11. POST /ipos/:id/refresh - executes controlled refresh for given source', async () => {
    const result = await controller.executeRefresh(
      { id: '11111111-1111-1111-1111-111111111111' },
      { source: 'sebi' },
    );
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.sourceCode).toBe('sebi');
    expect(result.status).toBe('SKIPPED');
  });

  it('12. POST /ipos/:id/refresh-verification - returns post-refresh verification report', async () => {
    const now = new Date('2026-09-10T12:00:00.000Z');
    const result = await controller.verifyRefresh(
      { id: '11111111-1111-1111-1111-111111111111' },
      {
        source: 'sebi',
        executionStatus: 'COMPLETED',
        refreshStartedAt: new Date('2026-09-10T11:59:00.000Z'),
        refreshCompletedAt: now,
      },
    );
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.sourceCode).toBe('sebi');
    expect(result.executionStatus).toBe('COMPLETED');
    expect(result.verdict).toBeDefined();
    expect(result.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
    expect(result.postRefreshPlan).toBeDefined();
    expect(result.qualitySummary).toBeDefined();
  });

  it('13. POST /ipos/:id/smart-refresh - executes full smart refresh workflow', async () => {
    const result = await controller.smartRefresh(
      { id: '11111111-1111-1111-1111-111111111111' },
      { source: 'sebi' },
    );
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.sourceCode).toBe('sebi');
    expect(result.finalOutcome).toBe('REFRESHED_AND_VERIFIED');
    expect(result.summaryMessage).toBeDefined();
  });

  it('14. GET /ipos/:id/coverage - returns data coverage analysis report', async () => {
    const result = await controller.getCoverage({
      id: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.ipoId).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.overallStatus).toBe('COVERED');
    expect(result.summary).toBeDefined();
    expect(result.fields).toBeDefined();
  });
});
