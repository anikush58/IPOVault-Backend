import { Injectable } from '@nestjs/common';
import { Prisma, SourceHealthStatus, SourceType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { QualitySummary } from './reconciliation.service';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type RefreshStatus = 'FRESH' | 'STALE' | 'UNKNOWN';

export type RefreshPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type RefreshReasonCode =
  | 'NEW_IPO_NO_SOURCE_OBSERVATION'
  | 'STALE_OBSERVATION'
  | 'SOURCE_HEALTH_DEGRADED'
  | 'SOURCE_CONFLICT'
  | 'MISSING_REQUIRED_DATA'
  | 'RECENT_LIFECYCLE_CHANGE'
  | 'UP_TO_DATE';

export type SourceFreshnessDecision = {
  sourceId: string;
  sourceCode: string;
  sourceType: SourceType;
  healthStatus: SourceHealthStatus;
  status: RefreshStatus;
  priority: RefreshPriority;
  lastObservedAt: Date | null;
  reasons: RefreshReasonCode[];
  messages: string[];
  recommendRefresh: boolean;
};

export type IpoFreshnessSummary = {
  ipoId: string;
  overallStatus: RefreshStatus;
  highestPriority: RefreshPriority;
  sourceDecisions: SourceFreshnessDecision[];
  evaluatedAt: Date;
};

export type FreshnessTtlConfig = {
  sebiTtlMs: number;
  nseTtlMs: number;
  defaultTtlMs: number;
  recentLifecycleWindowMs: number;
};

export const DEFAULT_FRESHNESS_TTL_CONFIG: FreshnessTtlConfig = {
  sebiTtlMs: 24 * 60 * 60 * 1000, // 24 hours technical default policy for official filing updates
  nseTtlMs: 6 * 60 * 60 * 1000, // 6 hours technical default policy for exchange listing updates
  defaultTtlMs: 12 * 60 * 60 * 1000, // 12 hours fallback technical default
  recentLifecycleWindowMs: 48 * 60 * 60 * 1000, // 48 hours window for evaluating recent lifecycle transitions
};

@Injectable()
export class DiscoveryFreshnessService {
  /**
   * Deterministic, read-only analysis of source freshness and refresh priority for an IPO.
   *
   * Note on Semantics:
   * - `lastObservedAt` represents max(FieldProvenance.retrievedAt) for a source, representing
   *   the latest successful observation retrieval date. It is a source-level observation timestamp
   *   and does NOT guarantee full field-level coverage or indicate external source publication time.
   * - `status` (FRESH/STALE/UNKNOWN) measures retrieval freshness against technical default TTL policy.
   * - `priority` (HIGH/MEDIUM/LOW/NONE) is lifecycle-aware and quality-aware, indicating refresh urgency.
   *
   * Side-effect free, performs zero database writes or external network requests.
   */
  async evaluateFreshness(
    db: DatabaseClient,
    ipoId: string,
    qualitySummary?: QualitySummary,
    ttlConfig: FreshnessTtlConfig = DEFAULT_FRESHNESS_TTL_CONFIG,
    now: Date = new Date(),
  ): Promise<IpoFreshnessSummary> {
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
      include: { lifecycleEvents: true },
    });

    if (!ipo) {
      return {
        ipoId,
        overallStatus: 'UNKNOWN',
        highestPriority: 'NONE',
        sourceDecisions: [],
        evaluatedAt: now,
      };
    }

    const sources = db.source?.findMany
      ? await db.source.findMany({
          where: { enabled: true },
          orderBy: { priority: 'asc' },
        })
      : [];

    const provenances = await db.fieldProvenance.findMany({
      where: { entityType: 'IPO', entityId: ipoId },
      orderBy: { retrievedAt: 'desc' },
    });

    // Map sourceId -> max retrievedAt (latest successful observation retrieval date)
    const maxRetrievedAtBySource = new Map<string, Date>();
    for (const prov of provenances) {
      const existing = maxRetrievedAtBySource.get(prov.sourceId);
      if (!existing || prov.retrievedAt > existing) {
        maxRetrievedAtBySource.set(prov.sourceId, prov.retrievedAt);
      }
    }

    const sourceDecisions: SourceFreshnessDecision[] = [];

    for (const source of sources) {
      // Evaluate discovery sources (Official Filings & Exchanges)
      if (
        source.sourceType !== SourceType.OFFICIAL_FILING &&
        source.sourceType !== SourceType.EXCHANGE
      ) {
        continue;
      }

      const lastObservedAt = maxRetrievedAtBySource.get(source.id) ?? null;
      const reasons: RefreshReasonCode[] = [];
      const messages: string[] = [];

      let ttlMs = ttlConfig.defaultTtlMs;
      if (source.code.toLowerCase().includes('sebi')) {
        ttlMs = ttlConfig.sebiTtlMs;
      } else if (source.code.toLowerCase().includes('nse')) {
        ttlMs = ttlConfig.nseTtlMs;
      }

      let status: RefreshStatus = 'FRESH';
      let priority: RefreshPriority = 'NONE';

      if (!lastObservedAt) {
        status = 'UNKNOWN';
        priority = 'HIGH';
        reasons.push('NEW_IPO_NO_SOURCE_OBSERVATION');
        messages.push(
          `No observation recorded for source '${source.code}' on IPO ${ipoId}.`,
        );
      } else {
        const ageMs = now.getTime() - lastObservedAt.getTime();
        if (ageMs > ttlMs) {
          status = 'STALE';
          priority = 'MEDIUM';
          reasons.push('STALE_OBSERVATION');
          const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);
          messages.push(
            `Last observation for source '${source.code}' was ${ageHours}h ago (threshold: ${(ttlMs / (1000 * 60 * 60)).toFixed(1)}h).`,
          );
        } else {
          status = 'FRESH';
          priority = 'NONE';
        }
      }

      // Source Health Evaluation (Independent of Freshness timestamp)
      if (
        source.healthStatus === SourceHealthStatus.DEGRADED ||
        source.healthStatus === SourceHealthStatus.FAILING
      ) {
        reasons.push('SOURCE_HEALTH_DEGRADED');
        messages.push(
          `Source '${source.code}' health status is ${source.healthStatus}.`,
        );
      }

      // Event-Aware Evaluation (Recent Lifecycle Transitions)
      if (ipo.lifecycleEvents && ipo.lifecycleEvents.length > 0) {
        const recentEvt = ipo.lifecycleEvents.find((evt) => {
          const evtTime = new Date(evt.eventDate).getTime();
          const age = now.getTime() - evtTime;
          return age >= 0 && age <= ttlConfig.recentLifecycleWindowMs;
        });

        if (recentEvt) {
          reasons.push('RECENT_LIFECYCLE_CHANGE');
          const dateStr = recentEvt.eventDate.toISOString().slice(0, 10);
          messages.push(
            `Recent lifecycle event '${recentEvt.eventType}' occurred on ${dateStr}.`,
          );
          if (priority === 'NONE') priority = 'MEDIUM';
        }
      }

      // Quality Summary & Reconciliation Conflict Influences
      if (qualitySummary) {
        const sourceConflict = qualitySummary.findings.find(
          (f) => f.code === 'SOURCE_CONFLICT',
        );
        if (sourceConflict) {
          reasons.push('SOURCE_CONFLICT');
          messages.push(
            `Source conflict detected on field '${sourceConflict.field ?? 'unknown'}'.`,
          );
          if (priority !== 'HIGH') priority = 'HIGH';
        }

        const missingData = qualitySummary.findings.find(
          (f) =>
            f.code === 'INCOMPLETE_TERMS' ||
            f.code === 'INCOMPLETE_ISSUE_STRUCTURE',
        );
        if (missingData && (ipo.status === 'OPEN' || ipo.status === 'CLOSED')) {
          reasons.push('MISSING_REQUIRED_DATA');
          messages.push(
            `Missing required terms for active ${ipo.status} IPO.`,
          );
          if (priority === 'NONE') priority = 'MEDIUM';
        }
      }

      // Lifecycle Modifiers
      if (ipo.status === 'OPEN') {
        if (status === 'STALE') priority = 'HIGH';
        else if (status === 'FRESH' && priority === 'NONE') priority = 'LOW';
      } else if (ipo.status === 'LISTED') {
        // Listed IPOs have lower refresh urgency unless active conflicts exist
        if (priority === 'MEDIUM') {
          priority = 'LOW';
        } else if (
          status === 'UNKNOWN' &&
          !reasons.includes('SOURCE_CONFLICT')
        ) {
          priority = 'LOW';
        }
      }

      if (reasons.length === 0) {
        reasons.push('UP_TO_DATE');
        messages.push(`Source '${source.code}' observation is up to date.`);
      }

      const recommendRefresh =
        status === 'STALE' ||
        status === 'UNKNOWN' ||
        priority === 'HIGH' ||
        priority === 'MEDIUM';

      sourceDecisions.push({
        sourceId: source.id,
        sourceCode: source.code,
        sourceType: source.sourceType,
        healthStatus: source.healthStatus,
        status,
        priority,
        lastObservedAt,
        reasons,
        messages,
        recommendRefresh,
      });
    }

    const priorityWeight: Record<RefreshPriority, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
      NONE: 0,
    };

    let highestPriority: RefreshPriority = 'NONE';
    for (const dec of sourceDecisions) {
      if (priorityWeight[dec.priority] > priorityWeight[highestPriority]) {
        highestPriority = dec.priority;
      }
    }

    let overallStatus: RefreshStatus = 'FRESH';
    if (sourceDecisions.some((d) => d.status === 'STALE')) {
      overallStatus = 'STALE';
    } else if (sourceDecisions.every((d) => d.status === 'UNKNOWN')) {
      overallStatus = 'UNKNOWN';
    }

    return {
      ipoId,
      overallStatus,
      highestPriority,
      sourceDecisions,
      evaluatedAt: now,
    };
  }
}
