# Phase 28 — Allotment Intelligence Specification & Architectural Design

**Status:** Architectural Design & Discovery  
**Version:** 1.0  
**Module:** `src/modules/allotment`  

---

## 1. Executive Summary

This document establishes the architectural design and discovery findings for **Phase 28 — Allotment Intelligence**.

The objective of Phase 28 is to add read-only, user-scoped intelligence and analytical summaries on top of the existing Allotment module (bulk jobs, check logs, saved PANs, and canonical IPO terms).

Key Architectural Decisions:
- **Zero Schema Migrations in Initial Slice**: Derives intelligence purely from existing `AllotmentCheckJob`, `AllotmentCheckJobItem`, `AllotmentCheckLog`, `UserSavedPan`, and canonical `Ipo` / `Company` records.
- **Strict Privacy Isolation**: All user-level intelligence is strictly scoped to the authenticated `userId`. Sensitive PANs remain masked (`ABCDE****F`) or identified by user-defined aliases.
- **No Fake Probabilities**: Eliminates arbitrary probability estimation (e.g. "3 applications = 30% chance"). Clearly distinguishes **Observed Historical Win Rates** from external predictive models.
- **Financial & Capital Intelligence**: Computes estimated capital applied, capital utilized/allotted, and capital unblocked/refunded using canonical IPO terms (`priceBandHigh`) and observed `sharesApplied` / `sharesAllotted`.

---

## 2. Existing Allotment Architecture

The existing Allotment system (`src/modules/allotment`) is structured as follows:

```text
Registrar Web Portals (KFintech, MUFG Intime, Bigshare)
                        │
                        ▼
            Registrar Discovery Adapters
  (kfin-identity-discovery, mufg-identity-discovery)
                        │
                        ▼
              RegistrarResolver
 (maps canonical ipoId → registrar adapter + external code)
                        │
                        ▼
             AllotmentCheckJobService
 (manages bulk jobs, user saved PANs, transient RAM decryption)
                        │
                        ▼
              AllotmentRepository
 (logs checks to PostgreSQL allotment_check_logs & check_jobs)
                        │
                        ▼
               AllotmentController
    (POST /check, POST /jobs, GET /jobs/:id, POST /jobs/:id/retry)
```

---

## 3. Existing Data Model

The PostgreSQL schema contains 4 allotment-related models:

1. `UserSavedPan`:
   - `id`, `userId`, `panEncrypted`, `panMasked`, `panHash`, `name`, `createdAt`, `updatedAt`.
2. `AllotmentCheckJob`:
   - `id`, `userId`, `ipoId`, `status` (`QUEUED`, `RUNNING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED`, `CANCELLED`), `totalChecks`, `processedChecks`, `successfulChecks`, `failedChecks`, `errorMessage`, `createdAt`, `updatedAt`.
3. `AllotmentCheckJobItem`:
   - `id`, `jobId`, `identifierType`, `identifierHash`, `maskedId`, `status` (`ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`, `APPLICATION_NOT_FOUND`, etc.), `sharesApplied`, `sharesAllotted`, `latencyMs`, `errorMessage`, `checkedAt`.
4. `AllotmentCheckLog`:
   - `id`, `ipoId`, `sourceId`, `identifierType`, `identifierHash`, `maskedId`, `status`, `sharesApplied`, `sharesAllotted`, `latencyMs`, `errorMessage`, `checkedAt`.

---

## 4. Existing APIs

- `POST /api/v1/allotment/check`: Single identifier check against registrar adapter.
- `POST /api/v1/allotment/jobs`: Creates bulk check job across user's saved PANs.
- `GET /api/v1/allotment/jobs/:id`: Fetches job status and items.
- `POST /api/v1/allotment/jobs/:id/retry`: Retries failed job items.
- `GET /api/v1/allotment/sources`: Lists supported registrar adapters.

---

## 5. Existing Capabilities

- **Registrar Resolution**: Auto-discovers and resolves registrar adapter and external IPO code.
- **Bulk Execution**: Queries multiple PANs in parallel with registrar concurrency control.
- **HMAC Hashing & Masking**: Sensitive PANs are HMAC-SHA256 hashed and masked in database and logs.
- **Transient In-Memory Decryption**: Saved PANs are decrypted in RAM only for job execution.
- **Status Normalization**: Unified `AllotmentResultStatus` across Category 1 (Business Results), Category 2 (Informational Outcomes), and Category 3 (Technical Outcomes).

---

## 6. Existing Gaps

- **No User-Level Allotment Summary**: No endpoint summarizes a user's overall allotment success rate across all checked IPOs.
- **No Account/PAN Performance Breakdown**: No breakdown showing which saved PAN (e.g. "Self", "Spouse", "Parent") has higher historical win rates.
- **No Capital Utilization Analytics**: Capital applied, capital locked, and capital refunded are not aggregated for bulk jobs or historical checks.
- **No Job Intelligence Summary**: Job responses return flat item lists without multi-account allotment summaries.

---

## 7. Candidate Intelligence Features & Classification

| Candidate Feature | Description | Classification |
|---|---|---|
| **1. User Allotment Summary** | Aggregate historical win rate, total checks, allotted vs not allotted counts for authenticated user | **READY NOW** |
| **2. PAN-Level Win Rates** | Win rate and allotment history broken down by saved PAN alias/masked ID | **READY NOW** |
| **3. Job Outcome Summary** | Multi-account summary attached to bulk check jobs (total shares applied, total shares allotted, success rate) | **READY NOW** |
| **4. Capital Utilization** | Estimated capital applied, capital utilized/allotted, and capital unblocked/refunded | **READY NOW** |
| **5. IPO Allotment Statistics** | Aggregate allotment statistics across all users for an IPO | **REQUIRES NEW DATA MODEL** (requires global anonymous aggregation rules) |
| **6. Subscription vs Allotment** | Comparing category subscription (RII/NII) against user outcome | **REQUIRES EXTERNAL DATA** (subscription data not in DB) |
| **7. Predictive Allotment Probability** | Machine learning or statistical probability prediction | **NOT JUSTIFIED YET** (lacks statistical population sample) |

---

## 8. Probability & Prediction Boundary

- **Strict Principle**: Never generate fake or unverified allotment probabilities (e.g., "3 applications = 30% chance").
- **Observed Historical Statistics Only**: The system will report *observed historical statistics* (e.g., "Observed Allotment Rate: 25% across 12 completed checks").
- **Clear Labeling**: All statistical metrics must be explicitly labeled as historical observations, not future predictions.

---

## 9. Capital Intelligence Feasibility

Capital metrics are fully feasible using canonical IPO terms (`priceBandHigh`) combined with `sharesApplied` and `sharesAllotted`:

1. **Estimated Capital Applied**:
   $$\text{Capital Applied} = \sum (\text{sharesApplied} \times \text{priceBandHigh})$$
2. **Estimated Capital Utilized (Allotted)**:
   $$\text{Capital Utilized} = \sum (\text{sharesAllotted} \times \text{priceBandHigh})$$
3. **Estimated Capital Unblocked (Refunded)**:
   $$\text{Capital Refunded} = \text{Capital Applied} - \text{Capital Utilized}$$

---

## 10. Privacy & Security Boundaries

- **User Scoping**: All intelligence endpoints require authentication (`userId`) and operate strictly on data owned by that user.
- **Masking & Aliasing**: Raw PANs are never returned in responses. PANs are represented by user-assigned aliases (`UserSavedPan.name`) or masked strings (`panMasked`).
- **Isolation**: User A can never query or view User B's allotment intelligence or saved PAN history.

---

## 11. Recommended Phase 28 First Slice

Implement two read-only endpoints:

1. **GET /api/v1/allotment/intelligence/summary** (User-Scoped Overall Allotment Summary)
   - Aggregates overall allotment history, win rate, capital utilization, and per-PAN statistics for the authenticated user.

2. **GET /api/v1/allotment/jobs/:id/intelligence** (Bulk Job Outcome & Capital Summary)
   - Aggregates multi-account allotment outcomes, total shares applied/allotted, and capital utilization for a specific completed job.

---

## 12. Proposed API Contract

### A. GET /api/v1/allotment/intelligence/summary

**Response Header**: `x-user-id: <user_uuid>`

**Response Payload**:
```json
{
  "data": {
    "userId": "usr-123",
    "summary": {
      "totalJobsExecuted": 15,
      "totalChecksCount": 42,
      "allottedCount": 8,
      "partiallyAllottedCount": 0,
      "notAllottedCount": 30,
      "pendingOrUnknownCount": 4,
      "observedWinRatePercentage": "21.05",
      "totalEstimatedCapitalApplied": "630000.00",
      "totalEstimatedCapitalUtilized": "120000.00",
      "totalEstimatedCapitalRefunded": "510000.00"
    },
    "panBreakdown": [
      {
        "savedPanId": "span-1",
        "name": "Self",
        "maskedPan": "ABCDE****F",
        "totalChecks": 15,
        "allottedCount": 4,
        "notAllottedCount": 11,
        "observedWinRatePercentage": "26.67"
      }
    ],
    "evaluatedAt": "2026-09-10T10:33:00.000Z"
  }
}
```

### B. GET /api/v1/allotment/jobs/:id/intelligence

**Response Payload**:
```json
{
  "data": {
    "jobId": "job-456",
    "ipoId": "ipo-789",
    "status": "COMPLETED",
    "summary": {
      "totalAccountsChecked": 3,
      "allottedAccountsCount": 1,
      "notAllottedAccountsCount": 2,
      "totalSharesApplied": 300,
      "totalSharesAllotted": 100,
      "estimatedCapitalApplied": "45000.00",
      "estimatedCapitalUtilized": "15000.00",
      "estimatedCapitalRefunded": "30000.00"
    },
    "evaluatedAt": "2026-09-10T10:33:00.000Z"
  }
}
```

---

## 13. Query & Performance Strategy

- **Single Bounded Database Query**: Queries `AllotmentCheckJob` and `AllotmentCheckJobItem` filtered by `userId` (indexed via `@@index([userId])`).
- **In-Memory Aggregation**: Aggregates win rates, capital amounts, and per-PAN breakdowns in TypeScript without raw SQL loops.
- **Zero External Calls**: No network calls to registrar web portals.

---

## 14. Database Impact

- **Zero Schema Migrations**: Phase 28 initial slice operates 100% on existing database schema and indexes (`AllotmentCheckJob`, `AllotmentCheckJobItem`, `UserSavedPan`, `Ipo`).

---

## 15. Dependencies

- **Hard Dependencies**:
  - Phase 26 (IPO Comparison & DTOs) — Completed
  - Phase 27 (IPO Analytics & Decimal Math) — Completed
  - Allotment Module (`AllotmentJobService`, `UserSavedPan`) — Completed
- **Optional Future Enhancements**:
  - External subscription data feed (for Subscription vs Allotment comparison)

---

## 16. Explicit Non-Goals

- No automated scraping of external subscription portals.
- No machine-learning probability prediction models.
- No schema migrations in this slice.
- No modification to existing registrar adapters or scraper logic.

---

## 17. Future Phase 28.x Opportunities

- **Subscription Ratio Comparison**: Integrate live category subscription (RII/NII) to compare user win rate against category subscription level.
- **Multi-Cycle Allotment Trends**: Historical month-over-month allotment trends for user portfolios.

---

## 18. Implemented First Slice

The Phase 28.1 implementation slice delivers user-scoped allotment intelligence without schema migrations or external dependencies:

### A. Endpoints

1. **`GET /api/v1/allotment/intelligence/summary`**
   - **Auth**: Required (`x-user-id` header).
   - **Scope**: User-bound strictly to the authenticated `userId`.
   - **Response**: Aggregated summary metrics (`totalJobs`, `totalChecks`, `completedChecks`, `allottedChecks`, `notAllottedChecks`, `failedChecks`, `unknownChecks`, `observedAllotmentRate`), indicative capital values (`indicativeAppliedValue`, `indicativeAllottedValue`), and `panBreakdown` array.

2. **`GET /api/v1/allotment/jobs/:id/intelligence`**
   - **Auth**: Required (`x-user-id` header).
   - **Ownership Guard**: Strict ownership check verifying job belongs to authenticated user. Returns 404 (NOT_FOUND) for non-owned jobs to prevent enumeration.
   - **Response**: Job-level metrics (`jobId`, `ipoId`, `status`), job `summary`, indicative `capital`, `accounts` breakdown (with `panId`, `alias`, `maskedPan`, `status`, `sharesApplied`, `sharesAllotted`, `indicativeAppliedValue`, `indicativeAllottedValue`), and `evaluatedAt`.

### B. Observed Allotment Rate Definition

$$\text{observedAllotmentRate} = \frac{\text{allottedChecks}}{\text{allottedChecks} + \text{notAllottedChecks}} \times 100$$

- **Denominator Boundary**: Denominator is strictly eligible completed outcome checks (`allottedChecks` + `notAllottedChecks`).
- **Exclusions**: `FAILED` and `UNKNOWN` outcomes are excluded from the denominator.
- **Zero Denominator Handling**: When no eligible completed checks exist, `observedAllotmentRate` returns `null` (not a false `"0.00"`).

### C. Indicative Capital Value Semantics

- **Explicit Labeling**: Capital metrics are explicitly named `indicativeAppliedValue` and `indicativeAllottedValue` calculated at the upper price band (`priceBandHigh`).
- **Calculation Rules**:
  $$\text{indicativeAppliedValue} = \text{sharesApplied} \times \text{priceBandHigh}$$
  $$\text{indicativeAllottedValue} = \text{sharesAllotted} \times \text{priceBandHigh}$$
- **Decimal Arithmetic**: Formatted to 2 decimal places using `Prisma.Decimal`.
- **Missing Price**: Returns `null` if canonical price reference (`priceBandHigh`) is unavailable.

### D. Status Mapping

- `ALLOTTED`: `ALLOTTED`, `PARTIALLY_ALLOTTED`.
- `NOT_ALLOTTED`: `NOT_ALLOTTED`.
- `FAILED`: `SOURCE_UNAVAILABLE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `NETWORK_ERROR`, `REGISTRAR_ERROR`, `TIMEOUT`.
- `UNKNOWN`: `NOT_YET_AVAILABLE`, `APPLICATION_NOT_FOUND`, `INVALID_IDENTIFIER`, `IPO_NOT_FOUND`, `REGISTRAR_UNRESOLVED`, `REGISTRAR_UNSUPPORTED`, `NOT_APPLIED`, `NOT_CHECKED`, `TEMPORARY_ERROR`.

### E. Privacy & Performance Safeguards

- **No Raw PAN**: Plaintext PANs are never exposed. Saved PANs are represented by user alias or `panMasked` (`ABCDE****F`).
- **Zero N+1 Queries**: Single bounded job/item fetch and batched IPO/PAN queries.

