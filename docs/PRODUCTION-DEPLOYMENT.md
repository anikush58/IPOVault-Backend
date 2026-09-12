# IPOVault Backend — Production Deployment & Operational Guide

This document defines the official production configuration, operational boundaries, and deployment procedures for the IPOVault Backend on Oracle Cloud Always Free VM (Ubuntu ARM64 / x86_64).

---

## 1. Prerequisites

- **Node.js**: `>= 20.0.0` (LTS)
- **Database**: PostgreSQL 15+ instance with `public` schema
- **Process Manager**: `systemd` or `pm2` or Docker container
- **Reverse Proxy**: NGINX / Cloudflare / Oracle Cloud Load Balancer (SSL Termination, Rate Limiting, Header Sanitization)

---

## 2. Production Environment Variables

Configure environment variables in systemd service file, `.env.production`, or container environment:

| Variable | Required | Default in Dev | Recommended Production Value | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | **Yes** | `development` | `production` | Enables production optimizations and security rules |
| `PORT` | No | `3000` | `3000` | HTTP listening port for NestJS server |
| `LOG_LEVEL` | No | `info` | `info` | Logging verbosity (`error`, `warn`, `info`, `debug`) |
| `DATABASE_URL` | **Yes** | — | `postgresql://user:pass@host:5432/ipovault` | PostgreSQL connection string |
| `CORS_ORIGINS` | **Yes** | `http://localhost:3000` | `https://ipovault.app` | Comma-separated list of allowed web origins |
| `ENABLE_DATA_CONSOLE` | No | `true` | `false` | Disables internal developer Data Console endpoints |
| `NOTIFICATION_WORKER_ENABLED` | No | `true` | `true` | Enables background notification delivery worker |
| `NOTIFICATION_WORKER_BATCH_SIZE` | No | `50` | `50` | Maximum deliveries claimed per worker tick |
| `NOTIFICATION_WORKER_INTERVAL_MS` | No | `10000` | `10000` | Worker tick interval in milliseconds |
| `NSE_IPO_ENDPOINT` | No | — | `https://www.nseindia.com/api/ipo-detail` | Production NSE API URL |
| `SEBI_IPO_ENDPOINT` | No | — | `https://www.sebi.gov.in/sebiweb/ajax/docs/` | Production SEBI AJAX listing URL |

> [!CAUTION]
> **Secrets Safety**: `DATABASE_URL` and API credentials must NEVER be committed to Git or printed in application logs.

---

## 3. Database Deployment & Migration Procedure

Do **NOT** run `prisma db push` or automated migrations on application startup.

### Pre-Deployment Migration Command

Before starting the new backend version, run standard Prisma migration deployment:

```bash
npx prisma migrate deploy
```

This applies unapplied SQL migrations from `prisma/migrations/` safely without mutating existing canonical data.

---

## 4. Build & Start Commands

### Production Build
```bash
npm run build
```
Generates production Javascript artifacts in `./dist/`.

### Production Start
```bash
NODE_ENV=production npm run start:prod
```
Executes `node dist/src/main`.

---

## 5. Health & Readiness Observability

The backend exposes two dedicated operational endpoints:

### Liveness Endpoint (`GET /api/v1/health`)
- **Purpose**: Checks if the NestJS process is alive and responding.
- **HTTP Status**: `200 OK`
- **Response**:
```json
{
  "status": "ok",
  "database": "up"
}
```

### Readiness Endpoint (`GET /api/v1/ready`)
- **Purpose**: Checks if the application and PostgreSQL database connectivity are ready to serve traffic.
- **Query**: `SELECT 1` against PostgreSQL.
- **HTTP Status when Ready**: `200 OK`
- **HTTP Status when Unhealthy**: `503 SERVICE_UNAVAILABLE`
- **Response when Ready**:
```json
{
  "status": "ok",
  "database": "up"
}
```

---

## 6. Reverse Proxy & Rate Limiting

The application modular monolith handles core business logic and database safety. External security controls should be enforced at the reverse proxy (NGINX / WAF):

1. **SSL Termination**: NGINX terminates HTTPS on port 443 and proxies HTTP to `127.0.0.1:3000`.
2. **Rate Limiting**:
   - Limit `/api/v1/allotment/check` to 10 requests/minute per IP.
   - Limit `/api/v1/allotment/jobs` to 5 requests/minute per IP.
3. **Developer Console Protection**:
   - `ENABLE_DATA_CONSOLE` should be set to `false`.
   - If enabled for internal debugging, restrict IP access via NGINX `allow` rules.

---

## 7. Graceful Shutdown & Operational Resilience

- NestJS shutdown hooks (`app.enableShutdownHooks()`) handle `SIGTERM` and `SIGINT` signals.
- On receiving `SIGTERM` (e.g. `systemctl stop ipovault`), NestJS cleanly:
  1. Stops accepting new incoming HTTP connections.
  2. Clears background scheduler timers (`NotificationDeliverySchedulerService`).
  3. Disconnects PostgreSQL client connections (`PrismaService.$disconnect()`).

---

## 8. Log Management & Backups

- Logs are written to `stdout`/`stderr` in JSON format.
- Systemd captures logs into `journalctl`:
  ```bash
  journalctl -u ipovault-backend -f
  ```
- Backup database daily via `pg_dump`:
  ```bash
  pg_dump -U ipovault ipovault > ipovault_backup_$(date +%F).sql
  ```

---

## 9. Rollback Plan

If a deployment issue occurs:
1. Stop service: `systemctl stop ipovault-backend`
2. Checkout previous git commit/tag: `git checkout <previous_version_tag>`
3. Rebuild: `npm run build`
4. Start service: `systemctl start ipovault-backend`
