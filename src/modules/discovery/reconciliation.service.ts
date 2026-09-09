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

export type QualitySeverity = 'INFO' | 'WARNING' | 'ERROR';

export type QualityStatus = 'HEALTHY' | 'NEEDS_REVIEW' | 'INCOMPLETE';

export type DataQualityFinding = {
  code: string;
  severity: QualitySeverity;
  field?: string;
  message: string;
  sourceCode?: string;
};

export type QualitySummary = {
  status: QualityStatus;
  findings: DataQualityFinding[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
};

export type IpoReconciliationSummary = {
  ipoId: string;
  hasCrossSourceConflict: boolean;
  canonicalValues: Record<string, string | null>;
  sebiActiveObservation: Record<string, string | null>;
  exchangeActiveObservation: Record<string, string | null>;
  fieldComparisons: FieldComparison[];
  provenanceReport: IpoReconciliationReport;
  qualitySummary: QualitySummary;
};

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  const str =
    typeof val === 'object' && val !== null && 'toFixed' in (val as any)
      ? (val as any).toFixed(2)
      : typeof val === 'object' && val !== null && 'toString' in val
        ? (val as any).toString()
        : String(val);
  const num = Number(str);
  return isNaN(num) ? null : num;
}

function valuesAreEqual(valA: string | null, valB: string | null): boolean {
  if (valA === null && valB === null) return true;
  if (valA === null || valB === null) return false;

  const trimA = valA.trim();
  const trimB = valB.trim();
  if (trimA === trimB) return true;

  const numA = parseNumeric(trimA);
  const numB = parseNumeric(trimB);
  if (numA !== null && numB !== null) {
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
      issue_size: ipo.issueSize ? parseNumeric(ipo.issueSize)?.toFixed(2) ?? null : null,
      fresh_issue_size: ipo.freshIssueSize
        ? parseNumeric(ipo.freshIssueSize)?.toFixed(2) ?? null
        : null,
      ofs_size: ipo.ofsSize ? parseNumeric(ipo.ofsSize)?.toFixed(2) ?? null : null,
      issue_share_count: ipo.issueShareCount
        ? parseNumeric(ipo.issueShareCount)?.toString() ?? null
        : null,
      fresh_issue_share_count: ipo.freshIssueShareCount
        ? parseNumeric(ipo.freshIssueShareCount)?.toString() ?? null
        : null,
      ofs_share_count: ipo.ofsShareCount
        ? parseNumeric(ipo.ofsShareCount)?.toString() ?? null
        : null,
      price_band_low: ipo.priceBandLow
        ? parseNumeric(ipo.priceBandLow)?.toFixed(2) ?? null
        : null,
      price_band_high: ipo.priceBandHigh
        ? parseNumeric(ipo.priceBandHigh)?.toFixed(2) ?? null
        : null,
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
   * Deterministic Data Quality & Reconciliation Intelligence analysis.
   * Read-only analysis evaluating internal consistency, share counts, date logic, and source conflicts.
   */
  async reconcileIpo(
    db: DatabaseClient,
    ipoId: string,
  ): Promise<IpoReconciliationSummary> {
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
      include: { lifecycleEvents: true },
    });

    const report = await this.detectConflicts(db, ipoId);

    const canonicalValues: Record<string, string | null> = ipo
      ? {
          marketSegment: ipo.marketSegment,
          exchange: ipo.exchange,
          status: ipo.status,
          symbol: ipo.symbol,
          issueSize: ipo.issueSize ? parseNumeric(ipo.issueSize)?.toFixed(2) ?? null : null,
          freshIssueSize: ipo.freshIssueSize
            ? parseNumeric(ipo.freshIssueSize)?.toFixed(2) ?? null
            : null,
          ofsSize: ipo.ofsSize ? parseNumeric(ipo.ofsSize)?.toFixed(2) ?? null : null,
          issueShareCount: ipo.issueShareCount
            ? parseNumeric(ipo.issueShareCount)?.toString() ?? null
            : null,
          freshIssueShareCount: ipo.freshIssueShareCount
            ? parseNumeric(ipo.freshIssueShareCount)?.toString() ?? null
            : null,
          ofsShareCount: ipo.ofsShareCount
            ? parseNumeric(ipo.ofsShareCount)?.toString() ?? null
            : null,
          priceBandLow: ipo.priceBandLow
            ? parseNumeric(ipo.priceBandLow)?.toFixed(2) ?? null
            : null,
          priceBandHigh: ipo.priceBandHigh
            ? parseNumeric(ipo.priceBandHigh)?.toFixed(2) ?? null
            : null,
          lotSize: ipo.lotSize ? String(ipo.lotSize) : null,
        }
      : {};

    // Extract dates from lifecycle events if present
    let openDate: string | null = null;
    let closeDate: string | null = null;
    let listingDate: string | null = null;

    if (ipo?.lifecycleEvents) {
      for (const evt of ipo.lifecycleEvents) {
        const dateStr = evt.eventDate.toISOString().slice(0, 10);
        if (evt.eventType === 'OPEN') openDate = dateStr;
        else if (evt.eventType === 'CLOSE') closeDate = dateStr;
        else if (evt.eventType === 'LISTING') listingDate = dateStr;
      }
    }

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

    // Run Data Quality & Consistency Checks
    const findings: DataQualityFinding[] = [];

    // 1. Cross-Source Conflict Findings
    for (const comp of fieldComparisons) {
      if (comp.outcome === 'CONFLICT') {
        findings.push({
          code: 'SOURCE_CONFLICT',
          severity: 'WARNING',
          field: comp.fieldName,
          message: `Source conflict detected for field '${comp.fieldName}': SEBI reported '${comp.sebiValue}', Exchange reported '${comp.exchangeValue}'.`,
        });
      }
    }

    if (ipo) {
      // 2. Share Count Consistency Check (fresh + OFS === total)
      const totalShareCount = parseNumeric(ipo.issueShareCount);
      const freshShareCount = parseNumeric(ipo.freshIssueShareCount);
      const ofsShareCount = parseNumeric(ipo.ofsShareCount);

      if (
        totalShareCount !== null &&
        freshShareCount !== null &&
        ofsShareCount !== null
      ) {
        if (freshShareCount + ofsShareCount !== totalShareCount) {
          findings.push({
            code: 'INTERNAL_SHARE_COUNT_MISMATCH',
            severity: 'ERROR',
            field: 'issue_share_count',
            message: `Fresh issue share count (${freshShareCount}) + OFS share count (${ofsShareCount}) does not equal total issue share count (${totalShareCount}).`,
          });
        }
      }

      // 3. Price Band Bounds Check (low <= high)
      const lowPrice = parseNumeric(ipo.priceBandLow);
      const highPrice = parseNumeric(ipo.priceBandHigh);

      if (lowPrice !== null && highPrice !== null) {
        if (lowPrice > highPrice) {
          findings.push({
            code: 'INVALID_PRICE_BAND',
            severity: 'ERROR',
            field: 'price_band_low',
            message: `Price band low (${lowPrice}) exceeds price band high (${highPrice}).`,
          });
        }
      }

      // 4. Date Range Check (openDate <= closeDate)
      if (openDate && closeDate) {
        if (openDate > closeDate) {
          findings.push({
            code: 'INVALID_ISSUE_DATE_RANGE',
            severity: 'ERROR',
            field: 'lifecycle.open_date',
            message: `Issue open date (${openDate}) is after issue close date (${closeDate}).`,
          });
        }
      }

      // 5. Lot Size Bounds Check (lotSize > 0)
      if (ipo.lotSize !== null && ipo.lotSize <= 0) {
        findings.push({
          code: 'NON_POSITIVE_LOT_SIZE',
          severity: 'ERROR',
          field: 'lot_size',
          message: `Lot size (${ipo.lotSize}) must be greater than zero.`,
        });
      }

      // 6. Negative Numeric Values Check
      const numericFields: Array<[string, unknown]> = [
        ['issue_size', ipo.issueSize],
        ['fresh_issue_size', ipo.freshIssueSize],
        ['ofs_size', ipo.ofsSize],
        ['issue_share_count', ipo.issueShareCount],
        ['fresh_issue_share_count', ipo.freshIssueShareCount],
        ['ofs_share_count', ipo.ofsShareCount],
      ];
      for (const [field, rawVal] of numericFields) {
        const parsed = parseNumeric(rawVal);
        if (parsed !== null && parsed < 0) {
          findings.push({
            code: 'NEGATIVE_NUMERIC_VALUE',
            severity: 'ERROR',
            field,
            message: `Numeric field '${field}' cannot be negative (${parsed}).`,
          });
        }
      }

      // 7. Incomplete Issue Structure Check
      if (
        parseNumeric(ipo.issueSize) !== null &&
        parseNumeric(ipo.freshIssueSize) === null &&
        parseNumeric(ipo.ofsSize) === null
      ) {
        findings.push({
          code: 'INCOMPLETE_ISSUE_STRUCTURE',
          severity: 'WARNING',
          field: 'fresh_issue_size',
          message: `Total issue size is recorded (${parseNumeric(ipo.issueSize)?.toFixed(2)} Cr), but fresh issue and OFS size breakdown are missing.`,
        });
      }
      if (
        parseNumeric(ipo.issueShareCount) !== null &&
        parseNumeric(ipo.freshIssueShareCount) === null &&
        parseNumeric(ipo.ofsShareCount) === null
      ) {
        findings.push({
          code: 'INCOMPLETE_ISSUE_STRUCTURE',
          severity: 'WARNING',
          field: 'fresh_issue_share_count',
          message: `Total issue share count is recorded (${parseNumeric(ipo.issueShareCount)}), but fresh issue and OFS share count breakdown are missing.`,
        });
      }

      // 8. Lifecycle-Aware Terms Completeness
      if (
        ipo.status === 'OPEN' ||
        ipo.status === 'CLOSED' ||
        ipo.status === 'LISTED'
      ) {
        if (lowPrice === null || highPrice === null) {
          findings.push({
            code: 'INCOMPLETE_TERMS',
            severity: 'WARNING',
            field: 'price_band_low',
            message: `Price band is missing for an active ${ipo.status} IPO.`,
          });
        }
        if (ipo.lotSize === null) {
          findings.push({
            code: 'INCOMPLETE_TERMS',
            severity: 'WARNING',
            field: 'lot_size',
            message: `Lot size is missing for an active ${ipo.status} IPO.`,
          });
        }
        if (!openDate) {
          findings.push({
            code: 'INCOMPLETE_TERMS',
            severity: 'WARNING',
            field: 'lifecycle.open_date',
            message: `Issue open date is missing for an active ${ipo.status} IPO.`,
          });
        }
      }

      if (ipo.status === 'CLOSED' || ipo.status === 'LISTED') {
        if (!closeDate) {
          findings.push({
            code: 'INCOMPLETE_TERMS',
            severity: 'WARNING',
            field: 'lifecycle.close_date',
            message: `Issue close date is missing for a ${ipo.status} IPO.`,
          });
        }
      }

      if (ipo.status === 'LISTED') {
        if (!listingDate) {
          findings.push({
            code: 'INCOMPLETE_TERMS',
            severity: 'WARNING',
            field: 'lifecycle.listing_date',
            message: `Listing date is missing for a LISTED IPO.`,
          });
        }
      }

      // 9. Source Coverage Gap
      const activeSources = new Set<string>();
      for (const comp of fieldComparisons) {
        if (comp.sebiValue !== null) activeSources.add('SEBI');
        if (comp.exchangeValue !== null) activeSources.add('NSE');
      }
      if (
        activeSources.size === 1 &&
        (ipo.status === 'OPEN' ||
          ipo.status === 'CLOSED' ||
          ipo.status === 'LISTED')
      ) {
        const sourceName = Array.from(activeSources)[0];
        findings.push({
          code: 'SOURCE_COVERAGE_GAP',
          severity: 'INFO',
          message: `IPO observations exist only for source '${sourceName}'. Cross-source verification is unavailable.`,
        });
      }
    }

    const errorCount = findings.filter((f) => f.severity === 'ERROR').length;
    const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
    const infoCount = findings.filter((f) => f.severity === 'INFO').length;

    let qualityStatus: QualityStatus = 'HEALTHY';
    if (errorCount > 0 || warningCount > 0) {
      qualityStatus = 'NEEDS_REVIEW';
    } else if (
      findings.some(
        (f) =>
          f.code === 'INCOMPLETE_TERMS' ||
          f.code === 'INCOMPLETE_ISSUE_STRUCTURE',
      )
    ) {
      qualityStatus = 'INCOMPLETE';
    }

    const qualitySummary: QualitySummary = {
      status: qualityStatus,
      findings,
      summary: {
        errors: errorCount,
        warnings: warningCount,
        info: infoCount,
      },
    };

    return {
      ipoId,
      hasCrossSourceConflict,
      canonicalValues,
      sebiActiveObservation: sebiActiveObs,
      exchangeActiveObservation: exchangeActiveObs,
      fieldComparisons,
      provenanceReport: report,
      qualitySummary,
    };
  }
}
