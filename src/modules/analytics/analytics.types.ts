import { ExchangeListing, IpoStatus, MarketSegment } from '@prisma/client';

export enum MetricCategory {
  MARKET = 'MARKET',
  PERFORMANCE = 'PERFORMANCE',
  SUBSCRIPTION = 'SUBSCRIPTION',
  ALLOTMENT = 'ALLOTMENT',
  DATA_QUALITY = 'DATA_QUALITY',
}

export enum MetricUnit {
  COUNT = 'COUNT',
  INR = 'INR',
  SHARES = 'SHARES',
  PERCENTAGE = 'PERCENTAGE',
  RATIO = 'RATIO',
  DAYS = 'DAYS',
  SCORE = 'SCORE',
}

export enum MetricAggregationType {
  COUNT = 'COUNT',
  SUM = 'SUM',
  AVERAGE = 'AVERAGE',
  MEDIAN = 'MEDIAN',
  RATIO = 'RATIO',
  DISTRIBUTION = 'DISTRIBUTION',
}

export enum MetricAvailabilityStatus {
  SUPPORTED = 'SUPPORTED',
  FUTURE_DATA_DEPENDENT = 'FUTURE_DATA_DEPENDENT',
}

export enum AnalyticsTimePeriod {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  QUARTER = 'QUARTER',
  YEAR = 'YEAR',
}

export enum AnalyticsDateAnchor {
  OPEN_DATE = 'OPEN_DATE',
  CLOSE_DATE = 'CLOSE_DATE',
  LISTING_DATE = 'LISTING_DATE',
  CREATED_AT = 'CREATED_AT',
}

export interface MetricContract {
  id: string;
  name: string;
  category: MetricCategory;
  description: string;
  unit: MetricUnit;
  aggregationType: MetricAggregationType;
  availabilityStatus: MetricAvailabilityStatus;
  sourceModels: string[];
  sourceFields: string[];
  formulaDescription: string;
  nullPolicyDescription: string;
}

export interface IssueSizeAggregates {
  totalIssueSizeInr: number;
  totalFreshIssueSizeInr: number;
  totalOfsSizeInr: number;
  averageIssueSizeInr: number | null;
  medianIssueSizeInr: number | null;
  freshIssueVsOfsRatio: number | null;
  totalIssueShareCount: number;
  totalFreshIssueShareCount: number;
  totalOfsShareCount: number;
}

export interface IpoMarketSummaryMetrics {
  totalIpos: number;
  byStatus: Record<IpoStatus, number>;
  bySegment: Record<MarketSegment, number>;
  byExchange: Record<ExchangeListing, number>;
  issueSize: IssueSizeAggregates;
}

export interface PriceBandSpreadMetric {
  ipoId: string;
  symbol: string | null;
  priceBandLow: number | null;
  priceBandHigh: number | null;
  spreadInr: number | null;
  spreadPercentage: number | null;
}

export interface ListingPerformanceMetric {
  ipoId: string;
  symbol: string | null;
  issuePriceInr: number | null;
  listingPriceInr: number | null; // Unsupported currently
  listingGainPercentage: number | null; // Unsupported currently
  availabilityReason: string;
}

export interface IpoPerformanceSummaryMetrics {
  evaluatedCount: number;
  averagePriceBandSpreadInr: number | null;
  averagePriceBandSpreadPercentage: number | null;
  listingPerformanceSupported: boolean;
  unsupportedMetricReason: string;
}

export interface AllotmentObservationSummaryMetrics {
  totalCheckLogs: number;
  totalJobItems: number;
  distinctIdentifiersChecked: number;
  deduplicatedObservationsCount: number;
  observedAllottedCount: number;
  observedPartiallyAllottedCount: number;
  observedNotAllottedCount: number;
  observedPositiveOutcomeCount: number;
  observedPositiveAllotmentRatePercentage: number | null;
  disclaimer: string;
}

export interface AnalyticsDataQualityMetrics {
  totalIpos: number;
  completeIposCount: number;
  completenessScorePercentage: number;
  freshnessScorePercentage: number;
  unmappedSourceIdentityCount: number;
}

export interface AnalyticsTimeFilter {
  period?: AnalyticsTimePeriod;
  anchor?: AnalyticsDateAnchor;
  startDate?: string;
  endDate?: string;
}

export interface IpoMarketSnapshotDto {
  totalIpos: number;
  openIposCount: number;
  upcomingIposCount: number;
  closedIposCount: number;
  listingSoonIposCount: number;
  withdrawnOrCancelledCount: number;
}

export interface IssueSizeDistributionDto {
  minimumIssueSizeInr: number | null;
  maximumIssueSizeInr: number | null;
  averageIssueSizeInr: number | null;
  medianIssueSizeInr: number | null;
  knownIssueSizeCount: number;
  issueSizeCoveragePercentage: number;
}

export interface IssueShareCountCoverageDto {
  knownIssueShareCount: number;
  issueShareCountCoveragePercentage: number;
}

export interface SegmentMarketAnalyticsDto {
  segment: MarketSegment;
  totalIpos: number;
  knownIssueSizeCount: number;
  totalIssueSizeInr: number;
  averageIssueSizeInr: number | null;
  medianIssueSizeInr: number | null;
  totalIssueShareCount: number;
}

export interface ExchangeListingCountSummaryDto {
  byExchangeClassification: Record<ExchangeListing, number>;
  totalExchangeListingsCount: number;
  explanation: string;
}

export interface IpoMarketTrendPointDto {
  periodKey: string;
  ipoCount: number;
  totalIssueSizeInr: number;
  averageIssueSizeInr: number | null;
}

export interface IpoMarketTrendAnalyticsDto {
  period: AnalyticsTimePeriod;
  anchor: AnalyticsDateAnchor;
  trendPoints: IpoMarketTrendPointDto[];
}

export interface IpoMarketAnalyticsFilterDto {
  from?: string;
  to?: string;
  segment?: MarketSegment;
  exchange?: ExchangeListing;
  status?: IpoStatus;
  period?: AnalyticsTimePeriod;
  anchor?: AnalyticsDateAnchor;
}

export interface DetailedIpoMarketAnalyticsResponseDto {
  filter: IpoMarketAnalyticsFilterDto;
  snapshot: IpoMarketSnapshotDto;
  marketSummary: IpoMarketSummaryMetrics;
  issueSizeDistribution: IssueSizeDistributionDto;
  issueShareCoverage: IssueShareCountCoverageDto;
  bySegmentDetailed: SegmentMarketAnalyticsDto[];
  byExchangeDetailed: ExchangeListingCountSummaryDto;
  trends: IpoMarketTrendAnalyticsDto;
}

// ── Phase 30.3 Performance Analytics DTOs ────────────────────────────────────

export interface PriceBandAnalyticsSummaryDto {
  totalIpos: number;
  knownPriceBandCount: number;
  priceBandCoveragePercentage: number;
  averagePriceBandSpreadInr: number | null;
  medianPriceBandSpreadInr: number | null;
  minimumPriceBandSpreadInr: number | null;
  maximumPriceBandSpreadInr: number | null;
  averagePriceBandSpreadPercentage: number | null;
  medianPriceBandSpreadPercentage: number | null;
}

export interface ListingTimelineAnalyticsDto {
  evaluatedIposCount: number;
  evaluatedTimelineCount: number;
  timelineCoveragePercentage: number;
  averageDaysCloseToListing: number | null;
  medianDaysCloseToListing: number | null;
  minimumDaysCloseToListing: number | null;
  maximumDaysCloseToListing: number | null;
  explanation: string;
}

export interface ListingPerformanceAnalyticsSummaryDto {
  evaluatedCount: number;
  knownListingPriceCount: number;
  listingPerformanceSupported: boolean;
  unsupportedMetricReason: string;
}

export interface SegmentPerformanceAnalyticsDto {
  segment: MarketSegment;
  totalIpos: number;
  knownPriceBandCount: number;
  averagePriceBandSpreadInr: number | null;
  medianPriceBandSpreadInr: number | null;
  averagePriceBandSpreadPercentage: number | null;
  medianPriceBandSpreadPercentage: number | null;
  evaluatedTimelineCount: number;
  averageDaysCloseToListing: number | null;
  medianDaysCloseToListing: number | null;
}

export interface IpoPerformanceTrendPointDto {
  periodKey: string;
  ipoCount: number;
  averagePriceBandSpreadInr: number | null;
  averageDaysCloseToListing: number | null;
}

export interface IpoPerformanceTrendAnalyticsDto {
  period: AnalyticsTimePeriod;
  anchor: AnalyticsDateAnchor;
  trendPoints: IpoPerformanceTrendPointDto[];
}

export interface IpoPerformanceAnalyticsFilterDto {
  from?: string;
  to?: string;
  segment?: MarketSegment;
  exchange?: ExchangeListing;
  status?: IpoStatus;
  period?: AnalyticsTimePeriod;
  anchor?: AnalyticsDateAnchor;
}

export interface DetailedIpoPerformanceAnalyticsResponseDto {
  filter: IpoPerformanceAnalyticsFilterDto;
  priceBandSummary: PriceBandAnalyticsSummaryDto;
  listingTimeline: ListingTimelineAnalyticsDto;
  listingPerformance: ListingPerformanceAnalyticsSummaryDto;
  bySegmentDetailed: SegmentPerformanceAnalyticsDto[];
  trends: IpoPerformanceTrendAnalyticsDto;
}

// ── Phase 30.4 Subscription & Demand Analytics DTOs ──────────────────────────

export enum SubscriptionCategory {
  QIB = 'QIB',
  NII = 'NII',
  RETAIL = 'RETAIL',
  EMPLOYEE = 'EMPLOYEE',
  SHAREHOLDER = 'SHAREHOLDER',
  OTHER = 'OTHER',
}

export interface CategorySubscriptionSummaryDto {
  category: SubscriptionCategory;
  knownCount: number;
  averageSubscriptionMultiplier: number | null;
  medianSubscriptionMultiplier: number | null;
}

export interface SubscriptionDemandSummaryDto {
  totalIpos: number;
  knownSubscriptionCount: number;
  subscriptionCoveragePercentage: number;
  subscriptionSupported: boolean;
  averageSubscriptionMultiplier: number | null;
  medianSubscriptionMultiplier: number | null;
  unsupportedMetricReason: string;
}

export interface CategoryWiseSubscriptionAnalyticsDto {
  supportedCategories: SubscriptionCategory[];
  knownCategoryCount: number;
  categories: CategorySubscriptionSummaryDto[];
  explanation: string;
}

export interface SegmentSubscriptionAnalyticsDto {
  segment: MarketSegment;
  totalIpos: number;
  knownSubscriptionCount: number;
  averageSubscriptionMultiplier: number | null;
  medianSubscriptionMultiplier: number | null;
}

export interface SubscriptionTrendPointDto {
  periodKey: string;
  ipoCount: number;
  averageSubscriptionMultiplier: number | null;
}

export interface SubscriptionTrendAnalyticsDto {
  period: AnalyticsTimePeriod;
  anchor: AnalyticsDateAnchor;
  trendPoints: SubscriptionTrendPointDto[];
}

export interface SubscriptionDemandAnalyticsFilterDto {
  from?: string;
  to?: string;
  segment?: MarketSegment;
  exchange?: ExchangeListing;
  status?: IpoStatus;
  period?: AnalyticsTimePeriod;
  anchor?: AnalyticsDateAnchor;
}

export interface DetailedSubscriptionDemandAnalyticsResponseDto {
  filter: SubscriptionDemandAnalyticsFilterDto;
  subscriptionSummary: SubscriptionDemandSummaryDto;
  categoryWise: CategoryWiseSubscriptionAnalyticsDto;
  bySegmentDetailed: SegmentSubscriptionAnalyticsDto[];
  trends: SubscriptionTrendAnalyticsDto;
}

// ── Phase 30.5 Allotment Analytics DTOs ──────────────────────────────────────

export interface AllotmentOutcomeDistributionDto {
  allottedCount: number;
  partiallyAllottedCount: number;
  notAllottedCount: number;
  positiveOutcomeCount: number;
  definitiveObservationsCount: number;
  observedPositiveAllotmentRatePercentage: number | null;
  fullAllotmentRatePercentage: number | null;
  partialAllotmentRatePercentage: number | null;
  notAllottedRatePercentage: number | null;
}

export interface AllotmentDataQualityCountsDto {
  totalRawObservations: number;
  deduplicatedObservationsCount: number;
  definitiveObservationsCount: number;
  excludedNonDefinitiveCount: number;
  observationCoveragePercentage: number | null;
}

export interface AllotmentAnalyticsSummaryDto {
  dataQuality: AllotmentDataQualityCountsDto;
  outcomes: AllotmentOutcomeDistributionDto;
  disclaimer: string;
}

export interface IpoAllotmentAnalyticsDto {
  ipoId: string;
  symbol: string | null;
  companyName: string | null;
  marketSegment: MarketSegment | null;
  dataQuality: AllotmentDataQualityCountsDto;
  outcomes: AllotmentOutcomeDistributionDto;
}

export interface SegmentAllotmentAnalyticsDto {
  segment: MarketSegment;
  dataQuality: AllotmentDataQualityCountsDto;
  outcomes: AllotmentOutcomeDistributionDto;
}

export interface AllotmentPeriodTrendPointDto {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  dataQuality: AllotmentDataQualityCountsDto;
  outcomes: AllotmentOutcomeDistributionDto;
}

export interface AllotmentTrendAnalyticsDto {
  period: AnalyticsTimePeriod;
  trendPoints: AllotmentPeriodTrendPointDto[];
}

export interface AllotmentAnalyticsFilterDto {
  ipoId?: string;
  segment?: MarketSegment;
  from?: string;
  to?: string;
  period?: AnalyticsTimePeriod;
}

export interface DetailedAllotmentAnalyticsResponseDto {
  filter: AllotmentAnalyticsFilterDto;
  summary: AllotmentAnalyticsSummaryDto;
  byIpoDetailed: IpoAllotmentAnalyticsDto[];
  bySegmentDetailed: SegmentAllotmentAnalyticsDto[];
  trends: AllotmentTrendAnalyticsDto;
  lotRatioMetricStatus: MetricAvailabilityStatus;
  lotRatioExplanation: string;
}

// ── Phase 30.6 Data-Quality-Aware Analytics DTOs ─────────────────────────────

export enum AnalyticsQualityStatus {
  COMPLETE = 'COMPLETE',
  PARTIAL = 'PARTIAL',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
  UNAVAILABLE = 'UNAVAILABLE',
  NEEDS_REVIEW = 'NEEDS_REVIEW',
}

export enum AnalyticsQualityWarningCode {
  PRICE_BAND_INCOMPLETE = 'PRICE_BAND_INCOMPLETE',
  LISTING_TIMELINE_INCOMPLETE = 'LISTING_TIMELINE_INCOMPLETE',
  SUBSCRIPTION_DATA_UNAVAILABLE = 'SUBSCRIPTION_DATA_UNAVAILABLE',
  ALLOTMENT_SAMPLE_ONLY = 'ALLOTMENT_SAMPLE_ONLY',
  PROVENANCE_INCOMPLETE = 'PROVENANCE_INCOMPLETE',
  SOURCE_HEALTH_DEGRADED = 'SOURCE_HEALTH_DEGRADED',
  DATA_QUALITY_WARNINGS_PRESENT = 'DATA_QUALITY_WARNINGS_PRESENT',
}

export interface MetricQualityContractDto {
  metricId: string;
  category: MetricCategory;
  availability: MetricAvailabilityStatus;
  qualityStatus: AnalyticsQualityStatus;
  completenessPercentage: number | null;
  freshnessStatus: 'FRESH' | 'STALE' | 'UNKNOWN';
  provenanceCoveragePercentage: number | null;
  warnings: AnalyticsQualityWarningCode[];
}

export interface DomainQualitySummaryDto {
  domain: string;
  qualityStatus: AnalyticsQualityStatus;
  completenessPercentage: number | null;
  knownObservationCount: number;
  missingObservationCount: number;
  explanation: string;
  warnings: AnalyticsQualityWarningCode[];
}

export interface ProvenanceQualitySummaryDto {
  totalEvaluatedFields: number;
  knownProvenanceCount: number;
  missingProvenanceCount: number;
  provenanceCoveragePercentage: number;
}

export interface SourceHealthQualitySummaryDto {
  totalSources: number;
  healthySourcesCount: number;
  degradedSourcesCount: number;
  failedSourcesCount: number;
  sourceHealthCoveragePercentage: number;
}

export interface FreshnessQualitySummaryDto {
  totalEvaluatedIpos: number;
  freshCount: number;
  staleCount: number;
  unknownCount: number;
  freshnessCoveragePercentage: number;
  note: string;
}

export interface QualityGateDistributionDto {
  totalEvaluatedIpos: number;
  passCount: number;
  passWithWarningsCount: number;
  needsReviewCount: number;
  incompleteCount: number;
  qualityGatePassRatePercentage: number;
}

export interface DetailedAnalyticsQualitySummaryResponseDto {
  evaluatedAt: string;
  overallQualityStatus: AnalyticsQualityStatus;
  disclaimer: string;
  domains: {
    market: DomainQualitySummaryDto;
    performance: DomainQualitySummaryDto;
    subscription: DomainQualitySummaryDto;
    allotment: DomainQualitySummaryDto;
  };
  provenance: ProvenanceQualitySummaryDto;
  sourceHealth: SourceHealthQualitySummaryDto;
  freshness: FreshnessQualitySummaryDto;
  qualityGate: QualityGateDistributionDto;
  metricQualityContracts: MetricQualityContractDto[];
  activeWarnings: AnalyticsQualityWarningCode[];
}
