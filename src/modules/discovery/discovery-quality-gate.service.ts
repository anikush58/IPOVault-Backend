import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  CoverageRefreshRecommendation,
  CoverageSummary,
  DiscoveryCoverageService,
  IpoCoverageReport,
} from './discovery-coverage.service';
import {
  DataQualityFinding,
  IpoReconciliationSummary,
} from './reconciliation.service';
import { IpoFreshnessSummary } from './discovery-freshness.service';
import {
  hasIssueShareCountMismatch,
  IssueStructureValues,
} from './issue-structure';

type Tx = Prisma.TransactionClient;
type DatabaseClient = Tx | PrismaService;

export type QualityGateStatus =
  | 'PASS'
  | 'PASS_WITH_WARNINGS'
  | 'NEEDS_REVIEW'
  | 'INCOMPLETE';

export type QualityGateFinding = {
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  field?: string;
  message: string;
};

export type FieldVerdictStatus =
  | 'PASS'
  | 'WARNING'
  | 'FAIL'
  | 'NOT_APPLICABLE';

export type FieldVerdict = {
  fieldName: string;
  status: FieldVerdictStatus;
  reason: string;
  canonicalValue: string | null;
  sourceCode: string | null;
  observedAt: Date | null;
};

export type IpoQualityGateReport = {
  ipoId: string;
  status: QualityGateStatus;
  evaluatedAt: Date;
  summary: {
    totalChecks: number;
    passed: number;
    warnings: number;
    blockers: number;
  };
  blockers: QualityGateFinding[];
  warnings: QualityGateFinding[];
  fields: FieldVerdict[];
  qualityFindings: DataQualityFinding[];
  coverageSummary: CoverageSummary;
  freshnessSummary?: IpoFreshnessSummary;
  reconciliationSummary?: IpoReconciliationSummary;
  refreshRecommendations: CoverageRefreshRecommendation[];
};

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

@Injectable()
export class DiscoveryQualityGateService {
  private readonly logger = new Logger(DiscoveryQualityGateService.name);

  constructor(
    private readonly coverageService?: DiscoveryCoverageService,
  ) {}

  /**
   * Read-only canonical IPO quality gate assessment.
   * Answers: "Can this IPO record currently be considered safe and sufficiently complete for downstream consumers?"
   *
   * Reuses Coverage, Reconciliation, Freshness, and Quality Engine outputs.
   * Performs ZERO database writes, creates NO provenance, emits NO change events, and executes NO refreshes.
   */
  async evaluateQualityGate(
    db: DatabaseClient,
    ipoId: string,
    now: Date = new Date(),
  ): Promise<IpoQualityGateReport> {
    this.logger.log(`Evaluating Canonical Quality Gate for IPO ${ipoId}...`);

    // 1. Validate IPO existence and load relations
    const ipo = await db.ipo.findUnique({
      where: { id: ipoId },
      include: { company: true, lifecycleEvents: true },
    });

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO was not found', 404);
    }

    // 2. Obtain Coverage Report (which internally invokes ReconciliationService & Freshness)
    const coverageSvc =
      this.coverageService ?? new DiscoveryCoverageService();
    const coverageReport: IpoCoverageReport = await coverageSvc.evaluateCoverage(
      db,
      ipoId,
      now,
    );

    const blockers: QualityGateFinding[] = [];
    const warnings: QualityGateFinding[] = [];
    const fieldVerdicts: FieldVerdict[] = [];

    // 3. Evaluate Terms & Numerical Constraints
    const low = parseNum(ipo.priceBandLow);
    const high = parseNum(ipo.priceBandHigh);
    const lot = ipo.lotSize !== null ? Number(ipo.lotSize) : null;

    if (low !== null && low <= 0) {
      blockers.push({
        code: 'INVALID_PRICE_BAND_LOW',
        severity: 'ERROR',
        field: 'priceBandLow',
        message: 'priceBandLow must be greater than zero',
      });
    }

    if (high !== null && high <= 0) {
      blockers.push({
        code: 'INVALID_PRICE_BAND_HIGH',
        severity: 'ERROR',
        field: 'priceBandHigh',
        message: 'priceBandHigh must be greater than zero',
      });
    }

    if (low !== null && high !== null && low > high) {
      blockers.push({
        code: 'INVALID_PRICE_BAND_RANGE',
        severity: 'ERROR',
        field: 'priceBandLow',
        message: `priceBandLow (${low}) must be <= priceBandHigh (${high})`,
      });
    }

    if (lot !== null && lot <= 0) {
      blockers.push({
        code: 'INVALID_LOT_SIZE',
        severity: 'ERROR',
        field: 'lotSize',
        message: 'lotSize must be positive',
      });
    }

    // Check for negative monetary / share values
    const monetaryFields: Array<{ name: string; val: number | null }> = [
      { name: 'issueSize', val: parseNum(ipo.issueSize) },
      { name: 'freshIssueSize', val: parseNum(ipo.freshIssueSize) },
      { name: 'ofsSize', val: parseNum(ipo.ofsSize) },
      { name: 'issueShareCount', val: parseNum(ipo.issueShareCount) },
      { name: 'freshIssueShareCount', val: parseNum(ipo.freshIssueShareCount) },
      { name: 'ofsShareCount', val: parseNum(ipo.ofsShareCount) },
      { name: 'faceValue', val: parseNum(ipo.faceValue) },
    ];

    for (const mf of monetaryFields) {
      if (mf.val !== null && mf.val < 0) {
        blockers.push({
          code: 'NEGATIVE_VALUE',
          severity: 'ERROR',
          field: mf.name,
          message: `Field '${mf.name}' cannot be negative (value: ${mf.val})`,
        });
      }
    }

    // 4. Evaluate Issue Structure (Reuse hasIssueShareCountMismatch from issue-structure.ts)
    const totSize = parseNum(ipo.issueSize);
    const freshSize = parseNum(ipo.freshIssueSize);
    const ofsSize = parseNum(ipo.ofsSize);

    if (totSize !== null && freshSize !== null && ofsSize !== null) {
      if (Math.abs(freshSize + ofsSize - totSize) > 1e-4) {
        blockers.push({
          code: 'ISSUE_SIZE_MISMATCH',
          severity: 'ERROR',
          field: 'issueSize',
          message: `Issue size mismatch: freshIssueSize (${freshSize}) + ofsSize (${ofsSize}) != total issueSize (${totSize})`,
        });
      }
    }

    const shareValues: IssueStructureValues = {
      issueSize: ipo.issueSize ? new Prisma.Decimal(String(ipo.issueSize)) : null,
      freshIssueSize: ipo.freshIssueSize ? new Prisma.Decimal(String(ipo.freshIssueSize)) : null,
      ofsSize: ipo.ofsSize ? new Prisma.Decimal(String(ipo.ofsSize)) : null,
      issueShareCount: ipo.issueShareCount ? new Prisma.Decimal(String(ipo.issueShareCount)) : null,
      freshIssueShareCount: ipo.freshIssueShareCount ? new Prisma.Decimal(String(ipo.freshIssueShareCount)) : null,
      ofsShareCount: ipo.ofsShareCount ? new Prisma.Decimal(String(ipo.ofsShareCount)) : null,
    };

    if (hasIssueShareCountMismatch(shareValues)) {
      blockers.push({
        code: 'ISSUE_SHARE_COUNT_MISMATCH',
        severity: 'ERROR',
        field: 'issueShareCount',
        message: 'Share count mismatch: freshIssueShareCount + ofsShareCount != total issueShareCount',
      });
    }

    // 5. Lifecycle Chronology Checks
    const openEvt = ipo.lifecycleEvents?.find((e) => e.eventType === 'OPEN');
    const closeEvt = ipo.lifecycleEvents?.find((e) => e.eventType === 'CLOSE');
    const listingEvt = ipo.lifecycleEvents?.find(
      (e) => e.eventType === 'LISTING',
    );

    if (openEvt && closeEvt && openEvt.eventDate > closeEvt.eventDate) {
      blockers.push({
        code: 'INVALID_LIFECYCLE_CHRONOLOGY',
        severity: 'ERROR',
        field: 'openDate',
        message: 'openDate must be on or before closeDate',
      });
    }

    // 6. Lifecycle-Aware Required Field Completeness Checks
    const status = ipo.status;
    const isPostOpen = [
      'OPEN',
      'CLOSED',
      'ALLOTMENT_PENDING',
      'ALLOTMENT_COMPLETED',
      'LISTING_PENDING',
      'LISTED',
    ].includes(status);
    const isListed = status === 'LISTED';

    // Helper function to determine if a field is strictly required for the IPO's lifecycle
    const isFieldRequiredForLifecycle = (fieldName: string): boolean => {
      if (fieldName === 'company.legalName') return true;
      if (isPostOpen && ['priceBandLow', 'priceBandHigh', 'lotSize', 'openDate', 'closeDate'].includes(fieldName)) {
        return true;
      }
      if (isListed && fieldName === 'listingDate') return true;
      return false;
    };

    // Core identity always required
    if (!ipo.company?.legalName) {
      blockers.push({
        code: 'MISSING_LEGAL_NAME',
        severity: 'ERROR',
        field: 'company.legalName',
        message: 'Company legal name is required',
      });
    }

    // Terms required if active/post-open or terms announced
    if (isPostOpen) {
      if (low === null) {
        blockers.push({
          code: 'MISSING_PRICE_BAND_LOW',
          severity: 'ERROR',
          field: 'priceBandLow',
          message: `priceBandLow is required for active IPO (status: ${status})`,
        });
      }
      if (high === null) {
        blockers.push({
          code: 'MISSING_PRICE_BAND_HIGH',
          severity: 'ERROR',
          field: 'priceBandHigh',
          message: `priceBandHigh is required for active IPO (status: ${status})`,
        });
      }
      if (lot === null) {
        blockers.push({
          code: 'MISSING_LOT_SIZE',
          severity: 'ERROR',
          field: 'lotSize',
          message: `lotSize is required for active IPO (status: ${status})`,
        });
      }
      if (!openEvt) {
        blockers.push({
          code: 'MISSING_OPEN_DATE',
          severity: 'ERROR',
          field: 'openDate',
          message: `openDate is required for active IPO (status: ${status})`,
        });
      }
      if (!closeEvt) {
        blockers.push({
          code: 'MISSING_CLOSE_DATE',
          severity: 'ERROR',
          field: 'closeDate',
          message: `closeDate is required for active IPO (status: ${status})`,
        });
      }
    }

    if (isListed && !listingEvt) {
      blockers.push({
        code: 'MISSING_LISTING_DATE',
        severity: 'ERROR',
        field: 'listingDate',
        message: 'listingDate is required for LISTED IPO',
      });
    }

    // 7. Evaluate Coverage Field Verdicts, Conflicts, and Freshness
    for (const fDetail of coverageReport.fields) {
      let fStatus: FieldVerdictStatus = 'PASS';
      let fReason = fDetail.message;

      if (fDetail.status === 'NOT_EXPECTED_FROM_SOURCE') {
        fStatus = 'NOT_APPLICABLE';
        fReason = `Field '${fDetail.fieldName}' is not expected for current IPO structure/lifecycle state.`;
      } else if (fDetail.status === 'CONFLICT') {
        fStatus = 'FAIL';
        fReason = `Source conflict detected for '${fDetail.fieldName}'.`;
        blockers.push({
          code: 'UNRESOLVED_SOURCE_CONFLICT',
          severity: 'ERROR',
          field: fDetail.fieldName,
          message: fReason,
        });
      } else if (fDetail.status === 'MISSING') {
        fStatus = 'FAIL';
        fReason = `Field '${fDetail.fieldName}' is missing canonical value.`;
        if (isFieldRequiredForLifecycle(fDetail.fieldName)) {
          blockers.push({
            code: 'MISSING_REQUIRED_FIELD',
            severity: 'ERROR',
            field: fDetail.fieldName,
            message: fReason,
          });
        } else {
          warnings.push({
            code: 'OPTIONAL_FIELD_MISSING',
            severity: 'WARNING',
            field: fDetail.fieldName,
            message: fReason,
          });
        }
      } else if (fDetail.status === 'STALE') {
        // Check if providing source is authoritative
        const authoritativeSource = fDetail.expectedSources[0];
        if (
          fDetail.providingSource?.toLowerCase() ===
          authoritativeSource?.toLowerCase()
        ) {
          fStatus = 'WARNING';
          fReason = `Authoritative source '${fDetail.providingSource}' for field '${fDetail.fieldName}' is stale.`;
          warnings.push({
            code: 'STALE_AUTHORITATIVE_SOURCE',
            severity: 'WARNING',
            field: fDetail.fieldName,
            message: fReason,
          });
        } else {
          fStatus = 'PASS';
          fReason = `Field '${fDetail.fieldName}' is covered; secondary source is stale.`;
        }
      } else if (fDetail.status === 'UNKNOWN') {
        if (isFieldRequiredForLifecycle(fDetail.fieldName)) {
          fStatus = 'FAIL';
          fReason = `Required field '${fDetail.fieldName}' is unknown (no observation recorded).`;
          blockers.push({
            code: 'MISSING_REQUIRED_FIELD',
            severity: 'ERROR',
            field: fDetail.fieldName,
            message: fReason,
          });
        } else {
          fStatus = 'WARNING';
          fReason = `No observation recorded for field '${fDetail.fieldName}'.`;
          warnings.push({
            code: 'UNKNOWN_FIELD_COVERAGE',
            severity: 'WARNING',
            field: fDetail.fieldName,
            message: fReason,
          });
        }
      } else {
        fStatus = 'PASS';
      }

      fieldVerdicts.push({
        fieldName: fDetail.fieldName,
        status: fStatus,
        reason: fReason,
        canonicalValue: fDetail.canonicalValue,
        sourceCode: fDetail.providingSource,
        observedAt: fDetail.observedAt,
      });
    }

    // 8. Determine Overall Quality Gate Status
    let overallStatus: QualityGateStatus = 'PASS';

    const hasCriticalMissing = blockers.some((b) =>
      [
        'MISSING_LEGAL_NAME',
        'MISSING_PRICE_BAND_LOW',
        'MISSING_PRICE_BAND_HIGH',
        'MISSING_LOT_SIZE',
        'MISSING_OPEN_DATE',
        'MISSING_CLOSE_DATE',
        'MISSING_LISTING_DATE',
        'MISSING_REQUIRED_FIELD',
        'INVALID_PRICE_BAND_LOW',
        'INVALID_PRICE_BAND_HIGH',
        'INVALID_PRICE_BAND_RANGE',
        'INVALID_LOT_SIZE',
        'NEGATIVE_VALUE',
        'ISSUE_SIZE_MISMATCH',
        'ISSUE_SHARE_COUNT_MISMATCH',
        'INVALID_LIFECYCLE_CHRONOLOGY',
      ].includes(b.code),
    );

    const hasConflictOrStaleAuthoritative =
      blockers.some((b) => b.code === 'UNRESOLVED_SOURCE_CONFLICT') ||
      warnings.some((w) => w.code === 'STALE_AUTHORITATIVE_SOURCE');

    if (hasCriticalMissing) {
      overallStatus = 'INCOMPLETE';
    } else if (hasConflictOrStaleAuthoritative) {
      overallStatus = 'NEEDS_REVIEW';
    } else if (warnings.length > 0) {
      overallStatus = 'PASS_WITH_WARNINGS';
    } else {
      overallStatus = 'PASS';
    }

    const passedCount = fieldVerdicts.filter(
      (f) => f.status === 'PASS' || f.status === 'NOT_APPLICABLE',
    ).length;

    this.logger.log(
      `Canonical Quality Gate complete for IPO ${ipoId}: status=${overallStatus}, passed=${passedCount}/${fieldVerdicts.length}, blockers=${blockers.length}, warnings=${warnings.length}`,
    );

    return {
      ipoId,
      status: overallStatus,
      evaluatedAt: now,
      summary: {
        totalChecks: fieldVerdicts.length,
        passed: passedCount,
        warnings: warnings.length,
        blockers: blockers.length,
      },
      blockers,
      warnings,
      fields: fieldVerdicts,
      qualityFindings: coverageReport.fields
        .filter((f) => f.status === 'CONFLICT' || f.status === 'MISSING')
        .map((f) => ({
          code: f.status,
          severity: f.status === 'CONFLICT' ? 'ERROR' : 'WARNING',
          field: f.fieldName,
          message: f.message,
        })),
      coverageSummary: coverageReport.summary,
      freshnessSummary: undefined,
      reconciliationSummary: undefined,
      refreshRecommendations: coverageReport.refreshRecommendations,
    };
  }
}
