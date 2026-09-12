import { AnalyticsCalculator } from './analytics.calculator';
import { AnalyticsQualityStatus, AnalyticsTimePeriod, MetricAvailabilityStatus } from './analytics.types';

describe('AnalyticsCalculator (Phase 30.1)', () => {
  describe('Average & Median Calculations', () => {
    it('calculates arithmetic average correctly while ignoring nulls/NaN', () => {
      expect(AnalyticsCalculator.calculateAverage([100, 200, 300])).toBe(200);
      expect(AnalyticsCalculator.calculateAverage([100, null, 200, undefined, NaN])).toBe(150);
    });

    it('returns null for empty array or array with only nulls', () => {
      expect(AnalyticsCalculator.calculateAverage([])).toBeNull();
      expect(AnalyticsCalculator.calculateAverage([null, undefined, NaN])).toBeNull();
    });

    it('calculates median correctly for odd and even number of items', () => {
      // Odd length
      expect(AnalyticsCalculator.calculateMedian([50, 10, 30])).toBe(30);
      // Even length
      expect(AnalyticsCalculator.calculateMedian([10, 20, 30, 40])).toBe(25);
    });

    it('returns null for empty median input', () => {
      expect(AnalyticsCalculator.calculateMedian([])).toBeNull();
    });
  });

  describe('Ratio & Percentage Calculations', () => {
    it('calculates fresh vs OFS ratio safely', () => {
      expect(AnalyticsCalculator.calculateRatio(1000, 500)).toBe(2);
      expect(AnalyticsCalculator.calculateRatio(500, 1000)).toBe(0.5);
    });

    it('returns null for ratio with zero denominator or missing values', () => {
      expect(AnalyticsCalculator.calculateRatio(1000, 0)).toBeNull();
      expect(AnalyticsCalculator.calculateRatio(null, 500)).toBeNull();
      expect(AnalyticsCalculator.calculateRatio(1000, undefined)).toBeNull();
    });

    it('calculates percentage correctly and rounds to 2 decimal places', () => {
      expect(AnalyticsCalculator.calculatePercentage(25, 100)).toBe(25);
      expect(AnalyticsCalculator.calculatePercentage(1, 3)).toBe(33.33);
    });

    it('returns 0 for percentage when total is 0 or part is null', () => {
      expect(AnalyticsCalculator.calculatePercentage(50, 0)).toBe(0);
      expect(AnalyticsCalculator.calculatePercentage(null, 100)).toBe(0);
      expect(AnalyticsCalculator.calculatePercentage(-10, 100)).toBe(0);
    });
  });

  describe('Price Band Spread & Listing Performance', () => {
    it('calculates price band spread in INR and percentage', () => {
      expect(AnalyticsCalculator.calculatePriceBandSpreadInr(100, 120)).toBe(20);
      expect(AnalyticsCalculator.calculatePriceBandSpreadPercentage(100, 120)).toBe(20);
    });

    it('returns null if price band bounds are missing or inverted', () => {
      expect(AnalyticsCalculator.calculatePriceBandSpreadInr(null, 120)).toBeNull();
      expect(AnalyticsCalculator.calculatePriceBandSpreadInr(120, 100)).toBeNull();
    });

    it('calculates listing gain percentage when both prices are present', () => {
      expect(AnalyticsCalculator.calculateListingGainPercentage(100, 150)).toBe(50);
      expect(AnalyticsCalculator.calculateListingGainPercentage(100, 80)).toBe(-20);
    });

    it('returns null for listing gain percentage when listing price is missing', () => {
      expect(AnalyticsCalculator.calculateListingGainPercentage(100, null)).toBeNull();
      expect(AnalyticsCalculator.calculateListingGainPercentage(null, 150)).toBeNull();
      expect(AnalyticsCalculator.calculateListingGainPercentage(0, 150)).toBeNull();
    });
  });

  describe('Allotment Rate Semantics', () => {
    it('calculates observed allotment rate percentage as descriptive rate', () => {
      expect(AnalyticsCalculator.calculateObservedAllotmentRatePercentage(2, 10)).toBe(20);
      expect(AnalyticsCalculator.calculateObservedAllotmentRatePercentage(0, 5)).toBe(0);
    });

    it('returns null when total deduplicated observations is 0', () => {
      expect(AnalyticsCalculator.calculateObservedAllotmentRatePercentage(5, 0)).toBeNull();
    });
  });

  describe('Time Period Key Formatting', () => {
    const testDate = new Date(Date.UTC(2026, 8, 11)); // 2026-09-11

    it('formats date into canonical period keys', () => {
      expect(AnalyticsCalculator.formatPeriodKey(testDate, AnalyticsTimePeriod.DAY)).toBe(
        '2026-09-11',
      );
      expect(AnalyticsCalculator.formatPeriodKey(testDate, AnalyticsTimePeriod.MONTH)).toBe(
        '2026-09',
      );
      expect(AnalyticsCalculator.formatPeriodKey(testDate, AnalyticsTimePeriod.QUARTER)).toBe(
        '2026-Q3',
      );
      expect(AnalyticsCalculator.formatPeriodKey(testDate, AnalyticsTimePeriod.YEAR)).toBe(
        '2026',
      );
    });
  });

  describe('Phase 30.2 Min/Max, Date Range & Exchange Extensions', () => {
    it('calculates min and max correctly while ignoring nulls, undefined, and NaNs', () => {
      expect(AnalyticsCalculator.calculateMin([100, 50, 200, null, NaN])).toBe(50);
      expect(AnalyticsCalculator.calculateMax([100, 50, 200, null, NaN])).toBe(200);
      expect(AnalyticsCalculator.calculateMin([])).toBeNull();
      expect(AnalyticsCalculator.calculateMax([])).toBeNull();
      expect(AnalyticsCalculator.calculateMin([null, undefined])).toBeNull();
      expect(AnalyticsCalculator.calculateMax([null, undefined])).toBeNull();
    });

    it('validates date range correctly and throws errors for invalid boundaries', () => {
      const valid = AnalyticsCalculator.validateDateRange('2026-01-01', '2026-12-31');
      expect(valid.fromDate).toEqual(new Date('2026-01-01'));
      expect(valid.toDate).toEqual(new Date('2026-12-31'));

      expect(() =>
        AnalyticsCalculator.validateDateRange('2026-12-31', '2026-01-01'),
      ).toThrow('cannot be after');

      expect(() => AnalyticsCalculator.validateDateRange('invalid-date')).toThrow(
        "Invalid 'from' date",
      );

      expect(() =>
        AnalyticsCalculator.validateDateRange('2026-01-01', 'invalid-date'),
      ).toThrow("Invalid 'to' date");
    });

    it('calculates total exchange listing slots counting BOTH twice', () => {
      const byExchange = { NSE: 5, BSE: 3, BOTH: 2 };
      expect(
        AnalyticsCalculator.calculateTotalExchangeListingsCount(byExchange),
      ).toBe(12); // 5 + 3 + 2*2
    });
  });

  describe('Phase 30.3 Duration Calculations', () => {
    it('calculates calendar duration days correctly between valid start and end dates', () => {
      expect(
        AnalyticsCalculator.calculateDurationDays('2026-09-01', '2026-09-05'),
      ).toBe(4);
      expect(
        AnalyticsCalculator.calculateDurationDays(
          new Date('2026-09-01T00:00:00Z'),
          new Date('2026-09-01T00:00:00Z'),
        ),
      ).toBe(0);
    });

    it('returns null for missing, invalid, or negative date pairs', () => {
      expect(AnalyticsCalculator.calculateDurationDays(null, '2026-09-05')).toBeNull();
      expect(AnalyticsCalculator.calculateDurationDays('2026-09-01', null)).toBeNull();
      expect(
        AnalyticsCalculator.calculateDurationDays('invalid-date', '2026-09-05'),
      ).toBeNull();
      // Negative duration (listing before close)
      expect(
        AnalyticsCalculator.calculateDurationDays('2026-09-10', '2026-09-05'),
      ).toBeNull();
    });

    it('calculates average and median duration days correctly ignoring invalid/negative values', () => {
      expect(
        AnalyticsCalculator.calculateAverageDuration([2, 4, 6, null, -1, NaN]),
      ).toBe(4);
      expect(
        AnalyticsCalculator.calculateMedianDuration([1, 3, 5, 7, null, -5]),
      ).toBe(4);
    });

    it('returns null for empty duration arrays', () => {
      expect(AnalyticsCalculator.calculateAverageDuration([])).toBeNull();
      expect(AnalyticsCalculator.calculateMedianDuration([])).toBeNull();
      expect(AnalyticsCalculator.calculateAverageDuration([null, -1])).toBeNull();
    });
  });

  describe('Phase 30.4 Subscription Calculator Extensions', () => {
    it('calculates valid subscription multiple correctly', () => {
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(1500, 100)).toBe(15);
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(155, 100)).toBe(1.55);
    });

    it('returns null for zero or negative denominator, missing values, or negative bids', () => {
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(1500, 0)).toBeNull();
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(1500, -100)).toBeNull();
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(null, 100)).toBeNull();
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(1500, undefined)).toBeNull();
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(NaN, 100)).toBeNull();
      expect(AnalyticsCalculator.calculateSubscriptionMultiple(-5, 100)).toBeNull();
    });

    it('calculates subscription coverage percentage correctly', () => {
      expect(AnalyticsCalculator.calculateSubscriptionCoverage(5, 10)).toBe(50);
      expect(AnalyticsCalculator.calculateSubscriptionCoverage(0, 10)).toBe(0);
      expect(AnalyticsCalculator.calculateSubscriptionCoverage(5, 0)).toBe(0);
    });
  });

  describe('calculateOutcomeRatePercentage', () => {
    it('calculates correct percentage rounded to 2 decimal places', () => {
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(25, 100)).toBe(25.0);
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(1, 3)).toBe(33.33);
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(0, 50)).toBe(0.0);
    });

    it('returns null on zero denominator or invalid inputs', () => {
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(10, 0)).toBeNull();
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(-1, 50)).toBeNull();
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(null as any, 100)).toBeNull();
      expect(AnalyticsCalculator.calculateOutcomeRatePercentage(10, null as any)).toBeNull();
    });
  });

  describe('calculateAllotmentOutcomeDistribution', () => {
    it('calculates outcome counts, positive totals, and rate reconciliation', () => {
      const dist = AnalyticsCalculator.calculateAllotmentOutcomeDistribution(30, 10, 60);

      expect(dist.allottedCount).toBe(30);
      expect(dist.partiallyAllottedCount).toBe(10);
      expect(dist.notAllottedCount).toBe(60);
      expect(dist.positiveOutcomeCount).toBe(40);
      expect(dist.definitiveObservationsCount).toBe(100);

      expect(dist.observedPositiveAllotmentRatePercentage).toBe(40.0);
      expect(dist.fullAllotmentRatePercentage).toBe(30.0);
      expect(dist.partialAllotmentRatePercentage).toBe(10.0);
      expect(dist.notAllottedRatePercentage).toBe(60.0);

      // Reconciliation check: full + partial + notAllotted = 100%
      const sum =
        dist.fullAllotmentRatePercentage! +
        dist.partialAllotmentRatePercentage! +
        dist.notAllottedRatePercentage!;
      expect(sum).toBe(100.0);
    });

    it('handles zero definitive observations with null rates', () => {
      const dist = AnalyticsCalculator.calculateAllotmentOutcomeDistribution(0, 0, 0);

      expect(dist.positiveOutcomeCount).toBe(0);
      expect(dist.definitiveObservationsCount).toBe(0);
      expect(dist.observedPositiveAllotmentRatePercentage).toBeNull();
      expect(dist.fullAllotmentRatePercentage).toBeNull();
      expect(dist.partialAllotmentRatePercentage).toBeNull();
      expect(dist.notAllottedRatePercentage).toBeNull();
    });
  });

  describe('classifyQualityStatus', () => {
    it('classifies metric quality statuses correctly', () => {
      expect(
        AnalyticsCalculator.classifyQualityStatus({
          availability: MetricAvailabilityStatus.FUTURE_DATA_DEPENDENT,
          completenessPercentage: 0,
        }),
      ).toBe(AnalyticsQualityStatus.UNAVAILABLE);

      expect(
        AnalyticsCalculator.classifyQualityStatus({
          availability: MetricAvailabilityStatus.SUPPORTED,
          completenessPercentage: 0,
        }),
      ).toBe(AnalyticsQualityStatus.INSUFFICIENT_DATA);

      expect(
        AnalyticsCalculator.classifyQualityStatus({
          availability: MetricAvailabilityStatus.SUPPORTED,
          completenessPercentage: 80,
        }),
      ).toBe(AnalyticsQualityStatus.PARTIAL);

      expect(
        AnalyticsCalculator.classifyQualityStatus({
          availability: MetricAvailabilityStatus.SUPPORTED,
          completenessPercentage: 100,
        }),
      ).toBe(AnalyticsQualityStatus.COMPLETE);

      expect(
        AnalyticsCalculator.classifyQualityStatus({
          availability: MetricAvailabilityStatus.SUPPORTED,
          completenessPercentage: 100,
          qualityGateStatus: 'NEEDS_REVIEW',
        }),
      ).toBe(AnalyticsQualityStatus.NEEDS_REVIEW);
    });
  });
});
