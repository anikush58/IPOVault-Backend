# IPOVault Backend

Server-side API for IPOVault, an Indian IPO data platform. The backend owns canonical IPO and company data, source evidence, and future automation. The mobile app will consume this API; it is not part of this repository.

**Phase 1** is the application foundation only. PostgreSQL, Prisma, IPO APIs, and discovery are not implemented yet.

## Stack

- Node.js 20+
- TypeScript (strict)
- NestJS
- REST (`/api/v1`)
- Zod environment validation
- Pino structured logging
- Jest

## Setup

```bash
npm install
cp .env.example .env
```

## Configure

Edit `.env` using `.env.example` as the template. Phase 1 variables:

- `NODE_ENV` — `development` | `test` | `staging` | `production`
- `PORT` — HTTP port (default `3000`)
- `LOG_LEVEL` — Pino level (default `info`)
- `CORS_ORIGINS` — comma-separated allowed origins

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

## Test

```bash
npm test
```

Unit tests: `npm run test:unit`  
API tests: `npm run test:e2e`  
Typecheck: `npm run typecheck`  
Lint: `npm run lint`

## Current API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Process liveness. Does **not** report database status. |

Example:

```json
{
  "data": {
    "status": "ok"
  }
}
```

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

- Database / Prisma / migrations
- Docker
- IPO, company, source, or discovery APIs
- Scraping, jobs, Redis, or authentication
