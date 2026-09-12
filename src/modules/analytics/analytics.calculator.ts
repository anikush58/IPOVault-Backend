import {
  AllotmentOutcomeDistributionDto,
  AnalyticsQualityStatus,
  AnalyticsTimePeriod,
  MetricAvailabilityStatus,
} from './analytics.types';

/**
 * AnalyticsCalculator
 *
 * Pure, deterministic mathematical utilities for analytics metrics calculations.
 *
 * Enforces:
 *   1. Money vs. Share Count Separation: Monetary fields (INR) and Share counts (SHARES) are never mixed.
 *   2. Null & Incomplete Data Policy: Missing or null values are never silently converted to 0.
 *   3. Zero Denominator Protection: Division by zero returns null or 0 cleanly (zero NaN/Infinity).
 *   4. Allotment Rate Semantics: Observed positive outcome rate is descriptive, never predictive.
 */
export class AnalyticsCalculator {
  /**
   * Safely calculates arithmetic mean of numbers.
   * Returns null if array is empty or contains no valid numeric entries.
   */
  static calculateAverage(values: Array<number | null | undefined>): number | null {
    const valid = values.filter((v): v is number => typeof v === 'number' && !isNaN(v));
    if (valid.length === 0) {
      return null;
    }
    const sum = valid.reduce((acc, curr) => acc + curr, 0);
    return Math.round((sum / valid.length) * 100) / 100;
  }

  /**
   * Safely calculates median (50th percentile) of numbers.
   * Returns null if array is empty or contains no valid numeric entries.
   */
  static calculateMedian(values: Array<number | null | undefined>): number | null {
    const valid = values
      .filter((v): v is number => typeof v === 'number' && !isNaN(v))
      .sort((a, b) => a - b);

    if (valid.length === 0) {
      return null;
    }

    const mid = Math.floor(valid.length / 2);
    if (valid.length % 2 === 0) {
      const med = (valid[mid - 1] + valid[mid]) / 2;
      return Math.round(med * 100) / 100;
    }

    return Math.round(valid[mid] * 100) / 100;
  }

  /**
   * Safely calculates a ratio (numerator / denominator).
   * Returns null if either value is null/undefined, denominator is 0, or either is non-positive.
   */
  static calculateRatio(
    numerator: number | null | undefined,
    denominator: number | null | undefined,
  ): number | null {
    if (
      typeof numerator !== 'number' ||
      typeof denominator !== 'number' ||
      isNaN(numerator) ||
      isNaN(denominator) ||
      denominator <= 0
    ) {
      return null;
    }

    const ratio = numerator / denominator;
    return Math.round(ratio * 10000) / 10000;
  }

  /**
   * Safely calculates percentage (part / total * 100).
   * Returns 0 if total is 0 or part is null/undefined.
   */
  static calculatePercentage(
    part: number | null | undefined,
    total: number | null | undefined,
  ): number {
    if (
      typeof part !== 'number' ||
      typeof total !== 'number' ||
      isNaN(part) ||
      isNaN(total) ||
      total <= 0 ||
      part < 0
    ) {
      return 0;
    }

    const percentage = (part / total) * 100;
    return Math.round(percentage * 100) / 100;
  }

  /**
   * Calculates price band spread in INR (priceBandHigh - priceBandLow).
   * Returns null if either price band bound is missing.
   */
  static calculatePriceBandSpreadInr(
    priceBandLow: number | null | undefined,
    priceBandHigh: number | null | undefined,
  ): number | null {
    if (
      typeof priceBandLow !== 'number' ||
      typeof priceBandHigh !== 'number' ||
      isNaN(priceBandLow) ||
      isNaN(priceBandHigh) ||
      priceBandHigh < priceBandLow
    ) {
      return null;
    }

    return Math.round((priceBandHigh - priceBandLow) * 100) / 100;
  }

  /**
   * Calculates price band spread percentage ((priceBandHigh - priceBandLow) / priceBandLow * 100).
   * Returns null if low <= 0 or either bound is missing.
   */
  static calculatePriceBandSpreadPercentage(
    priceBandLow: number | null | undefined,
    priceBandHigh: number | null | undefined,
  ): number | null {
    const spreadInr = this.calculatePriceBandSpreadInr(priceBandLow, priceBandHigh);
    if (spreadInr === null || !priceBandLow || priceBandLow <= 0) {
      return null;
    }

    const pct = (spreadInr / priceBandLow) * 100;
    return Math.round(pct * 100) / 100;
  }

  /**
   * Formula helper for Listing Gain Percentage: ((listingPrice - issuePrice) / issuePrice) * 100.
   * Returns null if listingPrice or issuePrice is missing or issuePrice <= 0.
   *
   * Note: Currently unsupported in Phase 30.1 because canonical schema lacks listingPrice.
   */
  static calculateListingGainPercentage(
    issuePrice: number | null | undefined,
    listingPrice: number | null | undefined,
  ): number | null {
    if (
      typeof issuePrice !== 'number' ||
      typeof listingPrice !== 'number' ||
      isNaN(issuePrice) ||
      isNaN(listingPrice) ||
      issuePrice <= 0
    ) {
      return null;
    }

    const gainPct = ((listingPrice - issuePrice) / issuePrice) * 100;
    return Math.round(gainPct * 100) / 100;
  }

  /**
   * Calculates descriptive observed positive allotment rate:
   *   (positiveOutcomes / totalDeduplicatedObservations) * 100
   *
   * Returns null if totalDeduplicatedObservations === 0.
   */
  static calculateObservedAllotmentRatePercentage(
    positiveOutcomes: number,
    totalDeduplicatedObservations: number,
  ): number | null {
    if (totalDeduplicatedObservations <= 0 || positiveOutcomes < 0) {
      return null;
    }

    const rate = (positiveOutcomes / totalDeduplicatedObservations) * 100;
    return Math.round(rate * 100) / 100;
  }

  /**
   * Formats a Date object into a canonical time period bucket string based on UTC:
   *   - DAY: "YYYY-MM-DD"
   *   - WEEK: "YYYY-Www"
   *   - MONTH: "YYYY-MM"
   *   - QUARTER: "YYYY-Q#"
   *   - YEAR: "YYYY"
   */
  static formatPeriodKey(date: Date, period: AnalyticsTimePeriod): string {
    const year = date.getUTCFullYear();
    const monthNum = date.getUTCMonth() + 1;
    const month = monthNum.toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');

    switch (period) {
      case AnalyticsTimePeriod.DAY:
        return `${year}-${month}-${day}`;
      case AnalyticsTimePeriod.WEEK: {
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const pastDaysOfYear = (date.getTime() - startOfYear.getTime()) / 86_400_000;
        const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getUTCDay() + 1) / 7);
        return `${year}-W${weekNum.toString().padStart(2, '0')}`;
      }
      case AnalyticsTimePeriod.MONTH:
        return `${year}-${month}`;
      case AnalyticsTimePeriod.QUARTER: {
        const quarter = Math.ceil(monthNum / 3);
        return `${year}-Q${quarter}`;
      }
      case AnalyticsTimePeriod.YEAR:
        return `${year}`;
      default:
        return `${year}-${month}`;
    }
  }

  /**
   * Calculates minimum value from an array of numbers, ignoring nulls and NaNs.
   * Returns null if array is empty or contains no valid numbers.
   */
  static calculateMin(values: Array<number | null | undefined>): number | null {
    const valid = values.filter((v): v is number => typeof v === 'number' && !isNaN(v));
    if (valid.length === 0) return null;
    return Math.min(...valid);
  }

  /**
   * Calculates maximum value from an array of numbers, ignoring nulls and NaNs.
   * Returns null if array is empty or contains no valid numbers.
   */
  static calculateMax(values: Array<number | null | undefined>): number | null {
    const valid = values.filter((v): v is number => typeof v === 'number' && !isNaN(v));
    if (valid.length === 0) return null;
    return Math.max(...valid);
  }

  /**
   * Validates date range boundary parameters (from, to).
   * Ensures dates are valid ISO formats and from <= to.
   */
  static validateDateRange(
    from?: string,
    to?: string,
  ): { fromDate?: Date; toDate?: Date } {
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (from) {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        throw new Error(`Invalid 'from' date parameter: '${from}'`);
      }
    }

    if (to) {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        throw new Error(`Invalid 'to' date parameter: '${to}'`);
      }
    }

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new Error(
        `Invalid date range: 'from' date (${from}) cannot be after 'to' date (${to})`,
      );
    }

    return { fromDate, toDate };
  }

  /**
   * Calculates total exchange listing slots from canonical exchange classification map:
   *   totalListings = count(NSE) + count(BSE) + (2 * count(BOTH))
   */
  static calculateTotalExchangeListingsCount(
    byExchange: Record<string, number>,
  ): number {
    const nse = byExchange['NSE'] || 0;
    const bse = byExchange['BSE'] || 0;
    const both = byExchange['BOTH'] || 0;
    return nse + bse + 2 * both;
  }

  /**
   * Calculates duration in calendar days between two dates (endDate - startDate).
   * Returns null if either date is missing, invalid, or if endDate < startDate (negative duration).
   */
  static calculateDurationDays(
    startDate: Date | string | null | undefined,
    endDate: Date | string | null | undefined,
  ): number | null {
    if (!startDate || !endDate) {
      return null;
    }

    const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
    const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return null;
    }

    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) {
      return null;
    }

    const days = Math.round(diffMs / 86_400_000);
    return days;
  }

  /**
   * Safely calculates arithmetic mean of durations (in days).
   * Filters out null, undefined, NaN, and negative values.
   * Returns null if valid entry count is 0.
   */
  static calculateAverageDuration(
    values: Array<number | null | undefined>,
  ): number | null {
    const valid = values.filter(
      (v): v is number => typeof v === 'number' && !isNaN(v) && v >= 0,
    );
    return this.calculateAverage(valid);
  }

  /**
   * Safely calculates median of durations (in days).
   * Filters out null, undefined, NaN, and negative values.
   * Returns null if valid entry count is 0.
   */
  static calculateMedianDuration(
    values: Array<number | null | undefined>,
  ): number | null {
    const valid = values.filter(
      (v): v is number => typeof v === 'number' && !isNaN(v) && v >= 0,
    );
    return this.calculateMedian(valid);
  }

  /**
   * Safely calculates subscription demand multiple (totalBidsSubmitted / totalSharesOffered).
   * Enforces zero denominator protection (returns null if totalSharesOffered <= 0).
   * Returns null if either input is null, undefined, NaN, or if totalBidsSubmitted < 0.
   *
   * Note: Currently unsupported because canonical schema lacks subscription demand columns.
   */
  static calculateSubscriptionMultiple(
    totalBidsSubmitted: number | null | undefined,
    totalSharesOffered: number | null | undefined,
  ): number | null {
    if (
      typeof totalBidsSubmitted !== 'number' ||
      typeof totalSharesOffered !== 'number' ||
      isNaN(totalBidsSubmitted) ||
      isNaN(totalSharesOffered) ||
      totalSharesOffered <= 0 ||
      totalBidsSubmitted < 0
    ) {
      return null;
    }

    const multiple = totalBidsSubmitted / totalSharesOffered;
    return Math.round(multiple * 100) / 100;
  }

  /**
   * Safely calculates subscription coverage percentage (knownSubscriptionCount / totalIpos * 100).
   * Returns 0 if totalIpos <= 0.
   */
  static calculateSubscriptionCoverage(
    knownCount: number | null | undefined,
    totalIpos: number | null | undefined,
  ): number {
    return this.calculatePercentage(knownCount, totalIpos);
  }

  /**
   * Calculates outcome rate percentage (outcomeCount / totalDefinitive * 100).
   * Enforces zero denominator protection (returns null if totalDefinitive <= 0).
   */
  static calculateOutcomeRatePercentage(
    outcomeCount: number | null | undefined,
    totalDefinitive: number | null | undefined,
  ): number | null {
    if (
      typeof outcomeCount !== 'number' ||
      typeof totalDefinitive !== 'number' ||
      isNaN(outcomeCount) ||
      isNaN(totalDefinitive) ||
      totalDefinitive <= 0 ||
      outcomeCount < 0
    ) {
      return null;
    }

    const rate = (outcomeCount / totalDefinitive) * 100;
    return Math.round(rate * 100) / 100;
  }

  /**
   * Calculates comprehensive allotment outcome distribution and rate reconciliation.
   */
  static calculateAllotmentOutcomeDistribution(
    allottedCount: number,
    partiallyAllottedCount: number,
    notAllottedCount: number,
  ): AllotmentOutcomeDistributionDto {
    const positiveOutcomeCount = allottedCount + partiallyAllottedCount;
    const definitiveObservationsCount = positiveOutcomeCount + notAllottedCount;

    const observedPositiveAllotmentRatePercentage =
      this.calculateOutcomeRatePercentage(positiveOutcomeCount, definitiveObservationsCount);

    const fullAllotmentRatePercentage =
      this.calculateOutcomeRatePercentage(allottedCount, definitiveObservationsCount);

    const partialAllotmentRatePercentage =
      this.calculateOutcomeRatePercentage(partiallyAllottedCount, definitiveObservationsCount);

    const notAllottedRatePercentage =
      this.calculateOutcomeRatePercentage(notAllottedCount, definitiveObservationsCount);

    return {
      allottedCount,
      partiallyAllottedCount,
      notAllottedCount,
      positiveOutcomeCount,
      definitiveObservationsCount,
      observedPositiveAllotmentRatePercentage,
      fullAllotmentRatePercentage,
      partialAllotmentRatePercentage,
      notAllottedRatePercentage,
    };
  }

  /**
   * Classifies quality status based on metric availability, completeness percentage, and quality gate/source signals.
   */
  static classifyQualityStatus(params: {
    availability: MetricAvailabilityStatus;
    completenessPercentage: number | null;
    qualityGateStatus?: string;
    hasDegradedSources?: boolean;
  }): AnalyticsQualityStatus {
    const { availability, completenessPercentage, qualityGateStatus, hasDegradedSources } = params;

    if (availability === MetricAvailabilityStatus.FUTURE_DATA_DEPENDENT) {
      return AnalyticsQualityStatus.UNAVAILABLE;
    }

    if (completenessPercentage === null || completenessPercentage === 0) {
      return AnalyticsQualityStatus.INSUFFICIENT_DATA;
    }

    if (qualityGateStatus === 'NEEDS_REVIEW' || hasDegradedSources) {
      return AnalyticsQualityStatus.NEEDS_REVIEW;
    }

    if (completenessPercentage < 100) {
      return AnalyticsQualityStatus.PARTIAL;
    }

    return AnalyticsQualityStatus.COMPLETE;
  }
}
