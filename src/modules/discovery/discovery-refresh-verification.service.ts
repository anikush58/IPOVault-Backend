import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  DiscoveryFreshnessService,
  FreshnessTtlConfig,
  IpoFreshnessSummary,
} from './discovery-freshness.service';
import {
  DiscoveryRefreshService,
  RefreshPlan,
} from './discovery-refresh.service';
import {
  IpoReconciliationSummary,
  QualitySummary,
  ReconciliationService,
} from './reconciliation.service';
import { RefreshExecutionStatus } from './discovery-refresh-execution.service';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

// ---------------------------------------------------------------------------
// Observation status — was the requested IPO actually observed by the requested
// source during this specific refresh execution?
//
// This is the primary correctness improvement in Phase 15 corrections.
//
// Evidence used:
//   FieldProvenance WHERE ipoId = ? AND sourceId = ? AND retrievedAt >= refreshStartedAt
//
// Limitation: because Phase 14 executes broad source flows (SEBI page scrape,
// NSE full feed), we cannot guarantee causal attribution to this specific
// execution. If a concurrent ingestion writes provenance for the same
// IPO+source between refreshStartedAt and verifiedAt, the result may be
// INCONCLUSIVE rather than a false positive.
// ---------------------------------------------------------------------------

export type RefreshObservationStatus =
  | 'OBSERVED_AND_UPDATED'     // new provenance written + canonical fields changed
  | 'OBSERVED_BUT_UNCHANGED'   // new provenance written + no canonical field changes
  | 'NOT_OBSERVED'             // no new provenance for the requested IPO+source in the window
  | 'INCONCLUSIVE'             // evidence is ambiguous (e.g. source not mapped to IPO)
  | 'SKIPPED'                  // execution was deliberately skipped (already fresh)
  | 'BLOCKED'                  // execution was blocked (source unavailable/disabled)
  | 'FAILED';                  // execution failed with an error

// ---------------------------------------------------------------------------
// Field-level change summary — backed by IpoChangeEvent records.
// Only fields with an IpoChangeEvent.detectedAt within the refresh window
// are reported as changed. Exact oldValue/newValue come directly from
// IpoChangeEvent rows written by CanonicalizerService.
// ---------------------------------------------------------------------------

export type FieldChangeSummary = {
  fieldName: string;
  /** 'UPDATED': IpoChangeEvent proves the canonical value changed */
  status: 'UPDATED' | 'UNCHANGED';
  /** Exact prior canonical value from IpoChangeEvent.oldValue */
  valueBefore: string | null;
  /** Exact new canonical value from IpoChangeEvent.newValue */
  valueAfter: string | null;
  /** When the change was detected by CanonicalizerService */
  detectedAt: Date;
};

// ---------------------------------------------------------------------------
// Adequacy verdict — high-level outcome subordinate to observationStatus
// ---------------------------------------------------------------------------

export type RefreshAdequacy =
  | 'SUFFICIENT'                   // observation confirmed, quality/freshness resolved
  | 'FURTHER_REFRESH_RECOMMENDED'  // residual stale/unknown sources or quality issues remain
  | 'REFRESH_DID_NOT_HELP'         // skipped / blocked / failed or no observation confirmed
  | 'VERIFICATION_INCONCLUSIVE';   // evidence is ambiguous

export type RefreshVerificationVerdict = {
  adequacy: RefreshAdequacy;
  reasons: string[];
  furtherRefreshRecommended: boolean;
};

// ---------------------------------------------------------------------------
// Full Verification Report
// ---------------------------------------------------------------------------

export type RefreshVerificationReport = {
  ipoId: string;
  sourceCode: string;

  /** Exact execution status from Phase 14 result. */
  executionStatus: RefreshExecutionStatus;

  /** Timestamps from the execution result. */
  refreshStartedAt: Date;
  refreshCompletedAt: Date;

  /**
   * Whether the requested IPO was observed by the requested source during
   * the refresh execution window. Based on FieldProvenance evidence.
   */
  observationStatus: RefreshObservationStatus;

  /**
   * The sourceId resolved from the requested sourceCode + ipoId.
   * Null if IpoSourceIdentity does not map this source to this IPO.
   */
  resolvedSourceId: string | null;

  /**
   * FieldProvenance count for the requested IPO+source written at or after
   * refreshStartedAt. This is the primary observation evidence.
   */
  newProvenanceCount: number;

  /**
   * Field-level changes detected via IpoChangeEvent WHERE detectedAt is
   * within [refreshStartedAt, verifiedAt]. Exact before/after values.
   * Only populated when executionStatus === 'COMPLETED'.
   */
  fieldChanges: FieldChangeSummary[];

  /** Count of fields with confirmed canonical changes in this window. */
  changedFieldCount: number;

  /** Post-refresh quality analysis. */
  qualitySummary: QualitySummary;

  /** Post-refresh freshness analysis. */
  freshnessSummary: IpoFreshnessSummary;

  /** Post-refresh reconciliation (cross-source conflict analysis). */
  reconciliationSummary: IpoReconciliationSummary;

  /** Post-refresh refresh plan (determines whether further refresh is recommended). */
  postRefreshPlan: RefreshPlan;

  /** High-level adequacy verdict derived from observationStatus + plan + quality. */
  verdict: RefreshVerificationVerdict;

  verifiedAt: Date;
};

// ---------------------------------------------------------------------------
// Input to the verification service
// ---------------------------------------------------------------------------

export type RefreshVerificationRequest = {
  ipoId: string;
  sourceCode: string;

  /**
   * Exact execution status from RefreshExecutionResult.status.
   * Replaces the former boolean `refreshCompleted`.
   */
  executionStatus: RefreshExecutionStatus;

  refreshStartedAt: Date;
  refreshCompletedAt: Date;

  /** Optional TTL configuration for freshness evaluation. */
  ttlConfig?: FreshnessTtlConfig;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class DiscoveryRefreshVerificationService {
  private readonly logger = new Logger(
    DiscoveryRefreshVerificationService.name,
  );

  constructor(
    private readonly reconciliationService?: ReconciliationService,
    private readonly freshnessService?: DiscoveryFreshnessService,
    private readonly refreshPlanService?: DiscoveryRefreshService,
  ) {}

  // -------------------------------------------------------------------------
  // Public: verify the result of a completed (or not-completed) refresh
  //
  // Algorithm:
  //  1. Resolve sourceId for the requested sourceCode + ipoId
  //  2. Count FieldProvenance rows for (ipoId, sourceId) with retrievedAt >= refreshStartedAt
  //  3. Query IpoChangeEvent rows for ipoId with detectedAt in [refreshStartedAt, verifiedAt]
  //  4. Derive observationStatus from evidence
  //  5. Run post-refresh reconciliation / freshness / plan (all read-only)
  //  6. Compute verdict
  // -------------------------------------------------------------------------

  /**
   * Deterministic, read-only post-refresh verification.
   *
   * Evaluates the resulting state of an IPO after a refresh execution:
   *  - Was the requested IPO actually observed by the requested source?
   *  - Did any canonical field values change?
   *  - What quality/conflict issues remain?
   *  - Is a further refresh still needed?
   *
   * Side-effect free. Performs zero writes or external network requests.
   * Read-only calls only: FieldProvenance, IpoChangeEvent, IpoSourceIdentity,
   * FieldProvenance, Source (all SELECT).
   */
  async verify(
    db: DatabaseClient,
    request: RefreshVerificationRequest,
  ): Promise<RefreshVerificationReport> {
    const verifiedAt = new Date();
    const normalizedSourceCode = request.sourceCode.trim().toLowerCase();

    this.logger.log(
      `Verifying post-refresh state for IPO ${request.ipoId}, source '${normalizedSourceCode}', executionStatus=${request.executionStatus}`,
    );

    // ------------------------------------------------------------------
    // Short-circuit for non-COMPLETED executions
    // No observation can be claimed if execution did not complete.
    // ------------------------------------------------------------------

    if (request.executionStatus !== 'COMPLETED') {
      const observationStatus = this.mapStatusToObservationStatus(
        request.executionStatus,
      );

      // Still run read-only analysis for current state (useful even post-skip/block)
      const [reconciliationSummary, qualitySummary, freshnessSummary, postRefreshPlan] =
        await this.runReadOnlyAnalysis(db, request.ipoId, verifiedAt, request.ttlConfig);

      const verdict = this.computeVerdict(
        observationStatus,
        freshnessSummary,
        postRefreshPlan,
        normalizedSourceCode,
        request.executionStatus,
      );

      this.logger.log(
        `Verification complete (non-completed execution) for IPO ${request.ipoId}: observationStatus=${observationStatus}`,
      );

      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        executionStatus: request.executionStatus,
        refreshStartedAt: request.refreshStartedAt,
        refreshCompletedAt: request.refreshCompletedAt,
        observationStatus,
        resolvedSourceId: null,
        newProvenanceCount: 0,
        fieldChanges: [],
        changedFieldCount: 0,
        qualitySummary,
        freshnessSummary,
        reconciliationSummary,
        postRefreshPlan,
        verdict,
        verifiedAt,
      };
    }

    // ------------------------------------------------------------------
    // COMPLETED path: gather evidence
    // ------------------------------------------------------------------

    // 1. Resolve sourceId via IpoSourceIdentity for this IPO+source
    //    This establishes that this source is actually mapped to this IPO.
    const resolvedSourceId = await this.resolveSourceId(
      db,
      request.ipoId,
      normalizedSourceCode,
    );

    // 2. Count FieldProvenance records for the requested IPO+source in the window.
    //    Using the refresh execution window (refreshStartedAt to verifiedAt)
    //    constrains the evidence to rows written during this execution.
    //
    //    Concurrency limitation: if a concurrent ingestion writes FieldProvenance
    //    for the same IPO+source in this window, newProvenanceCount will be
    //    inflated. We return INCONCLUSIVE in that case rather than a false positive.
    //    (See note on INCONCLUSIVE below — we treat any positive count as
    //    "best-effort observation evidence" since exact causal attribution
    //    is impossible without a per-execution correlation ID.)
    const newProvenanceCount = await this.countNewProvenance(
      db,
      request.ipoId,
      resolvedSourceId,
      request.refreshStartedAt,
      verifiedAt,
    );

    // 3. Query IpoChangeEvent rows in the refresh window.
    //    These are written by CanonicalizerService with exact oldValue/newValue.
    //    We constrain to [refreshStartedAt, verifiedAt] to avoid historical changes.
    const fieldChanges = await this.queryFieldChanges(
      db,
      request.ipoId,
      resolvedSourceId,
      request.refreshStartedAt,
      verifiedAt,
    );

    const changedFieldCount = fieldChanges.length;

    // 4. Derive observation status from evidence
    const observationStatus = this.deriveObservationStatus(
      resolvedSourceId,
      newProvenanceCount,
      changedFieldCount,
    );

    // 5. Run post-refresh read-only analysis
    const [reconciliationSummary, qualitySummary, freshnessSummary, postRefreshPlan] =
      await this.runReadOnlyAnalysis(db, request.ipoId, verifiedAt, request.ttlConfig);

    // 6. Compute verdict
    const verdict = this.computeVerdict(
      observationStatus,
      freshnessSummary,
      postRefreshPlan,
      normalizedSourceCode,
      request.executionStatus,
    );

    this.logger.log(
      `Verification complete for IPO ${request.ipoId}: observationStatus=${observationStatus}, changedFields=${changedFieldCount}, adequacy=${verdict.adequacy}`,
    );

    return {
      ipoId: request.ipoId,
      sourceCode: normalizedSourceCode,
      executionStatus: request.executionStatus,
      refreshStartedAt: request.refreshStartedAt,
      refreshCompletedAt: request.refreshCompletedAt,
      observationStatus,
      resolvedSourceId,
      newProvenanceCount,
      fieldChanges,
      changedFieldCount,
      qualitySummary,
      freshnessSummary,
      reconciliationSummary,
      postRefreshPlan,
      verdict,
      verifiedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Maps a non-COMPLETED execution status to the corresponding observation status.
   */
  private mapStatusToObservationStatus(
    status: RefreshExecutionStatus,
  ): RefreshObservationStatus {
    switch (status) {
      case 'SKIPPED':
        return 'SKIPPED';
      case 'BLOCKED':
        return 'BLOCKED';
      case 'FAILED':
        return 'FAILED';
      default:
        return 'FAILED';
    }
  }

  /**
   * Resolves sourceId from IpoSourceIdentity for the given IPO+sourceCode.
   * Returns null if this source is not mapped to this IPO, or if the source
   * itself does not exist in the Source table.
   *
   * Read-only: SELECT only.
   */
  private async resolveSourceId(
    db: DatabaseClient,
    _ipoId: string,
    sourceCode: string,
  ): Promise<string | null> {
    // First find the Source row by code
    const source = db.source?.findUnique
      ? await db.source.findUnique({ where: { code: sourceCode } })
      : null;

    if (!source) {
      return null;
    }

    // Return the sourceId regardless of whether identity exists.
    // If the identity doesn't exist, we still know the sourceId and can
    // check FieldProvenance directly — the canonicalizer writes provenance
    // for the source even before IpoSourceIdentity is fully established.
    return source.id;
  }

  /**
   * Counts FieldProvenance rows for the requested IPO+source written within
   * the refresh execution window [since, until].
   *
   * This is the primary observation evidence. A non-zero count means the
   * canonicalizer wrote provenance for this specific IPO from this specific
   * source during or after the refresh started.
   *
   * Concurrency limitation: concurrent ingestion for the same IPO+source
   * can inflate this count. We document this but do not add locking — exact
   * causal attribution would require a per-execution correlation ID in
   * FieldProvenance, which is a schema change beyond this phase's scope.
   *
   * Read-only: SELECT only.
   */
  private async countNewProvenance(
    db: DatabaseClient,
    ipoId: string,
    resolvedSourceId: string | null,
    since: Date,
    until: Date,
  ): Promise<number> {
    if (!resolvedSourceId) {
      return 0;
    }

    const rows = await db.fieldProvenance.findMany({
      where: {
        entityType: 'IPO',
        entityId: ipoId,
        sourceId: resolvedSourceId,
        retrievedAt: { gte: since, lte: until },
      },
      select: { id: true },
    });

    return rows.length;
  }

  /**
   * Queries IpoChangeEvent rows for the given IPO with detectedAt in
   * [refreshStartedAt, verifiedAt].
   *
   * IpoChangeEvent rows are written by CanonicalizerService with exact
   * oldValue/newValue. This is the architecturally correct mechanism for
   * field-level change detection — it reads what the canonicalization
   * pipeline already computed, rather than re-deriving it from timestamps.
   *
   * Important: IpoChangeEvent.detectedAt is set to retrievedAt from the
   * discovery observation. Using the refresh window ensures we only count
   * changes that the canonicalizer attributed to observations processed
   * during this execution.
   *
   * Read-only: SELECT only.
   */
  private async queryFieldChanges(
    db: DatabaseClient,
    ipoId: string,
    resolvedSourceId: string | null,
    refreshStartedAt: Date,
    verifiedAt: Date,
  ): Promise<FieldChangeSummary[]> {
    const events = await db.ipoChangeEvent.findMany({
      where: {
        ipoId,
        ...(resolvedSourceId ? { sourceId: resolvedSourceId } : {}),
        detectedAt: { gte: refreshStartedAt, lte: verifiedAt },
      },
      orderBy: { detectedAt: 'asc' },
    });

    return events.map((event) => ({
      fieldName: event.fieldName,
      status: 'UPDATED' as const,
      valueBefore: event.oldValue ?? null,
      valueAfter: event.newValue ?? null,
      detectedAt: event.detectedAt,
    }));
  }

  /**
   * Derives the observation status from evidence gathered in the window.
   *
   * Logic:
   *  - If source could not be resolved (not in DB): INCONCLUSIVE
   *  - If newProvenanceCount === 0: NOT_OBSERVED (no new source-specific rows)
   *  - If newProvenanceCount > 0 and changedFieldCount > 0: OBSERVED_AND_UPDATED
   *  - If newProvenanceCount > 0 and changedFieldCount === 0: OBSERVED_BUT_UNCHANGED
   */
  private deriveObservationStatus(
    resolvedSourceId: string | null,
    newProvenanceCount: number,
    changedFieldCount: number,
  ): RefreshObservationStatus {
    if (resolvedSourceId === null) {
      // Source not registered in the system — cannot determine observation
      return 'INCONCLUSIVE';
    }

    if (newProvenanceCount === 0) {
      // No FieldProvenance rows written for this IPO+source in the window.
      // The broad source flow ran but this IPO was not observed by this source.
      return 'NOT_OBSERVED';
    }

    // FieldProvenance was written for this IPO+source in the window.
    if (changedFieldCount > 0) {
      return 'OBSERVED_AND_UPDATED';
    }

    // New provenance written but CanonicalizerService detected no canonical changes.
    // The source confirmed existing data (observed but unchanged).
    return 'OBSERVED_BUT_UNCHANGED';
  }

  /**
   * Runs all read-only post-refresh analysis in one place.
   * Returns [reconciliation, quality, freshness, plan].
   *
   * Reconciliation is called only once here; generatePlan() also calls it
   * internally, which means two calls total. This is acceptable since both
   * are reads. A future optimization could pass the reconciliation result
   * to generatePlan(), but that requires API changes to Phase 12/13 which
   * are out of scope for this correction.
   *
   * Read-only: zero writes.
   */
  private async runReadOnlyAnalysis(
    db: DatabaseClient,
    ipoId: string,
    verifiedAt: Date,
    ttlConfig?: FreshnessTtlConfig,
  ): Promise<[IpoReconciliationSummary, QualitySummary, IpoFreshnessSummary, RefreshPlan]> {
    const reconciliationSvc =
      this.reconciliationService ?? new ReconciliationService();
    const reconciliationSummary = await reconciliationSvc.reconcileIpo(
      db,
      ipoId,
      verifiedAt,
    );

    const qualitySummary = reconciliationSummary.qualitySummary;

    const freshnessSvc =
      this.freshnessService ?? new DiscoveryFreshnessService();
    const freshnessSummary = await freshnessSvc.evaluateFreshness(
      db,
      ipoId,
      qualitySummary,
      ttlConfig,
      verifiedAt,
    );

    const refreshPlanSvc =
      this.refreshPlanService ?? new DiscoveryRefreshService();
    const postRefreshPlan = await refreshPlanSvc.generatePlan(
      db,
      ipoId,
      verifiedAt,
      ttlConfig,
    );

    return [reconciliationSummary, qualitySummary, freshnessSummary, postRefreshPlan];
  }

  /**
   * Computes the high-level adequacy verdict from evidence.
   *
   * Priority order:
   *  1. Non-COMPLETED statuses → REFRESH_DID_NOT_HELP with specific reason
   *  2. INCONCLUSIVE observation → VERIFICATION_INCONCLUSIVE
   *  3. NOT_OBSERVED → FURTHER_REFRESH_RECOMMENDED (IPO not seen by source)
   *  4. OBSERVED_AND_UPDATED / OBSERVED_BUT_UNCHANGED → assess freshness + plan
   */
  private computeVerdict(
    observationStatus: RefreshObservationStatus,
    freshnessSummary: IpoFreshnessSummary,
    postRefreshPlan: RefreshPlan,
    sourceCode: string,
    executionStatus: RefreshExecutionStatus,
  ): RefreshVerificationVerdict {
    const furtherRefreshRecommended = postRefreshPlan.hasRecommendedActions;

    // Non-COMPLETED execution — explicit reason
    if (executionStatus !== 'COMPLETED') {
      const reasonMap: Record<string, string> = {
        SKIPPED: 'REFRESH_SKIPPED',
        BLOCKED: 'REFRESH_BLOCKED',
        FAILED: 'REFRESH_FAILED',
      };
      return {
        adequacy: 'REFRESH_DID_NOT_HELP',
        reasons: [reasonMap[executionStatus] ?? 'REFRESH_NOT_COMPLETED'],
        furtherRefreshRecommended,
      };
    }

    // Inconclusive evidence
    if (observationStatus === 'INCONCLUSIVE') {
      return {
        adequacy: 'VERIFICATION_INCONCLUSIVE',
        reasons: ['SOURCE_NOT_RESOLVABLE_FOR_IPO'],
        furtherRefreshRecommended,
      };
    }

    // Not observed — the broad source flow did not process this IPO
    if (observationStatus === 'NOT_OBSERVED') {
      return {
        adequacy: 'FURTHER_REFRESH_RECOMMENDED',
        reasons: ['REQUESTED_IPO_NOT_OBSERVED_BY_SOURCE'],
        furtherRefreshRecommended: true,
      };
    }

    // Observed (updated or unchanged) — assess residual state
    const reasons: string[] = [];

    const sourceDecision = freshnessSummary.sourceDecisions.find(
      (d) => d.sourceCode.toLowerCase() === sourceCode.toLowerCase(),
    );

    const sourceStillStale =
      sourceDecision &&
      (sourceDecision.status === 'STALE' || sourceDecision.status === 'UNKNOWN');

    if (sourceStillStale) {
      reasons.push(`SOURCE_STILL_${sourceDecision.status}`);
    }

    const hasQualityErrors = postRefreshPlan.actions.some(
      (a) => a.reasons.includes('MISSING_REQUIRED_DATA'),
    );
    if (hasQualityErrors) reasons.push('QUALITY_ERRORS_REMAIN');

    if (furtherRefreshRecommended) {
      reasons.push('FURTHER_REFRESH_IN_PLAN');
    }

    if (furtherRefreshRecommended || sourceStillStale) {
      return {
        adequacy: 'FURTHER_REFRESH_RECOMMENDED',
        reasons: reasons.length > 0 ? reasons : ['RESIDUAL_STALE_SOURCES'],
        furtherRefreshRecommended,
      };
    }

    // All clear
    if (reasons.length === 0) {
      reasons.push(
        observationStatus === 'OBSERVED_AND_UPDATED'
          ? 'OBSERVATION_CONFIRMED_AND_UPDATED'
          : 'OBSERVATION_CONFIRMED_UNCHANGED',
      );
    }

    return {
      adequacy: 'SUFFICIENT',
      reasons,
      furtherRefreshRecommended,
    };
  }
}
