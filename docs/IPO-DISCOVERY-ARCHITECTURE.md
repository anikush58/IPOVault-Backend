# IPO Discovery Architecture

## Purpose

Define how IPO information enters IPOVault, is validated, normalized, deduplicated, persisted, and exposed to the application.

The central principle is:

> External sources provide evidence. IPOVault creates the canonical data model.

---

## 1. High-Level Architecture

```text
                    EXTERNAL SOURCES
       ┌──────────────┬──────────────┬──────────────┐
       │              │              │              │
      SEBI           NSE            BSE         Company
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                              ↓
                       SOURCE ADAPTERS
                              ↓
                       RAW INGESTION
                              ↓
                    DISCOVERY RECORDS
                              ↓
                    PARSE + NORMALIZE
                              ↓
                       VALIDATION
                              ↓
                 COMPANY / IPO MATCHING
                              ↓
                       DEDUPLICATION
                              ↓
                    CANONICALIZATION
                              ↓
                    FIELD PROVENANCE
                              ↓
                      CHANGE DETECTION
                              ↓
                         DATABASE
                              ↓
                            API
                              ↓
                        MOBILE APP
```

---

## 2. Source Adapter Contract

Every source should implement the same conceptual contract:

```text
SourceAdapter
├── discover()
├── fetch()
├── parse()
├── normalize()
└── validate()
```

The adapter must not directly mutate canonical IPO records.

It should produce a normalized discovery object.

```text
DiscoveredIPO
├── company identity
├── IPO identity
├── IPO attributes
├── lifecycle dates
├── source reference
└── confidence
```

---

## 3. Ingestion Pipeline

### Step 1 — Discover

Find potentially new or changed IPO information.

### Step 2 — Persist raw evidence

Save the raw response before parsing.

This is mandatory.

### Step 3 — Parse

Convert source-specific structures into structured values.

### Step 4 — Normalize

Normalize:

- company names
- dates
- currency values
- exchange names
- market segment
- identifiers
- status

### Step 5 — Validate

Check:

- required fields
- data types
- valid date relationships
- valid price bands
- positive quantities
- plausible issue size
- known market segment

### Step 6 — Match

Find the corresponding canonical Company and IPO.

### Step 7 — Deduplicate

Determine whether this is:

- a new IPO
- an existing IPO
- a duplicate observation
- an ambiguous record

### Step 8 — Canonicalize

Write approved information to the canonical database.

### Step 9 — Record provenance

Record where each important value came from.

### Step 10 — Detect changes

Compare canonical values with newly observed values and create change events.

---

## 4. Discovery Object

All adapters should converge to a common structure.

```json
{
  "company": {
    "legalName": "...",
    "cin": "...",
    "isin": "..."
  },
  "ipo": {
    "marketSegment": "MAINBOARD",
    "exchange": "NSE",
    "issueSize": 12500000000,
    "priceBandLow": 120,
    "priceBandHigh": 126,
    "lotSize": 120
  },
  "lifecycle": {
    "openDate": "2026-09-10",
    "closeDate": "2026-09-12"
  },
  "source": {
    "sourceId": "nse",
    "reference": "..."
  }
}
```

The exact implementation language/type should follow the project's existing backend stack.

---

## 5. Idempotency

Running the same discovery job twice must not create duplicate records.

Use:

```text
source_id + external_id
```

where an external identifier exists.

Otherwise use a deterministic content hash plus source context.

Canonicalization must also be idempotent.

---

## 6. Company Matching

Use strong identifiers first:

```text
CIN
↓
ISIN
↓
Official/exchange identifier
↓
Normalized legal name + supporting attributes
↓
Fuzzy match for review only
```

Recommended confidence bands:

```text
HIGH
→ automatic match

MEDIUM
→ manual review

LOW
→ do not merge automatically
```

---

## 7. IPO Matching

IPO matching must distinguish between:

- company identity
- IPO event
- exchange listing
- source observation

Multiple sources may describe the same IPO.

The canonical model should contain one IPO event with multiple source observations.

---

## 8. Source Priority

Source priority is field-dependent.

Do not assume one source is authoritative for every field.

Example policy:

```text
Legal company identity
→ official filings / exchange

IPO dates
→ exchange / official issue documents

Price band
→ official issue documents / exchange

Lot size
→ official issue documents / exchange

Allotment information
→ registrar / exchange

GMP
→ secondary market sources only
```

The source registry defines the implementation-level priority.

---

## 9. Conflict Resolution

If two sources disagree:

```text
Source A → ₹126
Source B → ₹126
Source C → ₹125
```

The system should:

1. Preserve all observations.
2. Determine field authority.
3. Select canonical value.
4. Record the selected provenance.
5. Optionally create a conflict/review record.

Never silently discard conflicting observations.

---

## 10. Change Detection

For every canonical field update:

```text
old value
     ↓
new observation
     ↓
same?
 ┌───┴───┐
YES     NO
 │       │
 │   create change event
 │       │
 └───────┘
```

Change detection must happen after normalization so formatting differences do not generate false changes.

Example:

```text
"₹126"
126
"126.00"
```

should normalize to the same numeric value.

---

## 11. Failure Handling

A source failure must not affect existing canonical data.

If fetching fails:

```text
source status = FAILED
job status = ERROR
existing IPO data = UNCHANGED
```

Use retries with bounded backoff.

Do not repeatedly hammer an unavailable source.

---

## 12. Scheduling

Use separate job categories.

```text
DISCOVERY
→ find new IPOs

REFRESH
→ update known IPO metadata

ACTIVE_IPO_REFRESH
→ more frequent updates while an IPO is open

LISTING_REFRESH
→ updates around allotment/listing

HEALTH_CHECK
→ source availability and parser health
```

Exact frequency should be configurable per source and respect source access rules.

---

## 13. Admin Review

Ambiguous or conflicting records should enter a review queue.

```text
DISCOVERY REVIEW

ABC Technologies

Potential match:
ABC Technologies Limited

Confidence:
96%

Sources:
✓ NSE
✓ BSE
✓ Company

Actions:
[Approve Match]
[Create New Company]
[Reject]
```

Automation should increase over time as matching confidence becomes reliable.

---

## 14. API Boundary

The mobile app must consume canonical API responses.

It should not know:

- which source was scraped
- how parsing works
- source-specific HTML
- source-specific JSON formats
- retry logic

Suggested endpoints:

```text
GET /ipos
GET /ipos/upcoming
GET /ipos/open
GET /ipos/closed
GET /ipos/listing-soon
GET /ipos/:id
GET /ipos/:id/timeline
GET /ipos/:id/sources
```

Admin endpoints should remain separate.

---

## 15. Observability

Track:

```text
source fetch success rate
source latency
parser failures
records discovered
records matched
records created
duplicates detected
manual reviews
field conflicts
canonical changes
```

A discovery system without observability becomes difficult to trust.

---

## 16. First Vertical Slice

Do not implement all sources simultaneously.

Build:

```text
ONE SOURCE
   ↓
RAW DISCOVERY
   ↓
NORMALIZATION
   ↓
VALIDATION
   ↓
COMPANY MATCHING
   ↓
IPO CREATION
   ↓
PROVENANCE
   ↓
API
   ↓
IPO LIST
   ↓
IPO DETAIL
```

Once this is stable, add the next source.

---

## 17. Definition of Done

Discovery is complete for the first milestone when:

- A source can be queried.
- Raw evidence is persisted.
- Data is normalized.
- Invalid records are rejected safely.
- Existing companies can be matched.
- Duplicate IPO observations do not create duplicate IPOs.
- Canonical fields have provenance.
- Changes are detected.
- Re-running the job is safe.
- Source failure does not corrupt existing data.
- Admins can inspect ambiguous records.
- The mobile API exposes canonical IPO data.
