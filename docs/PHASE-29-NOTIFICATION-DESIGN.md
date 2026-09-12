# Phase 29 — Notification Domain, User Preferences & Trigger Orchestration Design

## 1. Executive Summary

Phase 29 establishes the foundational, deterministic, user-scoped notification engine, user preference controls, and trigger orchestration for IPOVault:
- **Phase 29.1**: Core domain model, event engine, read/unread state management, user isolation, and database-enforced idempotency.
- **Phase 29.2**: User notification preferences, default configurations, preference management APIs, and generator integration.
- **Phase 29.3**: Trigger integration & generation orchestration connecting real domain state/events (`IpoLifecycleEvent`, `IpoChangeEvent`, `DiscoveryQualityGateService`, `AllotmentCheckJobItem`) to the preference-aware event engine.

**Intentionally Out of Scope (Future Phase 29.4 Boundary):**
- Push notifications (FCM / APNs)
- Email notifications
- SMS / WhatsApp messaging
- Background workers & message queues (BullMQ / RabbitMQ)
- Cron schedulers & background tickers
- External notification providers (Twilio, SendGrid, OneSignal, etc.)

---

## 2. Notification Data Model & Preferences Schema

### Prisma Schema Definitions

```prisma
enum NotificationType {
  IPO_OPENED
  IPO_CLOSED
  IPO_LISTING_SOON
  IPO_DATA_CHANGED
  IPO_DATA_QUALITY_WARNING
  ALLOTTED_RESULT_AVAILABLE
}

model Notification {
  id                String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId            String           @map("user_id")
  type              NotificationType
  title             String
  message           String
  relatedEntityType String?          @map("related_entity_type")
  relatedEntityId   String?          @map("related_entity_id")
  metadata          Json?            @db.JsonB
  deduplicationKey  String           @map("deduplication_key")
  readAt            DateTime?        @map("read_at") @db.Timestamptz(6)
  createdAt         DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime         @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([userId, deduplicationKey])
  @@index([userId, createdAt])
  @@index([userId, readAt, createdAt])
  @@map("notifications")
}

model NotificationPreference {
  id               String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId           String           @map("user_id")
  notificationType NotificationType @map("notification_type")
  enabled          Boolean          @default(true)
  createdAt        DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime         @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([userId, notificationType])
  @@index([userId])
  @@map("notification_preferences")
}
```

---

## 3. Strict Notification Types & System Defaults

Initial notification types cover useful domain events. All notification types default to **enabled** (`enabled: true`) system-wide until overridden by an explicit user preference.

1. `IPO_OPENED` (Default: Enabled)
2. `IPO_CLOSED` (Default: Enabled)
3. `IPO_LISTING_SOON` (Default: Enabled, window `LISTING_SOON_WINDOW_DAYS = 3`)
4. `IPO_DATA_CHANGED` (Default: Enabled)
5. `IPO_DATA_QUALITY_WARNING` (Default: Enabled)
6. `ALLOTTED_RESULT_AVAILABLE` (Default: Enabled)

---

## 4. Idempotency & Deduplication Strategy

Generating notifications repeatedly against domain state MUST NOT produce duplicate entries. Idempotency is guaranteed via deterministic `deduplicationKey` construction combined with PostgreSQL unique constraints (`@@unique([userId, deduplicationKey])`).

### Deduplication Key Formats

- **`IPO_OPENED`**: `ipo_opened:${ipoId}:${lifecycleEventId}`
- **`IPO_CLOSED`**: `ipo_closed:${ipoId}:${lifecycleEventId}`
- **`IPO_LISTING_SOON`**: `ipo_listing_soon:${ipoId}:${eventDateIso}`
- **`IPO_DATA_CHANGED`**: `ipo_data_changed:${ipoId}:${changeEventId}`
- **`IPO_DATA_QUALITY_WARNING`**: `ipo_quality_warning:${ipoId}:${qualityCondition}`
- **`ALLOTTED_RESULT_AVAILABLE`**: `allotment_result:${ipoId}:${jobItemId}`

### Database Uniqueness & Concurrency Safety
Under concurrent calls or parallel background runs, database unique key conflicts (`P2002` in Prisma) are handled gracefully (upsert / ignore on conflict) to maintain zero duplicate notifications.

---

## 5. User Notification Preferences & Generator Integration

### Effective Preference Semantics
When evaluating or generating a notification for a target user:
1. Check explicit user preference in `notification_preferences` for `(userId, notificationType)`.
2. If an explicit row exists: use `enabled = row.enabled`, `isDefault = false`.
3. If no row exists: use system default (`enabled = true`), `isDefault = true`.

### Creation Suppression Logic
- If effective preference `enabled === false`: Notification creation is **suppressed**, returning `null`.
- If effective preference `enabled === true`: Creation proceeds through normal idempotency checks and persistence.

### Historical Preservation & No Backfill Rules
- **Disabling a Type**: Existing notifications of that type remain untouched in the database. Only future event generation is suppressed.
- **Enabling or Resetting Preferences**: Re-enabling a notification type does **NOT** trigger historical backfill of past domain events. Future events will create notifications normally.

---

## 6. Phase 29.3 — Trigger Integration & Generation Orchestration

The `NotificationOrchestratorService` bridges persistent domain events/state with the preference-aware event generator:

```
┌─────────────────────────────────────────────────────────────┐
│                       Domain Triggers                       │
│  IpoLifecycleEvent | IpoChangeEvent | QualityGate | JobItem │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             NotificationOrchestratorService                 │
│  processLifecycleEvents() | processChangeEvents()           │
│  processQualityGate()     | processAllotmentObservation()   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Evaluates context & targets
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 NotificationEventGenerator                  │
│       Generates deterministic CreateNotificationInput        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Preference check & DB upsert
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   NotificationRepository                    │
│      Suppresses if disabled | Upserts to notifications      │
└─────────────────────────────────────────────────────────────┘
```

### Orchestration Entry Points & Domain Semantics

1. **`processLifecycleEvents(options)`**:
   - Evaluates `IpoLifecycleEvent` records (`OPEN`, `CLOSE`, `LISTING`).
   - Produces `IPO_OPENED`, `IPO_CLOSED`, or `IPO_LISTING_SOON` (within 3-day window).

2. **`processChangeEvents(options)`**:
   - Evaluates `IpoChangeEvent` records.
   - Produces `IPO_DATA_CHANGED` notifications detailing safe field modifications.

3. **`processQualityGate(options)`**:
   - Invokes existing `DiscoveryQualityGateService.evaluateQualityGate()`. Reuses existing Quality Gate rules.
   - Triggers `IPO_DATA_QUALITY_WARNING` **ONLY** for `NEEDS_REVIEW` or `INCOMPLETE` states.
   - Suppressed for `PASS` and `PASS_WITH_WARNINGS`.

4. **`processAllotmentObservation(jobItemId)` & `processAllotmentJob(jobId)`**:
   - Evaluates `AllotmentCheckJobItem` observation.
   - Targets `job.userId` (owner of the allotment job). If `job.userId` is absent (anonymous check), skips notification generation.
   - Triggers `ALLOTTED_RESULT_AVAILABLE` **ONLY** for definitive outcomes: `ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`.
   - Excludes non-definitive & transient statuses (`UNKNOWN`, `FAILED`, `RATE_LIMITED`, `TEMPORARY_ERROR`, etc.).

### User Targeting Rules
- **Allotment Observations**: Target `job.userId` (owner of the job/PAN data).
- **System-Wide Events** (Lifecycle, Changes, Quality Gate): Target specified `userId`/`targetUserIds` if provided, or resolve active system users from `UserSavedPan` and `AllotmentCheckJob`.

### Failure Isolation & Transaction Boundaries
- All orchestration methods execute outside primary domain transactions.
- Notification generation errors are caught, logged with structured diagnostics, and contained. Failures in notification generation **NEVER** break primary domain operations (e.g. IPO discovery, refresh, or allotment checking).

---

## 7. Read State & User Isolation

### Read State Semantics
- `readAt === null`: Unread notification
- `readAt !== null`: Read notification
- `POST /api/v1/notifications/:id/read`: Sets `readAt = now()`. Idempotent.
- `POST /api/v1/notifications/read-all`: Sets `readAt = now()` for all unread notifications belonging to the authenticated user.

### User Isolation (IDOR Protection)
- Authentication uses header convention `x-user-id`.
- Missing or empty `x-user-id` -> `401 Unauthorized`.
- All preference queries, updates, resets, notification lists, and read mutations strictly filter by `where: { userId }`.

---

## 8. Privacy & Security Rules

To prevent data leaks and maintain strict regulatory compliance:
- **No Plaintext PAN**: Raw PAN numbers are NEVER stored or exposed in notifications, preferences, or logs.
- **No Encrypted PAN**: `panEncrypted` is NEVER exposed.
- **No Hashes / Identifiers**: `panHash` and `identifierHash` are NEVER stored or exposed in notification payloads/metadata.
- Notification metadata for allotment contains only high-level details: IPO symbol/name, result status (`ALLOTTED`, `PARTIALLY_ALLOTTED`, `NOT_ALLOTTED`), and masked identifier if safe.

---

## 9. Notification & Preference API Specification

### Notification Endpoints
- `GET /api/v1/notifications`: Paginated list of notifications for the user.
- `GET /api/v1/notifications/:id`: Single notification for the user.
- `POST /api/v1/notifications/:id/read`: Marks single notification as read.
- `POST /api/v1/notifications/read-all`: Marks all unread notifications as read for current user.

### Preference Endpoints
- `GET /api/v1/notifications/preferences`: Effective preferences for ALL 6 types for current user.
- `PUT /api/v1/notifications/preferences/:type`: Updates single type preference (`{ "enabled": false }`).
- `POST /api/v1/notifications/preferences/reset`: Resets preferences back to system defaults.

---

## 10. Future Delivery & Scheduler Boundary (Phases 29.1–29.3)

Phase 29.1–29.3 cleanly separates notification **generation & state persistence** from notification **delivery**. Phase 29.4 now introduces the delivery infrastructure itself.

---

## 11. Phase 29.4 — Notification Delivery Infrastructure

### Architecture

```
Domain Event
    ↓
NotificationOrchestratorService
    ↓
NotificationRepository.createNotification()
    ↓                           ↓
Notification (DB)   NotificationDeliveryService.initDelivery()
                           ↓
                  DeliveryRecord: PENDING
                           ↓
                  DeliveryRecord: PROCESSING
                           ↓
              NotificationDeliveryAdapter.deliver()
                           ↓
                  DeliveryRecord: DELIVERED | FAILED
```

---

### Delivery Data Model

#### Schema

```prisma
enum DeliveryChannel {
  IN_APP
  PUSH    // reserved — no adapter yet
  EMAIL   // reserved — no adapter yet
  SMS     // reserved — no adapter yet
}

enum DeliveryStatus {
  PENDING
  PROCESSING
  DELIVERED
  FAILED
}

model NotificationDelivery {
  id                String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  notificationId    String          @map("notification_id") @db.Uuid
  channel           DeliveryChannel
  status            DeliveryStatus  @default(PENDING)
  attemptCount      Int             @default(0) @map("attempt_count")
  lastAttemptAt     DateTime?       @map("last_attempt_at") @db.Timestamptz(6)
  deliveredAt       DateTime?       @map("delivered_at") @db.Timestamptz(6)
  failureReason     String?         @map("failure_reason")
  providerMessageId String?         @map("provider_message_id")
  createdAt         DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime        @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  notification      Notification    @relation(fields: [notificationId], references: [id], onDelete: Cascade)

  @@unique([notificationId, channel])
  @@index([notificationId])
  @@index([status])
  @@map("notification_deliveries")
}
```

#### Design rationale
- **Separate table**: Keeps `Notification` clean. Provider-specific state (`attemptCount`, `failureReason`, `providerMessageId`, `deliveredAt`) lives in `NotificationDelivery`.
- **`@@unique([notificationId, channel])`**: One delivery record per (notification, channel). This is the authoritative concurrency safeguard — no `find → if absent → create` anti-pattern.
- **Cascade delete**: Delivery records are deleted automatically when the parent `Notification` row is deleted.

---

### Delivery State Machine

```
PENDING ──────→ PROCESSING ──────→ DELIVERED  (terminal, idempotent)
                    │
                    └──────────→ FAILED
                                    │
                                    └──→ PROCESSING  (retry)
```

**Legal transitions only**:
| From | To | Trigger |
|---|---|---|
| `PENDING` | `PROCESSING` | `initDelivery()` / `retryDelivery()` called |
| `PROCESSING` | `DELIVERED` | Adapter returns `{ status: 'DELIVERED' }` |
| `PROCESSING` | `FAILED` | Adapter returns `{ status: 'FAILED' }` or throws |
| `FAILED` | `PROCESSING` | `retryDelivery()` called explicitly |
| `DELIVERED` | — | Terminal. Repeated calls are no-ops. |

Attempting to transition from an illegal source state is rejected with a warning log. `DELIVERED` is never reset back to `PENDING`.

---

### IN_APP Channel Semantics

> **Important**: IN_APP delivery means the notification is persisted in the `notifications` table and is immediately readable via:
> - `GET /api/v1/notifications`
> - `GET /api/v1/notifications/:id`
>
> It does **NOT** mean a browser push notification or mobile alert was sent. Browser/mobile push belongs to the `PUSH` channel via FCM/APNs (Phase 29.5+).

The `InAppDeliveryAdapter`:
- Returns `{ status: 'DELIVERED' }` immediately.
- Makes no external I/O or network calls.
- Has no failure path (the notification is already in the DB).

---

### Adapter Abstraction

All delivery channels implement `NotificationDeliveryAdapter`:

```typescript
abstract class NotificationDeliveryAdapter {
  abstract readonly channel: DeliveryChannel;
  abstract deliver(notification: NotificationResponseDto): Promise<DeliveryResult>;
}
```

Adapters **MUST NOT**:
- Access Prisma internals or delivery record state.
- Access `PAN`, `panHash`, `panEncrypted`, or `identifierHash`.
- Throw — failures must be expressed as `DeliveryResult.status = 'FAILED'`.

Future adapters:
| Channel | Adapter class | Phase |
|---|---|---|
| `IN_APP` | `InAppDeliveryAdapter` | **29.4 (implemented)** |
| `PUSH` | `FcmDeliveryAdapter` | 29.5+ |
| `EMAIL` | `EmailDeliveryAdapter` | 29.5+ |
| `SMS` | `SmsDeliveryAdapter` | 29.5+ |

---

### Delivery Service Responsibilities

`NotificationDeliveryService`:
- Creates/gets delivery records (idempotent via repository upsert).
- Routes delivery to the correct adapter via `adapterRegistry`.
- Enforces explicit state machine transitions.
- Increments `attemptCount` and records `lastAttemptAt` on each attempt.
- Records `deliveredAt` on success, `failureReason` on failure.
- Isolates adapter failures — `initDelivery()` **never throws** to its caller.
- Supports `retryDelivery()` for `FAILED → PROCESSING` transitions.

`NotificationDeliveryService` does **NOT**:
- Generate notifications.
- Evaluate user preferences.
- Inspect PAN/hash/encrypted identifiers.
- Implement external provider logic.
- Run background workers or schedulers.

---

### Retry Semantics (Phase 29.4)

Phase 29.4 does **not** introduce automatic retry workers. However, the delivery service is designed for safe future worker integration:

- Each attempt increments `attemptCount`.
- Failure records `lastAttemptAt + failureReason`.
- Successful delivery records `deliveredAt`.
- `retryDelivery()` is explicitly callable — designed for a future worker.
- Repeated delivery of an already-`DELIVERED` record is a no-op.
- No exponential backoff implemented yet.

---

### Notification Creation Integration

After a `Notification` is successfully persisted in `NotificationRepository.createNotification()`, delivery is initiated for the `IN_APP` channel:

```
notification.upsert() → dto = mapToDto(created)
                      → deliveryService.initDelivery(dto, IN_APP)  [fire-and-forget, isolated]
                      → return dto  ← always succeeds regardless of delivery
```

**Key guarantee**: A notification is **never lost** because delivery infrastructure has a problem. The `Notification` row is returned successfully even if `initDelivery()` fails. The fire-and-forget catch block logs diagnostics and contains the error.

---

### Concurrency & Idempotency

- `NotificationDeliveryRepository.createDelivery()` uses `upsert` on `@@unique([notificationId, channel])`.
- If two concurrent calls race, only one creates the row; the other gets the existing row.
- `P2002` conflicts during creation are handled narrowly with a fallback `findUnique`.
- `DELIVERED` records are never re-delivered regardless of how many `initDelivery()` calls arrive.

---

### Failure Isolation

Delivery failures **MUST NOT** break:
- IPO discovery
- IPO canonicalization
- IPO refresh
- Allotment checking
- Notification generation
- Preference updates

The `InAppDeliveryAdapter` has no external failure path. For future external adapters, all failures are caught within `executeDelivery()`, logged with structured diagnostics (`notificationId`, `deliveryId`, `channel`, `status`), and recorded as `FAILED` delivery records.

Broad silent catch blocks are **not used** — only specific error paths are caught.

---

### Privacy

`NotificationDelivery` records **MUST NOT** store:
- Plaintext PAN
- `panHash`
- `panEncrypted`
- `identifierHash`
- Secrets or provider credentials

`providerMessageId` is a safe provider-assigned trace ID (e.g. FCM message ID). It must never contain sensitive user identifiers.

---

### API Changes

**No new public API endpoints** are added in Phase 29.4. Existing APIs are fully preserved:
- `GET /api/v1/notifications`
- `GET /api/v1/notifications/:id`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`
- `GET /api/v1/notifications/preferences`
- `PUT /api/v1/notifications/preferences/:type`
- `POST /api/v1/notifications/preferences/reset`

`NotificationDeliveryService.getDeliveryStatus()` is an internal service method. It is **not** exposed as a controller endpoint in Phase 29.4 (not yet justified for the consumer contract).

---

### No External Providers / No Scheduler / No Worker (Phase 29.4)

Phase 29.4 does **not** implement:
- Firebase FCM
- APNs
- Email providers (SendGrid, SES, Mailgun)
- SMS providers (Twilio)
- WhatsApp / Telegram
- BullMQ / RabbitMQ / Redis
- Cron schedulers
- Background worker processes
- External API credentials or SDKs

These belong exclusively to Phase 29.5+. The `DeliveryChannel` enum and adapter abstraction are designed to accommodate them without modifying the notification domain.

---

## 12. Phase 29.5 — External Notification Delivery Readiness (Atomic Claim)

### Objective

Harden the Phase 29.4 delivery infrastructure so future external notification providers (PUSH, EMAIL, SMS) can be integrated safely without risk of duplicate external adapter invocations under concurrency.

### Concurrency Gap & Resolution

In Phase 29.4, `@@unique([notificationId, channel])` prevented duplicate DB rows, but two concurrent calls could both observe `PENDING` state and simultaneously invoke `adapter.deliver()`.

Phase 29.5 introduces **Atomic Delivery Claims** using Prisma `updateMany`:

```sql
UPDATE notification_deliveries
SET status = 'PROCESSING',
    last_attempt_at = NOW(),
    attempt_count = attempt_count + 1
WHERE id = $1 AND status = $2;
```

- Returns `CLAIMED` if `count === 1` — this execution owns the delivery attempt.
- Returns `NOT_CLAIMED` if `count === 0` — another execution won the claim or status changed.

The adapter is invoked **only** by the winner of the claim.

### Claim Source State Invariant

`PROCESSING` represents an active delivery claim in progress. An existing `PROCESSING` record is **never** re-claimed by `initDelivery()` or `retryDelivery()`:
- `initDelivery()` checks `record.status === PROCESSING` and returns immediately without attempting a claim or calling the adapter. `expectedStatus` is strictly `PENDING`.
- `retryDelivery()` checks `record.status === PROCESSING` and returns immediately. `expectedStatus` is strictly `FAILED`.
- Only `PENDING` (via `initDelivery`) and `FAILED` (via `retryDelivery`) are valid source states for atomic claims. `executeDelivery()` never attempts `claimDelivery(id, PROCESSING)`.

### Conditional Finalization

Finalization from `PROCESSING -> DELIVERED` or `PROCESSING -> FAILED` is similarly guarded via `conditionalFinalizeDelivery`:

```sql
UPDATE notification_deliveries
SET status = $newStatus, ...
WHERE id = $1 AND status = 'PROCESSING';
```

If `count === 0`, a stale caller's update is ignored, preserving the state written by the rightful owner.

### Distributed Failure Boundary & Provider Idempotency

1. **Distributed Failure Boundary**: Atomic DB claims prevent local double-sends within DB transaction boundaries. If network failure or process crash occurs *after* external API call but *before* DB finalization, a future retry may re-invoke the provider.
2. **Provider Idempotency**: Future external adapters (PUSH, EMAIL, SMS) **MUST** pass provider-level deduplication keys or idempotency headers to external APIs where supported.
3. **Stale Processing Deferral**: Records stuck in `PROCESSING` due to worker crashes require a stale-processing recovery worker (Phase 29.6+) that resets `PROCESSING` records older than a configured threshold to `FAILED` for retry.

---

## 13. Phase 29.6 — Production Delivery Automation

### Target Architecture

```
Notification
    ↓
NotificationDelivery (PENDING)
    ↓
NotificationDeliverySchedulerService (ticker)
    ↓
NotificationDeliveryWorkerService
    ↓
recoverStaleDeliveries() [PROCESSING → FAILED]
    ↓
findEligibleDeliveries() [bounded batch query]
    ↓
atomic claimDelivery() [PENDING → PROCESSING / FAILED → PROCESSING]
    ↓
NotificationDeliveryAdapter.deliver()
    ↓
conditionalFinalizeDelivery() [PROCESSING → DELIVERED / FAILED]
```

### Key Architectural Boundary & Infrastructure

- **Modular Monolith Worker**: Built cleanly inside NestJS without introducing external queues/schedulers (Redis, BullMQ, RabbitMQ, `@nestjs/schedule`).
- **Interval Scheduler**: `NotificationDeliverySchedulerService` provides a non-overlapping timer ticker (`setInterval`) managing execution cadence.
- **In-Flight Execution Guard**: `NotificationDeliveryWorkerService.isInFlight()` prevents overlapping worker iterations when processing takes longer than interval duration.

### Bounded Candidate Selection & Eligibility

- **Query Limit**: Bounded via configurable batch size (`NOTIFICATION_WORKER_BATCH_SIZE`, default: `50`).
- **Starvation Protection**: Exhausted `FAILED` records (`attemptCount >= maxAttempts`) are filtered at the database query level via `OR: [{ status: 'PENDING' }, { status: 'FAILED', attemptCount: { lt: maxAttempts } }]`, preventing candidate batch starvation.
- **Eligibility Rules**:
  - `PENDING`: Eligible immediately.
  - `FAILED`: Eligible ONLY if `attemptCount < maxAttempts` AND elapsed backoff duration (`lastAttemptAt + backoffDelay <= now`) has passed.
  - `PROCESSING`: NOT eligible normally (recovered via explicit stale recovery lease).
  - `DELIVERED`: Never eligible.

### Retry Policy & Exponential Backoff

Implemented in `NotificationDeliveryRetryPolicy`:
- **`maxAttempts`**: Configurable (default: 5).
- **`baseDelayMs`**: Configurable (default: 10,000ms / 10s).
- **`maxDelayMs`**: Configurable (default: 3,600,000ms / 1 hour).
- **`backoffMultiplier`**: Configurable (default: 2).
- **Formula**: `delay = min(baseDelayMs * multiplier^(attemptCount - 1), maxDelayMs)`
- **Exhaustion**: When `attemptCount >= maxAttempts`, delivery transitions to terminal `FAILED` without automatic retry.

### Stale PROCESSING Lease Recovery

- **Timestamp Column**: `processingStartedAt TIMESTAMPTZ(6)` added to `notification_deliveries`. Set when `claimDelivery()` transitions state to `PROCESSING`.
- **Lease Timeout**: `NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS` (default: 5 minutes / 300,000ms).
- **Atomic Recovery**: `recoverStaleDeliveries(staleThreshold)` conditionally updates `WHERE status = 'PROCESSING' AND processing_started_at < threshold` to `status = 'FAILED'`, `processing_started_at = NULL`, `failure_reason = 'Stale processing lease expired'`.
- **Safety**: Legitimate active leases below threshold are NOT recovered prematurely.

### Failure Isolation & Observability

- **Batch Item Isolation**: Each item in a worker batch is processed inside an isolated `try / catch`. An unexpected error on item N never halts processing for remaining batch items.
- **Scheduler Isolation**: Scheduler tick exceptions are contained and logged without crashing the NestJS application process.
- **Privacy & Security Logs**: Logs capture `deliveryId`, `notificationId`, `channel`, `status`, `attemptCount`, and safe error strings. Zero plaintext PAN, `panHash`, `panEncrypted`, `identifierHash`, or raw secrets are logged.

### Local vs. Distributed Delivery Guarantees

| Guarantee Boundary | Behavior & Limitations |
|---|---|
| **Local Delivery Guarantee** | Atomic DB claims prevent local double-sends within DB transaction boundaries. |
| **Distributed External Guarantee** | Stale processing recovery after process crash may re-invoke provider. Future adapters MUST support provider idempotency headers. |
| **Multi-Instance Considerations** | DB-level `claimDelivery()` protects delivery ownership across application instances. Multi-node scheduler coordination can be added in future phases if needed. |

---

## 14. Phase 29.7 — Production Delivery Observability & Operational Hardening

### Objective

Harden the notification delivery worker and scheduler for production operations without introducing external providers, external queues (Redis/BullMQ), external schedulers, or public API changes.

### Key Enhancements

1. **Worker Operational Summary Logging & Structured Metrics**:
   - Each worker tick aggregates operational telemetry into `WorkerBatchResult`:
     - `candidatesFound`: Total eligible candidate rows returned by query.
     - `pendingProcessedCount`: Candidate rows in `PENDING` state.
     - `failedRetryProcessedCount`: Candidate rows in `FAILED` state undergoing retry.
     - `claimedCount`: Candidates successfully transitioned to `PROCESSING`.
     - `succeededCount`: Deliveries reaching terminal `DELIVERED`.
     - `failedCount`: Deliveries reaching terminal/interim `FAILED`.
     - `exhaustedCount`: Candidates skipped due to `attemptCount >= maxAttempts`.
     - `skippedBackoffCount`: Candidates skipped because retry backoff time has not elapsed.
     - `staleRecoveredCount`: Stale `PROCESSING` leases recovered to `FAILED`.
     - `itemErrorCount`: Count of processing exceptions encountered across batch items.
     - `durationMs`: Total tick execution duration in milliseconds.
   - Logs tick summary at `log` level; skips verbose per-row logs during normal operations; uses `warn`/`error` level for operational anomalies or item failures.
   - Strict privacy enforcement: Zero PAN, `panHash`, `panEncrypted`, `identifierHash`, or raw secrets logged.

2. **Scheduler Lifecycle Hardening**:
   - **Double-Registration Guard**: `onModuleInit()` checks `this.timer !== null` and guards against registering duplicate interval handles.
   - **Lifecycle Logging**: Clear startup (`Starting notification delivery scheduler (interval: Xms)...`) and teardown (`NotificationDeliverySchedulerService stopped...`) logs.
   - **Tick Failure Containment**: Rejections inside `workerService.processBatch()` are caught, logged at `error` level, and isolated so future scheduled interval ticks continue executing.

3. **Configuration Validation & Sanitization**:
   - **Worker Config (`sanitizeWorkerConfig`)**:
     - `NOTIFICATION_WORKER_ENABLED`: Boolean parsed safely (`true` unless case-insensitive string is `'false'`).
     - `NOTIFICATION_WORKER_BATCH_SIZE`: Numeric, default 50. Must be >= 1; invalid values safely normalized to default.
     - `NOTIFICATION_WORKER_INTERVAL_MS`: Numeric, default 10,000ms. Must be >= 1,000ms; invalid values safely normalized to default.
     - `NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS`: Numeric, default 300,000ms (5 min). Must be >= 10,000ms; invalid values safely normalized to default.
   - **Retry Policy Config (`sanitizeRetryPolicyConfig`)**:
     - `maxAttempts`: Numeric, default 5. Must be >= 1; invalid values safely normalized to default.
     - `baseDelayMs`: Numeric, default 10,000ms. Must be >= 1; invalid values safely normalized to default.
     - `maxDelayMs`: Numeric, default 3,600,000ms. Must be >= baseDelayMs; if less, capped to baseDelayMs.
     - `backoffMultiplier`: Numeric, default 2. Must be > 0; invalid values safely normalized to default.

4. **Safety Invariants**:
   - **Exhaustion Exclusion**: Database query `findEligibleDeliveries()` filters out exhausted `FAILED` records (`attemptCount >= maxAttempts`).
   - **Active Lease Protection**: `PROCESSING` records are never selected or claimed as normal candidates.
   - **Atomic Lease Finalization & Clear**: Successful or failed finalization clears `processingStartedAt = NULL` atomically.
   - **Attempt Count Integrity**: `attemptCount` increments exactly once upon successful `claimDelivery()` (`PENDING -> PROCESSING` or `FAILED -> PROCESSING`).
   - **Batch Failure Isolation**: Processing exceptions on item `N` are caught and logged; remaining batch items continue processing.

5. **At-Least-Once External Delivery Boundary**:
   - Deliveries guarantee **at-least-once** delivery semantics across system crash windows.
   - If an external provider adapter call succeeds but the process crashes before database finalization (`PROCESSING -> DELIVERED`), stale recovery will eventually reset the lease to `FAILED`, making it eligible for retry.
   - **Idempotency Rule**: Future external provider adapters MUST implement provider-side idempotency keys / headers (e.g. idempotency key derived from `delivery.id`) to prevent duplicate end-user messages during crash recovery.
   - Exactly-once delivery is explicitly **not** claimed.

---

## 15. Phase 29.8 — Notification Delivery Operations & Admin Visibility

### Purpose

Provide a read-only operational visibility boundary for notification delivery health without exposing sensitive user information (userId, PAN, notification text, metadata) and without adding external infrastructure (Redis, BullMQ, microservices).

### Operational Visibility Endpoint

- **Route**: `GET /api/v1/notifications/delivery/operations`
- **Method**: `GET`
- **Access**: Read-Only Administrative Visibility Boundary.
- **Authorization Boundary**: The backend codebase currently operates header-based user context (`x-user-id`) and does not feature a dedicated administrative RBAC guard framework. This endpoint is exposed for operational monitoring and is designed to be protected by an API Gateway or administrative RBAC guard in production environments.

### Aggregate Metrics Exposed

The endpoint returns `DeliveryOperationsSummaryResponseDto`:

```json
{
  "totalDeliveries": 100,
  "pendingCount": 10,
  "processingCount": 5,
  "deliveredCount": 75,
  "failedCount": 10,
  "exhaustedFailedCount": 2,
  "retryableFailedCount": 8,
  "staleProcessingCount": 1,
  "oldestPendingDeliveryAgeMs": 120000,
  "oldestRetryableFailedDeliveryAgeMs": 45000,
  "oldestProcessingDeliveryAgeMs": 350000,
  "deliverySuccessRatePercentage": 88.24,
  "deliveryFailureRatePercentage": 11.76,
  "recentHealth": {
    "windowMs": 86400000,
    "deliveriesCreated": 40,
    "delivered": 35,
    "failed": 5,
    "exhausted": 1,
    "retryAttempts": 12
  }
}
```

### Definitions & Metric Rules

- **`failedCount`**: Count of delivery records currently in `FAILED` state.
- **`retryableFailedCount`**: Count of `FAILED` deliveries with `attemptCount < maxAttempts` (eligible for worker retry after backoff).
- **`exhaustedFailedCount`**: Count of `FAILED` deliveries with `attemptCount >= maxAttempts` (permanently halted from automatic retry).
- **`staleProcessingCount`**: Count of `PROCESSING` deliveries where `processingStartedAt < (now - staleLeaseTimeoutMs)`.
- **`oldestPendingDeliveryAgeMs`**: Elapsed time in ms since creation of the oldest `PENDING` delivery record (`null` if 0 pending).
- **`oldestRetryableFailedDeliveryAgeMs`**: Elapsed time in ms since creation of the oldest retryable `FAILED` delivery record (`null` if none).
- **`oldestProcessingDeliveryAgeMs`**: Elapsed time in ms since lease start (`processingStartedAt`) of the oldest `PROCESSING` delivery record (`null` if none).
- **`deliverySuccessRatePercentage`**: `(deliveredCount / (deliveredCount + failedCount)) * 100` (`0` if no completed deliveries).
- **`deliveryFailureRatePercentage`**: `(failedCount / (deliveredCount + failedCount)) * 100` (`0` if no completed deliveries).
- **`recentHealth` (24-Hour Window)**: Aggregates created, delivered, failed, exhausted, and total retry attempts within the last 24 hours (`86,400,000ms`).

### Security & Privacy Safeguards

- **Zero PII/SPI leakage**: Response contains ONLY aggregate numeric counters, percentages, and millisecond ages.
- **Excluded Fields**: `userId`, `PAN`, `panHash`, `panEncrypted`, notification `title`, `message`, `metadata`, `providerMessageId`, and raw error payloads are explicitly **excluded**.
- **Read-Only Scope**: Phase 29.8 provides visibility only. No mutation endpoints (e.g. manual retry, force delivery, status override) are introduced in this phase.
- **Efficiency**: Database aggregation uses native Postgres `count`, `groupBy`, `aggregate`, and top-1 `findFirst` timestamp selections, avoiding in-memory table loading or N+1 query patterns.
