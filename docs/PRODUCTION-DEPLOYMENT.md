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

---

## 14. Standard Production Release Runbook — KFintech Registrar Reliability Solution

This section defines the official, fail-safe release procedure for deploying the permanent KFintech Registrar Reliability Solution to production.

- **Release Commit:** `d8813dbd5ffd4521b29d9f528eb864f542234ed1` (`d8813db`)
- **Previous Verified Baseline Commit:** `d54c810f432cd8b1c94483213722b5d2bc28a401` (`d54c810`)
- **Target Host:** Oracle Cloud Always Free VM (Ubuntu 24.04 ARM64 Ampere A1)
- **Service Unit:** `ipovault-backend.service`

```
================================================================================
CRITICAL OPERATIONAL DIRECTIVE:
Every command sequence in this runbook enforces strict stop-on-failure behavior.
If any preflight, fetch, merge, build, service restart, or smoke test fails:
1. STOP EXECUTION IMMEDIATELY.
2. DO NOT print success or assume partial completion.
3. CONSULT THE RECOVERY DECISION MATRIX IN SECTION 14.5 BEFORE ACTING.
================================================================================
```

### 14.1. Pre-Deployment Production Preflight (Execute on VM)

SSH into the Oracle Cloud VM:
```bash
ssh ubuntu@<ORACLE_VM_IP>
```

Execute the non-destructive preflight verification script:
```bash
# 1. Identify and navigate to the active systemd working directory
APP_DIR=$(systemctl show -p WorkingDirectory --value ipovault-backend)
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR" ]; then
  echo "❌ CRITICAL ABORT: WorkingDirectory '$APP_DIR' not found or invalid!"
  exit 1
fi
cd "$APP_DIR"
echo "✓ Active application directory verified: $APP_DIR"

# 2. Verify Remote Repository Origin URL
REMOTE_URL=$(git config --get remote.origin.url)
case "$REMOTE_URL" in
  *anikush58/IPOVault-Backend*) echo "✓ Remote origin verified: $REMOTE_URL" ;;
  *) echo "❌ CRITICAL ABORT: Unexpected remote repository origin: '$REMOTE_URL' (expected anikush58/IPOVault-Backend)"; exit 1 ;;
esac

# 3. Verify Active Branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ CRITICAL ABORT: Server is on branch '$CURRENT_BRANCH', expected 'main'!"
  exit 1
fi
echo "✓ Active branch verified: main"

# 4. Verify Clean Working Tree (Never silently overwrite uncommitted changes)
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ CRITICAL ABORT: Uncommitted local modifications detected on production server:"
  git status --short
  echo "Investigate and resolve these changes manually before proceeding. Never run git clean."
  exit 1
fi
echo "✓ Server working tree verified clean"

# 5. Verify Current Server HEAD matches Previous Verified Baseline
CURRENT_HEAD=$(git rev-parse HEAD)
echo "Current Server HEAD: $CURRENT_HEAD"
if [ "$CURRENT_HEAD" != "d54c810f432cd8b1c94483213722b5d2bc28a401" ]; then
  echo "❌ CRITICAL ABORT: Server HEAD ($CURRENT_HEAD) does NOT match baseline (d54c810)!"
  echo "Verify server git log before continuing."
  exit 1
fi
echo "✓ Server HEAD matches verified baseline: d54c810"

# 6. Verify Node.js Runtime Version
NODE_VER=$(node -v)
echo "Node runtime: $NODE_VER"
case "$NODE_VER" in
  v20.*|v22.*) echo "✓ Node version satisfies production requirement (>= 20)" ;;
  *) echo "❌ CRITICAL ABORT: Unsupported Node version: $NODE_VER (requires >= v20)"; exit 1 ;;
esac

# 7. Verify Root Partition Disk Space (>= 2GB required)
ROOT_AVAIL_KB=$(df -k / | awk 'NR==2 {print $4}')
if [ "$ROOT_AVAIL_KB" -lt 2097152 ]; then
  echo "❌ CRITICAL ABORT: Insufficient disk space on / ($ROOT_AVAIL_KB KB available, >= 2GB required)!"
  exit 1
fi
echo "✓ Sufficient disk space verified (>= 2GB free)"

# 8. Verify Active Process & Database Health Prior to Update
curl -fsS http://127.0.0.1:3000/api/v1/health > /dev/null || {
  echo "❌ CRITICAL ABORT: Existing application is unhealthy before deployment!"
  exit 1
}
curl -fsS http://127.0.0.1:3000/api/v1/ready > /dev/null || {
  echo "❌ CRITICAL ABORT: Existing database readiness check failed before deployment!"
  exit 1
}
echo "✓ Existing service and database verified healthy"
echo "================================================================================"
echo "✓ ALL PREFLIGHT CHECKS PASSED 100%. READY FOR RELEASE DEPLOYMENT."
echo "================================================================================"
```

---

### 14.2. Fast-Forward Deployment Procedure

> [!IMPORTANT]
> **PREVENTING UNINTENDED REDEPLOYMENTS (EXPLICIT SHA PINNING):**
> Blindly running `git pull` is strictly forbidden. The deployment script enforces explicit release selection by verifying that `origin/main` matches `$TARGET_RELEASE_SHA` exactly before merging.

#### Step 1: Push Release Commit from Local Workstation (Operator Action)
```bash
# Execute on local development workstation only:
git push origin main
```

#### Step 2: Fetch, Verify Ancestry, Build, and Restart on Production Server
```bash
cd "$APP_DIR"

# Target Release Commit Definition
TARGET_RELEASE_SHA="d8813dbd5ffd4521b29d9f528eb864f542234ed1"
EXPECTED_BASELINE_SHA="d54c810f432cd8b1c94483213722b5d2bc28a401"

# 1. Fetch latest changes from remote main
git fetch origin main || {
  echo "❌ CRITICAL ABORT: git fetch origin main failed!"
  exit 1
}

# 2. Strictly verify remote origin/main matches the approved release commit
REMOTE_SHA=$(git rev-parse origin/main)
if [ "$REMOTE_SHA" != "$TARGET_RELEASE_SHA" ]; then
  echo "❌ CRITICAL ABORT: origin/main ($REMOTE_SHA) does NOT match approved release commit ($TARGET_RELEASE_SHA)!"
  echo "Remote repository has advanced to an unintended commit. Halting."
  exit 1
fi
echo "✓ Verified origin/main matches approved release commit: $TARGET_RELEASE_SHA"

# 3. Verify fast-forward ancestry from server HEAD to release commit
git merge-base --is-ancestor HEAD "$TARGET_RELEASE_SHA" || {
  echo "❌ CRITICAL ABORT: Fast-forward merge is impossible. Remote main has diverged from server HEAD!"
  exit 1
}

# 4. Apply strict fast-forward merge to target commit
git merge --ff-only "$TARGET_RELEASE_SHA" || {
  echo "❌ CRITICAL ABORT: git merge --ff-only failed!"
  exit 1
}

# 5. Strictly verify active working tree HEAD
DEPLOYED_HEAD=$(git rev-parse HEAD)
if [ "$DEPLOYED_HEAD" != "$TARGET_RELEASE_SHA" ]; then
  echo "❌ CRITICAL ABORT: Deployed commit ($DEPLOYED_HEAD) does NOT match approved release ($TARGET_RELEASE_SHA)!"
  exit 1
fi
echo "✓ Source tree successfully updated to release commit: $DEPLOYED_HEAD"

# 6. Clean install dependencies
# NOTE ON DEPENDENCY INTEGRITY:
# `npm ci` alters `node_modules` by removing existing packages and installing exact lockfile packages.
# If npm ci fails, node_modules may be in an inconsistent state.
# DO NOT restart service. Follow Pre-Restart Failure Recovery (Section 14.5.1).
npm ci || {
  echo "❌ CRITICAL ABORT: npm ci failed! Review npm-debug.log."
  echo "DO NOT restart service. Active process in RAM is still serving."
  echo "Execute Pre-Restart Failure Recovery (Section 14.5.1) to restore clean baseline."
  exit 1
}

# 7. Build production bundle
# CRITICAL SAFETY NOTE ON BUILD ARTIFACTS:
# `npm run build` runs `nest build`, which empties/replaces `dist/` during compilation.
# If build fails, `dist/` is NOT intact on disk.
# While the running Node.js process in RAM continues serving previously loaded code,
# on-disk artifacts are broken. DO NOT restart service.
npm run build || {
  echo "❌ CRITICAL ABORT: Production build failed! dist/ is invalid or missing."
  echo "DO NOT restart service. Active process in RAM is still serving."
  echo "Execute Pre-Restart Failure Recovery (Section 14.5.1) to recompile baseline dist/."
  exit 1
}
test -f dist/src/main.js || {
  echo "❌ CRITICAL ABORT: dist/src/main.js missing after build! Build artifact incomplete."
  exit 1
}
echo "✓ Production bundle compiled successfully"

# 8. Restart application service
sudo systemctl restart ipovault-backend
sleep 3

# 9. Confirm systemd unit is active
sudo systemctl is-active --quiet ipovault-backend || {
  echo "❌ CRITICAL ABORT: ipovault-backend service failed to start! Immediate rollback required."
  echo "Execute Post-Restart Fail-Safe Rollback (Section 14.4)."
  exit 1
}
echo "✓ Service successfully restarted and active"
```

---

### 14.3. Five-Layer Production Smoke-Test Suite (Robust Structured Parsing)

Run these checks sequentially on the server. If **any** step fails or produces unexpected results, the runbook **halts immediately** and prints a diagnostic failure alert directing the operator to the recovery path.

```bash
cd "$APP_DIR"

# Configuration: Fail-Closed Live Refresh Policy
# Set REQUIRE_LIVE_REFRESH=true (default) if deployment acceptance requires verification of a fresh live
# KFintech portal refresh in the current service run. If true, absence of current-run refresh evidence
# FAILS the smoke test (exit 1). Notice/warning will NEVER count as success.
# Set REQUIRE_LIVE_REFRESH=false to treat live refresh strictly as an optional diagnostic, in which case
# the check will NOT claim live refresh was verified.
REQUIRE_LIVE_REFRESH="${REQUIRE_LIVE_REFRESH:-true}"

echo "================================================================================"
echo "STARTING 5-LAYER SMOKE TEST SUITE"
echo "Policy: REQUIRE_LIVE_REFRESH=$REQUIRE_LIVE_REFRESH"
echo "================================================================================"

# Layer 1: Core Process Liveness & Database Readiness
LIVENESS=$(curl -fsS http://127.0.0.1:3000/api/v1/health 2>/dev/null) || {
  echo "❌ SMOKE TEST LAYER 1 FAILED: Cannot connect to http://127.0.0.1:3000/api/v1/health"
  exit 1
}
if ! echo "$LIVENESS" | grep -q '"status":"ok"'; then
  echo "❌ SMOKE TEST LAYER 1 FAILED: Liveness check returned invalid response: $LIVENESS"
  exit 1
fi
echo "✓ Layer 1.1: Process liveness confirmed"

READINESS=$(curl -fsS http://127.0.0.1:3000/api/v1/ready 2>/dev/null) || {
  echo "❌ SMOKE TEST LAYER 1 FAILED: Cannot connect to http://127.0.0.1:3000/api/v1/ready"
  exit 1
}
if ! echo "$READINESS" | grep -q '"status":"ok"' || ! echo "$READINESS" | grep -q '"database":"up"'; then
  echo "❌ SMOKE TEST LAYER 1 FAILED: Readiness check returned invalid response: $READINESS"
  exit 1
fi
echo "✓ Layer 1.2: Database connectivity confirmed"

# Layer 2: Public Registrar Catalog Registration
SOURCES_RES=$(curl -fsS http://127.0.0.1:3000/api/v1/allotment/sources 2>/dev/null) || {
  echo "❌ SMOKE TEST LAYER 2 FAILED: Cannot connect to /api/v1/allotment/sources"
  exit 1
}
if ! echo "$SOURCES_RES" | grep -q '"code":"KFIN"'; then
  echo "❌ SMOKE TEST LAYER 2 FAILED: KFin registrar missing from /api/v1/allotment/sources: $SOURCES_RES"
  exit 1
fi
echo "✓ Layer 2: KFIN registrar adapter registration confirmed"

# Layer 3: Registry Snapshot Offline Fallback Integrity Verification
# DISTINGUISHING PERSISTED FALLBACK VS FRESH LIVE REFRESH:
# - File existence (test -s) verifies only that a snapshot file is present (> 0 bytes).
# - Fallback Usability: Valid schema, valid non-future fetchedAt, valid contentHash,
#   validationStatus === 'VALID', itemCount >= 20, and Tonbo entry present.
#   A snapshot meeting these criteria is USABLE AS A PERSISTED FALLBACK.
# - Freshness Policy: Implementation configures cacheTtlMs = 15 minutes (900,000 ms).
# - Strict Non-Zero Exit: The Node script exercises complete validation across 16 assertions
#   (missing/non-string/unparseable/future fetchedAt, invalid schema/hash, unknown sourceType,
#   item-count mismatch, missing Tonbo) and exits non-zero (exit 1) on any failure.
REGISTRY_FILE="data/registries/kfintech-registry.json"
if [ ! -s "$REGISTRY_FILE" ]; then
  echo "❌ SMOKE TEST LAYER 3 FAILED: $REGISTRY_FILE is missing or empty (0 bytes)!"
  exit 1
fi

node -e '
  const fs = require("fs");
  const path = "data/registries/kfintech-registry.json";
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (err) {
    console.error("DIAGNOSTIC FAILURE: Cannot read registry file: " + err.message);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error("DIAGNOSTIC FAILURE: Malformed JSON in registry snapshot: " + e.message);
    process.exit(1);
  }

  // 1. Schema & Metadata Header Verification
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.error("DIAGNOSTIC FAILURE: Registry root is not an object");
    process.exit(1);
  }
  const meta = data.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    console.error("DIAGNOSTIC FAILURE: Registry snapshot metadata object is missing or invalid");
    process.exit(1);
  }
  if (meta.version !== 1) {
    console.error("DIAGNOSTIC FAILURE: Invalid metadata version: " + meta.version + " (expected 1)");
    process.exit(1);
  }
  if (meta.registrarCode !== "KFINTECH" && meta.registrarCode !== "KFIN") {
    console.error("DIAGNOSTIC FAILURE: Invalid metadata registrarCode: " + meta.registrarCode + " (expected KFINTECH or KFIN)");
    process.exit(1);
  }
  if (meta.validationStatus !== "VALID") {
    console.error("DIAGNOSTIC FAILURE: Registry validationStatus is not VALID (got: " + meta.validationStatus + ")");
    process.exit(1);
  }
  if (typeof meta.contentHash !== "string" || meta.contentHash.length !== 64 || !/^[0-9a-f]{64}$/i.test(meta.contentHash)) {
    console.error("DIAGNOSTIC FAILURE: Invalid contentHash in metadata (expected 64-char hex SHA-256)");
    process.exit(1);
  }

  // 2. Strict fetchedAt Timestamp & Future Rejection
  if (!meta.fetchedAt || typeof meta.fetchedAt !== "string" || !meta.fetchedAt.trim()) {
    console.error("DIAGNOSTIC FAILURE: Missing or non-string fetchedAt timestamp in metadata");
    process.exit(1);
  }
  const fetchedAtMs = Date.parse(meta.fetchedAt);
  if (isNaN(fetchedAtMs)) {
    console.error("DIAGNOSTIC FAILURE: Invalid fetchedAt ISO timestamp in metadata: " + meta.fetchedAt);
    process.exit(1);
  }
  const nowMs = Date.now();
  // Reject future timestamps (allowing 5s max clock skew between processes)
  if (fetchedAtMs > nowMs + 5000) {
    console.error("DIAGNOSTIC FAILURE: fetchedAt timestamp is in the future (" + meta.fetchedAt + ", system clock: " + new Date(nowMs).toISOString() + ")");
    process.exit(1);
  }
  const ageMs = Math.max(0, nowMs - fetchedAtMs);
  const ageMinutes = (ageMs / 60000).toFixed(1);

  console.log("ℹ Registry snapshot age: " + ageMinutes + " minutes (fetchedAt: " + meta.fetchedAt + ")");
  console.log("ℹ Snapshot metadata sourceType: " + meta.sourceType + ", isStale: " + meta.isStale);

  // 3. Known Source Type Validation
  const validSourceTypes = ["PORTAL_SPA_BUNDLE", "PERSISTED_DISK_SNAPSHOT", "OFFICIAL_FEED"];
  if (!validSourceTypes.includes(meta.sourceType)) {
    console.error("DIAGNOSTIC FAILURE: Unknown or invalid sourceType in metadata: " + meta.sourceType);
    process.exit(1);
  }

  // 4. Items Array Threshold & Integrity
  if (!Array.isArray(data.items) || data.items.length < 20) {
    console.error("DIAGNOSTIC FAILURE: Registry items array invalid or below minimum threshold (< 20 items, count: " + (data && data.items ? data.items.length : 0) + ")");
    process.exit(1);
  }
  if (meta.itemCount !== data.items.length) {
    console.error("DIAGNOSTIC FAILURE: Metadata itemCount (" + meta.itemCount + ") does not match items.length (" + data.items.length + ")");
    process.exit(1);
  }
  const tonbo = data.items.find(i => i && i.clientId === "15211216041");
  if (!tonbo) {
    console.error("DIAGNOSTIC FAILURE: Tonbo Client ID 15211216041 is absent from registry items!");
    process.exit(1);
  }
  if (!tonbo.name || !tonbo.name.toUpperCase().includes("TONBO")) {
    console.error("DIAGNOSTIC FAILURE: Tonbo record name mismatch: " + JSON.stringify(tonbo));
    process.exit(1);
  }
  console.log("✓ Fallback snapshot integrity verified: " + data.items.length + " items; Tonbo verified: " + JSON.stringify(tonbo));
' || {
  echo "❌ SMOKE TEST LAYER 3 FAILED: Registry snapshot validation failed!"
  exit 1
}
echo "✓ Layer 3: Registry snapshot fallback integrity confirmed"

# Layer 4: Live Registrar Code Resolution & API Gateway Connectivity (Synthetic PAN Probe)
# Step 4a: Retrieve Tonbo IPO UUID from production API using structured parsing
# Note: GET /api/v1/ipos returns { data: IpoResponseDto[], meta: PaginationMeta }.
# Company names reside in `company.displayName` and `company.legalName`; symbol resides in `symbol`.
TONBO_UUID=$(node -e '
  const http = require("http");
  const req = http.get("http://127.0.0.1:3000/api/v1/ipos?limit=100", (res) => {
    let body = "";
    res.on("data", chunk => body += chunk);
    res.on("end", () => {
      if (res.statusCode !== 200) {
        console.error("DIAGNOSTIC FAILURE: HTTP " + res.statusCode + " fetching IPO list from /api/v1/ipos");
        process.exit(1);
      }
      try {
        const json = JSON.parse(body);
        const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : json.items || []);
        if (!list || list.length === 0) {
          console.error("DIAGNOSTIC FAILURE: No IPO records found in /api/v1/ipos response");
          process.exit(1);
        }
        const match = list.find(ipo => {
          const name = (ipo.company?.displayName || ipo.company?.legalName || "").toUpperCase();
          const sym = (ipo.symbol || "").toUpperCase();
          return name.includes("TONBO") || sym.includes("TONBO");
        });
        if (!match || !match.id) {
          console.error("DIAGNOSTIC FAILURE: Tonbo Imaging IPO record not found in /api/v1/ipos list (checked " + list.length + " records). The IPO record must be present and marked PUBLISHED in the database. Integration cannot be claimed passed.");
          process.exit(1);
        }
        process.stdout.write(match.id.trim());
      } catch (e) {
        console.error("DIAGNOSTIC FAILURE: Failed to parse IPOs JSON: " + e.message);
        process.exit(1);
      }
    });
  });
  req.on("error", (e) => {
    console.error("DIAGNOSTIC FAILURE: Network error querying /api/v1/ipos: " + e.message);
    process.exit(1);
  });
')

if [ -z "$TONBO_UUID" ]; then
  echo "❌ SMOKE TEST LAYER 4 FAILED: Could not retrieve Tonbo Imaging IPO UUID from /api/v1/ipos!"
  exit 1
fi
echo "✓ Layer 4.1: Tonbo IPO UUID retrieved: $TONBO_UUID"

# Step 4b: Probe with syntactically valid non-existent PAN (ZZZZZ9999Z)
# Architectural Note: Because startup disk hydration marks the in-memory cache as `isStale: true`,
# this initial probe triggers `getActiveRegistry()`, which automatically initiates `executeRefreshCycle()`,
# scraping the upstream KFintech portal, saving the fresh snapshot, and logging `[REGISTRAR_ALERT:RECOVERY_SUCCESS]`.
PROBE_RES=$(curl -s -w "\n%{http_code}" -X POST http://127.0.0.1:3000/api/v1/allotment/check \
  -H "Content-Type: application/json" \
  -d "{\"ipoId\":\"$TONBO_UUID\",\"identifierType\":\"PAN\",\"identifierValue\":\"ZZZZZ9999Z\"}") || {
  echo "❌ SMOKE TEST LAYER 4 FAILED: Curl connection error querying /api/v1/allotment/check"
  exit 1
}

PROBE_HTTP_CODE=$(echo "$PROBE_RES" | tail -n 1)
PROBE_BODY=$(echo "$PROBE_RES" | sed '$d')

if [ "$PROBE_HTTP_CODE" != "200" ]; then
  echo "❌ SMOKE TEST LAYER 4 FAILED: Probe returned HTTP $PROBE_HTTP_CODE, expected 200! Body: $PROBE_BODY"
  exit 1
fi

node -e '
  const raw = process.argv[1];
  let res;
  try {
    res = JSON.parse(raw);
  } catch (e) {
    console.error("DIAGNOSTIC FAILURE: Malformed JSON in allotment check response: " + e.message + ". Raw: " + raw);
    process.exit(1);
  }

  // Diagnostic branch handling for upstream outcomes
  if (res.status === "RATE_LIMITED") {
    console.error("DIAGNOSTIC FAILURE: KFintech API Gateway rate limit exceeded (status: RATE_LIMITED). Upstream is throttling requests.");
    process.exit(1);
  }
  if (res.status === "SOURCE_UNAVAILABLE") {
    console.error("DIAGNOSTIC FAILURE: KFintech upstream is unavailable (status: SOURCE_UNAVAILABLE, error: " + (res.errorMessage || "unknown") + "). Gateway cannot be reached.");
    process.exit(1);
  }
  if (res.status === "NOT_YET_AVAILABLE") {
    console.error("DIAGNOSTIC FAILURE: Allotment is marked not declared/awaited by registrar (status: NOT_YET_AVAILABLE).");
    process.exit(1);
  }
  if (res.status !== "APPLICATION_NOT_FOUND") {
    console.error("DIAGNOSTIC FAILURE: Expected status APPLICATION_NOT_FOUND, got: " + res.status + " (error: " + (res.errorMessage || "none") + "). Contract or matching behavior has changed.");
    process.exit(1);
  }
  if (res.sourceCode !== "KFIN") {
    console.error("DIAGNOSTIC FAILURE: Expected sourceCode KFIN, got: " + res.sourceCode);
    process.exit(1);
  }
  if (!res.checkedAt || isNaN(Date.parse(res.checkedAt))) {
    console.error("DIAGNOSTIC FAILURE: checkedAt must be valid ISO timestamp, got: " + res.checkedAt);
    process.exit(1);
  }
  console.log("✓ Probe response strictly validated: status=" + res.status + ", sourceCode=" + res.sourceCode + ", checkedAt=" + res.checkedAt);
' "$PROBE_BODY" || {
  echo "❌ SMOKE TEST LAYER 4 FAILED: Probe response structure or values invalid!"
  exit 1
}
echo "✓ Layer 4.2: End-to-end Tonbo resolution & Gateway 404 mapping verified (status: APPLICATION_NOT_FOUND)"

# Step 4c: Verify Runtime Refresh Evidence in Current Service Run (Bounded Polling Loop)
# CODE SIGNAL AUDIT EVIDENCE:
# In `src/modules/allotment/discovery/kfin-registry.store.ts` (line 401), `[REGISTRAR_ALERT:RECOVERY_SUCCESS]`
# is emitted strictly inside `applySuccessfulRefresh()` upon completing a valid upstream refresh cycle
# (via official feed or portal SPA bundle). It is NEVER emitted by disk hydration (`hydrateFromPersistentStorage`)
# or stale recovery paths (`recoverStaleSnapshot`, which logs `[REGISTRAR_ALERT:STALE_REGISTRY]`).
# To strictly guarantee evidence belongs to the current run, journalctl is queried with `--since "$SERVICE_START_TIME"`.
# A bounded polling loop (max 20s, 2s interval) is used because live scraping and journal log flushing are
# asynchronous; a fixed sleep is never used as proof of success.

# Obtain exact service start timestamp for current-run provenance
RAW_START_TIME=$(systemctl show -p ActiveEnterTimestamp --value ipovault-backend 2>/dev/null)

# Validate timestamp parseability via Node.js
VALID_START_MS=$(node -e '
  const t = process.argv[1];
  if (!t || !t.trim() || t.trim().toLowerCase() === "n/a") { process.exit(1); }
  const ms = Date.parse(t.trim());
  if (isNaN(ms) || ms <= 0) { process.exit(1); }
  process.stdout.write(ms.toString());
' "$RAW_START_TIME" 2>/dev/null)

if [ -n "$VALID_START_MS" ]; then
  SERVICE_START_TIME="$RAW_START_TIME"
  echo "✓ Active service start timestamp verified: $SERVICE_START_TIME"
elif [ "$REQUIRE_LIVE_REFRESH" = "true" ]; then
  echo "❌ SMOKE TEST LAYER 4 FAILED: Could not obtain a valid parseable ActiveEnterTimestamp from systemd (got: '${RAW_START_TIME:-empty}')!"
  echo "REQUIRE_LIVE_REFRESH is set to true (fail-closed mode). Current-run service provenance is mandatory."
  echo "Cannot verify whether refresh occurred in current run vs prior run without valid start timestamp. Halting."
  exit 1
else
  SERVICE_START_TIME=""
  echo "⚠️ [OPTIONAL DIAGNOSTIC] Systemd ActiveEnterTimestamp unavailable or invalid ('${RAW_START_TIME:-empty}')."
  echo "Current-run service provenance CANNOT be verified. Proceeding in degraded diagnostic mode only."
fi

POLL_TIMEOUT_SECS=20
POLL_INTERVAL_SECS=2
ELAPSED=0
REFRESH_LOG=""

if [ -n "$SERVICE_START_TIME" ]; then
  echo "Polling systemd journal for verified live refresh evidence since $SERVICE_START_TIME (max 20s)..."
else
  echo "Polling systemd journal for live refresh evidence in last 5 minutes (max 20s, unverified provenance)..."
fi

while [ $ELAPSED -lt $POLL_TIMEOUT_SECS ]; do
  if [ -n "$SERVICE_START_TIME" ]; then
    REFRESH_LOG=$(sudo journalctl -u ipovault-backend --since "$SERVICE_START_TIME" --no-pager | grep "REGISTRAR_ALERT:RECOVERY_SUCCESS" | tail -n 1)
  else
    REFRESH_LOG=$(sudo journalctl -u ipovault-backend --since "5 minutes ago" --no-pager | grep "REGISTRAR_ALERT:RECOVERY_SUCCESS" | tail -n 1)
  fi
  if [ -n "$REFRESH_LOG" ]; then
    break
  fi
  sleep $POLL_INTERVAL_SECS
  ELAPSED=$((ELAPSED + POLL_INTERVAL_SECS))
done

if [ -n "$REFRESH_LOG" ]; then
  echo "✓ Layer 4.3: Runtime refresh evidence confirmed in current run: $REFRESH_LOG"
elif [ "$REQUIRE_LIVE_REFRESH" = "true" ]; then
  echo "❌ SMOKE TEST LAYER 4 FAILED: Live refresh evidence ('REGISTRAR_ALERT:RECOVERY_SUCCESS') was NOT found within ${POLL_TIMEOUT_SECS}s since $SERVICE_START_TIME!"
  echo "REQUIRE_LIVE_REFRESH is set to true (fail-closed mode). Live upstream refresh is a mandatory deployment requirement."
  echo "Deployments must not proceed on unverified live refreshes. Halting."
  exit 1
else
  echo "ℹ [OPTIONAL DIAGNOSTIC] No current-run live refresh logged within ${POLL_TIMEOUT_SECS}s since ${SERVICE_START_TIME:-service start}."
  echo "Live refresh was NOT verified. Service is operating from hydrated disk snapshot fallback until next scheduled sync cycle."
fi

# Step 4d: Post-Probe On-Disk Snapshot Freshness Re-Validation & Correlation
# If REQUIRE_LIVE_REFRESH=true, the snapshot file on disk must now reflect the fresh upstream scrape:
# - Valid root and metadata schema, version=1, registrarCode, validationStatus='VALID', 64-char hex contentHash
# - Strict fetchedAt timestamp: non-empty string, valid ISO parse, non-future (< now + 5s)
# - Current-Run Provenance: fetchedAt MUST NOT be older than $SERVICE_START_TIME (rejecting pre-restart snapshots)
# - sourceType === 'PORTAL_SPA_BUNDLE' or 'OFFICIAL_FEED' (rejecting PERSISTED_DISK_SNAPSHOT and unknown types)
# - isStale === false (explicit boolean check)
# - Age within configured 15-minute TTL (900,000 ms)
# - Items threshold >= 20, itemCount matching array length, and Tonbo entry verified
# - Correlation: If journal log is present, itemCount and sourceType must match the journal alert
#
# DOCUMENTED CORRELATION LIMITATION:
# The application code logs item count and sourceType in `REGISTRAR_ALERT:RECOVERY_SUCCESS`, which are matched
# against the on-disk snapshot. Both must have been written in the current run (after $SERVICE_START_TIME).
# However, because the application code does not output a unique refresh transaction UUID, snapshot contentHash,
# or ISO millisecond timestamp in the journal alert, exact 1:1 transaction correlation cannot be mathematically
# proven by code artifacts alone and is not claimed.
if [ "$REQUIRE_LIVE_REFRESH" = "true" ]; then
  node -e '
    const fs = require("fs");
    const path = "data/registries/kfintech-registry.json";
    const serviceStartTimeStr = process.argv[1];
    const journalLogLine = process.argv[2] || "";

    let raw;
    try {
      raw = fs.readFileSync(path, "utf8");
    } catch (err) {
      console.error("DIAGNOSTIC FAILURE: Cannot read registry file: " + err.message);
      process.exit(1);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error("DIAGNOSTIC FAILURE: Malformed JSON in post-probe registry snapshot: " + e.message);
      process.exit(1);
    }

    // 1. Schema & Metadata Header Validation
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error("DIAGNOSTIC FAILURE: Registry root is not an object");
      process.exit(1);
    }
    const meta = data.metadata;
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      console.error("DIAGNOSTIC FAILURE: Registry snapshot metadata object is missing or invalid");
      process.exit(1);
    }
    if (meta.version !== 1) {
      console.error("DIAGNOSTIC FAILURE: Invalid metadata version: " + meta.version + " (expected 1)");
      process.exit(1);
    }
    if (meta.registrarCode !== "KFINTECH" && meta.registrarCode !== "KFIN") {
      console.error("DIAGNOSTIC FAILURE: Invalid metadata registrarCode: " + meta.registrarCode + " (expected KFINTECH or KFIN)");
      process.exit(1);
    }
    if (meta.validationStatus !== "VALID") {
      console.error("DIAGNOSTIC FAILURE: Registry validationStatus is not VALID (got: " + meta.validationStatus + ")");
      process.exit(1);
    }
    if (typeof meta.contentHash !== "string" || meta.contentHash.length !== 64 || !/^[0-9a-f]{64}$/i.test(meta.contentHash)) {
      console.error("DIAGNOSTIC FAILURE: Invalid contentHash in metadata (expected 64-char hex SHA-256)");
      process.exit(1);
    }

    // 2. Strict fetchedAt Timestamp, Future Rejection & Current-Run Provenance
    if (!meta.fetchedAt || typeof meta.fetchedAt !== "string" || !meta.fetchedAt.trim()) {
      console.error("DIAGNOSTIC FAILURE: Missing or non-string fetchedAt timestamp in metadata");
      process.exit(1);
    }
    const fetchedAtMs = Date.parse(meta.fetchedAt);
    if (isNaN(fetchedAtMs)) {
      console.error("DIAGNOSTIC FAILURE: Invalid fetchedAt ISO timestamp in metadata: " + meta.fetchedAt);
      process.exit(1);
    }
    const nowMs = Date.now();
    // Reject future timestamps (allowing 5s max clock skew between processes)
    if (fetchedAtMs > nowMs + 5000) {
      console.error("DIAGNOSTIC FAILURE: fetchedAt timestamp is in the future (" + meta.fetchedAt + ", system clock: " + new Date(nowMs).toISOString() + ")");
      process.exit(1);
    }

    // Verify snapshot reflects the CURRENT service run (provenance)
    if (!serviceStartTimeStr || !serviceStartTimeStr.trim() || serviceStartTimeStr.trim().toLowerCase() === "n/a") {
      console.error("DIAGNOSTIC FAILURE: Service start time is missing or 'n/a'. Cannot verify current-run provenance.");
      process.exit(1);
    }
    const serviceStartMs = Date.parse(serviceStartTimeStr);
    if (isNaN(serviceStartMs) || serviceStartMs <= 0) {
      console.error("DIAGNOSTIC FAILURE: Invalid or unparseable serviceStartTimeStr provided: '" + serviceStartTimeStr + "'");
      process.exit(1);
    }
    if (fetchedAtMs < serviceStartMs - 5000) {
      console.error("DIAGNOSTIC FAILURE: Snapshot fetchedAt (" + meta.fetchedAt + ") is older than current service start (" + serviceStartTimeStr + "). Snapshot does not reflect current-run refresh.");
      process.exit(1);
    }

    // 3. Freshness Policy: TTL & Stale Flag Enforcement
    const ageMs = Math.max(0, nowMs - fetchedAtMs);
    const ageMinutes = (ageMs / 60000).toFixed(1);
    const CACHE_TTL_MS = 15 * 60 * 1000;

    if (meta.isStale !== false) {
      console.error("DIAGNOSTIC FAILURE: Snapshot is marked isStale: true. Live refresh did not mark snapshot valid.");
      process.exit(1);
    }
    if (ageMs > CACHE_TTL_MS) {
      console.error("DIAGNOSTIC FAILURE: Snapshot age (" + ageMinutes + "m) exceeds 15m TTL. Freshness requirement failed.");
      process.exit(1);
    }

    // 4. Source Type Validation
    const allowedLiveSources = ["PORTAL_SPA_BUNDLE", "OFFICIAL_FEED"];
    if (meta.sourceType === "PERSISTED_DISK_SNAPSHOT") {
      console.error("DIAGNOSTIC FAILURE: Snapshot sourceType is PERSISTED_DISK_SNAPSHOT; live refresh was not written to disk.");
      process.exit(1);
    }
    if (!allowedLiveSources.includes(meta.sourceType)) {
      console.error("DIAGNOSTIC FAILURE: Unknown or invalid sourceType in metadata: " + meta.sourceType);
      process.exit(1);
    }

    // 5. Items Integrity & Threshold
    if (!Array.isArray(data.items) || data.items.length < 20) {
      console.error("DIAGNOSTIC FAILURE: Items array invalid or below 20 items (count: " + (data.items ? data.items.length : 0) + ")");
      process.exit(1);
    }
    if (meta.itemCount !== data.items.length) {
      console.error("DIAGNOSTIC FAILURE: Metadata itemCount (" + meta.itemCount + ") does not match items.length (" + data.items.length + ")");
      process.exit(1);
    }

    // 6. Tonbo Entry Verification
    const tonbo = data.items.find(i => i && i.clientId === "15211216041");
    if (!tonbo) {
      console.error("DIAGNOSTIC FAILURE: Tonbo Client ID 15211216041 is absent from registry items!");
      process.exit(1);
    }
    if (!tonbo.name || !tonbo.name.toUpperCase().includes("TONBO")) {
      console.error("DIAGNOSTIC FAILURE: Tonbo record name mismatch: " + JSON.stringify(tonbo));
      process.exit(1);
    }

    // 7. Correlation with Journal Alert (Item Count & Source Type)
    if (journalLogLine) {
      const countMatch = journalLogLine.match(/(\d+)\s+items/);
      if (countMatch && parseInt(countMatch[1], 10) !== data.items.length) {
        console.error("DIAGNOSTIC FAILURE: Item count in journal log (" + countMatch[1] + ") does not match snapshot items (" + data.items.length + ")");
        process.exit(1);
      }
      if (!journalLogLine.includes(meta.sourceType)) {
        console.error("DIAGNOSTIC FAILURE: SourceType in journal log does not match snapshot sourceType (" + meta.sourceType + ")");
        process.exit(1);
      }
      console.log("✓ Log and snapshot correlation verified: " + data.items.length + " items from " + meta.sourceType);
    }

    console.log("✓ Layer 4.4: Fresh snapshot strictly validated: sourceType=" + meta.sourceType + ", age=" + ageMinutes + "m, isStale=" + meta.isStale + ", fetchedAt=" + meta.fetchedAt);
  ' "$SERVICE_START_TIME" "$REFRESH_LOG" || {
    echo "❌ SMOKE TEST LAYER 4 FAILED: Live snapshot freshness assertion failed!"
    exit 1
  }
fi

# Layer 5: Negative Validation Isolation (Non-existent IPO ID)
NEG_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3000/api/v1/allotment/check \
  -H "Content-Type: application/json" \
  -d '{"ipoId":"00000000-0000-0000-0000-000000000000","identifierType":"PAN","identifierValue":"ZZZZZ9999Z"}')

if [ "$NEG_HTTP_CODE" != "404" ]; then
  echo "❌ SMOKE TEST LAYER 5 FAILED: Dummy IPO probe returned HTTP $NEG_HTTP_CODE, expected 404!"
  exit 1
fi
echo "✓ Layer 5: Negative IPO validation verified (clean HTTP 404)"

echo "================================================================================"
echo "✓ ALL 5 SMOKE TEST LAYERS PASSED 100%. PRODUCTION RELEASE IS OPERATIONAL."
echo "================================================================================"
```

---

### 14.4. Fail-Safe Post-Restart Rollback Procedure (Zero Data Loss / Preserved Checkpoints)

Execute this procedure **only** if the service fails to start post-restart or if any smoke test in Section 14.3 fails.

> [!CAUTION]
> **STRICT SAFETY DIRECTIVES:**
> 1. Rollback verifies remote origin, expected branch, target commit ancestry, and a clean working tree.
> 2. Unexpected production modifications will **never** be silently discarded. If the working tree is dirty, halt immediately. Never run `git clean`.
> 3. Rollback requires creating and verifying a safety recovery checkpoint branch before executing any reset.
> 4. Rollback requires explicit operator confirmation (`ROLLBACK`). It is never executed automatically.
> 5. If ancestry verification fails, HALT immediately. Never run `git reset --hard` if baseline commit is not an ancestor.

```bash
cd "$APP_DIR"

echo "================================================================================"
echo "INITIATING SAFE PRODUCTION ROLLBACK"
echo "================================================================================"

TARGET_ROLLBACK_SHA="d54c810f432cd8b1c94483213722b5d2bc28a401"

# Precondition 1: Verify remote repository origin URL
REMOTE_URL=$(git config --get remote.origin.url)
case "$REMOTE_URL" in
  *anikush58/IPOVault-Backend*) echo "✓ Remote origin verified: $REMOTE_URL" ;;
  *) echo "❌ CRITICAL ABORT: Unexpected remote repository origin: '$REMOTE_URL'"; exit 1 ;;
esac

# Precondition 2: Verify current branch is main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ CRITICAL ABORT: Cannot rollback from branch '$CURRENT_BRANCH', expected 'main'!"
  exit 1
fi

# Precondition 3: Verify working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ CRITICAL ABORT: Working directory contains uncommitted changes!"
  echo "Unexpected production modifications detected. Preserving state. Stash or commit before rollback."
  git status --short
  exit 1
fi

# Precondition 4: Strictly verify target rollback commit exists and is an ancestor of HEAD
git cat-file -e "${TARGET_ROLLBACK_SHA}^{commit}" || {
  echo "❌ CRITICAL ABORT: Target rollback commit $TARGET_ROLLBACK_SHA does not exist in local Git object database!"
  exit 1
}
if ! git merge-base --is-ancestor "$TARGET_ROLLBACK_SHA" HEAD; then
  echo "❌ CRITICAL ABORT: Target rollback commit $TARGET_ROLLBACK_SHA is NOT a direct ancestor of HEAD!"
  echo "History has diverged or manual commits were made. HALTING. Never running git reset --hard."
  echo "Manual operator intervention required."
  exit 1
fi
echo "✓ Ancestry verified: $TARGET_ROLLBACK_SHA is a confirmed direct ancestor of HEAD"

# Precondition 5: Create a timestamped safety checkpoint branch of current state
# CRITICAL NOTE ON GIT CHECKPOINT SCOPE:
# A Git checkpoint branch protects committed repository state and refs only.
# It does NOT back up untracked or ignored directories, specifically `node_modules/`, `dist/`,
# or `data/registries/`. Post-rollback bundle restoration relies on cleanly re-running
# `npm ci` and `npm run build` from baseline commit d54c810.
RECOVERY_BRANCH="recovery-pre-rollback-$(date +%Y%m%d_%H%M%S)"
git branch "$RECOVERY_BRANCH" HEAD || {
  echo "❌ CRITICAL ABORT: Failed to create safety checkpoint branch '$RECOVERY_BRANCH'!"
  exit 1
}

# Precondition 6: Explicitly confirm the recovery checkpoint branch exists in Git refs
git rev-parse --verify "refs/heads/$RECOVERY_BRANCH" > /dev/null || {
  echo "❌ CRITICAL ABORT: Checkpoint branch '$RECOVERY_BRANCH' could NOT be verified! Halting to prevent data loss."
  exit 1
}
echo "✓ Recovery checkpoint branch confirmed: $RECOVERY_BRANCH"

# Precondition 7: Explicit Operator Confirmation Prompt
echo "================================================================================"
echo "Target Rollback Commit: $TARGET_ROLLBACK_SHA (Baseline)"
echo "Recovery Checkpoint:   $RECOVERY_BRANCH"
echo "================================================================================"
read -r -p "Type 'ROLLBACK' to confirm hard reset to $TARGET_ROLLBACK_SHA: " OPERATOR_INPUT
if [ "$OPERATOR_INPUT" != "ROLLBACK" ]; then
  echo "❌ Rollback aborted by operator. Working tree remains untouched."
  exit 1
fi

# Action 1: Cleanly reset main branch to baseline commit
git reset --hard "$TARGET_ROLLBACK_SHA" || {
  echo "❌ CRITICAL ABORT: git reset --hard failed!"
  exit 1
}
echo "✓ Branch 'main' safely reset to $TARGET_ROLLBACK_SHA"

# Action 2: Clean install dependencies and re-build baseline bundle
npm ci || { echo "❌ CRITICAL ABORT: npm ci failed during rollback!"; exit 1; }
npm run build || { echo "❌ CRITICAL ABORT: npm run build failed during rollback!"; exit 1; }
test -f dist/src/main.js || { echo "❌ CRITICAL ABORT: dist/src/main.js missing after rollback build!"; exit 1; }

# Action 3: Restart application service
sudo systemctl restart ipovault-backend
sleep 3

# Action 4: Confirm restoration health
curl -fsS http://127.0.0.1:3000/api/v1/health > /dev/null || { echo "❌ ROLLBACK FAILED: Application unhealthy after reset!"; exit 1; }
curl -fsS http://127.0.0.1:3000/api/v1/ready > /dev/null || { echo "❌ ROLLBACK FAILED: Database unavailable after reset!"; exit 1; }

echo "================================================================================"
echo "✓ ROLLBACK COMPLETED SUCCESSFULLY. SERVICE RESTORED TO $TARGET_ROLLBACK_SHA."
echo "================================================================================"
```

---

### 14.5. Recovery Decision Matrix & Procedures

#### 14.5.1. Pre-Restart Failure Recovery Procedure (Build or Dependency Failure)

> [!IMPORTANT]
> **PRE-RESTART RECOVERY SAFEGUARDS:**
> If `npm ci` or `npm run build` fails during Step 2 of Section 14.2:
> 1. **System State:** The previous Node.js process is still running in RAM and serving traffic. However, `npm ci` altered `node_modules` and `nest build` emptied or invalidated `./dist` on disk.
> 2. **Rule 1 — DO NOT RESTART SYSTEMD:** Restarting now would attempt to run missing or broken build artifacts, causing immediate service downtime.
> 3. **Rule 2 — PRESERVE RECOVERY CHECKPOINT BEFORE RESET:** Before executing `git reset --hard`, verify repository origin, branch, clean working tree, and target commit ancestry. Create and verify a recovery branch. Never use `git clean`.
> 4. **Rule 3 — NO AUTOMATIC SERVICE RESTARTS:** Check running process health explicitly. If unhealthy, DO NOT automatically restart; halt safely and alert operator.

```bash
cd "$APP_DIR"

echo "================================================================================"
echo "INITIATING PRE-RESTART RECOVERY (RESTORING BASELINE DIST/)"
echo "================================================================================"

TARGET_BASELINE_SHA="d54c810f432cd8b1c94483213722b5d2bc28a401"

# Precondition 1: Verify remote repository origin URL
REMOTE_URL=$(git config --get remote.origin.url)
case "$REMOTE_URL" in
  *anikush58/IPOVault-Backend*) echo "✓ Remote origin verified: $REMOTE_URL" ;;
  *) echo "❌ CRITICAL ABORT: Unexpected remote repository origin: '$REMOTE_URL'"; exit 1 ;;
esac

# Precondition 2: Verify current branch is main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ CRITICAL ABORT: Cannot recover from branch '$CURRENT_BRANCH', expected 'main'!"
  exit 1
fi

# Precondition 3: Verify working tree has no uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ CRITICAL ABORT: Working directory contains uncommitted changes!"
  echo "Unexpected modifications detected. Never run git clean or silently discard changes."
  git status --short
  exit 1
fi

# Precondition 4: Strictly verify baseline commit exists and is an ancestor of HEAD
git cat-file -e "${TARGET_BASELINE_SHA}^{commit}" || {
  echo "❌ CRITICAL ABORT: Target baseline commit $TARGET_BASELINE_SHA does not exist in local Git object database!"
  exit 1
}
if ! git merge-base --is-ancestor "$TARGET_BASELINE_SHA" HEAD; then
  echo "❌ CRITICAL ABORT: Target baseline commit $TARGET_BASELINE_SHA is NOT an ancestor of HEAD!"
  echo "History has diverged. HALTING. Never running git reset --hard."
  exit 1
fi
echo "✓ Ancestry verified: $TARGET_BASELINE_SHA is a confirmed direct ancestor of HEAD"

# Precondition 5: Create a timestamped safety checkpoint branch of the failed build state
# CRITICAL NOTE ON GIT CHECKPOINT SCOPE:
# A Git checkpoint branch protects committed repository state only; it does NOT back up
# ignored directories such as `node_modules/` or `dist/`. If `npm ci` or `nest build` altered
# or invalidated these directories, they must be reconstructed via clean `npm ci` and
# `npm run build` from baseline commit d54c810.
RECOVERY_BRANCH="recovery-pre-restart-$(date +%Y%m%d_%H%M%S)"
git branch "$RECOVERY_BRANCH" HEAD || {
  echo "❌ CRITICAL ABORT: Failed to create safety checkpoint branch '$RECOVERY_BRANCH'!"
  exit 1
}

# Precondition 6: Explicitly confirm checkpoint branch exists in Git refs
git rev-parse --verify "refs/heads/$RECOVERY_BRANCH" > /dev/null || {
  echo "❌ CRITICAL ABORT: Checkpoint branch '$RECOVERY_BRANCH' could NOT be verified! Halting."
  exit 1
}
echo "✓ Recovery checkpoint branch confirmed: $RECOVERY_BRANCH"

# Precondition 7: Explicit Operator Confirmation Prompt
echo "================================================================================"
echo "Target Baseline Commit: $TARGET_BASELINE_SHA"
echo "Recovery Checkpoint:    $RECOVERY_BRANCH"
echo "================================================================================"
read -r -p "Type 'RECOVER' to confirm hard reset to $TARGET_BASELINE_SHA: " OPERATOR_INPUT
if [ "$OPERATOR_INPUT" != "RECOVER" ]; then
  echo "❌ Pre-restart recovery aborted by operator. Working tree untouched."
  exit 1
fi

# Action 1: Reset working tree to verified baseline commit
git reset --hard "$TARGET_BASELINE_SHA" || {
  echo "❌ Pre-restart recovery failed at git reset!"
  exit 1
}
echo "✓ Branch 'main' reset to baseline: $TARGET_BASELINE_SHA"

# Action 2: Reinstall baseline dependencies
npm ci || {
  echo "❌ Pre-restart recovery failed at npm ci! Review npm-debug.log."
  exit 1
}

# Action 3: Rebuild verified baseline bundle
npm run build || {
  echo "❌ Pre-restart recovery failed at npm run build!"
  exit 1
}

# Action 4: Verify baseline artifact presence
test -f dist/src/main.js || {
  echo "❌ Pre-restart recovery: dist/src/main.js is missing after build!"
  exit 1
}
echo "✓ Baseline dist/src/main.js compiled and verified on disk"

# Action 5: Explicit Health Checks on Running In-Memory Process
echo "Checking running process health..."
HEALTH_STATUS="OK"
curl -fsS http://127.0.0.1:3000/api/v1/health > /dev/null || HEALTH_STATUS="FAIL"
curl -fsS http://127.0.0.1:3000/api/v1/ready > /dev/null || HEALTH_STATUS="FAIL"

if [ "$HEALTH_STATUS" = "OK" ]; then
  echo "================================================================================"
  echo "✓ PRE-RESTART RECOVERY COMPLETE."
  echo "1. On-disk ./dist artifacts are recompiled and aligned with baseline $TARGET_BASELINE_SHA."
  echo "2. Active in-memory process remains healthy and serving traffic without interruption."
  echo "3. SAFE NEXT STEPS: It is safe to leave the service running, or plan an intentional restart during an off-peak maintenance window."
  echo "================================================================================"
else
  echo "================================================================================"
  echo "⚠️ CRITICAL ALERT: RUNNING PROCESS IS UNHEALTHY OR UNRESPONSIVE."
  echo "AUTOMATIC RESTART IS PROHIBITED."
  echo "Safe next steps:"
  echo "1. Inspect logs: sudo journalctl -u ipovault-backend -n 50 --no-pager"
  echo "2. Do NOT restart automatically until the root cause of process failure is determined."
  echo "3. If process cannot recover, proceed to Post-Restart Fail-Safe Rollback (Section 14.4)."
  echo "================================================================================"
  exit 1
fi
```

#### 14.5.2. Preventing Unintended Redeployment & Remote Reconciliation

> [!WARNING]
> **SEPARATION OF PRODUCTION ROLLBACK AND REMOTE RECONCILIATION:**
> Rolling back the local production server (Section 14.4) restores service health on the VM. It does **not** alter the remote repository `origin/main` on GitHub.
> - **The Danger:** If `origin/main` still points to release commit `d8813db`, any subsequent unpinned `git pull` or automated CI runner would unintentionally re-deploy the failed release.
> - **Never Execute Remote Git Pushes from VM:** Never run `git push`, `git revert`, or destructive Git commands to remote repositories from the production server or automated scripts.
> - **Engineering Governance:** All remote GitHub branch reconciliation must occur on an authorized developer workstation with human peer review.

**Remote Branch Reconciliation Procedure (Workstation Only):**
1. **Option A — Revert Release Commit on Remote `main` (Recommended for Immediate Lockout):**
   On the operator's development workstation (never on the VM):
   ```bash
   git checkout main
   git pull origin main
   git revert d8813dbd5ffd4521b29d9f528eb864f542234ed1 --no-edit
   git push origin main
   ```
   *Consequences of Option A:* This permanently advances `origin/main` with a clean revert commit. All developers pulling `main` will receive the reverted code.

2. **Option B — SHA-Pinned Deployment Gate (Runbook Safety Guarantee):**
   The deployment procedure in Section 14.2 strictly pins `TARGET_RELEASE_SHA`. It will **never** execute a merge if `origin/main` does not match the exact expected SHA. Even if `origin/main` remains at `d8813db` during an active post-mortem, the server will reject any redeployment attempt unless an operator explicitly alters `TARGET_RELEASE_SHA`.

#### 14.5.3. Master Recovery Decision Matrix

| Failure Stage | System State (RAM vs Disk vs Git) | Service Impact | Required Operator Action | Recovery Verification |
| :--- | :--- | :--- | :--- | :--- |
| **Preflight (Section 14.1)** | Server working tree dirty, branch invalid, or low disk space. Git HEAD at `d54c810`. | **Zero Impact**. Old application is serving traffic normally. | **DO NOT DEPLOY**. Resolve server dirty files or disk space manually. Never run `git clean`. | Re-run Section 14.1 preflight script until all checks output `✓`. |
| **Fetch / Ancestry (Section 14.2)** | Remote `origin/main` does not match `TARGET_RELEASE_SHA` or has diverged. | **Zero Impact**. Server source tree and disk artifacts untouched. | **DO NOT MERGE**. Reconcile Git branch on workstation. Verify remote SHA. | Re-run Step 2 of Section 14.2. |
| **npm ci / build Failure (Section 14.2)** | Git HEAD at `d8813db`. Process in RAM running old code. Disk `./dist` missing/invalid. | **Zero Immediate Outage**. Risk of outage if systemd restarts process. | **DO NOT RESTART SERVICE**. Execute Section 14.5.1 (Pre-Restart Recovery) to reset to `d54c810` and recompile `./dist`. | Verify `test -f dist/src/main.js` and `curl /health` passes. |
| **Service Restart Crash (Section 14.2)** | Git HEAD at `d8813db`. Systemd unit inactive/failed. | **Production Outage**. Service cannot start new bundle. | **EXECUTE ROLLBACK (Section 14.4)** immediately to restore `d54c810`, rebuild, and restart. | Verify `systemctl is-active` and `curl /health` passes. |
| **Smoke Test Failure (Section 14.3)** | Git HEAD at `d8813db`. Service running but allotment/catalog check failed. | **Degraded Feature**. Core API active, but KFintech allotment resolution broken. | **EXECUTE ROLLBACK (Section 14.4)** immediately to restore `d54c810`, rebuild, and restart. | Re-run Section 14.3 smoke tests against restored baseline. |

---

### 14.6. Code-Verified Specifications vs. Operational Assumptions

| Component / Requirement | Status | Verified Code Reference | Architectural Specification & Validation Detail |
| :--- | :---: | :--- | :--- |
| **Allotment Check Endpoint** | **VERIFIED** | [`src/modules/allotment/allotment.controller.ts:73`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/allotment.controller.ts#L73) | Route is `POST /api/v1/allotment/check` (singular `allotment`). Accepts `CheckAllotmentDto`. |
| **Request Payload Schema** | **VERIFIED** | [`src/modules/allotment/dto/allotment.dto.ts:14-37`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/dto/allotment.dto.ts#L14-L37) | Body requires `ipoId` (UUID) and `identifierValue` (PAN format: 5 letters, 4 digits, 1 letter). |
| **Synthetic PAN Outcome** | **VERIFIED** | [`src/modules/allotment/adapters/kfin-registrar.adapter.ts:273`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/adapters/kfin-registrar.adapter.ts#L273) | AWS API Gateway 404 response maps deterministically to `AllotmentStatus.APPLICATION_NOT_FOUND` with `sourceCode: 'KFIN'`. |
| **Registrars Catalog** | **VERIFIED** | [`src/modules/allotment/allotment.service.ts:153-159`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/allotment.service.ts#L153-L159) | `GET /api/v1/allotment/sources` returns `{ registrars: [{ code: 'KFIN', name: '...', ... }] }`. |
| **IPOs List Route & Response Shape** | **VERIFIED** | [`src/modules/ipos/ipo.service.ts:65-79`](file:///D:/Projects/IPOVault-Backend/src/modules/ipos/ipo.service.ts#L65-L79), [`src/modules/ipos/ipo.mapper.ts:266-300`](file:///D:/Projects/IPOVault-Backend/src/modules/ipos/ipo.mapper.ts#L266-L300) | `GET /api/v1/ipos?limit=100` returns `{ data: [IpoResponseDto], meta: PaginationMeta }`. Company names reside in `company.displayName` and `company.legalName`; symbol resides in `symbol`. There is no root `companyName`. |
| **Registry File Path** | **VERIFIED** | [`src/modules/allotment/discovery/kfin-registry.store.ts:79-84`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/discovery/kfin-registry.store.ts#L79-L84) | Configured default storage path is `data/registries/kfintech-registry.json` relative to `process.cwd()`. |
| **Registry Snapshot Schema** | **VERIFIED** | [`src/modules/allotment/discovery/kfin-registry.store.ts:22-38`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/discovery/kfin-registry.store.ts#L22-L38) | Snapshot schema consists of `metadata` (`version`, `registrarCode`, `sourceTimestamp`, `fetchedAt`, `sourceType`, `itemCount`, `validationStatus`, `isStale`, `contentHash`) and `items` array (`clientId`, `name`). |
| **Registry Fallback vs. Live Freshness** | **VERIFIED** | [`src/modules/allotment/discovery/kfin-registry.store.ts:19-33`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/discovery/kfin-registry.store.ts#L19-L33) | File existence (`test -s`) verifies disk presence only. Fallback usability requires valid schema, non-future timestamp, valid SHA-256 contentHash, `validationStatus === 'VALID'`, `itemCount >= 20`, and Tonbo entry. Live freshness requires `sourceType === 'PORTAL_SPA_BUNDLE'`, `isStale === false`, and age <= 15 minutes TTL. A snapshot file on disk alone does NOT prove a refresh occurred during the current service run. |
| **Journal Signal: RECOVERY_SUCCESS & Correlation** | **VERIFIED WITH LIMITATION** | [`src/modules/allotment/discovery/kfin-registry.store.ts:396-403`](file:///D:/Projects/IPOVault-Backend/src/modules/allotment/discovery/kfin-registry.store.ts#L396-L403) | Signal `[REGISTRAR_ALERT:RECOVERY_SUCCESS]` is emitted strictly inside `applySuccessfulRefresh()` after a successful upstream portal/feed scrape that passes schema and minimum threshold validation. It is NEVER emitted by startup disk hydration (`hydrateFromPersistentStorage`) or fallback recovery (`recoverStaleSnapshot`, which logs `[REGISTRAR_ALERT:STALE_REGISTRY]`). Scoping `journalctl` to `--since "$SERVICE_START_TIME"` and bounded polling (max 20s) prevents pre-restart false positives and accommodates asynchronous log flush. When `REQUIRE_LIVE_REFRESH=true`, absence of this signal fails closed (`exit 1`). If `REQUIRE_LIVE_REFRESH=false`, the check is strictly an optional diagnostic. **Correlation & Limitation:** The runbook correlates the log alert with the on-disk snapshot by verifying both occurred after `$SERVICE_START_TIME`, and matching the logged item count and `sourceType`. However, because the application code does not output the snapshot's `contentHash` or ISO `fetchedAt` in the journal alert, cryptographic 1:1 transaction linking between the log event and the file write is not supported by application code and is not claimed. |
| **Tonbo Client ID & Name** | **VERIFIED** | Live KFintech SPA bundle (`./static/js/main.9f7d02b5.js`) | Confirmed live upstream identity: `clientId: "15211216041"`, `name: "TONBO IMAGING INDIA LIMITED"`. |
| **VM Working Directory** | **OPERATOR-CONFIRMED** | Dynamically extracted via `systemctl show -p WorkingDirectory` | Evaluated dynamically at script execution time (`/var/www/ipovault-backend` or `/home/ubuntu/IPOVault-Backend`). |
| **Live Upstream Reachability** | **OPERATOR-CONFIRMED** | Target `https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query` | Requires live outbound internet access on port 443 from Oracle VM instance to AWS API Gateway. |
