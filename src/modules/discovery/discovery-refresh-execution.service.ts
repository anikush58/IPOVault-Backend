import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { NSE_SOURCE_CODE, SEBI_SOURCE_CODE } from './adapters/source-adapter';
import { SebiDiscoveryFlow } from './adapters/sebi/sebi-discovery.flow';
import { DiscoveryRefreshService, RefreshPlan } from './discovery-refresh.service';
import { NseDiscoveryFlow } from './nse-discovery.flow';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type RefreshExecutionStatus =
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED';

export type RefreshExecutionOutcome =
  | 'CREATED'
  | 'MATCHED'
  | 'DUPLICATE'
  | 'REJECTED'
  | 'ERROR'
  | 'SKIPPED'
  | 'BLOCKED'
  | 'UNSUPPORTED'
  | 'NO_NEW_OBSERVATIONS';

export type RefreshExecutionRequest = {
  ipoId: string;
  sourceCode: string;
};

export type RefreshExecutionResult = {
  ipoId: string;
  sourceCode: string;
  status: RefreshExecutionStatus;
  startedAt: Date;
  completedAt: Date;
  outcome: RefreshExecutionOutcome;
  message: string;
  reasons: string[];
  refreshedPlan?: RefreshPlan;
};

@Injectable()
export class DiscoveryRefreshExecutionService {
  private readonly logger = new Logger(DiscoveryRefreshExecutionService.name);

  constructor(
    private readonly refreshPlanService?: DiscoveryRefreshService,
    private readonly sebibDiscoveryFlow?: SebiDiscoveryFlow,
    private readonly nseDiscoveryFlow?: NseDiscoveryFlow,
  ) {}

  /**
   * Safe, explicit execution of ONE requested refresh action for an IPO and source.
   * Enforces Phase 13 refresh-plan recommendations and delegates fetch/ingestion to existing discovery flows.
   */
  async execute(
    db: DatabaseClient,
    request: RefreshExecutionRequest,
  ): Promise<RefreshExecutionResult> {
    const startedAt = new Date();
    const normalizedSourceCode = request.sourceCode.trim().toLowerCase();

    // 1. Verify IPO exists
    const ipo = await db.ipo.findUnique({
      where: { id: request.ipoId },
    });

    if (!ipo) {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'FAILED',
        startedAt,
        completedAt,
        outcome: 'ERROR',
        message: `IPO with ID '${request.ipoId}' was not found.`,
        reasons: ['IPO_NOT_FOUND'],
      };
    }

    // 2. Check source registration & availability
    const source = db.source?.findUnique
      ? await db.source.findUnique({
          where: { code: normalizedSourceCode },
        })
      : null;

    if (!source) {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'BLOCKED',
        startedAt,
        completedAt,
        outcome: 'UNSUPPORTED',
        message: `Source '${normalizedSourceCode}' is not registered in the system.`,
        reasons: ['SOURCE_NOT_REGISTERED'],
      };
    }

    if (!source.enabled) {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'BLOCKED',
        startedAt,
        completedAt,
        outcome: 'BLOCKED',
        message: `Source '${normalizedSourceCode}' is currently disabled.`,
        reasons: ['SOURCE_DISABLED'],
      };
    }

    // 3. Verify target source is supported by an executable discovery flow
    const supportedSources = [SEBI_SOURCE_CODE, NSE_SOURCE_CODE];
    if (!supportedSources.includes(normalizedSourceCode)) {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'BLOCKED',
        startedAt,
        completedAt,
        outcome: 'UNSUPPORTED',
        message: `Source '${normalizedSourceCode}' does not have an executable discovery flow available.`,
        reasons: ['EXECUTABLE_FLOW_UNAVAILABLE'],
      };
    }

    // 4. Generate Phase 13 Refresh Plan to enforce safety & freshness decisions
    const refreshPlanSvc =
      this.refreshPlanService ?? new DiscoveryRefreshService();
    const currentPlan = await refreshPlanSvc.generatePlan(
      db,
      request.ipoId,
      startedAt,
    );

    const targetAction = currentPlan.actions.find(
      (a) => a.sourceCode.toLowerCase() === normalizedSourceCode,
    );

    if (!targetAction) {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'BLOCKED',
        startedAt,
        completedAt,
        outcome: 'BLOCKED',
        message: `No refresh action decision found for source '${normalizedSourceCode}' in Phase 13 plan.`,
        reasons: ['ACTION_NOT_IN_PLAN'],
      };
    }

    if (targetAction.status === 'SKIPPED') {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'SKIPPED',
        startedAt,
        completedAt,
        outcome: 'SKIPPED',
        message: `Refresh action for '${normalizedSourceCode}' was SKIPPED (observation is up to date).`,
        reasons: targetAction.reasons,
        refreshedPlan: currentPlan,
      };
    }

    if (targetAction.status === 'BLOCKED') {
      const completedAt = new Date();
      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'BLOCKED',
        startedAt,
        completedAt,
        outcome: 'BLOCKED',
        message: `Refresh action for '${normalizedSourceCode}' is BLOCKED (e.g. source health degraded/failing).`,
        reasons: targetAction.reasons,
        refreshedPlan: currentPlan,
      };
    }

    // 5. Execute explicit refresh action via existing discovery flow
    this.logger.log(
      `Executing explicit refresh for IPO ${request.ipoId} via source '${normalizedSourceCode}'...`,
    );

    try {
      let flowOutcome: RefreshExecutionOutcome = 'MATCHED';

      if (normalizedSourceCode === SEBI_SOURCE_CODE) {
        if (!this.sebibDiscoveryFlow) {
          throw new Error('SebiDiscoveryFlow is not injected.');
        }
        const sebiResult = await this.sebibDiscoveryFlow.run(
          1,
          1,
          undefined,
          true,
          true,
        );

        if (sebiResult.canonicalCreatedCount > 0) {
          flowOutcome = 'CREATED';
        } else if (sebiResult.canonicalMatchedCount > 0) {
          flowOutcome = 'MATCHED';
        } else if (sebiResult.duplicateCount > 0) {
          flowOutcome = 'DUPLICATE';
        } else {
          flowOutcome = 'NO_NEW_OBSERVATIONS';
        }
      } else if (normalizedSourceCode === NSE_SOURCE_CODE) {
        if (!this.nseDiscoveryFlow) {
          throw new Error('NseDiscoveryFlow is not injected.');
        }
        const nseResults = await this.nseDiscoveryFlow.ingestLive(startedAt);

        if (nseResults.some((r) => r.outcome === 'CREATED')) {
          flowOutcome = 'CREATED';
        } else if (nseResults.some((r) => r.outcome === 'MATCHED')) {
          flowOutcome = 'MATCHED';
        } else if (nseResults.every((r) => r.outcome === 'DUPLICATE')) {
          flowOutcome = 'DUPLICATE';
        } else {
          flowOutcome = 'MATCHED';
        }
      }

      const completedAt = new Date();
      const updatedPlan = await refreshPlanSvc.generatePlan(
        db,
        request.ipoId,
        completedAt,
      );

      this.logger.log(
        `Completed explicit refresh for IPO ${request.ipoId} via source '${normalizedSourceCode}': outcome=${flowOutcome}`,
      );

      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'COMPLETED',
        startedAt,
        completedAt,
        outcome: flowOutcome,
        message: `Refresh operation completed successfully for source '${normalizedSourceCode}'.`,
        reasons: targetAction.reasons,
        refreshedPlan: updatedPlan,
      };
    } catch (err: unknown) {
      const completedAt = new Date();
      const errorMsg = err instanceof Error ? err.message : String(err);

      this.logger.error(
        `Explicit refresh failed for IPO ${request.ipoId} via source '${normalizedSourceCode}': ${errorMsg}`,
      );

      return {
        ipoId: request.ipoId,
        sourceCode: normalizedSourceCode,
        status: 'FAILED',
        startedAt,
        completedAt,
        outcome: 'ERROR',
        message: `Source refresh failed: ${errorMsg}`,
        reasons: ['DISCOVERY_FLOW_EXECUTION_FAILED'],
      };
    }
  }
}
