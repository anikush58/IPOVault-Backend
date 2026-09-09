/**
 * Phase 16 — Smart IPO Refresh Workflow Orchestration Tests
 *
 * Test principles:
 * - Workflow delegates to Phase 13 (Plan), Phase 14 (Execution), Phase 15 (Verification).
 * - Validates short-circuit behavior when plan specifies SKIPPED or BLOCKED.
 * - Confirms exact execution & verification calls for RECOMMENDED actions.
 * - Verifies deterministic mapping to SmartRefreshOutcome.
 * - Ensures source isolation and broad flow semantics.
 */

import { SourceHealthStatus, SourceType } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import {
  DiscoverySmartRefreshService,
  SmartRefreshRequest,
} from './discovery-smart-refresh.service';
import { RefreshPlan } from './discovery-refresh.service';
import { RefreshExecutionResult } from './discovery-refresh-execution.service';
import { RefreshVerificationReport } from './discovery-refresh-verification.service';

// ---------------------------------------------------------------------------
// Helpers: fake DB and service mocks
// ---------------------------------------------------------------------------

function makeDb(ipoRecord: Record<string, unknown> | null = { id: 'ipo-a' }) {
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

function makeRefreshPlan(
  sourceCode = 'sebi',
  actionStatus: 'RECOMMENDED' | 'SKIPPED' | 'BLOCKED' = 'RECOMMENDED',
  hasRecommendedActions = true,
): RefreshPlan {
  return {
    ipoId: 'ipo-a',
    overallStatus: 'STALE',
    highestPriority: 'HIGH',
    hasRecommendedActions,
    generatedAt: new Date('2026-09-10T12:00:00.000Z'),
    actions: [
      {
        sourceId: 'src-sebi',
        sourceCode,
        sourceType: SourceType.OFFICIAL_FILING,
        healthStatus: SourceHealthStatus.HEALTHY,
        status: actionStatus,
        freshnessStatus: 'STALE',
        priority: 'HIGH',
        lastObservedAt: null,
        reasons: ['STALE_THRESHOLD_EXCEEDED' as any],
        messages: ['Refresh recommended'],
      },
    ],
  };
}

function makeExecutionResult(
  sourceCode = 'sebi',
  status: 'COMPLETED' | 'SKIPPED' | 'BLOCKED' | 'FAILED' = 'COMPLETED',
): RefreshExecutionResult {
  return {
    ipoId: 'ipo-a',
    sourceCode,
    status,
    startedAt: new Date('2026-09-10T11:59:00.000Z'),
    completedAt: new Date('2026-09-10T12:00:00.000Z'),
    outcome: status === 'COMPLETED' ? 'MATCHED' : status === 'SKIPPED' ? 'SKIPPED' : 'ERROR',
    message: `Execution status: ${status}`,
    reasons: [],
  };
}

function makeVerificationReport(
  sourceCode = 'sebi',
  observationStatus:
    | 'OBSERVED_AND_UPDATED'
    | 'OBSERVED_BUT_UNCHANGED'
    | 'NOT_OBSERVED'
    | 'INCONCLUSIVE'
    | 'SKIPPED'
    | 'BLOCKED'
    | 'FAILED' = 'OBSERVED_AND_UPDATED',
  furtherRefreshRecommended = false,
): RefreshVerificationReport {
  const qualitySummary = { status: 'HEALTHY' as const, findings: [], summary: { errors: 0, warnings: 0, info: 0 } };
  return {
    ipoId: 'ipo-a',
    sourceCode,
    executionStatus: 'COMPLETED',
    refreshStartedAt: new Date('2026-09-10T11:59:00.000Z'),
    refreshCompletedAt: new Date('2026-09-10T12:00:00.000Z'),
    observationStatus,
    resolvedSourceId: 'src-sebi',
    newProvenanceCount: observationStatus.startsWith('OBSERVED') ? 1 : 0,
    fieldChanges: observationStatus === 'OBSERVED_AND_UPDATED'
      ? [{ fieldName: 'issue_size', status: 'UPDATED', valueBefore: '100', valueAfter: '200', detectedAt: new Date() }]
      : [],
    changedFieldCount: observationStatus === 'OBSERVED_AND_UPDATED' ? 1 : 0,
    qualitySummary,
    freshnessSummary: {
      ipoId: 'ipo-a',
      overallStatus: 'FRESH',
      highestPriority: 'NONE',
      sourceDecisions: [],
      evaluatedAt: new Date(),
    },
    reconciliationSummary: {
      ipoId: 'ipo-a',
      hasCrossSourceConflict: false,
      canonicalValues: {},
      sebiActiveObservation: {},
      exchangeActiveObservation: {},
      fieldComparisons: [],
      provenanceReport: { ipoId: 'ipo-a', hasAnyConflict: false, conflicts: [] },
      qualitySummary,
    },
    postRefreshPlan: makeRefreshPlan(sourceCode, 'SKIPPED', furtherRefreshRecommended),
    verdict: {
      adequacy: furtherRefreshRecommended ? 'FURTHER_REFRESH_RECOMMENDED' : 'SUFFICIENT',
      reasons: furtherRefreshRecommended ? ['RESIDUAL_STALE_SOURCES'] : ['OBSERVATION_CONFIRMED_AND_UPDATED'],
      furtherRefreshRecommended,
    },
    verifiedAt: new Date('2026-09-10T12:00:01.000Z'),
  };
}

describe('DiscoverySmartRefreshService (Phase 16 Workflow)', () => {
  let mockPlanService: { generatePlan: jest.Mock };
  let mockExecutionService: { execute: jest.Mock };
  let mockVerificationService: { verify: jest.Mock };
  let service: DiscoverySmartRefreshService;

  beforeEach(() => {
    mockPlanService = { generatePlan: jest.fn() };
    mockExecutionService = { execute: jest.fn() };
    mockVerificationService = { verify: jest.fn() };

    service = new DiscoverySmartRefreshService(
      mockPlanService as any,
      mockExecutionService as any,
      mockVerificationService as any,
    );
  });

  // =========================================================================
  // 1. Validation & Short-circuiting
  // =========================================================================

  it('1. Unknown IPO ID → throws 404 AppException', async () => {
    const db = makeDb(null);
    const req: SmartRefreshRequest = { ipoId: 'unknown-id', sourceCode: 'sebi' };

    await expect(service.smartRefresh(db as any, req)).rejects.toThrow(AppException);
    expect(mockPlanService.generatePlan).not.toHaveBeenCalled();
    expect(mockExecutionService.execute).not.toHaveBeenCalled();
  });

  it('2. Planned action SKIPPED → does not execute, returns REFRESH_SKIPPED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'SKIPPED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_SKIPPED');
    expect(res.execution).toBeUndefined();
    expect(res.verification).toBeUndefined();
    expect(mockExecutionService.execute).not.toHaveBeenCalled();
    expect(mockVerificationService.verify).not.toHaveBeenCalled();
  });

  it('3. Planned action BLOCKED → does not execute, returns REFRESH_BLOCKED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'BLOCKED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_BLOCKED');
    expect(res.execution).toBeUndefined();
    expect(mockExecutionService.execute).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 2. Execution Outcomes
  // =========================================================================

  it('4. Execution returned SKIPPED → returns REFRESH_SKIPPED with execution result', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'SKIPPED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_SKIPPED');
    expect(res.execution).toBeDefined();
    expect(mockVerificationService.verify).not.toHaveBeenCalled();
  });

  it('5. Execution returned BLOCKED → returns REFRESH_BLOCKED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'BLOCKED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_BLOCKED');
    expect(mockVerificationService.verify).not.toHaveBeenCalled();
  });

  it('6. Execution returned FAILED → returns REFRESH_FAILED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'FAILED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_FAILED');
    expect(mockVerificationService.verify).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 3. Successful Pipeline: Plan → Execute → Verify → Final Outcome
  // =========================================================================

  it('7. COMPLETED + OBSERVED_AND_UPDATED + no residual stale → REFRESHED_AND_VERIFIED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', false),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESHED_AND_VERIFIED');
    expect(res.execution).toBeDefined();
    expect(res.verification).toBeDefined();
    expect(mockExecutionService.execute).toHaveBeenCalledTimes(1);
    expect(mockVerificationService.verify).toHaveBeenCalledTimes(1);
  });

  it('8. COMPLETED + OBSERVED_BUT_UNCHANGED + no residual stale → REFRESHED_BUT_UNCHANGED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'OBSERVED_BUT_UNCHANGED', false),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESHED_BUT_UNCHANGED');
  });

  it('9. COMPLETED + OBSERVED_AND_UPDATED + residual stale → FURTHER_REFRESH_RECOMMENDED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', true),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('FURTHER_REFRESH_RECOMMENDED');
  });

  it('10. COMPLETED + NOT_OBSERVED → NOT_OBSERVED', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'NOT_OBSERVED', true),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('NOT_OBSERVED');
  });

  it('11. COMPLETED + INCONCLUSIVE → VERIFICATION_INCONCLUSIVE', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'INCONCLUSIVE', true),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('VERIFICATION_INCONCLUSIVE');
  });

  it('12. Verification error → returns VERIFICATION_INCONCLUSIVE without crashing', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockRejectedValue(new Error('DB connection reset'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('VERIFICATION_INCONCLUSIVE');
    expect(res.summaryMessage).toContain('verification failed');
    expect(res.execution).toBeDefined();
  });

  // =========================================================================
  // 4. Source Isolation & Broad Flow Verification
  // =========================================================================

  it('13. Source-specific request passes normalized sourceCode to plan, execute, and verify', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('nse', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('nse', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('nse', 'OBSERVED_AND_UPDATED', false),
    );

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: ' NSE ' });

    expect(res.sourceCode).toBe('nse');
    expect(mockExecutionService.execute).toHaveBeenCalledWith(
      expect.anything(),
      { ipoId: 'ipo-a', sourceCode: 'nse' },
    );
    expect(mockVerificationService.verify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceCode: 'nse' }),
    );
  });

  it('14. Exactly ONE execution and ONE verification per workflow invocation', async () => {
    const db = makeDb();
    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', false),
    );

    await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(mockPlanService.generatePlan).toHaveBeenCalledTimes(1);
    expect(mockExecutionService.execute).toHaveBeenCalledTimes(1);
    expect(mockVerificationService.verify).toHaveBeenCalledTimes(1);
  });

  // =========================================================================
  // 5. Phase 18 Operational Readiness & Safeguard Tests
  // =========================================================================

  it('15. Sequential Smart Refresh: second request short-circuits to REFRESH_SKIPPED when data becomes fresh', async () => {
    const db = makeDb();
    // First request: RECOMMENDED -> Execution COMPLETED -> Verified
    mockPlanService.generatePlan
      .mockResolvedValueOnce(makeRefreshPlan('sebi', 'RECOMMENDED'))
      .mockResolvedValueOnce(makeRefreshPlan('sebi', 'SKIPPED')); // Second call yields SKIPPED

    mockExecutionService.execute.mockResolvedValueOnce(makeExecutionResult('sebi', 'COMPLETED'));
    mockVerificationService.verify.mockResolvedValueOnce(
      makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', false),
    );

    const firstResult = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });
    expect(firstResult.finalOutcome).toBe('REFRESHED_AND_VERIFIED');

    // Second sequential request: plan now yields SKIPPED
    const secondResult = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });
    expect(secondResult.finalOutcome).toBe('REFRESH_SKIPPED');
    expect(mockExecutionService.execute).toHaveBeenCalledTimes(1); // Executed only once!
  });

  it('16. Timestamp window boundary: verification receives exact execution.startedAt and execution.completedAt timestamps', async () => {
    const db = makeDb();
    const startTime = new Date('2026-09-10T10:00:00.000Z');
    const endTime = new Date('2026-09-10T10:00:05.000Z');

    mockPlanService.generatePlan.mockResolvedValue(makeRefreshPlan('sebi', 'RECOMMENDED'));
    mockExecutionService.execute.mockResolvedValue({
      ...makeExecutionResult('sebi', 'COMPLETED'),
      startedAt: startTime,
      completedAt: endTime,
    });
    mockVerificationService.verify.mockResolvedValue(
      makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', false),
    );

    await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(mockVerificationService.verify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refreshStartedAt: startTime,
        refreshCompletedAt: endTime,
      }),
    );
  });

  it('17. Non-destructive failure: FAILED execution retains initial plan and error status without modifying IPO', async () => {
    const db = makeDb();
    const initialPlan = makeRefreshPlan('sebi', 'RECOMMENDED');
    mockPlanService.generatePlan.mockResolvedValue(initialPlan);
    mockExecutionService.execute.mockResolvedValue(makeExecutionResult('sebi', 'FAILED'));

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.finalOutcome).toBe('REFRESH_FAILED');
    expect(res.initialRefreshPlan).toEqual(initialPlan);
    expect(mockVerificationService.verify).not.toHaveBeenCalled();
  });

  it('18. Diagnostic response completeness: SmartRefreshResult returns complete diagnostic envelope', async () => {
    const db = makeDb();
    const plan = makeRefreshPlan('sebi', 'RECOMMENDED');
    const exec = makeExecutionResult('sebi', 'COMPLETED');
    const report = makeVerificationReport('sebi', 'OBSERVED_AND_UPDATED', false);

    mockPlanService.generatePlan.mockResolvedValue(plan);
    mockExecutionService.execute.mockResolvedValue(exec);
    mockVerificationService.verify.mockResolvedValue(report);

    const res = await service.smartRefresh(db as any, { ipoId: 'ipo-a', sourceCode: 'sebi' });

    expect(res.ipoId).toBe('ipo-a');
    expect(res.sourceCode).toBe('sebi');
    expect(res.generatedAt).toBeDefined();
    expect(res.finalOutcome).toBe('REFRESHED_AND_VERIFIED');
    expect(res.summaryMessage).toBeDefined();
    expect(res.initialRefreshPlan).toBe(plan);
    expect(res.execution).toBe(exec);
    expect(res.verification).toBe(report);
  });
});
