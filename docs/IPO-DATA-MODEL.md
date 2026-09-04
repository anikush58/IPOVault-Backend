# IPO Data Model

## Purpose

This document defines the canonical data model for IPOVault's Indian IPO discovery and lifecycle system.

The model separates:
- Company identity
- IPO events
- IPO lifecycle dates
- External sources
- Raw discovery evidence
- Field-level provenance
- Detected changes

The database should be the canonical source for the application. External websites and feeds are inputs, not the application's data model.

---

## 1. Design Principles

1. A **Company** is not an IPO.
2. An **IPO** is an event associated with a Company.
3. Raw external data must be retained before normalization.
4. Important canonical fields must retain source provenance.
5. Discovery must be idempotent.
6. Duplicate sources must map to one canonical IPO where they represent the same event.
7. Historical values must not be silently destroyed.
8. Source failures must never erase valid existing data.
9. Dates, INR amounts, and share quantities must use strongly typed database fields. Never store share counts in INR amount columns, or rupee amounts in share-count columns.
10. Exchange/source identifiers must be stored separately from internal IDs.

---

## 2. Core Entity Relationship

```text
Company
   │
   └──< IPO
          │
          ├──< IPO Date / Lifecycle Events
          ├──< IPO Source Identity
          ├──< Subscription Snapshot
          ├──< Field Provenance
          └──< IPO Change Event

Source
   │
   └──< Discovery Record
             │
             └──→ Company / IPO after matching and validation
```

---

## 3. Company

Represents the legal/business entity.

### Suggested fields

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| legal_name | text | Canonical legal name |
| display_name | text | User-facing name |
| cin | text nullable | Strong identity key where available |
| isin | — | Deferred to a future instrument/security model. Not a `companies` column. |
| website | text nullable | Official company website |
| industry | text nullable | Canonical industry |
| sector | text nullable | Canonical sector |
| created_at | timestamp | |
| updated_at | timestamp | |

### Identity rules

Prefer identifiers in this order:

1. CIN
2. ISIN/security identifier
3. Official exchange/company identifier
4. Combination of legal name + supporting attributes
5. Fuzzy matching only as a review aid

Do not automatically merge companies solely because their names are similar.

---

## 4. IPO

Represents one IPO event.

### Suggested fields

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| company_id | UUID | FK → companies |
| market_segment | enum | MAINBOARD / SME |
| exchange | enum/set | NSE / BSE / BOTH |
| status | enum | See lifecycle states |
| symbol | text nullable | Exchange symbol |
| issue_size | decimal(20,2) nullable | **INR** total issue amount. Not share count. |
| fresh_issue_size | decimal(20,2) nullable | **INR** fresh issue amount. Not share count. |
| ofs_size | decimal(20,2) nullable | **INR** offer-for-sale amount. Not share count. |
| issue_share_count | decimal(20,0) nullable | Total equity **shares** offered. Not rupees. |
| fresh_issue_share_count | decimal(20,0) nullable | Fresh-issue **shares**. Not rupees. |
| ofs_share_count | decimal(20,0) nullable | OFS **shares**. Not rupees. |
| face_value | decimal(20,2) nullable | Face value per share (**INR**) |
| price_band_low | decimal(20,2) nullable | Lower band (**INR**) |
| price_band_high | decimal(20,2) nullable | Upper band (**INR**) |
| lot_size | integer nullable | Shares per lot (market lot) |
| minimum_lots | integer nullable | Minimum application lots |
| created_at | timestamp | |
| updated_at | timestamp | |

INR amounts and share counts are different dimensions. Do not populate `issue_size` / `fresh_issue_size` / `ofs_size` from a source field that is a share count (including NSE discovery `issueSize` on the live list feed).

Monetary values should be stored numerically, not as formatted strings such as `₹1,250 Cr`. Share counts should be stored as whole numbers, not as formatted strings such as `1.85 crore shares`.

Share-count invariant: when `issue_share_count`, `fresh_issue_share_count`, and `ofs_share_count` are all present, `fresh_issue_share_count + ofs_share_count` should equal `issue_share_count`. A mismatch must be flagged for review. Never auto-correct any of the three values to force equality. Do not encode this as a database CHECK that rejects the row.

---

## 5. IPO Lifecycle

Recommended states:

```text
DRAFT
UPCOMING
OPEN
CLOSED
ALLOTMENT_PENDING
ALLOTMENT_COMPLETED
LISTING_PENDING
LISTED
WITHDRAWN
CANCELLED
```

Transitions should be validated by backend business rules.

```text
DRAFT
  ↓
UPCOMING
  ↓
OPEN
  ↓
CLOSED
  ↓
ALLOTMENT_PENDING
  ↓
ALLOTMENT_COMPLETED
  ↓
LISTING_PENDING
  ↓
LISTED
```

Exceptional transitions such as WITHDRAWN or CANCELLED must remain possible from appropriate states.

---

## 6. IPO Dates / Lifecycle Events

Do not store the entire IPO timeline as one JSON blob.

At minimum support:

- DRHP date
- RHP date
- Anchor investor date
- IPO open date
- IPO close date
- Basis of allotment date
- Refund initiation date
- Demat credit date
- Listing date

A dedicated lifecycle table is recommended:

```text
ipo_lifecycle_events
---------------------
id
ipo_id
event_type
event_date
source_id
source_reference
created_at
updated_at
```

This makes the timeline extensible without schema changes.

---

## 7. Source

Represents an external data source.

```text
sources
-------
id
name
source_type
base_url
priority
enabled
parser_type
parser_version
last_success_at
last_failure_at
created_at
updated_at
```

Example source types:

```text
OFFICIAL_FILING
EXCHANGE
REGISTRAR
COMPANY
SECONDARY
MARKET_SIGNAL
```

---

## 8. Discovery Record

A discovery record is raw evidence found by a source before it becomes canonical data.

```text
discovery_records
-----------------
id
source_id
external_id
source_reference
company_name
raw_payload
content_hash
discovered_at
processed_at
status
error_message
created_at
updated_at
```

Recommended statuses:

```text
NEW
PROCESSING
MATCHED
CREATED
DUPLICATE
REJECTED
ERROR
```

Raw payloads should be retained so parsing can be reproduced/debugged.

---

## 9. Field Provenance

Every important externally sourced canonical field should be traceable.

```text
field_provenance
----------------
id
entity_type
entity_id
field_name
value
source_id
source_reference
retrieved_at
confidence
created_at
```

Example:

```text
entity_type: IPO
entity_id: abc
field_name: price_band_high
value: 126
source: NSE
retrieved_at: 2026-09-01T10:32:00
confidence: 1.0
```

Provenance is evidence, not merely a display feature.

Canonical IPO amount and share fields must use these `field_name` values (snake_case, matching the database columns):

```text
issue_size                 → INR total issue amount
fresh_issue_size           → INR fresh issue amount
ofs_size                   → INR OFS amount
issue_share_count          → total shares offered
fresh_issue_share_count    → fresh-issue shares
ofs_share_count            → OFS shares
```

Never record a share-count observation under `issue_size`, or an INR amount under `issue_share_count`.

---

## 10. IPO Change Events

When a canonical value changes, record the change.

```text
ipo_change_events
-----------------
id
ipo_id
field_name
old_value
new_value
source_id
source_reference
detected_at
change_type
created_at
```

Examples:

```text
PRICE_BAND_CHANGED
LOT_SIZE_CHANGED
OPEN_DATE_CHANGED
CLOSE_DATE_CHANGED
LISTING_DATE_CHANGED
STATUS_CHANGED
ISSUE_SIZE_CHANGED          → INR amount columns (issue_size / fresh_issue_size / ofs_size)
FIELD_CHANGED               → including share-count columns until a dedicated type exists
```

These records become inputs for the notification system.

---

## 11. Constraints and Indexes

Recommended constraints:

- `companies.cin` unique when not null
- Source + external ID unique for discovery records
- Content hash indexed
- IPO symbol indexed
- Company ID indexed on IPO
- IPO status indexed
- Open/close/listing dates indexed
- Provenance indexed by entity + field
- Change events indexed by IPO + detected_at

Discovery operations must be safe to execute repeatedly.

---

## 12. Data Retention

Never delete raw discovery evidence merely because it has been normalized.

Canonical data may be updated.

Raw evidence should remain available for:

- debugging
- audit
- parser improvements
- source comparison
- historical reconstruction

---

## 13. Future Extensions

The model is intentionally extensible for:

- Subscription data
- GMP history
- Financial statements
- Peer companies
- Valuation metrics
- IPO analysis
- Allotment applications
- Listing performance
- User watchlists
- User applications
