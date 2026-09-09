import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  FieldComparisonOutcome,
  IpoReconciliationSummary,
  ReconciliationService,
} from './reconciliation.service';
import { DiscoveryRefreshService } from './discovery-refresh.service';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type FieldCoverageStatus =
  | 'COVERED'
  | 'MISSING'
  | 'STALE'
  | 'CONFLICT'
  | 'NOT_EXPECTED_FROM_SOURCE'
  | 'UNKNOWN';

export type EvaluatedFieldCategory =
  | 'IDENTITY'
  | 'ISSUE_STRUCTURE'
  | 'TERMS'
  | 'LIFECYCLE';

export type FieldCoverageDetail = {
  fieldName: string;
  category: EvaluatedFieldCategory;
  status: FieldCoverageStatus;
  canonicalValue: string | null;
  expectedSources: string[];
  providingSource: string | null;
  observedAt: Date | null;
  comparisonOutcome: FieldComparisonOutcome;
  message: string;
};

export type CoverageSummary = {
  totalFields: number;
  covered: number;
  missing: number;
  stale: number;
  conflict: number;
  notExpected: number;
  unknown: number;
};

export type CoverageRefreshRecommendation = {
  sourceCode: string;
  reason: string;
  targetFields: string[];
};

export type IpoCoverageReport = {
  ipoId: string;
  overallStatus: FieldCoverageStatus;
  summary: CoverageSummary;
  fields: FieldCoverageDetail[];
  refreshRecommendations: CoverageRefreshRecommendation[];
  evaluatedAt: Date;
};

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

@Injectable()
export class DiscoveryCoverageService {
  private readonly logger = new Logger(DiscoveryCoverageService.name);

  constructor(
    private readonly reconciliationService?: ReconciliationService,
    refreshPlanService?: DiscoveryRefreshService,
  ) {
    void refreshPlanService;
  }

  /**
   * Read-only evaluation of IPO data coverage & source reconciliation.
   *
   * Source Capability Architecture Note:
   * The Prisma Source database registry models source-level metadata (sourceType, priority, healthStatus).
   * DiscoveryCoverageService maps field-level expected source capabilities based on authoritative data rules:
   * - SEBI (Official Filing): Prospectus/RHP details (legalName, CIN, faceValue, issue breakdown, price band, lot size, open/close dates)
   * - NSE/Exchange: Market listing details (symbol, price band, lot size, open/close dates, listingDate)
   *
   * Performs zero database writes or external network requests.
   */
  async evaluateCoverage(
    db: DatabaseClient,
    ipoId: string,
    now: Date = new Date(),
  ): Promise<IpoCoverageReport> {
    this.logger.log(`Evaluating Smart IPO Data Coverage for IPO ${ipoId}...`);

    // 1. Validate IPO existence and load relations
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
      include: { company: true, lifecycleEvents: true },
    });

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    // 2. Obtain Reconciliation & Freshness Summary from ReconciliationService (single query path)
    const reconciliationSvc =
      this.reconciliationService ?? new ReconciliationService();
    const reconciliationSummary = await reconciliationSvc.reconcileIpo(
      db,
      ipoId,
      now,
    );

    // 3. Define target fields to evaluate
    const fieldDefinitions: Array<{
      fieldName: string;
      category: EvaluatedFieldCategory;
      expectedSources: string[];
      getValue: () => string | null;
      isNotExpected?: (summary: IpoReconciliationSummary) => boolean;
    }> = [
      // IDENTITY
      {
        fieldName: 'company.legalName',
        category: 'IDENTITY',
        expectedSources: ['sebi', 'nse'],
        getValue: () => ipo.company?.legalName ?? null,
      },
      {
        fieldName: 'company.cin',
        category: 'IDENTITY',
        expectedSources: ['sebi'],
        getValue: () => ipo.company?.cin ?? null,
      },
      {
        fieldName: 'faceValue',
        category: 'IDENTITY',
        expectedSources: ['sebi'],
        getValue: () => (ipo.faceValue ? String(ipo.faceValue) : null),
      },

      // ISSUE STRUCTURE
      {
        fieldName: 'issueSize',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi', 'nse'],
        getValue: () => (ipo.issueSize ? String(ipo.issueSize) : null),
      },
      {
        fieldName: 'freshIssueSize',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi'],
        getValue: () =>
          ipo.freshIssueSize ? String(ipo.freshIssueSize) : null,
        isNotExpected: () => {
          // If OFS size equals total issue size or fresh issue size is explicitly 0, fresh issue is not expected
          const tot = parseNum(ipo.issueSize);
          const ofs = parseNum(ipo.ofsSize);
          const fresh = parseNum(ipo.freshIssueSize);
          return (
            (tot !== null && ofs !== null && Math.abs(tot - ofs) < 1e-6) ||
            fresh === 0
          );
        },
      },
      {
        fieldName: 'ofsSize',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi'],
        getValue: () => (ipo.ofsSize ? String(ipo.ofsSize) : null),
        isNotExpected: () => {
          // If fresh issue size equals total issue size or OFS size is explicitly 0, OFS is not expected
          const tot = parseNum(ipo.issueSize);
          const fresh = parseNum(ipo.freshIssueSize);
          const ofs = parseNum(ipo.ofsSize);
          return (
            (tot !== null && fresh !== null && Math.abs(tot - fresh) < 1e-6) ||
            ofs === 0
          );
        },
      },
      {
        fieldName: 'issueShareCount',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi', 'nse'],
        getValue: () =>
          ipo.issueShareCount ? String(ipo.issueShareCount) : null,
      },
      {
        fieldName: 'freshIssueShareCount',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi'],
        getValue: () =>
          ipo.freshIssueShareCount ? String(ipo.freshIssueShareCount) : null,
        isNotExpected: () => {
          const tot = parseNum(ipo.issueShareCount);
          const ofs = parseNum(ipo.ofsShareCount);
          const fresh = parseNum(ipo.freshIssueShareCount);
          return (
            (tot !== null && ofs !== null && tot === ofs) || fresh === 0
          );
        },
      },
      {
        fieldName: 'ofsShareCount',
        category: 'ISSUE_STRUCTURE',
        expectedSources: ['sebi'],
        getValue: () =>
          ipo.ofsShareCount ? String(ipo.ofsShareCount) : null,
        isNotExpected: () => {
          const tot = parseNum(ipo.issueShareCount);
          const fresh = parseNum(ipo.freshIssueShareCount);
          const ofs = parseNum(ipo.ofsShareCount);
          return (
            (tot !== null && fresh !== null && tot === fresh) || ofs === 0
          );
        },
      },

      // TERMS
      {
        fieldName: 'priceBandLow',
        category: 'TERMS',
        expectedSources: ['sebi', 'nse'],
        getValue: () => (ipo.priceBandLow ? String(ipo.priceBandLow) : null),
      },
      {
        fieldName: 'priceBandHigh',
        category: 'TERMS',
        expectedSources: ['sebi', 'nse'],
        getValue: () => (ipo.priceBandHigh ? String(ipo.priceBandHigh) : null),
      },
      {
        fieldName: 'lotSize',
        category: 'TERMS',
        expectedSources: ['sebi', 'nse'],
        getValue: () => (ipo.lotSize !== null ? String(ipo.lotSize) : null),
      },

      // LIFECYCLE
      {
        fieldName: 'openDate',
        category: 'LIFECYCLE',
        expectedSources: ['sebi', 'nse'],
        getValue: () => {
          const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'OPEN');
          return evt ? evt.eventDate.toISOString().slice(0, 10) : null;
        },
      },
      {
        fieldName: 'closeDate',
        category: 'LIFECYCLE',
        expectedSources: ['sebi', 'nse'],
        getValue: () => {
          const evt = ipo.lifecycleEvents?.find((e) => e.eventType === 'CLOSE');
          return evt ? evt.eventDate.toISOString().slice(0, 10) : null;
        },
      },
      {
        fieldName: 'listingDate',
        category: 'LIFECYCLE',
        expectedSources: ['nse'],
        getValue: () => {
          const evt = ipo.lifecycleEvents?.find(
            (e) => e.eventType === 'LISTING',
          );
          return evt ? evt.eventDate.toISOString().slice(0, 10) : null;
        },
        isNotExpected: () => {
          const hasListingEvt = ipo.lifecycleEvents?.some(
            (e) => e.eventType === 'LISTING',
          );
          return (
            !hasListingEvt &&
            (ipo.status === 'DRAFT' || ipo.status === 'UPCOMING')
          );
        },
      },
    ];

    // Helper map for field comparisons
    const comparisonMap = new Map<string, FieldComparisonOutcome>();
    for (const comp of reconciliationSummary.fieldComparisons) {
      comparisonMap.set(comp.fieldName, comp.outcome);
    }

    // Helper map for provenances
    const conflictMap = new Map<
      string,
      {
        hasConflict: boolean;
        activeObservations: Array<{
          sourceCode: string;
          value: string;
          retrievedAt: Date;
        }>;
      }
    >();
    for (const conf of reconciliationSummary.provenanceReport.conflicts) {
      conflictMap.set(conf.fieldName, {
        hasConflict: conf.hasConflict,
        activeObservations: conf.activeObservations,
      });
    }

    // Map source freshness status
    const sourceFreshnessMap = new Map<string, 'FRESH' | 'STALE' | 'UNKNOWN'>();
    if (reconciliationSummary.freshnessSummary) {
      for (const dec of reconciliationSummary.freshnessSummary.sourceDecisions) {
        sourceFreshnessMap.set(dec.sourceCode.toLowerCase(), dec.status);
      }
    }

    const fields: FieldCoverageDetail[] = [];

    for (const def of fieldDefinitions) {
      const value = def.getValue();

      // Check if field is not expected
      if (def.isNotExpected && def.isNotExpected(reconciliationSummary)) {
        fields.push({
          fieldName: def.fieldName,
          category: def.category,
          status: 'NOT_EXPECTED_FROM_SOURCE',
          canonicalValue: value,
          expectedSources: def.expectedSources,
          providingSource: null,
          observedAt: null,
          comparisonOutcome: 'UNRESOLVED',
          message: `Field '${def.fieldName}' is not expected for current IPO structure or lifecycle stage (${ipo.status}).`,
        });
        continue;
      }

      // Check for source conflict
      // Map fieldName to schema fieldName format (e.g. priceBandLow -> price_band_low)
      const mappedDbFieldName = this.mapToDbFieldName(def.fieldName);
      const conf = conflictMap.get(mappedDbFieldName);
      const compOutcome =
        comparisonMap.get(mappedDbFieldName) ?? 'UNRESOLVED';

      if (conf?.hasConflict || compOutcome === 'CONFLICT') {
        const obsInfo = conf?.activeObservations
          .map((o) => `${o.sourceCode}: '${o.value}'`)
          .join(', ');

        fields.push({
          fieldName: def.fieldName,
          category: def.category,
          status: 'CONFLICT',
          canonicalValue: value,
          expectedSources: def.expectedSources,
          providingSource: conf?.activeObservations[0]?.sourceCode ?? null,
          observedAt: conf?.activeObservations[0]?.retrievedAt ?? null,
          comparisonOutcome: 'CONFLICT',
          message: `Source conflict detected for '${def.fieldName}': ${obsInfo || 'disagreeing observations recorded'}.`,
        });
        continue;
      }

      // Check if value is present
      if (value !== null && value !== undefined && value !== '') {
        const activeObs = conf?.activeObservations[0];
        const providingSource = activeObs?.sourceCode ?? null;
        const observedAt = activeObs?.retrievedAt ?? null;

        // Check if providing source is stale
        const sourceStatus = providingSource
          ? sourceFreshnessMap.get(providingSource.toLowerCase())
          : undefined;

        if (sourceStatus === 'STALE') {
          fields.push({
            fieldName: def.fieldName,
            category: def.category,
            status: 'STALE',
            canonicalValue: value,
            expectedSources: def.expectedSources,
            providingSource,
            observedAt,
            comparisonOutcome: compOutcome,
            message: `Value '${value}' is present, but providing source '${providingSource}' observation is stale.`,
          });
        } else {
          fields.push({
            fieldName: def.fieldName,
            category: def.category,
            status: 'COVERED',
            canonicalValue: value,
            expectedSources: def.expectedSources,
            providingSource,
            observedAt,
            comparisonOutcome: compOutcome,
            message: `Field '${def.fieldName}' is covered with value '${value}'.`,
          });
        }
        continue;
      }

      // Value is missing (null/empty)
      // Distinguish MISSING (expected source has observation, but value is null) vs UNKNOWN (no observation at all)
      const hasAnyObservation = conf && conf.activeObservations.length > 0;
      if (hasAnyObservation) {
        fields.push({
          fieldName: def.fieldName,
          category: def.category,
          status: 'MISSING',
          canonicalValue: null,
          expectedSources: def.expectedSources,
          providingSource: conf.activeObservations[0]?.sourceCode ?? null,
          observedAt: conf.activeObservations[0]?.retrievedAt ?? null,
          comparisonOutcome: compOutcome,
          message: `Field '${def.fieldName}' was observed by source '${conf.activeObservations[0]?.sourceCode}', but value is missing/null.`,
        });
      } else {
        fields.push({
          fieldName: def.fieldName,
          category: def.category,
          status: 'UNKNOWN',
          canonicalValue: null,
          expectedSources: def.expectedSources,
          providingSource: null,
          observedAt: null,
          comparisonOutcome: compOutcome,
          message: `No observation recorded from expected sources (${def.expectedSources.join(', ')}) for field '${def.fieldName}'.`,
        });
      }
    }

    // 4. Compute Coverage Summary
    const summary: CoverageSummary = {
      totalFields: fields.length,
      covered: fields.filter((f) => f.status === 'COVERED').length,
      missing: fields.filter((f) => f.status === 'MISSING').length,
      stale: fields.filter((f) => f.status === 'STALE').length,
      conflict: fields.filter((f) => f.status === 'CONFLICT').length,
      notExpected: fields.filter(
        (f) => f.status === 'NOT_EXPECTED_FROM_SOURCE',
      ).length,
      unknown: fields.filter((f) => f.status === 'UNKNOWN').length,
    };

    // 5. Derive Overall Coverage Status
    let overallStatus: FieldCoverageStatus = 'COVERED';
    if (summary.conflict > 0) {
      overallStatus = 'CONFLICT';
    } else if (summary.missing > 0) {
      overallStatus = 'MISSING';
    } else if (summary.stale > 0) {
      overallStatus = 'STALE';
    } else if (summary.unknown > 0) {
      overallStatus = 'UNKNOWN';
    } else {
      overallStatus = 'COVERED';
    }

    // 6. Generate Refresh Recommendations from Freshness Intelligence decisions
    const refreshRecommendations: CoverageRefreshRecommendation[] = [];
    const sourceDecisions =
      reconciliationSummary.freshnessSummary?.sourceDecisions ?? [];

    for (const dec of sourceDecisions) {
      if (
        dec.recommendRefresh &&
        dec.healthStatus !== 'FAILING' &&
        dec.healthStatus !== 'DISABLED'
      ) {
        const targetFields = fields
          .filter(
            (f) =>
              (f.status === 'MISSING' ||
                f.status === 'STALE' ||
                f.status === 'CONFLICT' ||
                f.status === 'UNKNOWN') &&
              f.expectedSources.includes(dec.sourceCode.toLowerCase()),
          )
          .map((f) => f.fieldName);

        refreshRecommendations.push({
          sourceCode: dec.sourceCode,
          reason:
            dec.messages.join('; ') ||
            'Refresh recommended by freshness intelligence',
          targetFields,
        });
      }
    }

    this.logger.log(
      `Coverage evaluation complete for IPO ${ipoId}: overallStatus=${overallStatus}, covered=${summary.covered}/${summary.totalFields}`,
    );

    return {
      ipoId,
      overallStatus,
      summary,
      fields,
      refreshRecommendations,
      evaluatedAt: now,
    };
  }

  private mapToDbFieldName(fieldName: string): string {
    switch (fieldName) {
      case 'company.legalName':
        return 'legal_name';
      case 'company.cin':
        return 'cin';
      case 'faceValue':
        return 'face_value';
      case 'issueSize':
        return 'issue_size';
      case 'freshIssueSize':
        return 'fresh_issue_size';
      case 'ofsSize':
        return 'ofs_size';
      case 'issueShareCount':
        return 'issue_share_count';
      case 'freshIssueShareCount':
        return 'fresh_issue_share_count';
      case 'ofsShareCount':
        return 'ofs_share_count';
      case 'priceBandLow':
        return 'price_band_low';
      case 'priceBandHigh':
        return 'price_band_high';
      case 'lotSize':
        return 'lot_size';
      case 'openDate':
        return 'lifecycle.open_date';
      case 'closeDate':
        return 'lifecycle.close_date';
      case 'listingDate':
        return 'lifecycle.listing_date';
      default:
        return fieldName;
    }
  }
}
