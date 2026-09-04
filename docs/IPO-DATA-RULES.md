# IPO Data Rules

## Purpose

These rules define how IPOVault acquires, validates, stores, updates, and presents IPO data.

The objective is to make the system reliable, reproducible, and auditable.

---

# 1. Core Rule

> Never confuse an observation with the truth.

A source reports a value.

IPOVault evaluates the observation, determines its authority, validates it, and then updates canonical data.

---

# 2. Raw Data Rule

Raw external responses must be persisted before transformation whenever technically and legally appropriate.

Never make the parser the only copy of external evidence.

Raw data should support:

- debugging
- parser regression testing
- auditing
- source comparison
- historical reconstruction

---

# 3. Provenance Rule

Every important externally sourced canonical field must have provenance.

At minimum:

```text
field
value
source
source_reference
retrieved_at
confidence
```

If a value cannot be traced to a source, it should not be presented internally as externally verified.

---

# 4. Source Authority Rule

Use the highest-authority appropriate source for each field.

Example:

```text
Official filing
    ↓
Exchange
    ↓
Registrar
    ↓
Trusted secondary source
    ↓
Other
```

This is not a universal ranking. Authority is field-specific.

---

# 5. Conflict Rule

If sources disagree:

1. Keep both observations.
2. Normalize both values.
3. Determine field-specific authority.
4. Select the canonical value.
5. Store provenance.
6. Flag significant unresolved conflicts for review.

Never silently delete the lower-priority observation.

---

# 6. Identity Rule

Never identify a company using display name alone.

Prefer:

```text
CIN
→ ISIN/security identifier
→ official/exchange identifier
→ normalized legal name + supporting evidence
```

Fuzzy matching can recommend a match but should not automatically merge ambiguous companies.

---

# 7. IPO Identity Rule

An IPO is an event, not simply a company name.

The same IPO may appear on:

- NSE
- BSE
- official documents
- registrar
- secondary websites

These observations should map to one canonical IPO event when evidence indicates they represent the same issue.

---

# 8. Idempotency Rule

Every discovery job must be safe to rerun.

Running:

```text
discover ABC
discover ABC
discover ABC
```

must not create:

```text
ABC IPO #1
ABC IPO #2
ABC IPO #3
```

Use source identifiers/content hashes and canonical identity matching.

---

# 9. Null Rule

Do not replace a known value with null merely because a later source omitted the field.

Bad:

```text
Existing lot size = 120
New source lot size = null

Result = null
```

Correct:

```text
Existing lot size = 120
New source omitted lot size

Result = 120
```

unless the source explicitly indicates that the value has changed or is no longer applicable.

---

# 10. Formatting Rule

Store canonical values in typed formats.

Do not store:

```text
"₹126"
"1,250 Cr"
"12%"
```

as the primary value.

Prefer:

```text
126                 (INR price)
12500000000         (INR amount, not shares)
18520085            (share count, not rupees)
0.12
```

Never serialize a share count as an INR amount (or the reverse) just to fill a field.

Formatting belongs to the API/UI layer.

---

# 11. Date Rule

Store dates/timestamps in a consistent timezone strategy.

IPO event dates should be represented as dates when the source specifies only a calendar date.

Use timestamps for:

- retrieval
- processing
- change detection
- job execution

Never infer a precise event time from a date-only source.

---

# 12. Price Band Rule

If the source provides:

```text
₹120–126
```

store:

```text
price_band_low = 120
price_band_high = 126
```

Validate:

```text
low <= high
low > 0
high > 0
```

---

# 13. Lot Size Rule

Validate:

```text
lot_size > 0
lot_size is integer
```

Do not infer lot size from minimum investment if the official value is unavailable unless the inferred value is explicitly marked as derived.

---

# 14. Issue Size Rule

Keep **INR amounts** and **share counts** as separate dimensions. Never treat one as the other.

### INR amounts (canonical columns)

```text
issue_size            → total issue amount (INR)
fresh_issue_size      → fresh issue amount (INR)
ofs_size              → OFS amount (INR)
```

### Share counts (canonical columns)

```text
issue_share_count            → total equity shares offered
fresh_issue_share_count      → fresh-issue shares
ofs_share_count              → OFS shares
```

Do not assume:

```text
total = fresh
```

or:

```text
total = OFS
```

unless supported by source data.

A source field named `issueSize` is not automatically an INR amount. NSE live list discovery currently reports share count in that field; that evidence must not populate `issue_size`.

Share-count invariant: when total, fresh, and OFS share counts are all known:

```text
fresh_issue_share_count + ofs_share_count = issue_share_count
```

If they disagree, flag the IPO for review. Do not rewrite any of the three values to make the equation hold.

The same non-assumption applies to INR amounts: do not infer a missing amount from shares × price band unless the result is stored as derived data (Rule 15), never as a source-reported canonical amount.

---

# 15. Derived Data Rule

Clearly distinguish:

### Source data

Directly observed from a source.

### Derived data

Calculated by IPOVault.

Example:

```text
Source:
Price band = ₹126

Derived:
Estimated market capitalization = ₹X
```

Derived values must never be represented as source-reported facts.

---

# 16. Change Rule

When a canonical value changes:

```text
old value
new value
source
timestamp
```

must be recorded.

Important changes should create an event that future notification systems can consume.

---

# 17. Historical Data Rule

Do not rewrite history simply because the current value changed.

Example:

```text
Sep 1:
Price band = ₹120–126

Sep 4:
Price band = ₹125–130
```

The system should be able to determine that the value changed.

For high-value historical fields, retain the prior observation and change event.

---

# 18. Status Rule

IPO status should be derived from validated lifecycle events where possible rather than manually toggled without evidence.

Example:

```text
OPEN
```

should correspond to the IPO's validated open/close dates and/or authoritative status signal.

Manual overrides should be explicit and auditable.

---

# 19. Failure Rule

A failed source must never cause destructive updates.

If:

```text
NSE fetch fails
```

then:

```text
Existing IPO data remains unchanged.
```

Do not interpret missing data as deleted data.

---

# 20. Staleness Rule

Every dynamic field should have a retrieval timestamp.

The system should know whether information is:

```text
Fresh
Stale
Unknown
```

The freshness threshold should depend on the field.

Subscription data may require frequent refresh.

Company identity may remain valid much longer.

---

# 21. Unofficial Data Rule

Data such as GMP must be explicitly classified as unofficial.

Never present:

```text
GMP ₹42
```

as equivalent to:

```text
Official IPO price ₹126
```

The UI should make the distinction clear.

---

# 22. Manual Override Rule

Admins may override canonical data only through an auditable mechanism.

Record:

```text
field
old value
new value
reason
admin/system actor
timestamp
```

Manual corrections must not destroy source observations.

---

# 23. API Rule

The mobile application consumes canonical data.

The mobile app must not:

- scrape sources
- resolve conflicts
- calculate source authority
- perform company matching
- decide canonical IPO identity

Those responsibilities belong to the backend.

---

# 24. UI Trust Rule

When useful, expose:

```text
Source
Last updated
Official / Unofficial
```

Users should be able to understand where important information came from.

---

# 25. Testing Rule

Every source adapter should have fixtures covering:

- valid IPO
- multiple IPOs
- missing fields
- changed values
- duplicate records
- malformed data
- source format changes
- unexpected HTML/JSON
- conflicting values

Every canonicalization service should have tests for idempotency.

---

# 26. Security Rule

Never commit:

- API keys
- passwords
- session cookies
- authentication tokens
- private credentials

to source code or documentation.

Use secure environment/secret management.

---

# 27. Compliance / Access Rule

Only use external data through access methods you are permitted to use.

Do not design discovery around:

- CAPTCHA bypass
- authentication bypass
- rate-limit evasion
- anti-bot circumvention
- unauthorized access

Where a source offers an official API/feed or permitted access method, prefer it.

---

# 28. Final Data Quality Principle

The system should prefer:

> **Correct + traceable + slightly delayed**

over:

> **Fast + unverified + opaque**

For an investment information product, trust is more valuable than having a number a few minutes earlier.
