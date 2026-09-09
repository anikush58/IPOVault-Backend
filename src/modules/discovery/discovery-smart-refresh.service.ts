import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { FreshnessTtlConfig } from './discovery-freshness.service';
import { DiscoveryRefreshService, RefreshPlan } from './discovery-refresh.service';
import {
  DiscoveryRefreshExecutionService,
  RefreshExecutionResult,
} from './discovery-refresh-execution.service';
import {
  DiscoveryRefreshVerificationService,
  RefreshVerificationReport,
} from './discovery-refresh-verification.service';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type SmartRefreshOutcome =
  | 'REFRESHED_AND_VERIFIED'
  | 'REFRESHED_BUT_UNCHANGED'
  | 'FURTHER_REFRESH_RECOMMENDED'
  | 'NOT_OBSERVED'
  | 'VERIFICATION_INCONCLUSIVE'
  | 'REFRESH_SKIPPED'
  | 'REFRESH_BLOCKED'
  | 'REFRESH_FAILED';

export type SmartRefreshRequest = {
  ipoId: string;
  sourceCode: string;
  ttlConfig?: FreshnessTtlConfig;
};

export type SmartRefreshResult = {
  ipoId: string;
  sourceCode: string;
  generatedAt: Date;
  finalOutcome: SmartRefreshOutcome;
  summaryMessage: string;
  initialRefreshPlan: RefreshPlan;
  execution?: RefreshExecutionResult;
  verification?: RefreshVerificationReport;
};

@Injectable()
export class DiscoverySmartRefreshService {
  private readonly logger = new Logger(DiscoverySmartRefreshService.name);

  constructor(
    private readonly refreshPlanService?: DiscoveryRefreshService,
    private readonly executionService?: DiscoveryRefreshExecutionService,
    private readonly verificationService?: DiscoveryRefreshVerificationService,
  ) {}

  /**
   * Deterministic, synchronous orchestration of a Smart IPO Refresh Workflow.
   *
   * Pipeline:
   *  Phase 13: Refresh Plan
   *      ↓
   *  Phase 14: Controlled Refresh Execution (only if RECOMMENDED)
   *      ↓
   *  Phase 15: Post-Refresh Verification & Reconciliation (if COMPLETED)
   *      ↓
   *  Final Combined Smart Refresh Outcome
   *
   * Orchestration only — delegates ingestion writes to Phase 14 and verification to Phase 15.
   */
  async smartRefresh(
    db: DatabaseClient,
    request: SmartRefreshRequest,
    now: Date = new Date(),
  ): Promise<SmartRefreshResult> {
    const { ipoId, ttlConfig } = request;
    const normalizedSourceCode = request.sourceCode.trim().toLowerCase();

    this.logger.log(
      `Starting Smart Refresh Workflow for IPO ${ipoId}, source '${normalizedSourceCode}'`,
    );

    // 1. Validate IPO exists
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
      select: { id: true },
    });

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    // 2. Generate Phase 13 Refresh Plan
    const planSvc = this.refreshPlanService ?? new DiscoveryRefreshService();
    const initialRefreshPlan = await planSvc.generatePlan(db, ipoId, now, ttlConfig);

    // 3. Inspect planned action for requested source
    const plannedAction = initialRefreshPlan.actions.find(
      (a) => a.sourceCode.toLowerCase() === normalizedSourceCode,
    );

    const actionStatus = plannedAction?.status ?? 'BLOCKED';

    // 4. Short-circuit if planned action is SKIPPED or BLOCKED
    if (actionStatus === 'SKIPPED') {
      this.logger.log(
        `Smart Refresh skipped for IPO ${ipoId}, source '${normalizedSourceCode}': source is already fresh`,
      );
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'REFRESH_SKIPPED',
        summaryMessage: `Refresh skipped: source '${normalizedSourceCode}' is already fresh or no refresh is required.`,
        initialRefreshPlan,
      };
    }

    if (actionStatus === 'BLOCKED') {
      const reason = plannedAction?.reasons.join(', ') || 'SOURCE_UNAVAILABLE';
      this.logger.log(
        `Smart Refresh blocked for IPO ${ipoId}, source '${normalizedSourceCode}': ${reason}`,
      );
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'REFRESH_BLOCKED',
        summaryMessage: `Refresh blocked for source '${normalizedSourceCode}': ${reason}.`,
        initialRefreshPlan,
      };
    }

    // 5. Execute Phase 14 Controlled Refresh
    const execSvc =
      this.executionService ?? new DiscoveryRefreshExecutionService();
    const execution = await execSvc.execute(db, {
      ipoId,
      sourceCode: normalizedSourceCode,
    });

    // 6. Handle non-COMPLETED execution outcomes
    if (execution.status === 'SKIPPED') {
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'REFRESH_SKIPPED',
        summaryMessage: execution.message || `Refresh action skipped for source '${normalizedSourceCode}'.`,
        initialRefreshPlan,
        execution,
      };
    }

    if (execution.status === 'BLOCKED') {
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'REFRESH_BLOCKED',
        summaryMessage: execution.message || `Refresh action blocked for source '${normalizedSourceCode}'.`,
        initialRefreshPlan,
        execution,
      };
    }

    if (execution.status === 'FAILED') {
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'REFRESH_FAILED',
        summaryMessage: execution.message || `Refresh execution failed for source '${normalizedSourceCode}'.`,
        initialRefreshPlan,
        execution,
      };
    }

    // 7. Execution COMPLETED -> Invoke Phase 15 Verification
    const verifySvc =
      this.verificationService ?? new DiscoveryRefreshVerificationService();

    let verification: RefreshVerificationReport;
    try {
      verification = await verifySvc.verify(db, {
        ipoId,
        sourceCode: normalizedSourceCode,
        executionStatus: execution.status,
        refreshStartedAt: execution.startedAt,
        refreshCompletedAt: execution.completedAt,
        ttlConfig,
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Verification failed unexpectedly post-refresh for IPO ${ipoId}: ${errMsg}`,
      );
      return {
        ipoId,
        sourceCode: normalizedSourceCode,
        generatedAt: now,
        finalOutcome: 'VERIFICATION_INCONCLUSIVE',
        summaryMessage: `Refresh completed, but verification failed: ${errMsg}`,
        initialRefreshPlan,
        execution,
      };
    }

    // 8. Derive final outcome from verification report
    const finalOutcome = this.deriveFinalOutcome(verification);
    const summaryMessage = this.buildSummaryMessage(
      normalizedSourceCode,
      finalOutcome,
      verification,
    );

    this.logger.log(
      `Smart Refresh completed for IPO ${ipoId}, source '${normalizedSourceCode}': outcome=${finalOutcome}`,
    );

    return {
      ipoId,
      sourceCode: normalizedSourceCode,
      generatedAt: now,
      finalOutcome,
      summaryMessage,
      initialRefreshPlan,
      execution,
      verification,
    };
  }

  /**
   * Deterministic mapping from Phase 15 verification report to SmartRefreshOutcome.
   */
  private deriveFinalOutcome(
    verification: RefreshVerificationReport,
  ): SmartRefreshOutcome {
    const { observationStatus, verdict } = verification;

    switch (observationStatus) {
      case 'SKIPPED':
        return 'REFRESH_SKIPPED';
      case 'BLOCKED':
        return 'REFRESH_BLOCKED';
      case 'FAILED':
        return 'REFRESH_FAILED';
      case 'INCONCLUSIVE':
        return 'VERIFICATION_INCONCLUSIVE';
      case 'NOT_OBSERVED':
        return 'NOT_OBSERVED';
      case 'OBSERVED_AND_UPDATED':
        return verdict.furtherRefreshRecommended
          ? 'FURTHER_REFRESH_RECOMMENDED'
          : 'REFRESHED_AND_VERIFIED';
      case 'OBSERVED_BUT_UNCHANGED':
        return verdict.furtherRefreshRecommended
          ? 'FURTHER_REFRESH_RECOMMENDED'
          : 'REFRESHED_BUT_UNCHANGED';
      default:
        return 'VERIFICATION_INCONCLUSIVE';
    }
  }

  private buildSummaryMessage(
    sourceCode: string,
    outcome: SmartRefreshOutcome,
    verification: RefreshVerificationReport,
  ): string {
    switch (outcome) {
      case 'REFRESHED_AND_VERIFIED':
        return `Successfully refreshed '${sourceCode}': ${verification.changedFieldCount} canonical field(s) updated and data is verified fresh.`;
      case 'REFRESHED_BUT_UNCHANGED':
        return `Refreshed '${sourceCode}': observation confirmed, but no canonical field values changed.`;
      case 'FURTHER_REFRESH_RECOMMENDED':
        return `Refreshed '${sourceCode}': observation processed, but further refresh is recommended (${verification.verdict.reasons.join(', ')}).`;
      case 'NOT_OBSERVED':
        return `Refreshed '${sourceCode}': execution completed, but the requested IPO was not observed in the source payload.`;
      case 'VERIFICATION_INCONCLUSIVE':
        return `Refreshed '${sourceCode}': verification results were inconclusive.`;
      case 'REFRESH_SKIPPED':
        return `Refresh skipped for '${sourceCode}'.`;
      case 'REFRESH_BLOCKED':
        return `Refresh blocked for '${sourceCode}'.`;
      case 'REFRESH_FAILED':
        return `Refresh failed for '${sourceCode}'.`;
      default:
        return `Smart refresh finished for '${sourceCode}' with outcome: ${outcome}.`;
    }
  }
}
