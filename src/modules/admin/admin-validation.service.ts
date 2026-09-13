import { Injectable } from '@nestjs/common';
import { IpoStatus, MarketSegment, PublicationStatus } from '@prisma/client';

export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFORMATION';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  field?: string;
  message: string;
}

export interface ValidationReport {
  isValid: boolean; // True if zero ERROR severity issues exist
  hasWarnings: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}

export interface IpoValidationInput {
  legalName?: string | null;
  displayName?: string | null;
  cin?: string | null;
  symbol?: string | null;
  marketSegment?: MarketSegment | null;
  status?: IpoStatus | null;
  publicationStatus?: PublicationStatus | null;
  priceBandLow?: number | null;
  priceBandHigh?: number | null;
  lotSize?: number | null;
  issueSize?: number | null;
  freshIssueSize?: number | null;
  ofsSize?: number | null;
  issueShareCount?: number | null;
  freshIssueShareCount?: number | null;
  ofsShareCount?: number | null;
  openDate?: string | Date | null;
  closeDate?: string | Date | null;
  listingDate?: string | Date | null;
}

@Injectable()
export class AdminValidationService {
  /**
   * Validates an IPO before publication or review.
   */
  validateIpo(input: IpoValidationInput): ValidationReport {
    const issues: ValidationIssue[] = [];

    // 1. Company Identity
    if (!input.legalName || input.legalName.trim().length === 0) {
      issues.push({
        severity: 'ERROR',
        code: 'MISSING_LEGAL_NAME',
        field: 'legalName',
        message: 'Company legal name is required.',
      });
    }

    // 2. Price Band Low <= Price Band High
    if (input.priceBandLow !== undefined && input.priceBandLow !== null && input.priceBandHigh !== undefined && input.priceBandHigh !== null) {
      if (input.priceBandLow < 0 || input.priceBandHigh < 0) {
        issues.push({
          severity: 'ERROR',
          code: 'NEGATIVE_PRICE_BAND',
          field: 'priceBand',
          message: 'Price band bounds cannot be negative.',
        });
      } else if (input.priceBandLow > input.priceBandHigh) {
        issues.push({
          severity: 'ERROR',
          code: 'INVALID_PRICE_BAND_RANGE',
          field: 'priceBandLow',
          message: `Price band low (${input.priceBandLow}) cannot be greater than price band high (${input.priceBandHigh}).`,
        });
      }
    }

    // 3. Lot Size
    if (input.lotSize !== undefined && input.lotSize !== null) {
      if (input.lotSize <= 0) {
        issues.push({
          severity: 'ERROR',
          code: 'INVALID_LOT_SIZE',
          field: 'lotSize',
          message: 'Lot size must be greater than zero if provided.',
        });
      }
    } else {
      issues.push({
        severity: 'WARNING',
        code: 'MISSING_LOT_SIZE',
        field: 'lotSize',
        message: 'Lot size is missing. Verify before opening issue.',
      });
    }

    // 4. Monetary non-negativity
    if (input.issueSize !== null && input.issueSize !== undefined && input.issueSize < 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NEGATIVE_ISSUE_SIZE',
        field: 'issueSize',
        message: 'Issue size cannot be negative.',
      });
    }
    if (input.freshIssueSize !== null && input.freshIssueSize !== undefined && input.freshIssueSize < 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NEGATIVE_FRESH_SIZE',
        field: 'freshIssueSize',
        message: 'Fresh issue size cannot be negative.',
      });
    }
    if (input.ofsSize !== null && input.ofsSize !== undefined && input.ofsSize < 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NEGATIVE_OFS_SIZE',
        field: 'ofsSize',
        message: 'OFS size cannot be negative.',
      });
    }

    // 5. Share Counts non-negativity & sum invariant
    if (input.issueShareCount !== null && input.issueShareCount !== undefined && input.issueShareCount < 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NEGATIVE_ISSUE_SHARES',
        field: 'issueShareCount',
        message: 'Issue share count cannot be negative.',
      });
    }

    if (
      input.issueShareCount !== null &&
      input.issueShareCount !== undefined &&
      input.freshIssueShareCount !== null &&
      input.freshIssueShareCount !== undefined &&
      input.ofsShareCount !== null &&
      input.ofsShareCount !== undefined
    ) {
      const sum = input.freshIssueShareCount + input.ofsShareCount;
      if (Math.abs(sum - input.issueShareCount) > 1) {
        issues.push({
          severity: 'WARNING',
          code: 'SHARE_COUNT_SUM_MISMATCH',
          field: 'issueShareCount',
          message: `Sum of fresh shares (${input.freshIssueShareCount}) and OFS shares (${input.ofsShareCount}) does not match total issue shares (${input.issueShareCount}).`,
        });
      }
    }

    // 6. Dates Logical Ordering
    const openDate = input.openDate ? new Date(input.openDate) : null;
    const closeDate = input.closeDate ? new Date(input.closeDate) : null;
    const listingDate = input.listingDate ? new Date(input.listingDate) : null;

    if (openDate && closeDate && openDate > closeDate) {
      issues.push({
        severity: 'ERROR',
        code: 'INVALID_DATE_SEQUENCE_OPEN_CLOSE',
        field: 'openDate',
        message: `Open date (${openDate.toISOString().slice(0, 10)}) cannot be after close date (${closeDate.toISOString().slice(0, 10)}).`,
      });
    }

    if (closeDate && listingDate && closeDate > listingDate) {
      issues.push({
        severity: 'ERROR',
        code: 'INVALID_DATE_SEQUENCE_CLOSE_LISTING',
        field: 'closeDate',
        message: `Close date (${closeDate.toISOString().slice(0, 10)}) cannot be after listing date (${listingDate.toISOString().slice(0, 10)}).`,
      });
    }

    if (!openDate || !closeDate) {
      issues.push({
        severity: 'WARNING',
        code: 'MISSING_LIFECYCLE_DATES',
        field: 'openDate',
        message: 'Open date or close date is not specified.',
      });
    }

    // Separate issues
    const errors = issues.filter((i) => i.severity === 'ERROR');
    const warnings = issues.filter((i) => i.severity === 'WARNING');
    const info = issues.filter((i) => i.severity === 'INFORMATION');

    return {
      isValid: errors.length === 0,
      hasWarnings: warnings.length > 0,
      errors,
      warnings,
      info,
    };
  }
}
