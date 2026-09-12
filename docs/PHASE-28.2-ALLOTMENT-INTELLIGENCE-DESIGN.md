# Phase 28.2 — Advanced Allotment Intelligence Discovery & Architectural Design

**Status:** Architectural Design & Discovery  
**Version:** 1.1 (Refined Domain Validation)  
**Module:** `src/modules/allotment`  

---

## 1. Executive Summary

This document establishes the architectural discovery and design specification for **Phase 28.2 — Advanced Allotment Intelligence**.

Phase 28.1 successfully delivered raw, user-scoped allotment check statistics (`GET /api/v1/allotment/intelligence/summary`) and job-level outcome intelligence (`GET /api/v1/allotment/jobs/:id/intelligence`).

The objective of Phase 28.2 is to transition from **raw check job counts** to **deduplicated latest-observation allotment intelligence** and **IPO-specific user outcome analytics**, addressing data inflation risks caused by repeated bulk check job executions.

Key Architectural Principles for Phase 28.2:
- **Check vs. Application Domain Boundary**: Explicitly acknowledges that an `AllotmentCheckJobItem` represents an allotment-check attempt (not a canonical bank/broker application record). Application cannot be treated as a canonical database entity without a `UserIpoApplication` model.
- **Deduplicated Observation Engine**: Deduplicates observations by grouping by `(ipoId, identifierHash)` and selecting the latest definitive result per unique `(IPO, PAN)` pair.
- **Zero Schema Migrations**: Operates 100% on existing database schema (`AllotmentCheckJob`, `AllotmentCheckJobItem`, `UserSavedPan`, `Ipo`).
- **Statistically Honest Metrics**: Reports **Observed Latest-Result Rate** across distinct checked `(IPO, PAN)` pairs, without predictive language.
- **Strict User Privacy Isolation**: Endpoints are strictly authenticated and user-scoped. Raw PANs remain masked (`ABCDE****F`).

---

## 2. Current Available Data

The IPOVault backend currently retains the following authoritative data models in PostgreSQL:

1. `AllotmentCheckJob`:
   - Attributes: `id`, `userId`, `ipoId`, `status`, `totalChecks`, `processedChecks`, `successfulChecks`, `failedChecks`, `errorMessage`, `createdAt`, `updatedAt`.
   - Index: `@@index([userId])`, `@@index([ipoId])`.

2. `AllotmentCheckJobItem`:
   - Attributes: `id`, `jobId`, `identifierType`, `identifierHash`, `maskedId`, `status`, `sharesApplied`, `sharesAllotted`, `latencyMs`, `errorMessage`, `checkedAt`.
   - Index: `@@index([jobId])`, `@@index([identifierHash])`.

3. `UserSavedPan`:
   - Attributes: `id`, `userId`, `panEncrypted`, `panMasked`, `panHash`, `name`, `createdAt`, `updatedAt`.
   - Index: `@@index([userId])`, `@@index([panHash])`.

4. `Ipo` & `Company`:
   - Canonical IPO metadata (`priceBandHigh`, `lotSize`, `symbol`, `companyId`).

5. `AllotmentCheckLog`:
   - System-wide check attempt log (not user-scoped; explicitly excluded from user intelligence).

---

## 3. Check vs Application Domain Boundary

A critical domain distinction exists between a **Check Attempt** and an **Application Entity**:

| Concept | Domain Meaning | Underlying Model | Canonical Entity? |
|---|---|---|---|
| **Check Attempt** | An execution of an allotment query against a registrar portal. | `AllotmentCheckJobItem` | YES (`AllotmentCheckJobItem`) |
| **Observed Outcome Pair** | The latest observed result for a distinct `(IPO, PAN)` pair. | Derived from `(ipoId, identifierHash)` latest item | Derived in-memory |
| **Application Entity** | An explicit record of a submitted bid (ASBA/UPI block, bid qty). | **None** (No `UserIpoApplication` model) | **NO** |

### Domain Conclusion:
Because the schema contains no `UserIpoApplication` table, **"Application" cannot be treated as a canonical entity**. The system records *allotment verification observations*. Deduplication over `(ipoId, identifierHash)` represents the **latest observed allotment status per unique PAN/IPO pair**.

---

## 4. Historical User Analytics Feasibility

With deduplication by `(ipoId, identifierHash)`, the following user-level historical analytics are fully feasible:

- **Total Unique IPOs Checked**: Count of distinct `ipoId` values checked by the user.
- **Total Unique PAN/IPO Pairs**: Count of distinct `(ipoId, identifierHash)` pairs checked.
- **Distinct Allotted Pairs**: Count of unique `(ipoId, identifierHash)` pairs where latest status is `ALLOTTED` or `PARTIALLY_ALLOTTED`.
- **Distinct Not Allotted Pairs**: Count of unique `(ipoId, identifierHash)` pairs where latest status is `NOT_ALLOTTED`.
- **Observed Latest-Result Rate**:
  $$\text{Observed Latest-Result Rate} = \frac{\text{distinctAllottedPairs}}{\text{distinctAllottedPairs} + \text{distinctNotAllottedPairs}} \times 100$$
- **Deduplicated Indicative Capital Applied**: Sum of `latest.sharesApplied × priceBandHigh` across unique `(ipoId, identifierHash)` pairs.
- **Deduplicated Indicative Capital Allotted**: Sum of `latest.sharesAllotted × priceBandHigh` across unique `(ipoId, identifierHash)` pairs.

---

## 5. Per-PAN Analytics Feasibility

Per-PAN historical analytics are fully feasible by grouping deduplicated `(ipoId, identifierHash)` pairs by `identifierHash` and linking to `UserSavedPan`:

- **Unique IPOs Checked Per PAN**: Count of distinct IPOs checked under that saved PAN.
- **Allotted vs Not Allotted Count Per PAN**: Deduplicated outcome counts for that account.
- **Per-PAN Observed Rate**: Historical allotment success percentage for that specific family member / account alias.
- **Indicative Capital Allotted Per PAN**: Total upper-price-band value of shares won by that specific PAN across all checked IPOs.

---

## 6. IPO-Specific Analytics Feasibility

User-scoped IPO-specific history (`GET /api/v1/allotment/ipos/:id/intelligence`) is fully feasible:

- Returns a user's multi-account allotment history for a specific canonical IPO.
- Lists all saved PANs checked for that IPO, their latest observed allotment status, shares applied, shares allotted, and indicative capital.
- Overall IPO outcome status for the user (`ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`, `UNKNOWN`).

---

## 7. Capital / Quantity Analytics

Current data supports indicative capital and lot calculations at the upper price band (`priceBandHigh`) and lot size (`lotSize`):

- **Applied Lots**: $\text{sharesApplied} / \text{lotSize}$
- **Allotted Lots**: $\text{sharesAllotted} / \text{lotSize}$
- **Indicative Capital Applied**: $\text{sharesApplied} \times \text{priceBandHigh}$
- **Indicative Capital Allotted**: $\text{sharesAllotted} \times \text{priceBandHigh}$

**Explicit Limitation**: These metrics are strictly labeled as **INDICATIVE UPPER-PRICE-BAND VALUES**. The database does not record actual bank account balances, UPI block requests, or ASBA unblock refunds.

---

## 8. Repeated-Check / Deduplication Analysis

### Problem Statement:
Because `AllotmentCheckJob` records are created whenever a user clicks "Check Allotment" or schedules a bulk check, a user may have 10 jobs for 1 IPO. Without deduplication:
- 10 check items for PAN A showing `NOT_ALLOTTED` = 10 `notAllottedChecks`.
- 10 check items for PAN B showing `ALLOTTED` = 10 `allottedChecks`.
- Raw rate = $10 / 20 = 50\%$.
- Applied capital = $10 \times \text{appliedValue}$ (inflated by 10x!).

### Solution (Deduplication Algorithm):
1. Load all jobs and items for the authenticated `userId`.
2. Group items by key `(ipoId, identifierHash)`.
3. For each group, select the item with the latest `checkedAt` date (preferring Category 1 definitive statuses `ALLOTTED` / `PARTIALLY_ALLOTTED` / `NOT_ALLOTTED` over `UNKNOWN` or `FAILED`).
4. Perform win rate, capital, and per-PAN aggregation on the resulting deduplicated map.

---

## 9. Treatment of Partial Allotment (`PARTIALLY_ALLOTTED`)

- **Binary Outcome Metric**: `PARTIALLY_ALLOTTED` is counted as a successful allotment (i.e. shares allotted > 0) alongside `ALLOTTED` in binary win-rate calculations.
- **Detailed Summary Breakdown**: `summary` object tracks `partiallyAllottedCount` distinctly.
- **Quantity & Capital Math**: Uses actual `sharesAllotted` returned by the registrar (e.g. 50 shares allotted out of 100 applied).

---

## 10. Statistical Validity & Terminology Discipline

- **Metric Name**: Explicitly named **Observed Latest-Result Rate** across distinct checked PAN/IPO pairs.
- **No Streaks & Consecutive Outcomes**: Calculating "allotment win streaks" (e.g. "3 wins in a row") is **not recommended** because Indian IPO allotments are independent random lotteries per IPO category. Presenting streaks creates false perceptions of luck or gambling patterns.
- **Denominator Discipline**: Excluding technical failures (`FAILED`) and non-application/unprocessed statuses (`UNKNOWN`) ensures that the observed win rate is mathematically sound.

---

## 11. Subscription-Data Availability

- **Repository Audit Result**: A complete codebase search for `subscription`, `times_subscribed`, `qib`, `nii`, `rii` revealed **zero** existing subscription schema tables or adapters.
- **Finding**: Subscription-vs-allotment analytics (e.g., comparing user win rate against retail category subscription X-times) **strictly REQUIRES EXTERNAL DATA** from a future subscription scraping or data feed adapter.

---

## 12. Probability-Model Feasibility

- **Feasibility Assessment**: **NOT JUSTIFIED YET**.
- **Rationale**: Predicting future allotment probability requires:
  1. Category-level subscription ratios (RII, NII, HNI, Employee).
  2. Total issue quota and lot allocation rules.
  3. Population-level application counts across all Indian investors.
- **Decision**: IPOVault will strictly output **Observed Historical Statistics** and explicitly disclaim predictive probability modeling.

---

## 13. Candidate Feature Classification

| Candidate Feature | Description | Classification |
|---|---|---|
| **1. Deduplicated Historical User History** | Aggregate outcome rate, deduplicated capital, and IPO list | **READY NOW** |
| **2. Deduplicated Per-PAN Breakdown** | Outcome rate and capital allotted grouped by saved PAN alias | **READY NOW** |
| **3. IPO-Specific User History** | Multi-account summary for a specific canonical IPO (`/ipos/:id/intelligence`) | **READY NOW** |
| **4. Applied vs Allotted Lot Analytics** | Lots applied, lots won, lot utilization ratio | **READY NOW** |
| **5. Historical Win Streaks** | Consecutive win/loss counting | **NOT JUSTIFIED YET** (statistically misleading) |
| **6. Global IPO Allotment Statistics** | Aggregate win rates across all IPOVault users for an IPO | **REQUIRES NEW DATA MODEL** (needs anonymized aggregation table) |
| **7. Subscription-vs-Allotment Analytics** | Win rate compared against category subscription ratio | **REQUIRES EXTERNAL DATA** (no subscription feed) |
| **8. Predictive Allotment Model** | AI / statistical future win probability prediction | **NOT JUSTIFIED YET** (lacks population data) |

---

## 14. Recommended Phase 28.2 Slice

**Implement Deduplicated Allotment History & IPO Performance APIs:**

1. **`GET /api/v1/allotment/intelligence/history`**
   - User-level deduplicated historical allotment summary across all participated IPOs.
   - Provides unique IPO count, unique PAN/IPO pair count, deduplicated win rate, deduplicated upper-price-band capital applied/allotted, per-PAN performance, and historical IPO timeline.

2. **`GET /api/v1/allotment/ipos/:id/intelligence`**
   - IPO-specific user allotment history.
   - Summarizes all saved accounts checked for that specific canonical IPO, applied vs allotted lots, and indicative capital.

---

## 15. Proposed API Specifications

### A. GET /api/v1/allotment/intelligence/history

**Auth**: Required (`x-user-id` header).

**Response Payload**:
```json
{
  "data": {
    "summary": {
      "totalUniqueIpos": 5,
      "totalDistinctPanIpoPairs": 12,
      "allottedPairs": 3,
      "notAllottedPairs": 8,
      "unknownOrPendingPairs": 1,
      "observedLatestResultRate": "27.27",
      "totalLotsApplied": 12,
      "totalLotsAllotted": 3
    },
    "capital": {
      "indicativeAppliedValue": "180000.00",
      "indicativeAllottedValue": "45000.00"
    },
    "panBreakdown": [
      {
        "panId": "span-1",
        "alias": "Primary Account",
        "maskedPan": "ABCDE****F",
        "totalIposChecked": 5,
        "allottedPairs": 2,
        "notAllottedPairs": 3,
        "observedLatestResultRate": "40.00",
        "indicativeAllottedValue": "30000.00"
      }
    ],
    "ipoHistory": [
      {
        "ipoId": "ipo-101",
        "symbol": "ZOMATO",
        "companyName": "Zomato Limited",
        "evaluatedAt": "2026-09-10T10:00:00.000Z",
        "overallOutcome": "ALLOTTED",
        "totalAccountsChecked": 2,
        "allottedAccounts": 1,
        "indicativeAppliedValue": "30000.00",
        "indicativeAllottedValue": "15000.00"
      }
    ],
    "evaluatedAt": "2026-09-10T10:52:00.000Z"
  }
}
```

### B. GET /api/v1/allotment/ipos/:id/intelligence

**Auth**: Required (`x-user-id` header).

**Response Payload**:
```json
{
  "data": {
    "ipoId": "ipo-101",
    "symbol": "ZOMATO",
    "companyName": "Zomato Limited",
    "priceBandHigh": "150.00",
    "lotSize": 100,
    "userSummary": {
      "totalAccountsChecked": 2,
      "allottedAccounts": 1,
      "notAllottedAccounts": 1,
      "overallOutcome": "PARTIALLY_ALLOTTED",
      "totalSharesApplied": 200,
      "totalSharesAllotted": 100,
      "totalLotsApplied": 2,
      "totalLotsAllotted": 1,
      "indicativeAppliedValue": "30000.00",
      "indicativeAllottedValue": "15000.00"
    },
    "accounts": [
      {
        "panId": "span-1",
        "alias": "Primary Account",
        "maskedPan": "ABCDE****F",
        "status": "ALLOTTED",
        "sharesApplied": 100,
        "sharesAllotted": 100,
        "lotsApplied": 1,
        "lotsAllotted": 1,
        "indicativeAppliedValue": "15000.00",
        "indicativeAllottedValue": "15000.00"
      }
    ],
    "evaluatedAt": "2026-09-10T10:52:00.000Z"
  }
}
```

---

## 16. Query & Performance Strategy

1. **Deduplicated Summary Query**:
   - `findUserJobsWithItems(userId)` with `take: 100` orders jobs by `createdAt: desc`.
   - In-memory Map keyed by `${item.job.ipoId}:${item.identifierHash}` picks the latest check item for each distinct PAN-IPO combination.
   - Zero N+1: Executes bounded batch queries for IPO metadata and saved PANs.

2. **IPO-Specific Query**:
   - Fetches all user jobs for the target `ipoId` using `where: { userId, ipoId }`.
   - Deduplicates items per `identifierHash` in memory.
   - Fetches canonical IPO metadata (`priceBandHigh`, `lotSize`, `companyName`, `symbol`).

---

## 17. Privacy & Security

- **Strict User Scoping**: All queries filter by authenticated `userId`.
- **Zero Raw PAN**: Plaintext PANs are never exposed. Masked PAN format (`ABCDE****F`) is strictly enforced.
- **Cross-User Protection**: Attempts to access an IPO or history for another user return empty results or 404 NOT_FOUND.

---

## 18. Schema Impact

- **Zero Schema Migrations**: Phase 28.2 uses 100% existing tables (`AllotmentCheckJob`, `AllotmentCheckJobItem`, `UserSavedPan`, `Ipo`, `Company`).

---

## 19. Explicit Non-Goals

- No machine learning allotment prediction.
- No database schema migrations.
- No external subscription scraping.
- No streak or "luck" score calculations.

---

## 20. Future Opportunities

- **Phase 28.3**: External Subscription Data Integration & Category Win-Rate Benchmarking.
- **Phase 28.4**: Anonymized Global IPO Allotment Analytics (Requires new database models).
