# IPO Source Registry

## Purpose

This document defines how IPOVault classifies, prioritizes, monitors, and uses external data sources.

The registry is a configuration and governance layer. Source-specific URLs, identifiers, parser versions, and access details should live in configuration/database records rather than being scattered through application code.

---

## 1. Source Principles

1. Prefer authoritative sources for factual IPO data.
2. Preserve source evidence.
3. Never treat a secondary source as authoritative simply because it is easier to access.
4. Source priority is field-specific.
5. A source can be enabled/disabled without code deployment where practical.
6. Parser versions must be tracked.
7. Access must respect applicable terms, robots rules, rate limits, authentication requirements, and licensing.
8. Do not design the system around bypassing CAPTCHAs, access controls, or anti-bot mechanisms.

---

## 2. Source Types

### OFFICIAL_FILING

Examples:
- regulatory filings
- DRHP/RHP/prospectus
- official company documents

Best for:
- company identity
- issue structure
- price band
- issue size
- dates
- risk/business information

### EXCHANGE

Examples:
- NSE
- BSE

Best for:
- issue status
- exchange identifiers
- issue dates
- subscription/listing information
- exchange events

### REGISTRAR

Best for:
- allotment information
- application/allotment status
- issue-specific registrar data

### COMPANY

Best for:
- official announcements
- investor-relations information
- corporate identity
- documents

### SECONDARY

Third-party IPO information providers.

Best for:
- discovery assistance
- cross-checking
- convenience data

Should not override authoritative information without an explicit rule.

### MARKET_SIGNAL

Examples:
- GMP
- market sentiment
- unofficial signals

These should always be clearly marked as unofficial/non-authoritative.

---

## 3. Registry Schema

Suggested fields:

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
rate_limit_policy
authentication_required
last_success_at
last_failure_at
last_checked_at
health_status
created_at
updated_at
```

---

## 4. Field-Level Authority

Authority should be defined per field.

Example policy:

| Field | Preferred authority |
|---|---|
| Legal company name | Official filing |
| CIN | Official/company/regulatory |
| IPO type | Official filing/exchange |
| Price band | Official issue document/exchange |
| Lot size | Official issue document/exchange |
| Issue amount (INR) | Official issue document/exchange |
| Issue share counts | Official issue document/exchange (not NSE list-feed `issueSize`) |
| IPO open date | Official issue document/exchange |
| IPO close date | Official issue document/exchange |
| Listing date | Exchange |
| Allotment date | Registrar/exchange |
| Allotment status | Registrar |
| GMP | Secondary/market-signal only |

This is a starting policy and should be verified against the actual source availability for each field.

---

## 5. Source Health

Track:

```text
HEALTHY
DEGRADED
FAILING
DISABLED
```

Health indicators:

- successful fetches
- failed fetches
- HTTP/API errors
- parser errors
- unexpected schema changes
- stale data
- response latency

A parser can fail even when the website itself is reachable, so fetch health and parse health should be distinguishable.

---

## 6. Parser Versioning

Every adapter should have a parser version.

Example:

```text
NSE adapter
parser_version = 3
```

When the source format changes:

```text
parser v3 → fails
parser v4 → deployed
```

Keep enough metadata to determine which parser produced a discovery record.

---

## 7. Registry Example

Conceptually:

```yaml
sources:
  - id: official_filings
    name: Official Filings
    type: OFFICIAL_FILING
    priority: 1
    enabled: true

  - id: nse
    name: NSE
    type: EXCHANGE
    priority: 2
    enabled: true

  - id: bse
    name: BSE
    type: EXCHANGE
    priority: 2
    enabled: true

  - id: registrar
    name: IPO Registrar
    type: REGISTRAR
    priority: 3
    enabled: true
```

Actual source endpoints should be maintained separately and verified before production use.

---

## 8. Adding a New Source

Process:

```text
Identify source
    ↓
Assess authority
    ↓
Check access/licensing/terms
    ↓
Register source
    ↓
Implement adapter
    ↓
Write parser tests
    ↓
Run against captured fixtures
    ↓
Validate output
    ↓
Enable in staging
    ↓
Monitor
    ↓
Enable production
```

Do not add a source directly to production without fixture-based parser tests.

---

## 9. Source Comparison

For overlapping fields, retain observations from multiple sources.

Example:

```text
Price Band

Official filing     ₹120–126
NSE                 ₹120–126
Secondary source    ₹120–125
```

Canonical:

```text
₹120–126
```

Reason:

```text
Official/exchange evidence outranks secondary evidence.
```

The lower-priority observation is still retained.

---

## 10. Security

Never store credentials or API secrets in this markdown document.

Use:

- environment variables
- secret managers
- encrypted configuration
- least-privilege credentials

Do not commit secrets to Git.

---

## 11. Operational Dashboard

The admin interface should expose:

```text
SOURCE HEALTH

NSE
Healthy
Last success: ...

BSE
Healthy
Last success: ...

Official Filings
Degraded
Parser errors: 3

Registrar
Healthy
```

Clicking a source should show recent runs and errors.

---

## 12. Source Registry Governance

Any change to source priority should be treated as a data-quality decision.

Document:

- why priority changed
- which fields are affected
- when it changed
- who/what changed it

Avoid hardcoded priority logic scattered throughout adapters.
