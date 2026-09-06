# Allotment Checker Specification & Architecture

**Status:** Approved Specification  
**Version:** 1.3  
**Module:** `src/modules/allotment`  

---

## 1. Executive Overview

The **IPOVault Allotment Checker** is a modular, high-reliability backend capability designed to query, normalize, verify, and store IPO allotment results across Indian stock market registrars (KFintech, MUFG Intime, Bigshare, etc.) and stock exchanges (NSE/BSE).

### Primary Product Requirement
The user performs exactly **one action**:
1. Select an IPO from the dropdown.

IPOVault automatically orchestrates everything else:
- Resolves the registrar and registrar-specific IPO code.
- Fetches all saved PANs associated with the user's profile.
- Executes controlled concurrent allotment checks across all PANs.
- Normalizes adapter responses into unified business outcomes.
- Emits real-time progress updates (e.g. *"Checking 14 of 29..."*).
- Reports individual allotment results (`ALLOTTED`, `NOT_ALLOTTED`, `NOT_YET_AVAILABLE`).

---

## 2. Categorized Status Model Architecture

The status model formally separates outcomes into **Business Results**, **Informational Outcomes**, and **Technical System Outcomes**:

```typescript
export enum AllotmentStatus {
  // Category 1: Business Results
  ALLOTTED = 'ALLOTTED',
  PARTIALLY_ALLOTTED = 'PARTIALLY_ALLOTTED',
  NOT_ALLOTTED = 'NOT_ALLOTTED',

  // Category 2: Informational Outcomes
  NOT_YET_AVAILABLE = 'NOT_YET_AVAILABLE',
  APPLICATION_NOT_FOUND = 'APPLICATION_NOT_FOUND',
  INVALID_IDENTIFIER = 'INVALID_IDENTIFIER',
  IPO_NOT_FOUND = 'IPO_NOT_FOUND',
  REGISTRAR_UNRESOLVED = 'REGISTRAR_UNRESOLVED',
  REGISTRAR_UNSUPPORTED = 'REGISTRAR_UNSUPPORTED',
  UNSUPPORTED_IDENTIFIER = 'UNSUPPORTED_IDENTIFIER',

  // Category 3: Technical & System Outcomes
  SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE',
  SOURCE_RESPONSE_INVALID = 'SOURCE_RESPONSE_INVALID',
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  CONFLICTING_RESULTS = 'CONFLICTING_RESULTS',
  TEMPORARY_ERROR = 'TEMPORARY_ERROR',
  UNKNOWN = 'UNKNOWN',
}
```

---

## 3. Bulk Orchestration Concept & Job Lifecycle

### Job States
- `QUEUED`: Job created, awaiting execution pool assignment.
- `RUNNING`: Actively executing per-PAN checks with progress updates.
- `COMPLETED`: All PAN checks executed successfully (0 errors).
- `COMPLETED_WITH_ERRORS`: Job completed, but one or more individual PAN checks failed (allows retrying only failed checks).
- `FAILED`: Job level failure (e.g. registrar completely unreachable).
- `CANCELLED`: Job aborted by user or system.

### Concurrency Policy
- Configurable per registrar (e.g., `KFINTECH: 5`, `MUFG_INTIME: 3`).

```text
USER SELECTS IPO
       │
       ▼
1. Resolve Registrar & Registrar IPO Code
       │
       ▼
2. Load User's Saved PAN Records (In-Memory Only)
       │
       ▼
3. Create Bulk Job (State: QUEUED -> RUNNING)
       │
       ▼
4. Per-Registrar Configurable Concurrent Adapter Queries
       │
       ▼
5. Real-Time Progress Emission ("Checking 14 of 29...")
       │
       ▼
6. Response Normalization & Keyed Audit Logging
       │
       ▼
7. Return Result Set (Status: COMPLETED or COMPLETED_WITH_ERRORS)
```

---

## 4. Security & Privacy Architecture

1. **Keyed HMAC-SHA-256 Hashing:** PANs and sensitive identifiers are hashed using `crypto.createHmac('sha256', ALLOTMENT_HASH_SECRET)`.
2. **Masked Display:** Identifiers displayed in logs and responses use masking (`ABCDE****F`).
3. **No CAPTCHA Bypassing:** Anti-bot mechanisms and security controls are strictly respected.
4. **Technical Failure Insulation:** Technical errors are never converted to `NOT_ALLOTTED`.
