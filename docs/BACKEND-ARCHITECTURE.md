# Backend Architecture

## IPOVault — Backend Architecture Specification

**Status:** Proposed  
**Version:** 1.0  
**Purpose:** Establish the backend foundation for IPOVault before implementing automated IPO discovery, allotment checking, notifications, analytics, or other server-side capabilities.

---

# 1. Executive Summary

IPOVault currently has no backend.

The backend will become the authoritative server-side system for:

- IPO data
- Company data
- IPO lifecycle
- External-source ingestion
- Data normalization and validation
- Source provenance
- Change detection
- Subscription data
- GMP data
- Allotment integrations
- User accounts
- User IPO applications
- Notifications
- Analytics
- Portfolio/history

The mobile application must consume the backend through a stable API and must not contain source-ingestion, scraping, data-authority, or canonicalization logic.

The initial architecture should be a **modular monolith**, not microservices.

```text
                         EXTERNAL SOURCES
                              │
             ┌────────────────┼────────────────┐
             │                │                │
           SEBI              NSE              BSE
             │                │                │
             └────────────────┼────────────────┘
                              ↓
                       INGESTION LAYER
                              ↓
                    DISCOVERY / PROCESSING
                              ↓
                    VALIDATION + MATCHING
                              ↓
                      CANONICAL DATABASE
                              ↓
                       DOMAIN SERVICES
                              ↓
                         REST API
                              ↓
                       MOBILE APP
```

---

# 2. Architecture Goals

## Primary goals

1. Build a reliable backend from zero.
2. Keep the architecture simple enough for a small development team.
3. Make IPO data the central domain.
4. Make external source integration replaceable.
5. Preserve raw evidence and field provenance.
6. Make ingestion idempotent.
7. Make data changes auditable.
8. Keep mobile and backend responsibilities clearly separated.
9. Support future background jobs and notifications.
10. Make deployment inexpensive initially but scalable later.

## Non-goals for the first backend release

Do not initially build:

- Microservices
- Kubernetes
- Event-driven infrastructure spanning multiple services
- Complex distributed caching
- Machine-learning recommendation systems
- High-frequency trading infrastructure
- Over-engineered CQRS/event sourcing

These can be introduced only when actual requirements justify them.

---

# 3. Recommended Technology Stack

## Backend

**Node.js + TypeScript**

Recommended framework:

**NestJS**

Reasons:

- Strong modular structure
- Dependency injection
- Clear separation of controllers/services/modules
- Good TypeScript support
- Background-job integrations are straightforward
- Easier for AI coding agents to navigate consistently
- Suitable for a modular monolith

Fastify can be used as the HTTP adapter if performance is important, but the initial implementation should prioritize maintainability.

## Database

**PostgreSQL**

PostgreSQL should be the primary persistent datastore.

It will store:

- canonical IPO data
- companies
- lifecycle events
- sources
- discovery records
- provenance
- changes
- users
- applications
- notifications
- analytics-related historical data

## ORM

**Prisma**

Use Prisma for:

- schema definition
- migrations
- type-safe database access
- development ergonomics

Do not bypass the ORM casually. Raw SQL should be reserved for cases where it provides a clear benefit.

## API

**REST API**

Start with REST rather than GraphQL.

Use versioning:

```text
/api/v1/...
```

## Background jobs

Initially use:

**Redis + BullMQ**

Jobs will eventually handle:

- IPO discovery
- source refresh
- subscription refresh
- GMP refresh
- allotment checks
- notification delivery
- source health checks

Do not introduce Redis until the first job-processing requirement exists if avoiding unnecessary infrastructure during the initial bootstrap is important. The architecture should nevertheless isolate job execution behind a service boundary so Redis/BullMQ can be added without rewriting domain logic.

## Validation

Use a TypeScript validation library such as **Zod** or NestJS-compatible DTO validation.

The project must choose one validation approach and use it consistently.

## Testing

Use:

- unit tests
- integration tests
- API/e2e tests
- database-backed tests where appropriate

Recommended runner:

**Vitest** or **Jest**

Choose one and standardize it.

---

# 4. Architectural Style

Use a **modular monolith**.

```text
                    IPOVault Backend
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
      Domain             Jobs               API
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                       PostgreSQL
```

Each domain should be isolated internally.

Recommended modules:

```text
src/
├── modules/
│   ├── companies/
│   ├── ipos/
│   ├── discovery/
│   ├── sources/
│   ├── subscriptions/
│   ├── gmp/
│   ├── allotment/
│   ├── users/
│   ├── applications/
│   ├── notifications/
│   └── portfolio/
│
├── database/
├── jobs/
├── auth/
├── common/
├── config/
└── main.ts
```

Not all modules need to be implemented immediately.

---

# 5. Layering Rules

Each module should follow a consistent internal structure.

Example:

```text
ipos/
├── ipo.controller.ts
├── ipo.service.ts
├── ipo.repository.ts
├── ipo.types.ts
├── ipo.dto.ts
├── ipo.mapper.ts
└── ipo.module.ts
```

Use these responsibilities:

### Controller

Handles:

- HTTP requests
- authentication/authorization boundary
- request validation
- response mapping

Controllers should not contain business logic.

### Service

Handles:

- domain operations
- business rules
- orchestration

### Repository

Handles:

- database persistence
- queries
- transactions

### DTO

Defines:

- API input/output contracts

### Mapper

Converts:

- database models → API models
- domain models → persistence models where necessary

---

# 6. Dependency Direction

Preferred direction:

```text
Controller
    ↓
Service
    ↓
Repository
    ↓
Database
```

For discovery:

```text
Source Adapter
    ↓
Discovery Service
    ↓
Normalization
    ↓
Validation
    ↓
Matching
    ↓
Canonicalization
    ↓
Repository
```

Do not allow controllers to directly manipulate database records.

Do not allow mobile-specific logic inside the database layer.

---

# 7. Project Structure

Recommended initial repository structure:

```text
backend/
├── src/
│   ├── main.ts
│   │
│   ├── config/
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   └── env.validation.ts
│   │
│   ├── common/
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── pagination/
│   │   ├── types/
│   │   └── utils/
│   │
│   ├── auth/
│   │
│   ├── modules/
│   │   ├── companies/
│   │   ├── ipos/
│   │   ├── sources/
│   │   ├── discovery/
│   │   ├── subscriptions/
│   │   ├── gmp/
│   │   ├── allotment/
│   │   ├── users/
│   │   ├── applications/
│   │   ├── notifications/
│   │   └── portfolio/
│   │
│   └── jobs/
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── test/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

The exact naming can follow the existing repository conventions if they differ, but the architectural boundaries should remain.

---

# 8. Configuration Management

Never hardcode:

- database credentials
- API keys
- authentication secrets
- source credentials
- encryption keys

Use environment variables.

Example:

```text
NODE_ENV=
PORT=

DATABASE_URL=

REDIS_URL=

JWT_SECRET=

LOG_LEVEL=
```

Provide:

```text
.env.example
```

but never commit the real `.env`.

Validate required environment variables at startup.

If configuration is invalid, the application should fail clearly rather than start with unsafe defaults.

---

# 9. Database Architecture

PostgreSQL is the system of record.

Core domain tables initially:

```text
companies
ipos
ipo_lifecycle_events
sources
discovery_records
field_provenance
ipo_change_events
```

Future tables:

```text
ipo_subscriptions
ipo_gmp_history
ipo_documents
users
user_ipo_applications
notifications
portfolio_positions
```

The database schema must follow the separate:

`IPO-DATA-MODEL.md`

document.

Do not duplicate or independently redefine the IPO schema in application code.

---

# 10. Database Rules

## Migrations

All schema changes must use versioned migrations.

Never modify production schema manually without recording the equivalent migration.

## Transactions

Use transactions for operations that update multiple related records.

Example:

```text
Canonical IPO update
    +
Field provenance
    +
Change event
```

These should be atomic.

## Indexes

Add indexes based on:

- lookup patterns
- foreign keys
- status
- dates
- source identifiers
- unique identity constraints

Do not add indexes blindly.

---

# 11. API Architecture

Base path:

```text
/api/v1
```

Public IPO endpoints:

```text
GET /api/v1/ipos
GET /api/v1/ipos/upcoming
GET /api/v1/ipos/open
GET /api/v1/ipos/closed
GET /api/v1/ipos/listing-soon
GET /api/v1/ipos/:id
GET /api/v1/ipos/:id/timeline
```

Future endpoints:

```text
GET /api/v1/ipos/:id/subscription
GET /api/v1/ipos/:id/gmp
GET /api/v1/ipos/:id/financials
GET /api/v1/ipos/:id/valuation
GET /api/v1/ipos/:id/analysis
```

User endpoints:

```text
GET /api/v1/me
GET /api/v1/me/applications
POST /api/v1/me/applications
GET /api/v1/me/portfolio
```

Admin endpoints should be separated logically:

```text
/api/v1/admin/...
```

---

# 12. API Response Contract

Use consistent response structures.

Successful collection:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

Successful single resource:

```json
{
  "data": {}
}
```

Error:

```json
{
  "error": {
    "code": "IPO_NOT_FOUND",
    "message": "IPO was not found",
    "requestId": "..."
  }
}
```

Do not expose:

- raw database errors
- stack traces
- source credentials
- internal infrastructure details

in production responses.

---

# 13. API Versioning

Use:

```text
/api/v1
```

Do not break existing mobile clients silently.

If a breaking API change becomes necessary:

```text
/api/v2
```

or provide a compatible migration path.

---

# 14. Pagination

Any endpoint that can return an unbounded collection must support pagination.

Example:

```text
GET /api/v1/ipos?page=1&limit=20
```

Set a safe maximum page size.

Do not allow clients to request unlimited records.

---

# 15. Authentication

Authentication is not required for public IPO browsing.

Authentication becomes necessary for:

- user applications
- allotment tracking tied to user data
- watchlists
- notifications
- portfolio
- personal analytics

The authentication implementation should be isolated so public IPO APIs do not depend on user authentication.

---

# 16. Authorization

At minimum define:

```text
PUBLIC
USER
ADMIN
```

Potential future roles:

```text
SUPER_ADMIN
DATA_REVIEWER
```

Admin-only operations include:

- approving discovery records
- overriding canonical data
- managing sources
- viewing source errors
- triggering jobs
- reviewing conflicts

---

# 17. Discovery Architecture

Discovery is a backend subsystem, not an API endpoint.

```text
Scheduler
    ↓
Source Adapter
    ↓
Raw Ingestion
    ↓
Discovery Record
    ↓
Parser
    ↓
Normalizer
    ↓
Validator
    ↓
Company Matcher
    ↓
IPO Matcher
    ↓
Canonicalizer
    ↓
Provenance
    ↓
Change Detection
```

See:

`IPO-DISCOVERY-ARCHITECTURE.md`

for detailed rules.

---

# 18. Source Adapter Boundary

Source-specific logic must remain isolated.

Example:

```text
discovery/
├── adapters/
│   ├── nse/
│   ├── bse/
│   ├── sebi/
│   └── company/
│
├── discovery.service.ts
├── normalization/
├── validation/
├── matching/
└── discovery.module.ts
```

An adapter must never:

- write arbitrary canonical data
- contain mobile/UI logic
- contain notification logic
- bypass validation

Adapters produce structured observations.

---

# 19. Background Jobs

Jobs should be independent from HTTP request handling.

Examples:

```text
ipo.discovery
ipo.refresh
ipo.subscription.refresh
ipo.gmp.refresh
ipo.allotment.check
notification.dispatch
source.health_check
```

Job properties:

- retryable where appropriate
- idempotent
- observable
- bounded
- rate-limited according to source requirements

Long-running ingestion must never block an API request.

---

# 20. Scheduling Strategy

The exact cadence is source-specific.

Conceptually:

```text
DISCOVERY
→ periodic

KNOWN IPO REFRESH
→ periodic

ACTIVE IPO
→ more frequent

ALLOTMENT WINDOW
→ focused refresh

LISTING WINDOW
→ focused refresh
```

Do not create unnecessary high-frequency polling.

Respect:

- source terms
- rate limits
- access permissions
- licensing
- operational constraints

---

# 21. Caching

Caching should be introduced only where useful.

Potential cache candidates:

- IPO list
- upcoming IPO list
- IPO detail
- static company metadata

Do not cache data so aggressively that users receive stale time-sensitive IPO information.

Dynamic data should have explicit freshness semantics.

---

# 22. Logging

Use structured logs.

Every request should have a request ID.

Example:

```json
{
  "level": "info",
  "requestId": "...",
  "method": "GET",
  "path": "/api/v1/ipos",
  "status": 200,
  "durationMs": 42
}
```

Discovery jobs should log:

```text
source
job ID
records fetched
records parsed
records rejected
records created
duplicates
conflicts
duration
```

Never log secrets or sensitive user data.

---

# 23. Error Handling

Define application-level error codes.

Examples:

```text
IPO_NOT_FOUND
COMPANY_NOT_FOUND
INVALID_DISCOVERY
SOURCE_UNAVAILABLE
SOURCE_PARSE_FAILED
AMBIGUOUS_COMPANY_MATCH
DUPLICATE_DISCOVERY
UNAUTHORIZED
FORBIDDEN
VALIDATION_ERROR
RATE_LIMITED
INTERNAL_ERROR
```

Errors should be predictable for the mobile application.

---

# 24. Observability

Track backend health separately from source health.

### Backend

```text
API uptime
API latency
error rate
database health
job queue health
```

### Source

```text
fetch success
fetch failures
parser failures
staleness
unexpected schema changes
```

### Discovery

```text
records discovered
records matched
records created
duplicates
manual reviews
conflicts
```

---

# 25. Security Baseline

Implement:

- HTTPS in production
- secure secret management
- input validation
- rate limiting
- authentication for protected endpoints
- authorization
- secure password handling if passwords are used
- database least-privilege access
- dependency updates
- security headers
- CORS policy
- request-size limits

Do not expose the database directly to the mobile app.

---

# 26. Data Privacy

User-specific data must be separated logically from public IPO data.

Public:

```text
IPO
Company
Subscription
GMP
Listing
```

Private:

```text
User
Application
PAN-related data if ever stored
Allotment tracking data
Portfolio
Notification preferences
```

Do not collect sensitive information unless a feature genuinely requires it.

If PAN or other sensitive identifiers are introduced later, perform a dedicated privacy/security design before storing them.

---

# 27. External Source Access

Use permitted access methods.

Prefer:

1. official API/feed
2. official downloadable data
3. permitted public endpoints
4. permitted document retrieval

Do not design the system around:

- CAPTCHA bypass
- authentication bypass
- anti-bot circumvention
- rate-limit evasion
- unauthorized access

Every source should have documented access assumptions.

---

# 28. Deployment Architecture

Initial production deployment can be a single server/container.

```text
                 Internet
                    │
                    ▼
              Reverse Proxy
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
       API Server          Job Worker
          │                   │
          └─────────┬─────────┘
                    ▼
                PostgreSQL
                    │
                  Redis
```

The API and worker can initially run on the same VM.

As usage grows, separate them.

---

# 29. Containerization

Use Docker for reproducible deployment.

Recommended services:

```text
api
worker
postgres
redis
```

For local development:

```text
docker compose up
```

Production deployment should use secure credentials and persistent storage.

---

# 30. Environment Strategy

Support:

```text
development
test
staging
production
```

At minimum:

```text
Development
→ local database

Test
→ isolated test database

Production
→ managed/persistent database
```

Avoid testing against production data.

---

# 31. CI/CD

Every pull request should ideally run:

```text
install
↓
lint
↓
typecheck
↓
unit tests
↓
integration tests
↓
build
```

Deployment should happen only after required checks pass.

Database migrations should be explicitly controlled during deployment.

---

# 32. Testing Strategy

## Unit tests

Test:

- normalization
- validation
- matching
- conflict resolution
- change detection
- business rules

## Integration tests

Test:

- database repositories
- transactions
- discovery persistence
- canonicalization

## E2E/API tests

Test:

```text
GET /api/v1/ipos
GET /api/v1/ipos/:id
```

and protected user/admin endpoints.

## Source fixture tests

Each source adapter should have stored fixtures representing realistic source responses.

This is especially important because external source formats can change.

---

# 33. Data Integrity

Never allow:

```text
source failure
    ↓
canonical field becomes null
```

Never allow:

```text
duplicate source observation
    ↓
duplicate IPO
```

Never allow:

```text
ambiguous company
    ↓
automatic destructive merge
```

Never allow:

```text
canonical update
    ↓
missing provenance
```

---

# 34. API ↔ Mobile App Contract

The mobile app should treat the backend as the source of truth for server-owned IPO data.

The mobile app may cache API responses for UX/performance.

It must not independently decide:

- IPO status
- source authority
- company identity
- IPO identity
- subscription truth
- canonical price band
- canonical dates

---

# 35. Mobile Offline Behavior

The mobile app should degrade gracefully when the backend is unavailable.

Recommended behavior:

```text
Fresh API data
    ↓
Local cache
    ↓
Show cached data with stale indicator
```

Do not silently present old time-sensitive data as current.

---

# 36. Domain Events

Do not build a full event-sourcing architecture.

However, important domain events should be represented internally.

Examples:

```text
IPO_CREATED
IPO_UPDATED
IPO_STATUS_CHANGED
IPO_DATE_CHANGED
IPO_PRICE_CHANGED
SUBSCRIPTION_UPDATED
ALLOTMENT_AVAILABLE
IPO_LISTED
```

These can later trigger:

```text
notifications
analytics
audit logs
```

without coupling those systems directly to the core IPO service.

---

# 37. Notification Architecture

Future structure:

```text
Domain Change
      ↓
Event
      ↓
Notification Rules
      ↓
User Preferences
      ↓
Notification Queue
      ↓
Push Provider
```

The IPO service should not directly send push notifications.

---

# 38. Auditability

Administrative changes must be auditable.

For manual overrides record:

```text
actor
entity
field
old value
new value
reason
timestamp
```

Source-derived changes should also retain:

```text
source
retrieval time
observation
canonical result
```

---

# 39. Performance Principles

Do not optimize prematurely.

Initial targets:

- fast IPO list response
- fast IPO detail response
- database queries using appropriate indexes
- background processing for slow external operations
- pagination on collections

Avoid:

- scraping during API requests
- expensive calculations on every request
- N+1 database queries
- loading entire IPO history when only a summary is needed

---

# 40. Scalability Path

Initial:

```text
1 API
1 Worker
1 PostgreSQL
1 Redis
```

Later:

```text
Multiple API instances
Multiple workers
Managed PostgreSQL
Managed Redis
CDN/cache
```

Only split domains into microservices if operational scale genuinely requires it.

---

# 41. Development Rules for AI Coding Agents

Cursor and Antigravity must treat the documentation in `/docs` as the architectural source of truth.

Before changing architecture:

1. Inspect existing implementation.
2. Inspect relevant docs.
3. Explain the proposed change.
4. Identify affected modules.
5. Avoid unrelated refactoring.
6. Implement the smallest coherent change.
7. Add/update tests.
8. Verify build/typecheck.
9. Update documentation if the architecture changed.

AI agents must not:

- invent duplicate database models
- create alternate IPO schemas
- introduce microservices without approval
- hardcode external source URLs throughout business logic
- place scraping logic in mobile code
- bypass validation
- silently change API contracts
- remove data to fix a duplication problem
- commit secrets

---

# 42. Cursor Development Workflow

Use a staged implementation.

## Stage 1 — Backend bootstrap

```text
Node.js
TypeScript
NestJS
Prisma
PostgreSQL
configuration
logging
testing
```

## Stage 2 — Database foundation

Implement the approved schema.

## Stage 3 — Health API

Build:

```text
GET /api/v1/health
```

Confirm:

```text
Backend → Database
```

works.

## Stage 4 — IPO read API

Implement:

```text
GET /api/v1/ipos
GET /api/v1/ipos/:id
```

## Stage 5 — Connect mobile app

Replace temporary/static IPO data with API data.

## Stage 6 — Discovery foundation

Implement:

```text
Source
DiscoveryRecord
Adapter interface
Raw ingestion
Normalization
Validation
```

## Stage 7 — First source

Implement exactly one permitted source adapter.

## Stage 8 — Matching/canonicalization

Implement company and IPO matching.

## Stage 9 — Provenance/change detection

Implement source traceability and change events.

## Stage 10 — Jobs

Introduce Redis/BullMQ when background processing is ready.

---

# 43. Antigravity Development Workflow

Antigravity should primarily work on the application layer once the API contract is stable.

Preferred sequence:

```text
API contract
    ↓
IPO list
    ↓
IPO detail
    ↓
Loading states
    ↓
Empty states
    ↓
Error states
    ↓
Pull-to-refresh
    ↓
Local caching
```

Do not allow the UI agent to invent backend behavior when an API contract already exists.

---

# 44. First Vertical Slice

The first complete backend milestone is:

```text
PostgreSQL
    ↓
Company
    ↓
IPO
    ↓
API
    ↓
Mobile App
```

Then:

```text
One permitted source
    ↓
Discovery
    ↓
Database
    ↓
API
    ↓
Mobile App
```

This proves the entire architecture before adding complexity.

---

# 45. Definition of Done — Backend Foundation

The backend foundation is complete when:

- TypeScript backend starts successfully.
- Environment validation works.
- PostgreSQL connection works.
- Prisma migrations work.
- Health endpoint works.
- Structured logging works.
- Error handling is consistent.
- Tests execute successfully.
- IPO/Company schema is migrated.
- IPO API works.
- API versioning exists.
- Mobile app can consume the API.
- Secrets are not committed.
- Docker/local development works.
- CI can build and test the backend.

---

# 46. Definition of Done — Discovery Foundation

Discovery is complete when:

- Source registry exists.
- Source adapter contract exists.
- Raw discovery records are persisted.
- Normalization exists.
- Validation exists.
- Company matching exists.
- IPO matching exists.
- Duplicate detection is idempotent.
- Canonicalization works transactionally.
- Provenance is stored.
- Change events are stored.
- Source failures do not corrupt canonical data.
- Admin review exists for ambiguous records.
- One real source works end-to-end.

---

# 47. Architectural Decision Summary

| Decision | Choice |
|---|---|
| Architecture | Modular monolith |
| Language | TypeScript |
| Runtime | Node.js |
| Framework | NestJS |
| Database | PostgreSQL |
| ORM | Prisma |
| API | REST |
| API version | `/api/v1` |
| Jobs | BullMQ + Redis when needed |
| Authentication | Add when user-specific features require it |
| Deployment | Dockerized single-server start |
| Discovery | Adapter-based |
| Data source of truth | Canonical PostgreSQL data |
| Raw evidence | Persisted |
| Provenance | Field-level |
| Change history | Explicit events |
| Mobile data access | API only |
| Microservices | Not initially |

---

# 48. Guiding Principle

The backend should be designed around one fundamental idea:

> **IPOVault is a data platform first and a mobile interface second.**

The mobile app is the presentation and user-interaction layer.

The backend owns:

```text
identity
truth
history
source evidence
business rules
automation
```

If this separation is maintained from the beginning, IPO discovery, allotment checking, notifications, analytics, and portfolio functionality can all be added without rebuilding the foundation.
