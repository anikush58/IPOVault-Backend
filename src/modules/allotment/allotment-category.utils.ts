import { AllotmentStatus, CategoryAllotmentResult } from './allotment.types';

/**
 * Normalizes raw registrar category strings into canonical IPO category identifiers.
 * Never guesses missing categories. If unrecognized, returns the trimmed raw string.
 */
export function mapRegistrarCategory(raw?: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const upper = trimmed.toUpperCase();

  // Shareholder category indicators
  if (
    upper === 'S' ||
    upper === 'SH' ||
    upper === 'SHA' ||
    upper === 'SHR' ||
    upper === 'SHH' ||
    upper === 'SH_IND' ||
    upper.includes('SHAREHOLDER') ||
    upper.includes('SHARE HOLDER') ||
    upper.includes('SHARE-HOLDER')
  ) {
    return 'SHAREHOLDER';
  }

  // Retail individual investor indicators
  if (
    upper === 'IND' ||
    upper === 'RET' ||
    upper === 'RI' ||
    upper === 'RII' ||
    upper === 'RETAIL' ||
    upper.includes('RETAIL') ||
    upper.includes('INDIVIDUAL')
  ) {
    return 'RETAIL';
  }

  // Employee category indicators
  if (upper === 'EMP' || upper === 'EMPL' || upper.includes('EMPLOYEE')) {
    return 'EMPLOYEE';
  }

  // Non-Institutional / HNI indicators
  if (
    upper === 'NII' ||
    upper === 'HNI' ||
    upper === 'B-HNI' ||
    upper === 'S-HNI' ||
    upper === 'BHNI' ||
    upper === 'SHNI' ||
    upper.includes('NON INSTITUTIONAL') ||
    upper.includes('NON-INSTITUTIONAL')
  ) {
    return 'HNI';
  }

  // Institutional indicators
  if (upper === 'QIB' || upper.includes('QUALIFIED INSTITUTIONAL')) {
    return 'QIB';
  }

  // Return clean raw value if not standard, but NEVER invent a fake category
  return trimmed;
}

/**
 * Deduplicates repeated records from registrar responses.
 * If registrar returns repeated items with same application number and/or category,
 * keep the one with confirmed allotment or the first occurrence.
 */
export function deduplicateCategoryRecords(
  records: CategoryAllotmentResult[],
): CategoryAllotmentResult[] {
  if (!records || records.length <= 1) return records || [];

  const seen = new Map<string, CategoryAllotmentResult>();

  for (const record of records) {
    const catKey = (
      record.category ||
      record.rawCategory ||
      'UNKNOWN'
    ).toUpperCase();
    const appKey = (record.applicationNumber || '').trim();
    // Unique key combines category and application number if available
    const key = appKey
      ? `${catKey}:::${appKey}`
      : `${catKey}:::${record.sharesAllotted}:::${record.sharesApplied ?? 0}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, record);
    } else {
      // If duplicate exists, favor confirmed allotment
      const isExistingAllotted =
        existing.status === AllotmentStatus.ALLOTTED ||
        existing.status === AllotmentStatus.PARTIALLY_ALLOTTED;
      const isCurrentAllotted =
        record.status === AllotmentStatus.ALLOTTED ||
        record.status === AllotmentStatus.PARTIALLY_ALLOTTED;

      if (!isExistingAllotted && isCurrentAllotted) {
        seen.set(key, record);
      } else if (
        isCurrentAllotted &&
        (record.sharesAllotted || 0) > (existing.sharesAllotted || 0)
      ) {
        seen.set(key, record);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Derives overall allotment outcome from category-level results.
 *
 * Rules:
 * 1. If any category is confirmed allotted, overall status must be ALLOTTED (or PARTIALLY_ALLOTTED).
 *    Total shares = sum of all confirmed allotted shares without duplication.
 * 2. NOT_ALLOTTED only when all applicable categories have been successfully checked and each is confirmed not allotted.
 * 3. If one or more categories remain pending or failed and no allotment is confirmed,
 *    represent the overall result as pending/partial/unknown according to the existing status model.
 *    Never convert a technical failure into NOT_ALLOTTED.
 */
export function deriveOverallAllotment(
  categoryResults: CategoryAllotmentResult[],
): {
  status: AllotmentStatus;
  sharesAllotted: number;
  sharesApplied: number;
} {
  if (!categoryResults || categoryResults.length === 0) {
    return {
      status: AllotmentStatus.APPLICATION_NOT_FOUND,
      sharesAllotted: 0,
      sharesApplied: 0,
    };
  }

  const deduped = deduplicateCategoryRecords(categoryResults);

  if (deduped.length === 1) {
    return {
      status: deduped[0].status,
      sharesAllotted: deduped[0].sharesAllotted || 0,
      sharesApplied: deduped[0].sharesApplied || 0,
    };
  }

  // Calculate totals
  const totalAllotted = deduped.reduce(
    (sum, c) => sum + (c.sharesAllotted || 0),
    0,
  );
  const totalApplied = deduped.reduce(
    (sum, c) => sum + (c.sharesApplied || 0),
    0,
  );

  // 1. Any category confirmed allotted
  const hasFullAllotment = deduped.some(
    (c) => c.status === AllotmentStatus.ALLOTTED,
  );
  const hasPartialAllotment = deduped.some(
    (c) => c.status === AllotmentStatus.PARTIALLY_ALLOTTED,
  );

  if (hasFullAllotment || totalAllotted > 0) {
    return {
      status: AllotmentStatus.ALLOTTED,
      sharesAllotted: totalAllotted,
      sharesApplied: totalApplied,
    };
  }

  if (hasPartialAllotment) {
    return {
      status: AllotmentStatus.PARTIALLY_ALLOTTED,
      sharesAllotted: totalAllotted,
      sharesApplied: totalApplied,
    };
  }

  // 2. Check for technical failures, rate limits, or pending states
  const hasRateLimited = deduped.some(
    (c) => c.status === AllotmentStatus.RATE_LIMITED,
  );
  if (hasRateLimited) {
    return {
      status: AllotmentStatus.RATE_LIMITED,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  const hasSourceUnavailable = deduped.some(
    (c) => c.status === AllotmentStatus.SOURCE_UNAVAILABLE,
  );
  if (hasSourceUnavailable) {
    return {
      status: AllotmentStatus.SOURCE_UNAVAILABLE,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  const hasSourceInvalid = deduped.some(
    (c) => c.status === AllotmentStatus.SOURCE_RESPONSE_INVALID,
  );
  if (hasSourceInvalid) {
    return {
      status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  const hasTemporaryError = deduped.some(
    (c) => c.status === AllotmentStatus.TEMPORARY_ERROR,
  );
  if (hasTemporaryError) {
    return {
      status: AllotmentStatus.TEMPORARY_ERROR,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  const hasNotYetAvailable = deduped.some(
    (c) => c.status === AllotmentStatus.NOT_YET_AVAILABLE,
  );
  if (hasNotYetAvailable) {
    return {
      status: AllotmentStatus.NOT_YET_AVAILABLE,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  // 3. Confirm NOT_ALLOTTED strictly when all categories are confirmed NOT_ALLOTTED
  const allNotAllotted = deduped.every(
    (c) => c.status === AllotmentStatus.NOT_ALLOTTED,
  );
  if (allNotAllotted) {
    return {
      status: AllotmentStatus.NOT_ALLOTTED,
      sharesAllotted: 0,
      sharesApplied: totalApplied,
    };
  }

  // 4. Any other non-definitive status (APPLICATION_NOT_FOUND, NEEDS_REVIEW, etc.)
  const firstUnresolved = deduped.find(
    (c) => c.status !== AllotmentStatus.NOT_ALLOTTED,
  );
  return {
    status: firstUnresolved?.status || AllotmentStatus.NEEDS_REVIEW,
    sharesAllotted: 0,
    sharesApplied: totalApplied,
  };
}
