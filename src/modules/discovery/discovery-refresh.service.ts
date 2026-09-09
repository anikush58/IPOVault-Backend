import { Injectable } from '@nestjs/common';
import { Prisma, SourceHealthStatus, SourceType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  DiscoveryFreshnessService,
  FreshnessTtlConfig,
  RefreshPriority,
  RefreshReasonCode,
  RefreshStatus,
} from './discovery-freshness.service';
import { ReconciliationService } from './reconciliation.service';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type RefreshActionStatus = 'RECOMMENDED' | 'SKIPPED' | 'BLOCKED';

export type RefreshAction = {
  sourceId: string;
  sourceCode: string;
  sourceType: SourceType;
  healthStatus: SourceHealthStatus;
  status: RefreshActionStatus;
  freshnessStatus: RefreshStatus;
  priority: RefreshPriority;
  lastObservedAt: Date | null;
  reasons: RefreshReasonCode[];
  messages: string[];
};

export type RefreshPlan = {
  ipoId: string;
  overallStatus: RefreshStatus;
  highestPriority: RefreshPriority;
  hasRecommendedActions: boolean;
  generatedAt: Date;
  actions: RefreshAction[];
};

@Injectable()
export class DiscoveryRefreshService {
  constructor(
    private readonly freshnessService?: DiscoveryFreshnessService,
    private readonly reconciliationService?: ReconciliationService,
  ) {}

  /**
   * Deterministic, read-only generation of a Smart IPO Refresh Plan.
   * Transforms Phase 12 freshness & reconciliation state into prioritized, safe refresh actions.
   * Performs zero database writes or external network requests.
   */
  async generatePlan(
    db: DatabaseClient,
    ipoId: string,
    now: Date = new Date(),
    ttlConfig?: FreshnessTtlConfig,
  ): Promise<RefreshPlan> {
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
    });

    if (!ipo) {
      return {
        ipoId,
        overallStatus: 'UNKNOWN',
        highestPriority: 'NONE',
        hasRecommendedActions: false,
        generatedAt: now,
        actions: [],
      };
    }

    const reconciliationSvc =
      this.reconciliationService ?? new ReconciliationService();
    const reconciliationSummary = await reconciliationSvc.reconcileIpo(
      db,
      ipoId,
      now,
    );

    const freshnessSvc =
      this.freshnessService ?? new DiscoveryFreshnessService();
    const freshnessSummary = await freshnessSvc.evaluateFreshness(
      db,
      ipoId,
      reconciliationSummary.qualitySummary,
      ttlConfig,
      now,
    );

    const sources = db.source?.findMany
      ? await db.source.findMany({
          where: { enabled: true },
          orderBy: { priority: 'asc' },
        })
      : [];

    const sourceMetaMap = new Map<string, { dbPriority: number }>();
    for (const src of sources) {
      sourceMetaMap.set(src.id, { dbPriority: src.priority });
    }

    const actions: RefreshAction[] = [];

    for (const decision of freshnessSummary.sourceDecisions) {
      let actionStatus: RefreshActionStatus = 'SKIPPED';

      if (
        decision.healthStatus === SourceHealthStatus.FAILING ||
        decision.healthStatus === SourceHealthStatus.DEGRADED
      ) {
        actionStatus = 'BLOCKED';
      } else if (
        decision.status === 'STALE' ||
        decision.status === 'UNKNOWN' ||
        decision.recommendRefresh
      ) {
        actionStatus = 'RECOMMENDED';
      } else {
        actionStatus = 'SKIPPED';
      }

      actions.push({
        sourceId: decision.sourceId,
        sourceCode: decision.sourceCode,
        sourceType: decision.sourceType,
        healthStatus: decision.healthStatus,
        status: actionStatus,
        freshnessStatus: decision.status,
        priority: decision.priority,
        lastObservedAt: decision.lastObservedAt,
        reasons: decision.reasons,
        messages: decision.messages,
      });
    }

    const priorityWeight: Record<RefreshPriority, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      NONE: 0,
    };

    // Sort Refresh Actions deterministically:
    // 1. Refresh Priority (HIGH > MEDIUM > LOW > NONE)
    // 2. Source Authority / Priority metadata (lower dbPriority value first)
    // 3. Alphabetical sourceCode tie-breaker
    actions.sort((a, b) => {
      const weightA = priorityWeight[a.priority];
      const weightB = priorityWeight[b.priority];
      if (weightA !== weightB) {
        return weightB - weightA;
      }

      const metaA = sourceMetaMap.get(a.sourceId)?.dbPriority ?? 100;
      const metaB = sourceMetaMap.get(b.sourceId)?.dbPriority ?? 100;
      if (metaA !== metaB) {
        return metaA - metaB;
      }

      return a.sourceCode.localeCompare(b.sourceCode);
    });

    const hasRecommendedActions = actions.some(
      (a) => a.status === 'RECOMMENDED',
    );

    return {
      ipoId,
      overallStatus: freshnessSummary.overallStatus,
      highestPriority: freshnessSummary.highestPriority,
      hasRecommendedActions,
      generatedAt: now,
      actions,
    };
  }
}
