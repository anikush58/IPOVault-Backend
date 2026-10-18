# IPOVault Backend — Production Deployment & Operational Guide

This document defines the official production configuration, operational boundaries, and deployment procedures for the IPOVault Backend on Oracle Cloud Always Free VM running **Ubuntu 24.04.5 LTS (ARM64 Ampere A1)**.

---

## 1. Prerequisites

- **Target OS**: Ubuntu 24.04.5 LTS ARM64
- **Node.js**: `v22.23.2` via NVM (`/home/ubuntu/.nvm/versions/node/v22.23.2/bin/node`)
- **Database**: PostgreSQL 16.15 instance running on `127.0.0.1:5432` with `public` schema
- **Process Manager**: `systemd` (`/etc/systemd/system/ipovault-backend.service`)
- **Reverse Proxy**: NGINX (SSL Termination, Rate Limiting, Header Sanitization)
- **Application Directory**: `/home/ubuntu/IPOVault-Backend`
- **Production Domain**: `api.getipovault.in`

---

## 2. Production Environment Variables

Configure environment variables in `/home/ubuntu/IPOVault-Backend/.env` (permissions `600`):

| Variable | Required in Prod? | Default in Dev | Recommended Production Setting | Description |
| :--- | :--- | :--- | :--- | :--- |
| `NODE_ENV` | **YES** | `development` | `production` | Enables production optimizations and security rules |
| `PORT` | No | `3000` | `3000` | HTTP listening port for NestJS server |
| `LOG_LEVEL` | No | `info` | `info` | Logging verbosity (`error`, `warn`, `info`, `debug`) |
| `DATABASE_URL` | **YES** | — | `postgresql://ipovault_app:PASSWORD@127.0.0.1:5432/ipovault?schema=public` | PostgreSQL 16 connection string |
| `CORS_ORIGINS` | **YES** | `http://localhost:3000` | `https://ipovault.app,https://admin.ipovault.app` | Comma-separated allowed web origins |
| `ENABLE_DATA_CONSOLE` | No | `true` | `false` | Disables internal developer Data Console endpoints |
| `NOTIFICATION_WORKER_ENABLED` | No | `true` | `true` | Enables background notification delivery worker |
| `NOTIFICATION_WORKER_BATCH_SIZE` | No | `50` | `50` | Maximum deliveries claimed per worker tick |
| `NOTIFICATION_WORKER_INTERVAL_MS` | No | `10000` | `10000` | Worker tick interval in milliseconds |
| `NSE_IPO_ENDPOINT` | No | — | `https://www.nseindia.com/api/ipo-detail` | Production NSE API URL |
| `SEBI_IPO_ENDPOINT` | No | — | `https://www.sebi.gov.in/sebiweb/ajax/docs/` | Production SEBI AJAX listing URL |
| `ACCOUNT_DELETION_TOKEN_SECRET` | **YES** | — | Generated 32+ char hex | HMAC signing secret for account deletion confirmation tokens |
| `RESEND_API_KEY` | **YES** | — | `re_...` | Resend API key for transactional email delivery |
| `EMAIL_FROM` | No | `IPOVault Security <noreply@getipovault.in>` | `IPOVault Security <noreply@getipovault.in>` | Sender address for transactional emails |
| `PUBLIC_APP_URL` | No | `https://getipovault.in` | `https://getipovault.in` | Canonical base URL for email confirmation links |

### Resend Sender-Domain Verification & Titan Mail Preservation (Owner Action)

> [!WARNING]
> **CRITICAL: DO NOT OVERWRITE TITAN MAIL ROOT MX RECORDS!**  
> `getipovault.in` uses Titan Mail for inbound business mailboxes (`support@getipovault.in`, `admin@getipovault.in`).  
> **Root MX records (`mx1.titan.email`, `mx2.titan.email`) must remain untouched.** Overwriting root MX records with Resend will break your incoming business email.

To configure Resend without impacting Titan Mail:
1. Log in to the [Resend Dashboard](https://resend.com/domains) and add domain `getipovault.in`.
2. In your DNS manager (e.g. GoDaddy), configure DNS records as follows:
   - **Root MX Records (DO NOT TOUCH):** Retain existing Titan MX records on `@` (`mx1.titan.email`, `mx2.titan.email`).
   - **DKIM (`TXT`):** Name `resend._domainkey.getipovault.in` $\rightarrow$ public key string provided by Resend. (Does not conflict with Titan).
   - **SPF (`TXT` - MERGE, DO NOT DUPLICATE):** RFC 7208 forbids multiple SPF records. Merge Titan and Resend into a single `TXT` record on `@`:
     ```text
     v=spf1 include:spf.titan.email include:amazonses.com ~all
     ```
   - **DMARC (`TXT`):** Name `_dmarc.getipovault.in` $\rightarrow$ `v=DMARC1; p=none;`.
   - **Return-Path Bounce MX (SUBDOMAIN ONLY):** Name `bounces.getipovault.in` $\rightarrow$ `feedback-smtp.us-east-1.amazonses.com` (priority 10). **Never put Resend MX on the root `@`.**
   - *(Alternative Recommendation):* Add a dedicated sending subdomain in Resend (e.g. `mail.getipovault.in`). This fully isolates transactional email DNS from the root Titan mailbox.
3. Click "Verify Domain" in Resend. Once status reports "Verified", email delivery is operational.

> [!CAUTION]
> **Secrets Safety**: `DATABASE_URL`, `ACCOUNT_DELETION_TOKEN_SECRET`, `RESEND_API_KEY`, and API credentials must NEVER be committed to Git or printed in application logs.

---

## 3. Database Deployment & Migration Procedure

Do **NOT** run `prisma db push` or automated migrations on application startup.

### Pre-Deployment Migration Command

Before launching or restarting the backend process, run standard Prisma migration deployment using standard POSIX environment export:

```bash
cd /home/ubuntu/IPOVault-Backend
export $(grep -v '^#' .env | xargs) && npx prisma migrate deploy
```

This applies unapplied SQL migrations from `prisma/migrations/` safely without mutating existing canonical data.

### Production Migration Inventory & Reconciliation
- **Repository Migrations**: 8 canonical migration directories exist in `prisma/migrations/`.
- **Production `_prisma_migrations` Table**: Contains 10 execution records corresponding exactly to the 8 repository migration names. Note: `20260906211500_add_allotment_jobs_and_saved_pans` contains 2 initial interrupted/failed execution records (`finished_at IS NULL`) from initial server setup before its successful execution row.
- **Verification Status**: Confirmed schema matches repository 100%; `npx prisma migrate status` reports `Database schema is up to date!`.

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
- **Purpose**: Checks if the NestJS process is alive and responding to HTTP requests. Pure in-memory check.
- **Database Dependency**: None (Does **NOT** query PostgreSQL).
- **HTTP Status**: `200 OK`
- **Response**:
```json
{
  "status": "ok"
}
```

### Readiness Endpoint (`GET /api/v1/ready`)
- **Purpose**: Checks if the application and PostgreSQL database connectivity are ready to serve traffic.
- **Database Query**: Performs `SELECT 1` against PostgreSQL.
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

## 6. Reverse Proxy & NGINX Rate Limiting

The application modular monolith handles core business logic and database safety. External security controls should be enforced at NGINX:

### 1. HTTP Context Rate-Limiting Zones (`/etc/nginx/conf.d/rate_limiting.conf`)
Create `/etc/nginx/conf.d/rate_limiting.conf` so directives reside in the NGINX `http` context:
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=allotment_limit:10m rate=10r/m;
```

### 2. Server & Location Configuration (`/etc/nginx/sites-available/ipovault`)
```nginx
server {
    listen 80;
    server_name api.ipovault.app;

    location / {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/v1/allotment/check {
        limit_req zone=allotment_limit burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 7. Graceful Shutdown & Operational Resilience

- NestJS shutdown hooks (`app.enableShutdownHooks()`) handle `SIGTERM` and `SIGINT` signals.
- Systemd service specifies `KillSignal=SIGTERM` and `TimeoutStopSec=15`.
- On receiving `SIGTERM` (e.g. `systemctl stop ipovault-backend`), NestJS cleanly:
  1. Stops accepting new incoming HTTP connections.
  2. Clears background scheduler timers (`NotificationDeliverySchedulerService`).
  3. Disconnects PostgreSQL client connections (`PrismaService.$disconnect()`).

---

## 8. Complete Deployment Runbook

Follow these exact steps to deploy to a fresh Oracle Cloud Ubuntu 22.04 LTS ARM64 VM:

### Step 1: System Package Updates
```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y build-essential curl git unzip nginx certbot python3-certbot-nginx lsb-release ca-certificates gnupg
```

### Step 2: Install PostgreSQL 16 via Official PostgreSQL Repository
```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get install -y postgresql-16 postgresql-client-16
```

### Step 3: Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v # Should be >= 20.0.0
```

### Step 4: Configure Local PostgreSQL Database
```bash
sudo -u postgres psql -c "CREATE USER ipovault_app WITH PASSWORD 'CHANGE_THIS_SECURE_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE ipovault OWNER ipovault_app;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ipovault TO ipovault_app;"
```

### Step 5: Clone Repository
```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone -b feature/allotment-checker https://github.com/anikush58/IPOVault-Backend.git ipovault-backend
cd ipovault-backend
```

### Step 6: Configure Production Environment (`.env.production`)
```bash
cat << 'EOF' > .env.production
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://ipovault_app:CHANGE_THIS_SECURE_PASSWORD@127.0.0.1:5432/ipovault?schema=public
CORS_ORIGINS=https://ipovault.app
ENABLE_DATA_CONSOLE=false
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_WORKER_BATCH_SIZE=50
NOTIFICATION_WORKER_INTERVAL_MS=10000
NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS=300000
EOF

chmod 600 .env.production
```

### Step 7: Install Dependencies & Generate Prisma Client
```bash
npm ci
npm run prisma:generate
```

### Step 8: Deploy Database Migrations
```bash
export $(grep -v '^#' .env.production | xargs) && npx prisma migrate deploy
```

### Step 9: Production Build
```bash
npm run build
```

### Step 10: Configure Systemd Service (`/etc/systemd/system/ipovault-backend.service`)
```bash
sudo cat << 'EOF' > /etc/systemd/system/ipovault-backend.service
[Unit]
Description=IPOVault Backend API
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/var/www/ipovault-backend
EnvironmentFile=/var/www/ipovault-backend/.env.production
ExecStart=/usr/bin/node dist/src/main
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ipovault-backend

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ipovault-backend
sudo systemctl start ipovault-backend
```

### Step 11: Configure NGINX & Rate-Limiting
```bash
sudo cat << 'EOF' > /etc/nginx/conf.d/rate_limiting.conf
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=allotment_limit:10m rate=10r/m;
EOF

sudo cat << 'EOF' > /etc/nginx/sites-available/ipovault
server {
    listen 80;
    server_name api.ipovault.app;

    location / {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/v1/allotment/check {
        limit_req zone=allotment_limit burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/ipovault /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 12: Provision Let's Encrypt TLS Certificate
```bash
sudo certbot --nginx -d api.ipovault.app --non-interactive --agree-tos -m admin@ipovault.app
```

### Step 13: Verify Liveness & Readiness Endpoints
```bash
curl -i https://api.ipovault.app/api/v1/health
# Expected: HTTP 200 OK {"data":{"status":"ok"}}

curl -i https://api.ipovault.app/api/v1/ready
# Expected: HTTP 200 OK {"data":{"status":"ok","database":"up"}}
```

---

## 9. Security Pre-Deployment Checklist

Before exposing the VM to public traffic, verify each requirement:

- [ ] SSH password authentication disabled in `/etc/ssh/sshd_config` (`PasswordAuthentication no`).
- [ ] SSH key authentication active for `ubuntu` user.
- [ ] Non-root `ubuntu` user owns application directory and runs systemd service.
- [ ] `.env.production` permissions restricted (`chmod 600 .env.production`).
- [ ] UFW firewall enabled (`sudo ufw allow 22,80,443/tcp && sudo ufw enable`).
- [ ] PostgreSQL strictly bound to loopback `127.0.0.1:5432` (port 5432 closed to public network).
- [ ] NGINX rate-limiting active (`rate_limiting.conf` in `/etc/nginx/conf.d/`).
- [ ] Let's Encrypt TLS certificate active on NGINX with HTTP→HTTPS redirect.
- [ ] CORS origins configured strictly in `.env.production` (`CORS_ORIGINS=https://ipovault.app`).
- [ ] Developer Data Console disabled (`ENABLE_DATA_CONSOLE=false`).
- [ ] System logs managed via systemd `journalctl` without sensitive credentials or raw PAN leakage.

---

## 10. Automated Database Backups & Operations

### Backup Architecture & Security
- **Backup Script**: `/usr/local/sbin/ipovault-postgres-backup` (owned by `root:root`, mode `755`).
- **Backup Location**: `/var/backups/ipovault` (owned by `postgres:postgres`, mode `0700`, inaccessible to public web servers).
- **Format**: PostgreSQL Custom Format (`pg_dump -Fc -b -d ipovault`).
- **Retention Policy**: Retains up to 23 automated daily dumps (`ipovault_auto_*.dump`). Pre-deployment backups (`ipovault_pre_*.dump`) are explicitly protected from automated pruning.

### Automation via Systemd Timer
- **Service Unit**: `/etc/systemd/system/ipovault-postgres-backup.service` (`Type=oneshot`, `User=postgres`)
- **Timer Unit**: `/etc/systemd/system/ipovault-postgres-backup.timer` (`OnCalendar=daily`, `Persistent=true`)

### Integrity Verification & Restoration Procedure

#### 1. Verify Backup Catalog (Non-destructive)
```bash
sudo -u postgres pg_restore --list /var/backups/ipovault/ipovault_auto_YYYYMMDD_HHMMSS.dump
```

#### 2. Restore to Temporary Test Database (Validation)
```bash
sudo -u postgres createdb ipovault_restore_test
sudo -u postgres pg_restore -d ipovault_restore_test /var/backups/ipovault/ipovault_auto_YYYYMMDD_HHMMSS.dump
sudo -u postgres psql -d ipovault_restore_test -c "SELECT count(1) FROM _prisma_migrations;"
sudo -u postgres dropdb ipovault_restore_test
```

#### 3. Production Restoration Procedure
```bash
# Stop application process before database restore
sudo systemctl stop ipovault-backend

# Perform full restore over production database
sudo -u postgres pg_restore --clean -d ipovault /var/backups/ipovault/<backup-filename>.dump

# Restart application process
sudo systemctl start ipovault-backend
```

---

## 11. Production Watchdog & Observability

### Watchdog Architecture
- **Script Path**: `/usr/local/sbin/ipovault-healthcheck` (owned by `root:root`, mode `755`).
- **Service Unit**: `/etc/systemd/system/ipovault-healthcheck.service` (`Type=oneshot`).
- **Timer Unit**: `/etc/systemd/system/ipovault-healthcheck.timer` (`OnCalendar=*:0/5`, runs every 5 minutes).

### Inspection & Failure Classification
The watchdog non-destructively inspects system state every 5 minutes and classifies failures into journald:
1. **Liveness Check**: Calls `https://api.getipovault.in/api/v1/health` (HTTP 200 OK). Failure logged as `APPLICATION_DOWN`.
2. **Readiness Check**: Calls `https://api.getipovault.in/api/v1/ready` (HTTP 200 OK + DB up). Failure logged as `DATABASE_NOT_READY`.
3. **Direct PostgreSQL Check**: Executes read-only `SELECT 1;` query as user `postgres`. Failure logged as `POSTGRES_QUERY_FAILED`.
4. **Disk Health**: Inspects `/` partition. Usage >= 80% logged as `DISK_WARNING`; >= 90% logged as `DISK_CRITICAL`.
5. **Backup Freshness**: Verifies newest dump file in `/var/backups/ipovault` is non-empty and <= 30 hours old. Failure logged as `BACKUP_STALE` / `BACKUP_MISSING`.

### Operator Observability Commands
```bash
# Check watchdog service execution status
sudo systemctl status ipovault-healthcheck.service

# View watchdog logs in journald
sudo journalctl -u ipovault-healthcheck.service -n 50 --no-pager

# Inspect next scheduled watchdog timer execution
systemctl list-timers --all --no-pager | grep ipovault-healthcheck
```

---

## 12. Production Scheduled Discovery

### Overview & Scope
The Production Scheduled Discovery subsystem (`DiscoverySchedulerService`) automates broad IPO discovery from external sources within the NestJS backend process.
- **Supported Sources**: `NSE` (Exchange API) and `SEBI` (Official Filing Listing & Document PDF Ingestion).
- **Architecture**: In-process NestJS lifecycle service (`OnModuleInit`, `OnModuleDestroy`). Does not introduce external queue infrastructure (Redis/BullMQ) or secondary worker processes.

### Environment Configuration
Configure scheduled discovery in `/var/www/ipovault-backend/.env.production`:

| Variable | Required? | Default | Recommended Production Setting | Description |
| :--- | :--- | :--- | :--- | :--- |
| `DISCOVERY_SCHEDULER_ENABLED` | No | `false` | `false` (until explicit enablement) | Controls background scheduler execution |
| `DISCOVERY_SCHEDULER_INTERVAL_MS` | No | `21600000` | `21600000` (6 hours) | Cadence between discovery cycles in ms |
| `DISCOVERY_SCHEDULER_INITIAL_DELAY_MS` | No | `0` | `0` | Initial startup delay before first tick |

### Execution & Safety Principles
1. **Disabled by Default**: Scheduler remains inactive unless `DISCOVERY_SCHEDULER_ENABLED=true` is explicitly configured.
2. **Sequential Source Execution**: Every cycle runs `NSE` discovery first, followed by `SEBI` discovery. Request throttling and HTTP timeouts are preserved.
3. **Failure Isolation**: An error in NSE discovery is contained and logged; SEBI discovery will still execute. A failure in any source will never crash the scheduler process or corrupt canonical database state.
4. **In-Process Overlap Guard**: An atomic boolean flag prevents new ticks from running if a prior discovery cycle is still executing.
5. **Operational Prerequisite**: The systemd automated backup timer (`ipovault-postgres-backup.timer`) MUST be active and healthy before enabling scheduled discovery.
6. **Single-Process Limitation**: Overlap protection is scoped to the single production monolith process (`127.0.0.1:3000`). Distributed multi-node locking is not implemented.

### Operational Health Endpoint (`GET /api/v1/health/discovery`)
Exposes read-only, in-memory telemetry for operational monitoring without querying PostgreSQL:
```json
{
  "data": {
    "enabled": true,
    "status": "HEALTHY",
    "intervalMs": 21600000,
    "staleThresholdMs": 32400000,
    "running": false,
    "lastCycle": {
      "cycleId": "1e3414bf-8689-469a-a54d-c2bebf0e6366",
      "status": "SUCCESS",
      "startedAt": "2026-09-12T12:58:30.528Z",
      "completedAt": "2026-09-12T12:58:44.197Z",
      "durationMs": 13669
    },
    "sources": {
      "nse": { "status": "SUCCESS", "durationMs": 169, "recordsProcessed": 2 },
      "sebi": { "status": "SUCCESS", "durationMs": 13500, "totalDiscovered": 25, "canonicalCreated": 0 }
    },
    "consecutiveFailureCount": 0,
    "overlapSkipCount": 0
  }
}
```

### Health Status Definitions & Alerting
- `DISABLED`: `DISCOVERY_SCHEDULER_ENABLED=false`.
- `STARTING`: Scheduler enabled; first cycle pending.
- `HEALTHY`: Last cycle succeeded (`SUCCESS`); age <= 1.5 * interval (`32,400,000` ms / 9 hours).
- `DEGRADED`: Last cycle partial success OR 1 consecutive failure OR overlap skips present.
- `STALE`: Scheduler enabled, but age since last completed cycle exceeds `1.5 * DISCOVERY_SCHEDULER_INTERVAL_MS` (9 hours).
- `FAILED`: 2 or more consecutive cycle failures OR last cycle status `FAILED`.

### Verification & Watchdog Integration
```bash
# Query discovery health endpoint directly
curl -fsS https://api.getipovault.in/api/v1/health/discovery

# Check scheduled discovery logs in journald
sudo journalctl -u ipovault-backend --since "1 hour ago" --no-pager | grep DiscoverySchedulerService

# How to safely disable scheduled discovery in production:
# Edit .env -> DISCOVERY_SCHEDULER_ENABLED=false
sudo systemctl restart ipovault-backend
```

---

## 13. Account Deletion Data-Retention Scope & Test-Account Verification

### Multi-Table Purge & Cascade Inventory
When an account deletion is confirmed (via authenticated mobile client `DELETE /api/v1/user/account` or verified web confirmation `POST /api/v1/user/confirm-deletion`), the backend executes an atomic PostgreSQL transaction in `UserService.executeUserTablesPurge`:

| Data Domain | Target PostgreSQL Table | Prisma Model | Purge / Anonymization Mechanism |
| :--- | :--- | :--- | :--- |
| **Saved PANs** | `user_saved_pans` | `UserSavedPan` | Atomic `deleteMany` where `userId = cleanUserId` |
| **Broker Accounts** | `broker_accounts` | `BrokerAccount` | Atomic `deleteMany` (cascades via DB foreign keys to `broker_connections`, `broker_tokens`, `broker_holdings`, `broker_trades`, `ipo_investments`) |
| **Push Tokens** | `user_push_tokens` | `UserPushToken` | Atomic `deleteMany` where `userId = cleanUserId` |
| **Notifications** | `notifications` | `Notification` | Atomic `deleteMany` (cascades via DB foreign key to `notification_deliveries`) |
| **Notification Prefs** | `notification_preferences` | `NotificationPreference` | Atomic `deleteMany` where `userId = cleanUserId` |
| **Allotment Jobs** | `allotment_check_jobs` | `AllotmentCheckJob` | Explicit `deleteMany` for `allotment_check_job_items` by job owner + `deleteMany` for `allotment_check_jobs` where `userId = cleanUserId` |
| **Entitlements** | `user_entitlements` | `UserEntitlement` | Atomic `deleteMany` where `userId = cleanUserId` |
| **Tier Audit Logs** | `user_entitlement_audit_logs` | `UserEntitlementAuditLog` | **Decoupled & Anonymized**: `userId = 'anon-' + randomUUID()`, `ipAddress = null`, `entitlementId = null`, `reason = 'Account deleted'`. Retained for billing dispute accounting. |
| **Deletion Replay** | `consumed_deletion_tokens` | `ConsumedDeletionToken` | **Replay Protection & Zero Residual PII**: Hashed token JTI (`jti_hash`), `status = 'COMPLETED'`, `completed_at`, and `expires_at`. Direct identifier `user_id` is nullified (`userId = null`) upon completion to eliminate residual PII while preserving 100% replay immunity. |

### Dedicated Test-Account Verification Checklist
Before deploying or performing verification with a dedicated test account (`$TEST_UID`):

#### Step 1: Pre-Deletion Inspection
```bash
sudo -u postgres psql -d ipovault -c "
SELECT 
  (SELECT count(*) FROM user_saved_pans WHERE user_id = '$TEST_UID') AS pans,
  (SELECT count(*) FROM broker_accounts WHERE user_id = '$TEST_UID') AS broker_accounts,
  (SELECT count(*) FROM user_push_tokens WHERE user_id = '$TEST_UID') AS push_tokens,
  (SELECT count(*) FROM notifications WHERE user_id = '$TEST_UID') AS notifications,
  (SELECT count(*) FROM notification_preferences WHERE user_id = '$TEST_UID') AS notif_prefs,
  (SELECT count(*) FROM allotment_check_jobs WHERE user_id = '$TEST_UID') AS allotment_jobs,
  (SELECT count(*) FROM allotment_check_job_items WHERE job_id IN (SELECT id FROM allotment_check_jobs WHERE user_id = '$TEST_UID')) AS allotment_job_items,
  (SELECT count(*) FROM user_entitlements WHERE user_id = '$TEST_UID') AS entitlements,
  (SELECT count(*) FROM user_entitlement_audit_logs WHERE user_id = '$TEST_UID') AS audit_logs_direct,
  (SELECT count(*) FROM consumed_deletion_tokens WHERE user_id = '$TEST_UID') AS pending_deletion_tokens;
"
```

#### Step 2: Post-Deletion Verification
After confirming deletion, run the exact same inspection query. Expected results:
- `pans`: **0**
- `broker_accounts`: **0** (cascaded connections, tokens, holdings, trades, investments all **0**)
- `push_tokens`: **0**
- `notifications`: **0** (cascaded deliveries **0**)
- `notif_prefs`: **0**
- `allotment_jobs`: **0**
- `allotment_job_items`: **0**
- `entitlements`: **0**
- `audit_logs_direct`: **0** (all logs transitioned to unlinked `anon-*` surrogates)
- `pending_deletion_tokens`: **0** (`user_id` nullified upon completion; token record preserved via `jti_hash` with `status = 'COMPLETED'` and `user_id IS NULL`)
- Firebase Authentication: User is deleted (`auth/user-not-found`)

