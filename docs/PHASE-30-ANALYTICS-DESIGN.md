# Phase 30 — Analytics Architecture & Canonical Metric Definitions

## 1. Analytics Architecture

The **Analytics Domain** inside IPOVault provides single-source-of-truth mathematical analytics derived strictly from canonical database records.

```
Canonical Domain Models (Ipo, Company, IpoLifecycleEvent, AllotmentCheckLog, Source)
                                   ↓
                       Prisma Database Engine (Read-Only)
                                   ↓
                           AnalyticsService
                                   ↓
                         AnalyticsCalculator
  (Money/Share Separation, Denominator Protection, Descriptive Allotment Rules)
                                   ↓
                   Typed Analytics Contracts / Metrics DTOs
```

### Architectural Principles

1. **Read-Only Consumer**: The analytics layer consumes canonical data without modifying IPOs, companies, allotment check records, or source observations.
2. **Single Source of Truth**: Analytics reads directly from authoritative PostgreSQL domain tables (`ipos`, `companies`, `ipo_lifecycle_events`, `allotment_check_logs`, `discovery_records`). Analytics does not create a second source of truth.
3. **Foundation Only (Phase 30.1)**: Phase 30.1 establishes internal domain metrics, calculator routines, metric contracts, and unit tests. Zero public HTTP endpoints or controllers are exposed in Phase 30.1.
4. **No Premature Optimization / Infrastructure**: Zero Redis, BullMQ queues, background worker tasks, or materialized views are introduced. Aggregations execute dynamically via optimized database queries.

---

## 2. Domain Boundary

- **Module**: `AnalyticsModule` (`src/modules/analytics/analytics.module.ts`)
- **Service**: `AnalyticsService` (`src/modules/analytics/analytics.service.ts`)
- **Calculators**: `AnalyticsCalculator` (`src/modules/analytics/analytics.calculator.ts`)
- **Registry**: `METRIC_DEFINITIONS` (`src/modules/analytics/analytics-metric-definitions.ts`)

The analytics boundary does **not**:
- Perform database mutations.
- Rewrite historical event dates or price bands.
- Expose administrative or public REST routes in Phase 30.1.
- Store cached aggregate state in external key-value stores.

---

## 3. Metric Taxonomy & Registry

Metrics are categorized into five canonical categories:

| Category | Description | Availability Status in Phase 30.1 |
|---|---|---|
| **IPO Market Metrics** | Total count, status/segment/exchange distributions, monetary issue sizes, share counts. | `SUPPORTED` |
| **IPO Performance Metrics** | Price band spreads, price band percentages, listing gain %. | Price Band `SUPPORTED`; Listing Gain `FUTURE_DATA_DEPENDENT` |
| **Subscription / Demand Metrics** | Total demand multiplier, category-wise QIB/NII/RII subscription. | `FUTURE_DATA_DEPENDENT` |
| **Allotment Metrics** | Checked observation counts, deduplicated observations, observed positive outcome rate. | `SUPPORTED` (Phase 28 Semantics Preserved) |
| **Data Quality Metrics** | Freshness score, completeness score, unmapped source identity count. | `SUPPORTED` |

---

## 4. Supported Metric Definitions & Formulas

### A. IPO Market Metrics

1. **`TOTAL_IPOS`**
   - **Meaning**: Total count of registered IPOs.
   - **Formula**: `count(Ipo.id)`
   - **Unit**: `COUNT`

2. **`IPOS_BY_STATUS`**
   - **Meaning**: Grouped count of IPOs per status (`DRAFT`, `UPCOMING`, `OPEN`, `CLOSED`, `ALLOTMENT_PENDING`, `ALLOTMENT_COMPLETED`, `LISTING_PENDING`, `LISTED`, `WITHDRAWN`, `CANCELLED`).
   - **Formula**: `count(Ipo.id) GROUP BY status`

3. **`IPOS_BY_SEGMENT`**
   - **Meaning**: Breakdown of IPOs by market segment (`MAINBOARD` vs `SME`).
   - **Formula**: `count(Ipo.id) GROUP BY marketSegment`

4. **`TOTAL_ISSUE_SIZE_INR`**
   - **Meaning**: Total monetary issue size in Indian Rupees (INR).
   - **Formula**: `sum(Ipo.issueSize) WHERE issueSize IS NOT NULL`
   - **Unit**: `INR`

5. **`AVERAGE_ISSUE_SIZE_INR`**
   - **Meaning**: Mean issue size in INR among IPOs with valid issue size.
   - **Formula**: `sum(Ipo.issueSize) / count(valid issueSize)`
   - **Unit**: `INR`
   - **Null Policy**: Returns `null` if count of valid records is 0.

6. **`MEDIAN_ISSUE_SIZE_INR`**
   - **Meaning**: 50th percentile issue size in INR among IPOs with valid issue size.
   - **Formula**: Median of sorted non-null `issueSize` values.
   - **Unit**: `INR`
   - **Null Policy**: Returns `null` if 0 valid records exist.

7. **`FRESH_VS_OFS_RATIO`**
   - **Meaning**: Ratio of monetary Fresh Issue size to monetary Offer for Sale (OFS) size.
   - **Formula**: `freshIssueSize / ofsSize`
   - **Unit**: `RATIO`
   - **Null Policy**: Returns `null` if `ofsSize` is missing or `0`.

8. **`TOTAL_ISSUE_SHARE_COUNT`**
   - **Meaning**: Total number of equity shares offered across IPOs.
   - **Formula**: `sum(Ipo.issueShareCount) WHERE issueShareCount IS NOT NULL`
   - **Unit**: `SHARES`

### B. IPO Performance Metrics

1. **`PRICE_BAND_SPREAD_INR`**
   - **Meaning**: Absolute difference between high and low bounds of price band.
   - **Formula**: `priceBandHigh - priceBandLow`
   - **Unit**: `INR`
   - **Null Policy**: Returns `null` if either price band bound is missing.

2. **`PRICE_BAND_SPREAD_PERCENTAGE`**
   - **Meaning**: Percentage spread of price band relative to lower bound.
   - **Formula**: `((priceBandHigh - priceBandLow) / priceBandLow) * 100`
   - **Unit**: `PERCENTAGE`

---

## 5. Unsupported / Future Metrics (Data Dependent)

The following metrics are explicitly documented as **`FUTURE_DATA_DEPENDENT`** and return `null` / unsupported status in Phase 30.1:

1. **`LISTING_GAIN_PERCENTAGE`**
   - **Formula**: `((listingPrice - issuePrice) / issuePrice) * 100`
   - **Reason**: Canonical schema (`Ipo` model) does not currently contain a `listingPrice` column.
2. **`TOTAL_SUBSCRIPTION_MULTIPLIER`**
   - **Formula**: `totalBidsSubmitted / totalSharesOffered`
   - **Reason**: Canonical schema does not track QIB, NII, RII, or total subscription times.
3. **`CATEGORY_WISE_SUBSCRIPTION`**
   - **Reason**: Canonical schema does not store category demand breakdowns.

---

## 6. Null & Incomplete Data Policy

- **No Silent Zero Substitution**: Missing source data (e.g. `issueSize IS NULL`) MUST NOT be converted to zero. Missing fields represent unknown values.
- **Zero Denominator Protection**: All division operations (average, ratio, percentage) verify that the denominator is strictly positive (`denominator > 0`). If the denominator is 0, the calculator returns `null` or `0.0` as per metric contract, avoiding `NaN` or `Infinity`.
- **Incomplete Records**: Aggregations evaluate only records that possess valid data for the target fields.

---

## 7. Money vs. Share Count Safety Rules

To prevent financial misreporting:
- **`issueSize`**, **`freshIssueSize`**, and **`ofsSize`** are monetary INR fields (`Decimal(20, 2)`).
- **`issueShareCount`**, **`freshIssueShareCount`**, and **`ofsShareCount`** are equity share count fields (`Decimal(20, 0)`).
- Monetary fields (INR) and share count fields (SHARES) are calculated in strict isolation. They MUST NEVER be added together or interchanged.

---

## 8. Allotment Analytics Semantics (Phase 28 Rules Preserved)

Phase 30.1 strictly adheres to Phase 28 allotment intelligence definitions:

1. **Observation Nature**: `AllotmentCheckLog` and `AllotmentCheckJobItem` rows represent *check attempt observations*, NOT total end-user applications.
2. **Deduplication Rule**: Deduplication per `(ipoId, identifierHash)` using the latest observation timestamp is required before calculating observed allotment rates.
3. **Positive Outcomes**: Binary positive outcomes include both `ALLOTTED` and `PARTIALLY_ALLOTTED`.
4. **Descriptive Limitation**: Observed positive allotment rates represent *descriptive sample statistics* of checked observations. They MUST NOT be interpreted as predictive probabilities of future allotment success.

---

## 9. Time Period Semantics

Canonical time period bucketing supports:
- **Granularities**: `DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`.
- **Anchor Date Fields**:
  - `OPEN_DATE` (`IpoLifecycleEvent` where `eventType = OPEN`)
  - `CLOSE_DATE` (`IpoLifecycleEvent` where `eventType = CLOSE`)
  - `LISTING_DATE` (`IpoLifecycleEvent` where `eventType = LISTING`)
  - `RECORD_CREATED_AT` (`Ipo.createdAt`)
- **Key Formats**: UTC-based formatting strings (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`, `YYYY-Q#`, `YYYY`).

---

## 10. Data Quality Requirements

The analytics engine evaluates:
- **`completenessScorePercentage`**: Percentage of IPOs possessing non-null price bands, market segment, status, and symbol.
- **`unmappedSourceIdentityCount`**: Count of IPOs lacking mapped source identities in `IpoSourceIdentity`.

---

## 11. Planned Phase 30.2+ Roadmap

1. **Phase 30.2 — Production-Ready IPO Market Analytics Engine**: Implement read-only market summary, market snapshot, issue size distribution, segment & exchange breakdowns, period trend analytics, date range filtering, and coverage metrics.
2. **Phase 30.3 — Analytics API Boundary & Controllers**: (Future phase) Expose read-only REST endpoints protected by authorization controls.
3. **Phase 30.4 — Subscription & Listing Data Schema Extensions**: (Future phase) Add schema columns for listing prices and subscription demand tables to enable Phase 30.1 `FUTURE_DATA_DEPENDENT` metrics.

---

## 12. Phase 30.2 — IPO Market Analytics Specification

### A. Market Analytics Scope
Phase 30.2 introduces `AnalyticsService.getDetailedMarketAnalytics()`, delivering complete aggregate market analytics built strictly on canonical IPO records without schema modifications, Redis caches, background workers, or public REST controllers.

### B. Core Features & Capabilities

1. **Market Snapshot (`IpoMarketSnapshotDto`)**:
   - `totalIpos`: Total count of evaluated IPOs matching filters.
   - `openIposCount`: `status = OPEN`.
   - `upcomingIposCount`: `status = UPCOMING`.
   - `closedIposCount`: `status = CLOSED`.
   - `listingSoonIposCount`: `status = ALLOTMENT_COMPLETED` or `status = LISTING_PENDING`.
   - `withdrawnOrCancelledCount`: `status = WITHDRAWN` or `status = CANCELLED`.

2. **Issue Size Distribution (`IssueSizeDistributionDto`)**:
   - Evaluated in INR (`Decimal(20, 2)`).
   - Metrics: `minimumIssueSizeInr`, `maximumIssueSizeInr`, `averageIssueSizeInr`, `medianIssueSizeInr`.
   - Coverage: `knownIssueSizeCount`, `issueSizeCoveragePercentage` (`known / total * 100`).
   - Null Handling: `null` values are excluded from mathematical aggregates and never silently converted to 0.

3. **Share Count Coverage (`IssueShareCountCoverageDto`)**:
   - Evaluated in `SHARES` (`Decimal(20, 0)`), strictly isolated from monetary INR metrics.
   - `knownIssueShareCount`, `issueShareCountCoveragePercentage`.

4. **Segment Market Breakdown (`SegmentMarketAnalyticsDto`)**:
   - Provided separately for `MAINBOARD` and `SME`.
   - Metrics: `totalIpos`, `knownIssueSizeCount`, `totalIssueSizeInr`, `averageIssueSizeInr`, `medianIssueSizeInr`, `totalIssueShareCount`.

5. **Exchange Classification & Listing Slots (`ExchangeListingCountSummaryDto`)**:
   - `byExchangeClassification`: Grouped counts for `NSE`, `BSE`, and `BOTH` (each IPO entity counted once).
   - `totalExchangeListingsCount`: Counts physical exchange listing slots, where `BOTH` counts as 2 listing slots (`NSE + BSE + 2 * BOTH`).

6. **Period-Based Market Trends (`IpoMarketTrendAnalyticsDto`)**:
   - Periodic Bucketing: `DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`.
   - Date Anchors (`AnalyticsDateAnchor`): `CREATED_AT` (default), `OPEN_DATE`, `CLOSE_DATE`, `LISTING_DATE`.
   - Point Metrics: `periodKey`, `ipoCount`, `totalIssueSizeInr`, `averageIssueSizeInr`.

7. **Date Range Filtering (`IpoMarketAnalyticsFilterDto`)**:
   - Parameters: `from` and `to` (ISO dates).
   - Validation: Strict date format checking and boundary validation (`from <= to`). Throws explicit error on invalid parameters.
   - Filtering: Applied at database query level using `gte` / `lte` bounds on anchor fields.

### C. Database Query & Performance Strategy
- **Prisma Aggregation**: GroupBy and Count queries are pushed down to PostgreSQL for `status`, `marketSegment`, and `exchange` breakdowns.
- **Selective Column Projections**: Full model hydration is avoided by selecting only required scalar columns (`id`, `status`, `marketSegment`, `exchange`, `issueSize`, `freshIssueSize`, `ofsSize`, `issueShareCount`, `freshIssueShareCount`, `ofsShareCount`, `createdAt`).
- **Controlled Median Calculation**: Median requires sorting scalar monetary values in memory. This is performed on lightweight scalar arrays without hydrating full model objects or executing raw SQL.

### D. Explicitly Deferred Metrics (Future Phases)
- Listing gain / listing performance analytics (`listingPrice` missing from schema).
- Subscription demand analytics (category-wise QIB/NII/RII demand missing from schema).
- Advanced market prediction & predictive allotment probability.

---

## 13. Phase 30.3 — IPO Performance Analytics Specification

### A. Performance Analytics Scope
Phase 30.3 introduces `AnalyticsService.getIpoPerformanceAnalytics()`, delivering canonical performance foundation analytics derived strictly from available schema fields (`priceBandLow`, `priceBandHigh`, and `IpoLifecycleEvent` records for `CLOSE` and `LISTING` event types).

> [!IMPORTANT]
> **Listing Gain Calculation Policy**:
> If canonical listing price is absent in database records, IPOVault does **NOT** calculate listing gain/loss or synthesize listing performance metrics. Listing gain analytics remain strictly `FUTURE_DATA_DEPENDENT`.

### B. Supported vs. Unsupported Performance Data Matrix

| Performance Metric / Field | Canonical Source Field | Status | Calculation / Null Policy |
|---|---|---|---|
| **Price Band Low** | `Ipo.priceBandLow` | `SUPPORTED` | `Decimal(20, 2)` |
| **Price Band High** | `Ipo.priceBandHigh` | `SUPPORTED` | `Decimal(20, 2)` |
| **Price Band Spread (INR)** | `priceBandHigh - priceBandLow` | `SUPPORTED` | Null if either bound is missing or `high < low`. |
| **Price Band Spread (%)** | `((high - low) / low) * 100` | `SUPPORTED` | Null if `low <= 0` or bounds missing/invalid. |
| **Close Date** | `IpoLifecycleEvent.eventDate` (`CLOSE`) | `SUPPORTED` | Canonical lifecycle event date (`CLOSE`). |
| **Listing Date** | `IpoLifecycleEvent.eventDate` (`LISTING`) | `SUPPORTED` | Canonical lifecycle event date (`LISTING`). |
| **Close-to-Listing Duration** | `eventDate(LISTING) - eventDate(CLOSE)` | `SUPPORTED` | Integer calendar days. Requires both events; rejects negative durations (`listingDate < closeDate`). |
| **Final Issue Price** | *None on `Ipo` model* | `FUTURE_DATA_DEPENDENT` | Schema lacks `issuePrice`. `priceBandHigh` is NOT substituted. |
| **Listing Price** | *None on `Ipo` model* | `FUTURE_DATA_DEPENDENT` | Schema lacks `listingPrice` or `marketPrice` fields. |
| **Listing Gain Percentage** | *None* | `FUTURE_DATA_DEPENDENT` | Returns `null`. `listingPerformanceSupported: false`. |
| **Performance Classification** | *None* | `FUTURE_DATA_DEPENDENT` | Returns `null`. Classifications (Positive/Flat/Negative) are disabled. |

### C. Core Features & Capabilities

1. **Price Band Analytics (`PriceBandAnalyticsSummaryDto`)**:
   - Monetary spread evaluated in INR (`priceBandHigh - priceBandLow`).
   - Percentage spread relative to lower bound (`((high - low) / low) * 100`).
   - Summary Metrics: `averagePriceBandSpreadInr`, `medianPriceBandSpreadInr`, `minimumPriceBandSpreadInr`, `maximumPriceBandSpreadInr`, `averagePriceBandSpreadPercentage`, `medianPriceBandSpreadPercentage`.
   - Data Quality: `totalIpos`, `knownPriceBandCount`, `priceBandCoveragePercentage`.
   - Safety: `null` bounds, inverted bounds (`high < low`), or `low <= 0` return `null` for spread calculations.

2. **Listing Timeline Analytics (`ListingTimelineAnalyticsDto`)**:
   - Close-to-Listing duration evaluated in integer calendar days between canonical `CLOSE` and `LISTING` lifecycle events.
   - Summary Metrics: `averageDaysCloseToListing`, `medianDaysCloseToListing`, `minimumDaysCloseToListing`, `maximumDaysCloseToListing`.
   - Data Quality: `evaluatedIposCount`, `evaluatedTimelineCount`, `timelineCoveragePercentage`.
   - Rules: Requires both `CLOSE` and `LISTING` event dates. Excludes incomplete pairs. Never substitutes `createdAt` or observation timestamps. Rejects negative durations (`listingDate < closeDate`).

3. **Listing Performance Status (`ListingPerformanceAnalyticsSummaryDto`)**:
   - Explicitly documents `listingPerformanceSupported = false` and `knownListingPriceCount = 0`.
   - Reason: Canonical schema (`Ipo` model) currently lacks `listingPrice` and `issuePrice` columns.
   - Rule: IPOVault does NOT invent listing prices or calculate listing gain/loss until a canonical schema extension is introduced.

4. **Segment Performance Breakdown (`SegmentPerformanceAnalyticsDto`)**:
   - Segment-level performance metrics provided separately for `MAINBOARD` and `SME`.
   - Metrics: `totalIpos`, `knownPriceBandCount`, `averagePriceBandSpreadInr`, `medianPriceBandSpreadInr`, `averagePriceBandSpreadPercentage`, `medianPriceBandSpreadPercentage`, `evaluatedTimelineCount`, `averageDaysCloseToListing`, `medianDaysCloseToListing`.

5. **Period-Based Performance Trends (`IpoPerformanceTrendAnalyticsDto`)**:
   - Periodic Bucketing: `DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`.
   - Date Anchors (`AnalyticsDateAnchor`): `LISTING_DATE` (default), `OPEN_DATE`, `CLOSE_DATE`, `CREATED_AT`.
   - Point Metrics: `periodKey`, `ipoCount`, `averagePriceBandSpreadInr`, `averageDaysCloseToListing`.

6. **Date Range Filtering (`IpoPerformanceAnalyticsFilterDto`)**:
   - Parameters: `from` and `to` (ISO dates).
   - Validation: Strict date format checking and boundary validation (`from <= to`). Throws explicit error on invalid parameters.
   - Anchored Filtering: Filters matching lifecycle events when anchor is `LISTING_DATE`, `OPEN_DATE`, or `CLOSE_DATE`, or `createdAt` when anchor is `CREATED_AT`.

### D. Explicitly Deferred Metrics (Future Data Dependent)
- **`LISTING_GAIN_PERCENTAGE`**: Requires canonical `listingPrice` and `issuePrice` schema fields.
- **`LISTING_PERFORMANCE_CLASSIFICATION`**: Requires canonical `listingPrice` to classify Positive, Flat, or Negative listing outcome.
- **`ISSUE_PRICE_INR`**: Requires canonical `issuePrice` schema field.

---

## 14. Phase 30.4 — Subscription & Demand Analytics Specification

### A. Scope & Single-Source-of-Truth Principles
Phase 30.4 introduces `AnalyticsService.getSubscriptionDemandAnalytics()`, establishing the subscription and demand analytics boundary strictly aligned with canonical data model reality.

**Core Rule**: IPOVault does not fabricate subscription multiples, synthetic category demand figures, or speculative demand metrics.

> [!WARNING]
> **Domain Separation Guarantee**:
> **ALLOTMENT CHECK OBSERVATIONS ARE NOT IPO SUBSCRIPTION APPLICATIONS.**
> IPOVault does **NOT** infer subscription demand from allotment check logs (`AllotmentCheckLog`), check jobs (`AllotmentCheckJob`), job items (`AllotmentCheckJobItem`), or user saved PAN records (`UserSavedPan`). Internal check attempt logs describe user check activity, NOT market-wide subscription demand.

### B. Subscription Data Matrix

| Metric | Status | Reason / Canonical Evidence |
|---|---|---|
| **`TOTAL_SUBSCRIPTION_MULTIPLIER`** | `FUTURE_DATA_DEPENDENT` | Canonical `Ipo` schema currently lacks `totalBidsSubmitted` and `totalSharesOffered` demand fields. |
| **`CATEGORY_WISE_SUBSCRIPTION`** | `FUTURE_DATA_DEPENDENT` | Canonical schema lacks category demand breakdown tables for `QIB`, `NII`, `RETAIL`, `EMPLOYEE`, `SHAREHOLDER`, `OTHER`. |
| **`SUBSCRIPTION_BY_DAY`** | `FUTURE_DATA_DEPENDENT` | Canonical schema does not track daily subscription progression during the issue open window. |
| **`TOTAL_APPLICATION_COUNT`** | `FUTURE_DATA_DEPENDENT` | Canonical schema lacks market-wide application count tables. Allotment check records are NOT applications. |
| **`TOTAL_SUBSCRIBED_SHARES`** | `FUTURE_DATA_DEPENDENT` | Canonical schema lacks subscribed share count columns. |
| **`SUBSCRIPTION_COVERAGE`** | `SUPPORTED` (0%) | Evaluated as `knownSubscriptionCount / totalIpos * 100` (returns 0% until schema extension). |

### C. Category & Denominator Semantics
1. **Defined Categories**: `QIB` (Qualified Institutional Buyers), `NII` (Non-Institutional Investors / HNI), `RETAIL` (Retail Individual Investors), `EMPLOYEE`, `SHAREHOLDER`, `OTHER`.
2. **Category Isolation**: Categories are preserved without silent merging (e.g. NII is NOT merged with HNI, Employee is NOT merged with Retail).
3. **Denominator Rule**: Subscription multiplier formula is `totalBidsSubmitted / totalSharesOffered`. Bids and shares MUST be evaluated in `SHARES`, strictly isolated from monetary INR amounts (`issueSize`).

### D. Live vs. Final Subscription & Data Quality Rules
1. **Live vs Final Distinction**: When schema extensions introduce subscription tracking, live intraday snapshots and final official subscription figures MUST be stored with observation period timestamps and NEVER combined into a single ambiguous figure.
2. **Zero Denominator Protection**: Division by zero returns `null` (zero `NaN` or `Infinity`).
3. **Negative Bids Protection**: Negative bid quantities or multipliers return `null`.
4. **Explicit Deferral**: Returns `subscriptionSupported: false`, `knownSubscriptionCount: 0`, and explicit `unsupportedMetricReason` detailing missing canonical schema tables.

---

## 15. Phase 30.5 — Allotment Analytics Specification

### A. Core Allotment Observation Principles & Privacy Boundaries

Phase 30.5 builds a read-only Allotment Analytics domain layer composing existing Phase 28 allotment intelligence and observation semantics.

> [!IMPORTANT]
> **Observation vs Market Application Statement**:
> "Allotment analytics represent IPOVault's observed allotment-check outcomes and are NOT market-wide IPO application or allotment statistics."
>
> **Descriptive vs Predictive Statement**:
> "Observed positive allotment rate is descriptive, not predictive."

**Authoritative Semantic Rules**:
1. **`AllotmentCheckJobItem` & `AllotmentCheckLog` are observations, NOT user application records.**
2. An observation represents a checked PAN/IPO check result stream.
3. **Deduplication**: Per distinct `(ipoId, identifierHash)` using Phase 28 deduplication precedence:
   - Priority 1 (Definitive): `ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`.
   - Priority 2 (Informational/Unknown): `NOT_YET_AVAILABLE`, `APPLICATION_NOT_FOUND`, `INVALID_IDENTIFIER`, `IPO_NOT_FOUND`, `REGISTRAR_UNRESOLVED`, `REGISTRAR_UNSUPPORTED`, `UNSUPPORTED_IDENTIFIER`, `UNKNOWN`.
   - Priority 3 (Error): `SOURCE_UNAVAILABLE`, `SOURCE_RESPONSE_INVALID`, `CAPTCHA_REQUIRED`, `RATE_LIMITED`, `CONFLICTING_RESULTS`, `TEMPORARY_ERROR`.
   - Priority 1 supersedes Priority 2/3. Newer `checkedAt` (or `createdAt`) supersedes older timestamp for same priority class. Non-definitive observations NEVER override definitive results.
4. **Binary Positive Outcomes**: `ALLOTTED` and `PARTIALLY_ALLOTTED` are positive binary outcomes. `NOT_ALLOTTED` is negative. Non-definitive statuses are excluded from outcome rates.
5. **Descriptive Non-Predictive Disclaimer**: The observed allotment rate is descriptive of the checked-observation sample and is NOT a predictive probability of allotment success.
6. **Privacy Boundary**: DTOs use only `identifierHash`, `ipoId`, `checkedAt`, and `status`. Raw PANs, encrypted PANs, decrypted PANs, and user identity fields are NEVER exposed in analytics output.

### B. Core Allotment Metrics

1. **Observed Positive Allotment Rate (`OBSERVED_POSITIVE_ALLOTMENT_RATE`)**:
   - Formula: `(count(ALLOTTED) + count(PARTIALLY_ALLOTTED)) / totalDefinitiveObservations * 100`
   - Labeled explicitly as OBSERVED and DESCRIPTIVE sample statistic.

2. **Full Allotment Rate (`FULL_ALLOTMENT_RATE`)**:
   - Formula: `count(ALLOTTED) / totalDefinitiveObservations * 100`

3. **Partial Allotment Rate (`PARTIAL_ALLOTMENT_RATE`)**:
   - Formula: `count(PARTIALLY_ALLOTTED) / totalDefinitiveObservations * 100`

4. **Not Allotted Rate (`NOT_ALLOTTED_RATE`)**:
   - Formula: `count(NOT_ALLOTTED) / totalDefinitiveObservations * 100`

5. **Rate Reconciliation**:
   - `fullAllotmentRatePercentage + partialAllotmentRatePercentage + notAllottedRatePercentage = 100.00%`

6. **Observed Lot Ratio (`OBSERVED_LOT_RATIO`)**:
   - Status: `FUTURE_DATA_DEPENDENT`. Marked data-dependent because canonical observation records lack uniform lot size and applied share quantity across all check sources.

### C. Data Quality & Breakdown Matrix

1. **Data Quality Counts (`AllotmentDataQualityCountsDto`)**:
   - `totalRawObservations`: Total raw job items + check logs matching filters.
   - `deduplicatedObservationsCount`: Distinct `(ipoId, identifierHash)` count.
   - `definitiveObservationsCount`: Count with `ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`.
   - `excludedNonDefinitiveCount`: Count of non-definitive / error observations.
   - `observationCoveragePercentage`: `(definitiveObservationsCount / deduplicatedObservationsCount) * 100`.

2. **Breakdowns**:
   - **Per-IPO Analytics (`byIpoDetailed`)**: Detailed data quality and outcome distribution per IPO.
   - **Per-Segment Analytics (`bySegmentDetailed`)**: Detailed data quality and outcome distribution for `MAINBOARD` and `SME`.
   - **Time Period Trends (`trends`)**: Periodically bucketed (`DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`) anchored strictly on observation `checkedAt` timestamp.

---

## 16. Phase 30.6 — Data-Quality-Aware Analytics Specification

### A. Scope & Non-Predictive Quality Disclaimer
Phase 30.6 introduces `AnalyticsService.getAnalyticsQualitySummary()`, establishing a unified, transparent data-quality contract across all existing Phase 30 analytics capabilities (Market, Performance, Subscription, Allotment).

> [!IMPORTANT]
> **Status Distinction Guarantee**:
> "FUTURE_DATA_DEPENDENT is different from UNAVAILABLE."
> - **`FUTURE_DATA_DEPENDENT`**: The metric cannot currently be calculated because the canonical schema or source capability does not yet exist.
> - **`UNAVAILABLE`**: Capability exists in canonical schema/source, but zero usable observation records exist.
>
> **Zero Conversion Prevention Guarantee**:
> "Missing data must never be silently represented as zero."

**Mandatory Quality Principles**:
1. **Data quality telemetry describes the completeness, retrieval freshness, lineage provenance, and source health of underlying canonical records.** It is NOT an investment-quality rating, financial recommendation, or predictive score.
2. **Non-Predictive Allotment Disclaimer**: Observed allotment rates remain sample statistics of checked observations and are NOT predictive probabilities of future allotment success.
3. **No Synthetic Quality Data**: Data quality metrics consume real database signals (`FieldProvenance`, `Source`, `DiscoveryRecord`, `AllotmentCheckLog`, `AllotmentCheckJobItem`, `IpoLifecycleEvent`).
4. **Historical Event Age vs Data Staleness**: Freshness evaluates observation retrieval age relative to technical source TTL policies (24h for filing, 6h for exchange). Historical IPO records retain complete historical validity and are NEVER marked stale merely because their event occurred in the past.

### B. Quality Dimensions Matrix

| Dimension | Metrics & Sources | Quality Status Rules |
|---|---|---|
| **COMPLETENESS** | Evaluated via missing/known field coverage ratios across Market, Performance, and Allotment data. | `AVAILABLE` (100%), `PARTIAL` (<100%), `UNAVAILABLE` (0% or 0 observations). |
| **FRESHNESS** | Evaluated via `FieldProvenance.retrievedAt` retrieval age against source TTL defaults. | `FRESH` (within TTL window), `STALE` (exceeds TTL window), `UNKNOWN` (no observation timestamp). |
| **PROVENANCE** | Evaluated via `FieldProvenance` count against total core canonical fields. | `provenanceCoveragePercentage = (knownProvenance / totalFields) * 100`. |
| **SOURCE HEALTH** | Evaluated via `Source.healthStatus` (`HEALTHY`, `DEGRADED`, `FAILED`). | Triggers `SOURCE_HEALTH_DEGRADED` warning if degraded/failed sources exist. |
| **QUALITY GATE** | Evaluated via canonical readiness checks (`PASS`, `PASS_WITH_WARNINGS`, `NEEDS_REVIEW`, `INCOMPLETE`). | Triggers `NEEDS_REVIEW` overall status if quality gate review is needed. |

### C. Deterministic Quality Warning Codes

- `NO_DATA`: No observation records exist for the metric.
- `PARTIAL_DATA`: Metric data exists with partial coverage or exclusions.
- `MISSING_PRICE_BAND`: One or more IPO records lack upper/lower price band bounds.
- `MISSING_ISSUE_SIZE`: One or more IPO records lack monetary issue size.
- `MISSING_SHARE_COUNT`: One or more IPO records lack issue share count.
- `MISSING_LIFECYCLE_DATE`: One or more IPO records lack key lifecycle dates (Close/Listing).
- `SUBSCRIPTION_DATA_UNAVAILABLE`: Subscription demand analytics are `FUTURE_DATA_DEPENDENT` (canonical schema lacks demand tables).
- `LISTING_PRICE_UNAVAILABLE`: Listing price gain metrics are `FUTURE_DATA_DEPENDENT`.
- `NON_DEFINITIVE_ALLOTMENT_OBSERVATIONS`: Non-definitive or technical failure observations were excluded.
- `INVALID_OBSERVATIONS_EXCLUDED`: Invalid or contradictory observations were excluded from rate calculation.
- `STALE_DATA`: Source retrieval age exceeds technical TTL window.
- `PROVENANCE_INCOMPLETE`: Field provenance lineage records are incomplete.
- `SOURCE_HEALTH_DEGRADED`: One or more enabled data sources are in degraded or failed health status.
- `PRICE_BAND_INCOMPLETE`: Price band coverage is incomplete across evaluated IPOs.
- `LISTING_TIMELINE_INCOMPLETE`: Close-to-listing timeline duration coverage is incomplete.
- `ALLOTMENT_SAMPLE_ONLY`: Allotment rates are descriptive sample statistics of checked observations only.
- `DATA_QUALITY_WARNINGS_PRESENT`: Quality gate blockers or warnings exist across canonical IPO records.

---

## 17. Phase 30.7 — Analytics REST API Surface Specification

### A. Overview & Architecture
Phase 30.7 introduces the canonical Analytics REST API boundary under `/api/v1/analytics`.

**Key Architectural Guarantees**:
1. **Read-Only Surface**: All endpoints accept HTTP `GET` only. Zero data mutation, queueing, or database writes.
2. **Thin API Boundary**: `AnalyticsController` acts strictly as an API delegation layer with zero inline business calculations or database access.
3. **Strict Validation**: All query parameters are validated via Zod schemas (`ZodValidationPipe`), returning HTTP 400 Bad Request with standard `{ error: { code: "VALIDATION_ERROR", message: ... } }` envelope for invalid date ordering (`from > to`), invalid enums, or malformed parameters.
4. **Privacy & Security Guarantee**: Response payloads strictly use explicit serializable DTOs. Zero raw/encrypted PAN (`panEncrypted`, `panMasked`, `panHash`), credentials, secrets, or raw provider response objects are exposed.
5. **Standardized Response Wrapping**: Responses are automatically wrapped in NestJS `{ data: ... }` response envelopes by global interceptor architecture.

### B. Endpoint Catalog

| HTTP Method | Route Path | Purpose & Service Delegation | Supported Query Parameters | Primary Response DTO |
|---|---|---|---|---|
| `GET` | `/api/v1/analytics/market` | Detailed Market Analytics (`AnalyticsService.getDetailedMarketAnalytics`) | `from`, `to`, `segment`, `exchange`, `status`, `period`, `anchor` | `DetailedIpoMarketAnalyticsResponseDto` |
| `GET` | `/api/v1/analytics/performance` | Detailed Performance Analytics (`AnalyticsService.getIpoPerformanceAnalytics`) | `from`, `to`, `segment`, `exchange`, `status`, `period`, `anchor` | `DetailedIpoPerformanceAnalyticsResponseDto` |
| `GET` | `/api/v1/analytics/subscription` | Subscription Analytics (`AnalyticsService.getSubscriptionDemandAnalytics`) | `from`, `to`, `segment`, `exchange`, `status`, `period`, `anchor` | `DetailedSubscriptionDemandAnalyticsResponseDto` |
| `GET` | `/api/v1/analytics/allotment` | Allotment Observation Analytics (`AnalyticsService.getAllotmentAnalytics`) | `ipoId`, `segment`, `from`, `to`, `period` | `DetailedAllotmentAnalyticsResponseDto` |
| `GET` | `/api/v1/analytics/quality` | Unified Data Quality Telemetry (`AnalyticsService.getAnalyticsQualitySummary`) | None | `DetailedAnalyticsQualitySummaryResponseDto` |
| `GET` | `/api/v1/analytics/summary` | Lightweight Mobile Summary Snapshot (`AnalyticsService.getAnalyticsSummary`) | `segment`, `exchange` | `AnalyticsSummaryResponseDto` |
| `GET` | `/api/v1/analytics/metrics` | Metric Catalog Registry (`AnalyticsService.getMetricDefinitionsList`) | None | `AnalyticsMetricDefinitionDto[]` |
| `GET` | `/api/v1/analytics/contracts` | Metric Definitions Map (`AnalyticsService.getMetricContracts`) | None | `Record<string, MetricContract>` |

### C. Domain API Semantics & Availability

1. **Market API (`GET /api/v1/analytics/market`)**:
   - Returns market snapshot (total IPOs, active, closed, listed), status distribution, segment/exchange breakdown, issue size aggregations, and trend series.
   - Filters: Reuses `AnalyticsFilter` (`OPEN_DATE`, `CLOSE_DATE`, `LISTING_DATE`, `CREATED_AT` anchors).

2. **Performance API (`GET /api/v1/analytics/performance`)**:
   - Exposes price band spread metrics and close-to-listing timeline duration metrics.
   - Listing price performance metrics explicitly return `listingPerformanceSupported: false` with reason `"Listing price performance metrics are FUTURE_DATA_DEPENDENT."`

3. **Subscription API (`GET /api/v1/analytics/subscription`)**:
   - Explicitly returns HTTP 200 OK with `subscriptionSupported: false`, `qualityStatus: FUTURE_DATA_DEPENDENT`, `knownObservationCount: 0`, `coveragePercentage: 0`, and explicit reason `"Subscription demand metrics are FUTURE_DATA_DEPENDENT."`
   - Does NOT convert missing subscription demand into false 0% or 0x multiplier metrics.

4. **Allotment API (`GET /api/v1/analytics/allotment`)**:
   - Exposes descriptive outcome distribution rates (`observedPositiveAllotmentRatePercentage`, `fullAllotmentRatePercentage`, `partialAllotmentRatePercentage`, `notAllottedRatePercentage`).
   - Includes mandatory sample disclaimer: *"Observed allotment rates represent descriptive statistics of checked sample observations only. They MUST NOT be interpreted as predictive probabilities of future allotment success."*

5. **Quality API (`GET /api/v1/analytics/quality`)**:
   - Exposes unified data-quality telemetry across Completeness, Freshness, Provenance, Source Health, and Quality Gates.
   - Distinguishes explicitly between `COMPLETE`, `PARTIAL`, `INSUFFICIENT_DATA`, `UNAVAILABLE`, and `NEEDS_REVIEW` states.

6. **Summary API (`GET /api/v1/analytics/summary`)**:
   - Aggregates market snapshot, performance snapshot, subscription availability, allotment snapshot, and overall quality status into a single lightweight parallel execution call tailored for mobile dashboards.
   - Omits heavy trend arrays and detailed per-IPO lists to keep payload size bounded (< 2 KB).

7. **Metrics API (`GET /api/v1/analytics/metrics`)**:
   - Provides client discovery for all canonical analytics metrics, including metric ID, name, category, unit, availability status, description, and formula.

### D. Serialization & Type Contracts

- **Decimal / Monetary Serialization**: Prisma `Decimal` instances are converted to standard JavaScript numbers via `.toNumber()` or rounded string representations prior to JSON serialization, preventing `Prisma.Decimal` object serialization anomalies in client apps.
- **Date Serialization**: Timestamps and dates are formatted as ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- **Error Handling**: Malformed or out-of-bound parameters trigger `ZodValidationPipe` failures resulting in HTTP 400 Bad Request with standardized error payloads:
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Validation failed",
      "details": [...]
    }
  }
  ```
- **Security & Privacy Boundary**: All allotment calculations are computed over aggregated logs. Sensitive fields (`panEncrypted`, `panMasked`, `panHash`, `identifierHash`, raw provider payloads) are excluded from DTO contracts.
