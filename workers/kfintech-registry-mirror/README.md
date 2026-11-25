# KFintech Active Registry Mirror (Cloudflare Worker)

Automated proxy mirror that fetches `https://ipostatus.kfintech.com/`, downloads the active React bundle, extracts the live `clientId` and company name array, and serves a machine-readable JSON feed for `IPOVault-Backend`.

## Deployment

1. **Deploy worker:**
   ```bash
   cd workers/kfintech-registry-mirror
   npx wrangler deploy
   ```

2. **Set secret token (optional but recommended):**
   ```bash
   npx wrangler secret put MIRROR_SECRET
   # Enter your secret token when prompted, e.g. "my-super-secret-token"
   ```

3. **Configure `IPOVault-Backend` `.env` on production:**
   ```bash
   KFINTECH_MACHINE_READABLE_SOURCE_URL="https://kfintech-registry-mirror.<your-subdomain>.workers.dev"
   KFINTECH_MACHINE_READABLE_SOURCE_TOKEN="my-super-secret-token"
   ```
