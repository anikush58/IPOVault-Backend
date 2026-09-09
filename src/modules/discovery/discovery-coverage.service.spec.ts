/**
 * Phase 19 — Smart IPO Data Coverage & Source Reconciliation Tests
 */

import { SourceHealthStatus, SourceType } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import { DiscoveryCoverageService } from './discovery-coverage.service';
import { IpoReconciliationSummary } from './reconciliation.service';

const now = new Date('2026-09-10T12:00:00.000Z');

function makeIpoRecord(partial: Record<string, unknown> = {}) {
  return {
    id: 'ipo-1',
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
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    status: 'OPEN',
    symbol: 'TESTSYM',
    issueSize: '100.00',
    freshIssueSize: '60.00',
    ofsSize: '40.00',
    issueShareCount: '10000000',
    freshIssueShareCount: '6000000',
    ofsShareCount: '4000000',
    faceValue: '10.00',
    priceBandLow: '100.00',
    priceBandHigh: '120.00',
    lotSize: 100,
    minimumLots: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    lifecycleEvents: [
      {
        id: 'evt-1',
        ipoId: 'ipo-1',
        eventType: 'OPEN',
        eventDate: new Date('2026-09-01T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'ref-1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'evt-2',
        ipoId: 'ipo-1',
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-05T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'ref-2',
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...partial,
  };
}

function makeDb(ipoRecord: Record<string, unknown> | null = makeIpoRecord()) {
  return {
    ipo: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => {
        if (!ipoRecord) return Promise.resolve(null);
        return Promise.resolve(
          (ipoRecord as Record<string, unknown>).id === args.where.id ? ipoRecord : null,
        );
      }),
    },
  };
}

function makeReconciliationSummary(
  conflicts: Array<{ fieldName: string; hasConflict: boolean; activeObs: any[] }> = [],
  staleSource = false,
): IpoReconciliationSummary {
  return {
    ipoId: 'ipo-1',
    hasCrossSourceConflict: conflicts.some((c) => c.hasConflict),
    canonicalValues: {},
    sebiActiveObservation: {},
    exchangeActiveObservation: {},
    fieldComparisons: conflicts.map((c) => ({
      fieldName: c.fieldName,
      sebiValue: c.activeObs[0]?.value ?? null,
      exchangeValue: c.activeObs[1]?.value ?? null,
      outcome: c.hasConflict ? 'CONFLICT' : 'MATCH',
    })),
    provenanceReport: {
      ipoId: 'ipo-1',
      hasAnyConflict: conflicts.some((c) => c.hasConflict),
      conflicts: conflicts.map((c) => ({
        fieldName: c.fieldName,
        canonicalValue: c.activeObs[0]?.value ?? null,
        hasConflict: c.hasConflict,
        activeObservations: c.activeObs,
        historicalObservations: c.activeObs,
        observations: c.activeObs,
      })),
    },
    qualitySummary: {
      status: conflicts.some((c) => c.hasConflict) ? 'NEEDS_REVIEW' : 'HEALTHY',
      findings: [],
      summary: { errors: 0, warnings: 0, info: 0 },
    },
    freshnessSummary: {
      ipoId: 'ipo-1',
      overallStatus: staleSource ? 'STALE' : 'FRESH',
      highestPriority: staleSource ? 'MEDIUM' : 'NONE',
      sourceDecisions: [
        {
          sourceId: 'src-sebi',
          sourceCode: 'sebi',
          sourceType: SourceType.OFFICIAL_FILING,
          healthStatus: SourceHealthStatus.HEALTHY,
          status: staleSource ? 'STALE' : 'FRESH',
          priority: staleSource ? 'MEDIUM' : 'NONE',
          lastObservedAt: now,
          reasons: [],
          messages: [],
          recommendRefresh: staleSource,
        },
      ],
      evaluatedAt: now,
    },
  };
}

describe('DiscoveryCoverageService (Phase 19)', () => {
  let mockReconciliationService: { reconcileIpo: jest.Mock };
  let mockRefreshPlanService: { generatePlan: jest.Mock };
  let service: DiscoveryCoverageService;

  beforeEach(() => {
    mockReconciliationService = { reconcileIpo: jest.fn() };
    mockRefreshPlanService = { generatePlan: jest.fn() };

    service = new DiscoveryCoverageService(
      mockReconciliationService as any,
      mockRefreshPlanService as any,
    );

    mockRefreshPlanService.generatePlan.mockResolvedValue({
      ipoId: 'ipo-1',
      overallStatus: 'FRESH',
      highestPriority: 'NONE',
      hasRecommendedActions: false,
      generatedAt: now,
      actions: [],
    });
  });

  it('1. Fully covered IPO → returns overallStatus COVERED', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary([
        {
          fieldName: 'issue_size',
          hasConflict: false,
          activeObs: [{ sourceCode: 'sebi', value: '100.00', retrievedAt: now }],
        },
      ]),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.ipoId).toBe('ipo-1');
    expect(report.summary.totalFields).toBeGreaterThan(0);
    expect(report.fields.find((f) => f.fieldName === 'issueSize')?.status).toBe('COVERED');
  });

  it('2. Missing terms → detects MISSING status for missing price band and lot size', async () => {
    const db = makeDb(
      makeIpoRecord({
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
      }),
    );
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary([
        {
          fieldName: 'price_band_low',
          hasConflict: false,
          activeObs: [{ sourceCode: 'sebi', value: '', retrievedAt: now }],
        },
        {
          fieldName: 'lot_size',
          hasConflict: false,
          activeObs: [{ sourceCode: 'sebi', value: '', retrievedAt: now }],
        },
      ]),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.summary.missing).toBeGreaterThan(0);
    expect(report.fields.find((f) => f.fieldName === 'priceBandLow')?.status).toBe('MISSING');
    expect(report.fields.find((f) => f.fieldName === 'lotSize')?.status).toBe('MISSING');
  });

  it('3. Missing issue structure → flags missing fresh issue breakdown', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: null,
        ofsSize: null,
      }),
    );
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary([
        {
          fieldName: 'fresh_issue_size',
          hasConflict: false,
          activeObs: [{ sourceCode: 'sebi', value: '', retrievedAt: now }],
        },
      ]),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'freshIssueSize')?.status).toBe('MISSING');
  });

  it('4. Stale provenance → marks field status as STALE when providing source is stale', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary(
        [
          {
            fieldName: 'issue_size',
            hasConflict: false,
            activeObs: [{ sourceCode: 'sebi', value: '100.00', retrievedAt: now }],
          },
        ],
        true, // stale source
      ),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'issueSize')?.status).toBe('STALE');
    expect(report.summary.stale).toBeGreaterThan(0);
  });

  it('5. Source conflict → marks field status as CONFLICT when sources disagree', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary([
        {
          fieldName: 'issue_size',
          hasConflict: true,
          activeObs: [
            { sourceCode: 'sebi', value: '100.00', retrievedAt: now },
            { sourceCode: 'nse', value: '105.00', retrievedAt: now },
          ],
        },
      ]),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'issueSize')?.status).toBe('CONFLICT');
    expect(report.summary.conflict).toBeGreaterThan(0);
    expect(report.overallStatus).toBe('CONFLICT');
  });

  it('6. SEBI-only field → company.cin shows SEBI as providing source', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(
      makeReconciliationSummary([
        {
          fieldName: 'cin',
          hasConflict: false,
          activeObs: [{ sourceCode: 'sebi', value: 'L12345MH2020PLC123456', retrievedAt: now }],
        },
      ]),
    );

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const cinField = report.fields.find((f) => f.fieldName === 'company.cin');
    expect(cinField?.expectedSources).toEqual(['sebi']);
    expect(cinField?.providingSource).toBe('sebi');
  });

  it('7. Exchange-only field → listingDate shows expected source nse', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary());

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const listingField = report.fields.find((f) => f.fieldName === 'listingDate');
    expect(listingField?.expectedSources).toEqual(['nse']);
  });

  it('8. Neither source has field → status is UNKNOWN when no observation recorded', async () => {
    const db = makeDb(makeIpoRecord({ faceValue: null }));
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary([]));

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const faceValField = report.fields.find((f) => f.fieldName === 'faceValue');
    expect(faceValField?.status).toBe('UNKNOWN');
  });

  it('9. Fresh-only issue → ofsSize and ofsShareCount marked NOT_EXPECTED_FROM_SOURCE', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: '100.00',
        ofsSize: null,
        issueShareCount: '1000000',
        freshIssueShareCount: '1000000',
        ofsShareCount: null,
      }),
    );
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary());

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'ofsSize')?.status).toBe('NOT_EXPECTED_FROM_SOURCE');
    expect(report.fields.find((f) => f.fieldName === 'ofsShareCount')?.status).toBe('NOT_EXPECTED_FROM_SOURCE');
  });

  it('10. OFS-only issue → freshIssueSize and freshIssueShareCount marked NOT_EXPECTED_FROM_SOURCE', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: null,
        ofsSize: '100.00',
        issueShareCount: '1000000',
        freshIssueShareCount: null,
        ofsShareCount: '1000000',
      }),
    );
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary());

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'freshIssueSize')?.status).toBe('NOT_EXPECTED_FROM_SOURCE');
    expect(report.fields.find((f) => f.fieldName === 'freshIssueShareCount')?.status).toBe('NOT_EXPECTED_FROM_SOURCE');
  });

  it('11. Unknown provenance → field present but no provenance returns COVERED without crashing', async () => {
    const db = makeDb(makeIpoRecord({ lotSize: 100 }));
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary([]));

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const lotField = report.fields.find((f) => f.fieldName === 'lotSize');
    expect(lotField?.status).toBe('COVERED');
    expect(lotField?.canonicalValue).toBe('100');
  });

  it('12. Field not expected from source → listingDate marked NOT_EXPECTED_FROM_SOURCE for DRAFT IPO', async () => {
    const db = makeDb(makeIpoRecord({ status: 'DRAFT', lifecycleEvents: [] }));
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary());

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.fields.find((f) => f.fieldName === 'listingDate')?.status).toBe('NOT_EXPECTED_FROM_SOURCE');
  });

  it('13. Refresh recommendation for stale source → populates refreshRecommendations array', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary([], true));
    mockRefreshPlanService.generatePlan.mockResolvedValue({
      ipoId: 'ipo-1',
      overallStatus: 'STALE',
      highestPriority: 'MEDIUM',
      hasRecommendedActions: true,
      generatedAt: now,
      actions: [
        {
          sourceId: 'src-sebi',
          sourceCode: 'sebi',
          sourceType: SourceType.OFFICIAL_FILING,
          healthStatus: SourceHealthStatus.HEALTHY,
          status: 'RECOMMENDED',
          freshnessStatus: 'STALE',
          priority: 'MEDIUM',
          lastObservedAt: now,
          reasons: ['STALE_OBSERVATION'],
          messages: ['Refresh recommended for SEBI'],
        },
      ],
    });

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.refreshRecommendations).toHaveLength(1);
    expect(report.refreshRecommendations[0].sourceCode).toBe('sebi');
  });

  it('14. No recommendation when source is healthy/fresh → refreshRecommendations is empty', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue(makeReconciliationSummary([], false));
    mockRefreshPlanService.generatePlan.mockResolvedValue({
      ipoId: 'ipo-1',
      overallStatus: 'FRESH',
      highestPriority: 'NONE',
      hasRecommendedActions: false,
      generatedAt: now,
      actions: [],
    });

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    expect(report.refreshRecommendations).toHaveLength(0);
  });

  it('15. Unknown IPO ID → throws 404 AppException', async () => {
    const db = makeDb(null);

    await expect(service.evaluateCoverage(db as any, 'unknown-id')).rejects.toThrow(
      AppException,
    );
  });

  it('16. Fresh source + stale secondary source (matching values) → returns COVERED', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue({
      ...makeReconciliationSummary([
        {
          fieldName: 'issue_size',
          hasConflict: false,
          activeObs: [
            { sourceCode: 'sebi', value: '100.00', retrievedAt: now },
            { sourceCode: 'nse', value: '100.00', retrievedAt: new Date(now.getTime() - 864000000) },
          ],
        },
      ]),
      freshnessSummary: {
        ipoId: 'ipo-1',
        overallStatus: 'STALE',
        highestPriority: 'MEDIUM',
        sourceDecisions: [
          {
            sourceId: 'src-sebi',
            sourceCode: 'sebi',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            status: 'FRESH',
            priority: 'NONE',
            lastObservedAt: now,
            reasons: [],
            messages: [],
            recommendRefresh: false,
          },
          {
            sourceId: 'src-nse',
            sourceCode: 'nse',
            sourceType: SourceType.EXCHANGE,
            healthStatus: SourceHealthStatus.HEALTHY,
            status: 'STALE',
            priority: 'MEDIUM',
            lastObservedAt: new Date(now.getTime() - 864000000),
            reasons: ['STALE_OBSERVATION'],
            messages: ['NSE is stale'],
            recommendRefresh: true,
          },
        ],
        evaluatedAt: now,
      },
    });

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const issueSizeField = report.fields.find((f) => f.fieldName === 'issueSize');
    expect(issueSizeField?.status).toBe('COVERED');
    expect(issueSizeField?.providingSource).toBe('sebi');
  });

  it('17. Conflict with mixed freshness (fresh SEBI + stale NSE with different values) → returns CONFLICT', async () => {
    const db = makeDb();
    mockReconciliationService.reconcileIpo.mockResolvedValue({
      ...makeReconciliationSummary([
        {
          fieldName: 'issue_size',
          hasConflict: true,
          activeObs: [
            { sourceCode: 'sebi', value: '100.00', retrievedAt: now },
            { sourceCode: 'nse', value: '105.00', retrievedAt: new Date(now.getTime() - 864000000) },
          ],
        },
      ]),
      freshnessSummary: {
        ipoId: 'ipo-1',
        overallStatus: 'STALE',
        highestPriority: 'MEDIUM',
        sourceDecisions: [
          {
            sourceId: 'src-sebi',
            sourceCode: 'sebi',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            status: 'FRESH',
            priority: 'NONE',
            lastObservedAt: now,
            reasons: [],
            messages: [],
            recommendRefresh: false,
          },
          {
            sourceId: 'src-nse',
            sourceCode: 'nse',
            sourceType: SourceType.EXCHANGE,
            healthStatus: SourceHealthStatus.HEALTHY,
            status: 'STALE',
            priority: 'MEDIUM',
            lastObservedAt: new Date(now.getTime() - 864000000),
            reasons: ['STALE_OBSERVATION'],
            messages: ['NSE is stale'],
            recommendRefresh: true,
          },
        ],
        evaluatedAt: now,
      },
    });

    const report = await service.evaluateCoverage(db as any, 'ipo-1', now);

    const issueSizeField = report.fields.find((f) => f.fieldName === 'issueSize');
    expect(issueSizeField?.status).toBe('CONFLICT');
    expect(report.overallStatus).toBe('CONFLICT');
  });
});
