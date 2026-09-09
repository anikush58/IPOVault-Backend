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

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

// ---------------------------------------------------------------------------
// Provenance snapshot — lightweight capture of sourceId -> latestRetrievedAt
// Used to compare before/after state across a refresh boundary.
// ---------------------------------------------------------------------------

export type ProvenanceSnapshot = {
  /** Map of sourceId to the most-recent retrievedAt timestamp observed. */
  bySource: Record<string, Date>;
  capturedAt: Date;
};

// ---------------------------------------------------------------------------
// Field-level change detection
// ---------------------------------------------------------------------------

export type FieldChangeStatus =
  | 'UNCHANGED'    // same value before and after
  | 'UPDATED'      // new provenance written; canonical value may have changed
  | 'APPEARED'     // no canonical value before; non-null value after
  | 'DISAPPEARED'  // had canonical value before; null after
  | 'UNKNOWN';     // no provenance data to compare

export type FieldChangeSummary = {
  fieldName: string;
  status: FieldChangeStatus;
  valueBefore: string | null;
  valueAfter: string | null;
};

// ---------------------------------------------------------------------------
// Refresh adequacy verdict
// ---------------------------------------------------------------------------

export type RefreshAdequacy =
  | 'SUFFICIENT'                    // freshness and quality issues resolved
  | 'FURTHER_REFRESH_RECOMMENDED'   // residual stale/unknown sources or quality findings remain
  | 'REFRESH_DID_NOT_HELP';         // execution completed but freshness/quality unchanged

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

  /** Whether the refresh execution actually completed (vs. SKIPPED/BLOCKED/FAILED). */
  refreshCompleted: boolean;

  /** Timestamps from the execution result. */
  refreshStartedAt: Date;
  refreshCompletedAt: Date;

  /** Provenance snapshot taken before the refresh (caller-supplied). */
  snapshotBefore: ProvenanceSnapshot;

  /** Live provenance snapshot taken at verification time (post-refresh). */
  snapshotAfter: ProvenanceSnapshot;

  /** Whether new provenance rows were written for the requested source. */
  newProvenanceRecorded: boolean;

  /** Field-level change summary derived from canonical values before vs. after. */
  fieldChanges: FieldChangeSummary[];

  /** Count of fields that actually changed. */
  changedFieldCount: number;

  /** Post-refresh quality analysis. */
  qualitySummary: QualitySummary;

  /** Post-refresh freshness analysis. */
  freshnessSummary: IpoFreshnessSummary;

  /** Post-refresh reconciliation (cross-source conflict analysis). */
  reconciliationSummary: IpoReconciliationSummary;

  /** Post-refresh refresh plan (determines whether further refresh is recommended). */
  postRefreshPlan: RefreshPlan;

  /** High-level adequacy verdict. */
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
   * Whether the refresh execution completed (i.e. status === 'COMPLETED').
   * If false (SKIPPED/BLOCKED/FAILED), the report is still produced but
   * refreshCompleted will be false and newProvenanceRecorded will be false.
   */
  refreshCompleted: boolean;
  refreshStartedAt: Date;
  refreshCompletedAt: Date;

  /**
   * A provenance snapshot captured BEFORE the refresh was executed.
   * If not supplied, the service treats all pre-refresh values as UNKNOWN.
   */
  snapshotBefore?: ProvenanceSnapshot;

  /**
   * Optional TTL configuration for freshness evaluation.
   */
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
  // Public: capture a provenance snapshot (call BEFORE executing a refresh)
  // -------------------------------------------------------------------------

  /**
   * Captures a lightweight provenance snapshot for a given IPO.
   * Should be called before executing a refresh to record the pre-refresh state.
   * Read-only and side-effect free.
   */
  async captureSnapshot(
    db: DatabaseClient,
    ipoId: string,
    capturedAt: Date = new Date(),
  ): Promise<ProvenanceSnapshot> {
    const provenances = await db.fieldProvenance.findMany({
      where: { entityType: 'IPO', entityId: ipoId },
      orderBy: { retrievedAt: 'desc' },
    });

    const bySource: Record<string, Date> = {};
    for (const prov of provenances) {
      const existing = bySource[prov.sourceId];
      if (!existing || prov.retrievedAt > existing) {
        bySource[prov.sourceId] = prov.retrievedAt;
      }
    }

    return { bySource, capturedAt };
  }

  // -------------------------------------------------------------------------
  // Public: verify a completed (or not-completed) refresh
  // -------------------------------------------------------------------------

  /**
   * Deterministic, read-only post-refresh verification.
   *
   * Evaluates the resulting state of an IPO after a refresh execution:
   * - What provenance changed?
   * - What field values changed?
   * - What quality/conflict issues remain?
   * - Is a further refresh still needed?
   *
   * Side-effect free. Performs zero writes or external network requests.
   */
  async verify(
    db: DatabaseClient,
    request: RefreshVerificationRequest,
  ): Promise<RefreshVerificationReport> {
    const verifiedAt = new Date();
    const normalizedSourceCode = request.sourceCode.trim().toLowerCase();

    this.logger.log(
      `Verifying post-refresh state for IPO ${request.ipoId}, source '${normalizedSourceCode}'`,
    );

    // 1. Capture post-refresh provenance snapshot
    const snapshotAfter = await this.captureSnapshot(
      db,
      request.ipoId,
      verifiedAt,
    );

    const snapshotBefore: ProvenanceSnapshot = request.snapshotBefore ?? {
      bySource: {},
      capturedAt: request.refreshStartedAt,
    };

    // 2. Determine whether new provenance was recorded
    const newProvenanceRecorded = this.detectNewProvenance(
      snapshotBefore,
      snapshotAfter,
      request.refreshCompleted,
    );

    // 3. Run full post-refresh reconciliation
    const reconciliationSvc =
      this.reconciliationService ?? new ReconciliationService();
    const reconciliationSummary = await reconciliationSvc.reconcileIpo(
      db,
      request.ipoId,
      verifiedAt,
    );

    const qualitySummary = reconciliationSummary.qualitySummary;

    // 4. Post-refresh freshness evaluation
    const freshnessSvc =
      this.freshnessService ?? new DiscoveryFreshnessService();
    const freshnessSummary = await freshnessSvc.evaluateFreshness(
      db,
      request.ipoId,
      qualitySummary,
      request.ttlConfig,
      verifiedAt,
    );

    // 5. Post-refresh refresh plan
    const refreshPlanSvc =
      this.refreshPlanService ?? new DiscoveryRefreshService();
    const postRefreshPlan = await refreshPlanSvc.generatePlan(
      db,
      request.ipoId,
      verifiedAt,
      request.ttlConfig,
    );

    // 6. Field-change detection using canonical values
    const fieldChanges = this.detectFieldChanges(
      reconciliationSummary.canonicalValues,
      snapshotBefore,
      snapshotAfter,
    );

    const changedFieldCount = fieldChanges.filter(
      (f) =>
        f.status === 'UPDATED' ||
        f.status === 'APPEARED' ||
        f.status === 'DISAPPEARED',
    ).length;

    // 7. Compute verification verdict
    const verdict = this.computeVerdict(
      request.refreshCompleted,
      newProvenanceRecorded,
      changedFieldCount,
      freshnessSummary,
      qualitySummary,
      postRefreshPlan,
      normalizedSourceCode,
    );

    this.logger.log(
      `Verification complete for IPO ${request.ipoId}: adequacy=${verdict.adequacy}, changedFields=${changedFieldCount}`,
    );

    return {
      ipoId: request.ipoId,
      sourceCode: normalizedSourceCode,
      refreshCompleted: request.refreshCompleted,
      refreshStartedAt: request.refreshStartedAt,
      refreshCompletedAt: request.refreshCompletedAt,
      snapshotBefore,
      snapshotAfter,
      newProvenanceRecorded,
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
   * Determines whether the refresh produced new provenance rows by comparing
   * max(retrievedAt) per source before and after.
   * Conservative heuristic: if any source has a newer max(retrievedAt) in the
   * after snapshot compared to the before snapshot, new provenance was recorded.
   */
  private detectNewProvenance(
    before: ProvenanceSnapshot,
    after: ProvenanceSnapshot,
    refreshCompleted: boolean,
  ): boolean {
    if (!refreshCompleted) {
      return false;
    }

    const afterSourceIds = Object.keys(after.bySource);
    const beforeSourceIds = Object.keys(before.bySource);

    // New source entirely (no provenance at all before for this source)
    const hasNewSource = afterSourceIds.some(
      (id) => !beforeSourceIds.includes(id),
    );
    if (hasNewSource) return true;

    // Existing source with newer retrievedAt
    for (const sourceId of afterSourceIds) {
      const afterDate = after.bySource[sourceId];
      const beforeDate = before.bySource[sourceId];
      if (afterDate && (!beforeDate || afterDate > beforeDate)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Builds a field-level change summary.
   *
   * Since the lightweight snapshot stores only source timestamps (not field values),
   * the change detection is conservative:
   * - UNKNOWN: no pre-refresh snapshot provided
   * - UNCHANGED: snapshot provided, no new provenance recorded
   * - APPEARED: canonical value is non-null, no provenance existed before
   * - UPDATED: new provenance recorded and canonical value is non-null
   * - DISAPPEARED: canonical value is null after, had provenance before
   */
  private detectFieldChanges(
    canonicalValues: Record<string, string | null>,
    snapshotBefore: ProvenanceSnapshot,
    snapshotAfter: ProvenanceSnapshot,
  ): FieldChangeSummary[] {
    const hasBeforeData = Object.keys(snapshotBefore.bySource).length > 0;
    const anyNewProvenance = this.hasAnyNewerProvenance(
      snapshotBefore,
      snapshotAfter,
    );

    return Object.entries(canonicalValues).map(([fieldName, valueAfter]) => {
      if (!hasBeforeData) {
        return {
          fieldName,
          status: 'UNKNOWN' as FieldChangeStatus,
          valueBefore: null,
          valueAfter,
        };
      }

      if (!anyNewProvenance) {
        // No new provenance written — canonical values are unchanged
        return {
          fieldName,
          status: 'UNCHANGED' as FieldChangeStatus,
          valueBefore: valueAfter,
          valueAfter,
        };
      }

      // New provenance was recorded
      if (valueAfter !== null) {
        const hadProvenance = Object.keys(snapshotBefore.bySource).length > 0;
        return {
          fieldName,
          status: (hadProvenance ? 'UPDATED' : 'APPEARED') as FieldChangeStatus,
          valueBefore: null,
          valueAfter,
        };
      }

      // valueAfter is null — field disappeared (or was never present)
      const hadAnyProvenance = Object.keys(snapshotBefore.bySource).length > 0;
      if (hadAnyProvenance) {
        return {
          fieldName,
          status: 'DISAPPEARED' as FieldChangeStatus,
          valueBefore: null,
          valueAfter: null,
        };
      }

      return {
        fieldName,
        status: 'UNCHANGED' as FieldChangeStatus,
        valueBefore: null,
        valueAfter: null,
      };
    });
  }

  private hasAnyNewerProvenance(
    before: ProvenanceSnapshot,
    after: ProvenanceSnapshot,
  ): boolean {
    const afterSourceIds = Object.keys(after.bySource);
    const beforeSourceIds = Object.keys(before.bySource);

    if (afterSourceIds.length > beforeSourceIds.length) return true;

    for (const sourceId of afterSourceIds) {
      const afterDate = after.bySource[sourceId];
      const beforeDate = before.bySource[sourceId];
      if (afterDate && (!beforeDate || afterDate > beforeDate)) return true;
    }
    return false;
  }

  /**
   * Computes the adequacy verdict based on post-refresh state.
   *
   * SUFFICIENT: no further refresh recommended and no quality errors remain.
   * FURTHER_REFRESH_RECOMMENDED: post-refresh plan still has RECOMMENDED actions.
   * REFRESH_DID_NOT_HELP: refresh completed but produced no new provenance.
   */
  private computeVerdict(
    refreshCompleted: boolean,
    newProvenanceRecorded: boolean,
    changedFieldCount: number,
    freshnessSummary: IpoFreshnessSummary,
    qualitySummary: QualitySummary,
    postRefreshPlan: RefreshPlan,
    sourceCode: string,
  ): RefreshVerificationVerdict {
    const reasons: string[] = [];

    if (!refreshCompleted) {
      return {
        adequacy: 'REFRESH_DID_NOT_HELP',
        reasons: ['REFRESH_NOT_COMPLETED'],
        furtherRefreshRecommended: postRefreshPlan.hasRecommendedActions,
      };
    }

    if (!newProvenanceRecorded) {
      reasons.push('NO_NEW_PROVENANCE_RECORDED');
    }

    // Source-level freshness after refresh
    const sourceDecision = freshnessSummary.sourceDecisions.find(
      (d) => d.sourceCode.toLowerCase() === sourceCode.toLowerCase(),
    );

    const sourceStillStale =
      sourceDecision &&
      (sourceDecision.status === 'STALE' ||
        sourceDecision.status === 'UNKNOWN');

    if (sourceStillStale) {
      reasons.push(`SOURCE_STILL_${sourceDecision.status}`);
    }

    // Quality findings
    const hasErrors = qualitySummary.summary.errors > 0;
    const hasWarnings = qualitySummary.summary.warnings > 0;
    if (hasErrors) reasons.push('QUALITY_ERRORS_REMAIN');
    if (hasWarnings) reasons.push('QUALITY_WARNINGS_REMAIN');

    const furtherRefreshRecommended = postRefreshPlan.hasRecommendedActions;

    let adequacy: RefreshAdequacy;

    if (!newProvenanceRecorded && changedFieldCount === 0) {
      adequacy = 'REFRESH_DID_NOT_HELP';
    } else if (furtherRefreshRecommended || sourceStillStale) {
      reasons.push('FURTHER_REFRESH_IN_PLAN');
      adequacy = 'FURTHER_REFRESH_RECOMMENDED';
    } else {
      adequacy = 'SUFFICIENT';
      if (reasons.length === 0) {
        reasons.push('ALL_SOURCES_FRESH');
      }
    }

    return {
      adequacy,
      reasons,
      furtherRefreshRecommended,
    };
  }
}
