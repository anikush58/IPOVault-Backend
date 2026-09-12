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

Configure environment variables in `/var/www/ipovault-backend/.env.production` (permissions `600`):

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

> [!CAUTION]
> **Secrets Safety**: `DATABASE_URL` and API credentials must NEVER be committed to Git or printed in application logs.

---

## 3. Database Deployment & Migration Procedure

Do **NOT** run `prisma db push` or automated migrations on application startup.

### Pre-Deployment Migration Command

Before launching or restarting the backend process, run standard Prisma migration deployment using standard POSIX environment export:

```bash
export $(grep -v '^#' .env.production | xargs) && npx prisma migrate deploy
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
