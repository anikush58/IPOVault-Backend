import { Injectable } from '@nestjs/common';
import { Prisma, SourceType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { DiscoveredIpo } from './discovery.types';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type SourceValueObservation = {
  sourceId: string;
  sourceCode: string;
  sourceType: SourceType;
  sourceReference: string | null;
  value: string;
  retrievedAt: Date;
};

export type FieldConflict = {
  fieldName: string;
  canonicalValue: string | null;
  hasConflict: boolean;
  activeObservations: SourceValueObservation[];
  historicalObservations: SourceValueObservation[];
  /** Alias for activeObservations for backward compatibility */
  observations: SourceValueObservation[];
};

export type IpoReconciliationReport = {
  ipoId: string;
  hasAnyConflict: boolean;
  conflicts: FieldConflict[];
};

export type FieldComparisonOutcome =
  | 'MATCH'
  | 'CONFLICT'
  | 'SEBI_ONLY'
  | 'EXCHANGE_ONLY'
  | 'UNRESOLVED';

export type FieldComparison = {
  fieldName: string;
  sebiValue: string | null;
  exchangeValue: string | null;
  outcome: FieldComparisonOutcome;
};

export type ObservationReconciliationResult = {
  hasConflict: boolean;
  comparisons: FieldComparison[];
};

export type IpoReconciliationSummary = {
  ipoId: string;
  hasCrossSourceConflict: boolean;
  canonicalValues: Record<string, string | null>;
  sebiActiveObservation: Record<string, string | null>;
  exchangeActiveObservation: Record<string, string | null>;
  fieldComparisons: FieldComparison[];
  provenanceReport: IpoReconciliationReport;
};

function valuesAreEqual(valA: string | null, valB: string | null): boolean {
  if (valA === null && valB === null) return true;
  if (valA === null || valB === null) return false;

  const trimA = valA.trim();
  const trimB = valB.trim();
  if (trimA === trimB) return true;

  const numA = Number(trimA);
  const numB = Number(trimB);
  if (!isNaN(numA) && !isNaN(numB)) {
    return Math.abs(numA - numB) < 1e-6;
  }

  return false;
}

function classifyOutcome(
  sebiVal: string | null,
  exchangeVal: string | null,
): FieldComparisonOutcome {
  if (sebiVal !== null && exchangeVal !== null) {
    return valuesAreEqual(sebiVal, exchangeVal) ? 'MATCH' : 'CONFLICT';
  }
  if (sebiVal !== null && exchangeVal === null) return 'SEBI_ONLY';
  if (sebiVal === null && exchangeVal !== null) return 'EXCHANGE_ONLY';
  return 'UNRESOLVED';
}

@Injectable()
export class ReconciliationService {
  /**
   * Pure deterministic comparison of two normalized observations (e.g. SEBI vs EXCHANGE).
   * Side-effect free, read-only analysis.
   */
  reconcileObservations(
    sebi: DiscoveredIpo,
    exchange: DiscoveredIpo,
  ): ObservationReconciliationResult {
    const fieldsToCompare: Array<{
      fieldName: string;
      sebiVal: string | null;
      exchangeVal: string | null;
    }> = [
      {
        fieldName: 'issue_size',
        sebiVal: sebi.ipo.issueSize,
        exchangeVal: exchange.ipo.issueSize,
      },
      {
        fieldName: 'fresh_issue_size',
        sebiVal: sebi.ipo.freshIssueSize,
        exchangeVal: exchange.ipo.freshIssueSize,
      },
      {
        fieldName: 'ofs_size',
        sebiVal: sebi.ipo.ofsSize,
        exchangeVal: exchange.ipo.ofsSize,
      },
      {
        fieldName: 'issue_share_count',
        sebiVal: sebi.ipo.issueShareCount,
        exchangeVal: exchange.ipo.issueShareCount,
      },
      {
        fieldName: 'fresh_issue_share_count',
        sebiVal: sebi.ipo.freshIssueShareCount,
        exchangeVal: exchange.ipo.freshIssueShareCount,
      },
      {
        fieldName: 'ofs_share_count',
        sebiVal: sebi.ipo.ofsShareCount,
        exchangeVal: exchange.ipo.ofsShareCount,
      },
      {
        fieldName: 'price_band_low',
        sebiVal: sebi.ipo.priceBandLow,
        exchangeVal: exchange.ipo.priceBandLow,
      },
      {
        fieldName: 'price_band_high',
        sebiVal: sebi.ipo.priceBandHigh,
        exchangeVal: exchange.ipo.priceBandHigh,
      },
      {
        fieldName: 'lot_size',
        sebiVal: sebi.ipo.lotSize === null ? null : String(sebi.ipo.lotSize),
        exchangeVal:
          exchange.ipo.lotSize === null ? null : String(exchange.ipo.lotSize),
      },
      {
        fieldName: 'lifecycle.open_date',
        sebiVal: sebi.lifecycle.openDate,
        exchangeVal: exchange.lifecycle.openDate,
      },
      {
        fieldName: 'lifecycle.close_date',
        sebiVal: sebi.lifecycle.closeDate,
        exchangeVal: exchange.lifecycle.closeDate,
      },
      {
        fieldName: 'lifecycle.listing_date',
        sebiVal: sebi.lifecycle.listingDate,
        exchangeVal: exchange.lifecycle.listingDate,
      },
    ];

    const comparisons: FieldComparison[] = fieldsToCompare.map(
      ({ fieldName, sebiVal, exchangeVal }) => ({
        fieldName,
        sebiValue: sebiVal,
        exchangeValue: exchangeVal,
        outcome: classifyOutcome(sebiVal, exchangeVal),
      }),
    );

    const hasConflict = comparisons.some((c) => c.outcome === 'CONFLICT');

    return {
      hasConflict,
      comparisons,
    };
  }

  /**
   * Database-backed conflict analysis querying field provenances for an IPO.
   * Distinguishes active observations (latest per source) from historical revisions.
   * Same-source revisions do NOT produce false cross-source conflicts.
   */
  async detectConflicts(
    db: DatabaseClient,
    ipoId: string,
  ): Promise<IpoReconciliationReport> {
    const ipo = await db.ipo.findUnique({ where: { id: ipoId } });
    if (!ipo) {
      return {
        ipoId,
        hasAnyConflict: false,
        conflicts: [],
      };
    }

    const provenances = await db.fieldProvenance.findMany({
      where: { entityType: 'IPO', entityId: ipoId },
      include: { source: true },
      orderBy: { retrievedAt: 'asc' },
    });

    const groupedByField = new Map<string, SourceValueObservation[]>();
    for (const prov of provenances) {
      const list = groupedByField.get(prov.fieldName) ?? [];
      list.push({
        sourceId: prov.sourceId,
        sourceCode: prov.source.code,
        sourceType: prov.source.sourceType,
        sourceReference: prov.sourceReference,
        value: prov.value,
        retrievedAt: prov.retrievedAt,
      });
      groupedByField.set(prov.fieldName, list);
    }

    const canonicalMap: Record<string, string | null> = {
      market_segment: ipo.marketSegment,
      exchange: ipo.exchange,
      status: ipo.status,
      symbol: ipo.symbol,
      issue_size: ipo.issueSize ? ipo.issueSize.toFixed(2) : null,
      fresh_issue_size: ipo.freshIssueSize
        ? ipo.freshIssueSize.toFixed(2)
        : null,
      ofs_size: ipo.ofsSize ? ipo.ofsSize.toFixed(2) : null,
      issue_share_count: ipo.issueShareCount
        ? ipo.issueShareCount.toString()
        : null,
      fresh_issue_share_count: ipo.freshIssueShareCount
        ? ipo.freshIssueShareCount.toString()
        : null,
      ofs_share_count: ipo.ofsShareCount ? ipo.ofsShareCount.toString() : null,
      price_band_low: ipo.priceBandLow ? ipo.priceBandLow.toFixed(2) : null,
      price_band_high: ipo.priceBandHigh ? ipo.priceBandHigh.toFixed(2) : null,
      lot_size: ipo.lotSize ? String(ipo.lotSize) : null,
    };

    const conflicts: FieldConflict[] = [];

    for (const [fieldName, obsList] of groupedByField.entries()) {
      // Group historical rows by sourceId to find the latest active row per source
      const bySource = new Map<string, SourceValueObservation>();
      for (const obs of obsList) {
        const existing = bySource.get(obs.sourceId);
        if (!existing || obs.retrievedAt >= existing.retrievedAt) {
          bySource.set(obs.sourceId, obs);
        }
      }

      const activeObservations = Array.from(bySource.values());

      // Conflict occurs ONLY when active observations from distinct sources disagree
      let hasConflict = false;
      if (activeObservations.length >= 2) {
        const firstVal = activeObservations[0]!.value;
        hasConflict = activeObservations.some(
          (obs) => !valuesAreEqual(obs.value, firstVal),
        );
      }

      conflicts.push({
        fieldName,
        canonicalValue: canonicalMap[fieldName] ?? null,
        hasConflict,
        activeObservations,
        historicalObservations: obsList,
        observations: activeObservations,
      });
    }

    const hasAnyConflict = conflicts.some((c) => c.hasConflict);

    return {
      ipoId,
      hasAnyConflict,
      conflicts,
    };
  }

  /**
   * Scoped multi-source reconciliation summary for an IPO (e.g. SEBI ↔ NSE).
   * Operates strictly on already-ingested observations without canonical writes or network calls.
   */
  async reconcileIpo(
    db: DatabaseClient,
    ipoId: string,
  ): Promise<IpoReconciliationSummary> {
    const report = await this.detectConflicts(db, ipoId);
    const ipo = await db.ipo.findUnique({ where: { id: ipoId } });

    const canonicalValues: Record<string, string | null> = ipo
      ? {
          marketSegment: ipo.marketSegment,
          exchange: ipo.exchange,
          status: ipo.status,
          symbol: ipo.symbol,
          issueSize: ipo.issueSize ? ipo.issueSize.toFixed(2) : null,
          freshIssueSize: ipo.freshIssueSize
            ? ipo.freshIssueSize.toFixed(2)
            : null,
          ofsSize: ipo.ofsSize ? ipo.ofsSize.toFixed(2) : null,
          issueShareCount: ipo.issueShareCount
            ? ipo.issueShareCount.toString()
            : null,
          freshIssueShareCount: ipo.freshIssueShareCount
            ? ipo.freshIssueShareCount.toString()
            : null,
          ofsShareCount: ipo.ofsShareCount
            ? ipo.ofsShareCount.toString()
            : null,
          priceBandLow: ipo.priceBandLow ? ipo.priceBandLow.toFixed(2) : null,
          priceBandHigh: ipo.priceBandHigh ? ipo.priceBandHigh.toFixed(2) : null,
          lotSize: ipo.lotSize ? String(ipo.lotSize) : null,
        }
      : {};

    const sebiActiveObs: Record<string, string | null> = {};
    const exchangeActiveObs: Record<string, string | null> = {};

    for (const conflict of report.conflicts) {
      for (const active of conflict.activeObservations) {
        if (
          active.sourceCode.toLowerCase().includes('sebi') ||
          active.sourceType === SourceType.OFFICIAL_FILING
        ) {
          sebiActiveObs[conflict.fieldName] = active.value;
        } else if (
          active.sourceCode.toLowerCase().includes('nse') ||
          active.sourceCode.toLowerCase().includes('bse') ||
          active.sourceType === SourceType.EXCHANGE
        ) {
          exchangeActiveObs[conflict.fieldName] = active.value;
        }
      }
    }

    const fieldNamesToCompare = [
      'issue_size',
      'fresh_issue_size',
      'ofs_size',
      'issue_share_count',
      'fresh_issue_share_count',
      'ofs_share_count',
      'price_band_low',
      'price_band_high',
      'lot_size',
      'lifecycle.open_date',
      'lifecycle.close_date',
      'lifecycle.listing_date',
    ];

    const fieldComparisons: FieldComparison[] = fieldNamesToCompare.map(
      (fieldName) => {
        const sebiVal = sebiActiveObs[fieldName] ?? null;
        const exchangeVal = exchangeActiveObs[fieldName] ?? null;
        return {
          fieldName,
          sebiValue: sebiVal,
          exchangeValue: exchangeVal,
          outcome: classifyOutcome(sebiVal, exchangeVal),
        };
      },
    );

    const hasCrossSourceConflict =
      report.hasAnyConflict ||
      fieldComparisons.some((c) => c.outcome === 'CONFLICT');

    return {
      ipoId,
      hasCrossSourceConflict,
      canonicalValues,
      sebiActiveObservation: sebiActiveObs,
      exchangeActiveObservation: exchangeActiveObs,
      fieldComparisons,
      provenanceReport: report,
    };
  }
}
