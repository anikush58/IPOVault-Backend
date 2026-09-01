# IPOVault Backend

Server-side API for IPOVault, an Indian IPO data platform. The backend owns canonical IPO and company data, source evidence, and future automation. The mobile app will consume this API; it is not part of this repository.

**Phase 3** adds canonical IPO read APIs. Discovery, write APIs, and user features are not implemented yet.

## Stack

- Node.js 20+
- TypeScript (strict)
- NestJS
- PostgreSQL 16
- Prisma (schema + migrations)
- REST (`/api/v1`)
- Zod environment validation
- Pino structured logging
- Jest

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d
npx prisma migrate deploy
```

`docker compose` starts PostgreSQL only (databases `ipovault` and `ipovault_test`). If Docker is unavailable, create equivalent local databases and set `DATABASE_URL`.

## Configure

Edit `.env` using `.env.example` as the template:

- `NODE_ENV` — `development` | `test` | `staging` | `production`
- `PORT` — HTTP port (default `3000`)
- `LOG_LEVEL` — Pino level (default `info`)
- `CORS_ORIGINS` — comma-separated allowed origins
- `DATABASE_URL` — PostgreSQL connection URL (required)

Optional for tests: `TEST_DATABASE_URL` (defaults to `postgresql://ipovault:ipovault@localhost:5432/ipovault_test`).

The process exits on startup if configuration is invalid.

## Run

```bash
npm run start:dev
```

Production-style run after build:

```bash
npm run build
npm run start:prod
```

Apply migrations in production with `npx prisma migrate deploy` (not `db push`).

## Test

Migrate the test database, then run tests:

```bash
# PowerShell
$env:DATABASE_URL="postgresql://ipovault:ipovault@localhost:5432/ipovault_test"
npx prisma migrate deploy
npm test
```

```bash
# POSIX
DATABASE_URL=postgresql://ipovault:ipovault@localhost:5432/ipovault_test npx prisma migrate deploy
npm test
```

Unit tests: `npm run test:unit`  
API tests: `npm run test:e2e`  
Integration tests: `npm run test:integration`  
Typecheck: `npm run typecheck`  
Lint: `npm run lint`

## Current API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Process liveness and PostgreSQL connectivity |
| `GET` | `/api/v1/ipos` | Paginated canonical IPO list |
| `GET` | `/api/v1/ipos/:id` | Canonical IPO detail |

`GET /api/v1/ipos` query parameters:

- `status`, `marketSegment`, `exchange` — optional exact-match filters
- `page` — default `1`
- `limit` — default `20`, maximum `100`

Health example:

```json
{
  "data": {
    "status": "ok",
    "database": "up"
  }
}
```

If PostgreSQL is unreachable, the endpoint returns `503` with the standard error envelope.

Every response includes `X-Request-Id`. Errors use:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "The requested resource was not found",
    "requestId": "..."
  }
}
```

## Not in this phase

- Discovery, scraping, or source adapters
- Subscriptions, GMP, allotment, notifications, or analytics
- User accounts or authentication
- Redis / workers in Docker Compose
