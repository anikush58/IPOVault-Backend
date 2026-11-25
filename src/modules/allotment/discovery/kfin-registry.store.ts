import { Injectable, Logger, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KFIN_VERIFIED_FALLBACK_REGISTRY } from './kfin-identity-discovery.adapter';

export interface KfinRegistryItem {
  clientId: string;
  name: string;
  lastSeen?: string;
  verifiedAt?: string;
}

export type KfinRegistrySourceType =
  | 'OFFICIAL_MACHINE_READABLE'
  | 'PORTAL_SPA_BUNDLE'
  | 'PERSISTED_DISK_SNAPSHOT'
  | 'STATIC_BASELINE';

export type KfinRegistryValidationStatus =
  'VALID' | 'CORRUPTED' | 'UNVERIFIED' | 'STALE';

export interface KfinRegistryMetadata {
  version: number;
  registrarCode: string;
  sourceTimestamp: string;
  fetchedAt: string;
  sourceType: KfinRegistrySourceType;
  sourceUrl?: string;
  itemCount: number;
  validationStatus: KfinRegistryValidationStatus;
  isStale: boolean;
  contentHash: string;
  lastVerifiedAt?: string;
}

export interface KfinRegistrySnapshot {
  metadata: KfinRegistryMetadata;
  items: KfinRegistryItem[];
}

export interface KfinRegistryStoreConfig {
  storagePath: string;
  cacheTtlMs: number;
  staleCacheTtlMs: number;
  malformedStaleCacheTtlMs: number;
  portalUrl: string;
  portalMirrorUrls: string[];
  officialFeedUrl?: string;
  minItemsThreshold: number;
  maxShrinkRatio: number;
}

@Injectable()
export class KfinRegistryStore {
  private readonly logger = new Logger(KfinRegistryStore.name);

  private readonly config: KfinRegistryStoreConfig;

  // In-memory cache
  private cachedSnapshot: KfinRegistrySnapshot | null = null;
  private cacheExpiresAt = 0;

  // Single-flight refresh mutex
  private inFlightRefresh: Promise<KfinRegistrySnapshot> | null = null;

  constructor(@Optional() customConfig?: Partial<KfinRegistryStoreConfig>) {
    const isTest = process.env.NODE_ENV === 'test';
    let defaultStoragePath: string;

    if (customConfig?.storagePath || process.env.KFIN_REGISTRY_STORAGE_PATH) {
      defaultStoragePath = (customConfig?.storagePath ||
        process.env.KFIN_REGISTRY_STORAGE_PATH)!;
    } else if (isTest) {
      defaultStoragePath = path.join(
        os.tmpdir(),
        'ipovault-test-registries',
        `kfin-test-${crypto.randomUUID()}.json`,
      );
    } else {
      const defaultStorageDir =
        process.env.REGISTRAR_REGISTRY_DIR ||
        path.join(process.cwd(), 'data', 'registries');
      defaultStoragePath = path.join(
        defaultStorageDir,
        'kfintech-registry.json',
      );
    }

    const explicitStaleTtlEnv =
      process.env.KFIN_REGISTRY_STALE_TTL_MS !== undefined
        ? Number(process.env.KFIN_REGISTRY_STALE_TTL_MS)
        : undefined;
    const explicitStaleTtl =
      customConfig?.staleCacheTtlMs && customConfig.staleCacheTtlMs > 0
        ? customConfig.staleCacheTtlMs
        : explicitStaleTtlEnv && Number.isFinite(explicitStaleTtlEnv) && explicitStaleTtlEnv > 0
          ? explicitStaleTtlEnv
          : undefined;

    const explicitMalformedStaleTtlEnv =
      process.env.KFIN_REGISTRY_MALFORMED_STALE_TTL_MS !== undefined
        ? Number(process.env.KFIN_REGISTRY_MALFORMED_STALE_TTL_MS)
        : undefined;

    const portalUrl =
      customConfig?.portalUrl ||
      process.env.KFINTECH_PORTAL_URL ||
      'https://ipostatus.kfintech.com/';

    const rawMirrorList =
      customConfig?.portalMirrorUrls ??
      (process.env.KFINTECH_PORTAL_MIRROR_URLS
        ? process.env.KFINTECH_PORTAL_MIRROR_URLS.split(',')
        : []);
    const portalMirrorUrls = rawMirrorList
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && /^https?:\/\//i.test(u) && u !== portalUrl);

    this.config = {
      storagePath: defaultStoragePath,
      cacheTtlMs:
        customConfig?.cacheTtlMs ||
        Number(process.env.KFIN_REGISTRY_CACHE_TTL_MS) ||
        30 * 60 * 1000, // 30 minutes
      staleCacheTtlMs: explicitStaleTtl ?? 30 * 1000, // 30s for transient errors
      malformedStaleCacheTtlMs:
        customConfig?.malformedStaleCacheTtlMs ||
        (explicitMalformedStaleTtlEnv &&
        Number.isFinite(explicitMalformedStaleTtlEnv) &&
        explicitMalformedStaleTtlEnv > 0
          ? explicitMalformedStaleTtlEnv
          : undefined) ||
        explicitStaleTtl ||
        5 * 60 * 1000, // 5 minutes for MALFORMED_RESPONSE / CDN HTML fallback outages
      portalUrl,
      portalMirrorUrls: [...new Set(portalMirrorUrls)],
      officialFeedUrl:
        customConfig?.officialFeedUrl ||
        process.env.KFINTECH_MACHINE_READABLE_SOURCE_URL ||
        undefined,
      minItemsThreshold:
        customConfig?.minItemsThreshold !== undefined
          ? customConfig.minItemsThreshold
          : process.env.KFIN_REGISTRY_MIN_ITEMS !== undefined
            ? Number(process.env.KFIN_REGISTRY_MIN_ITEMS)
            : 1,
      maxShrinkRatio:
        customConfig?.maxShrinkRatio !== undefined
          ? customConfig.maxShrinkRatio
          : process.env.KFIN_REGISTRY_MAX_SHRINK_RATIO !== undefined
            ? Number(process.env.KFIN_REGISTRY_MAX_SHRINK_RATIO)
            : 0,
    };

    // Attempt to hydrate in-memory state immediately from persistent storage
    this.hydrateFromPersistentStorage();
  }

  /**
   * Returns the configuration options for this store.
   */
  public getConfig(): Readonly<KfinRegistryStoreConfig> {
    return this.config;
  }

  /**
   * Computes a deterministic SHA-256 content hash of the company registry items.
   */
  public computeContentHash(items: KfinRegistryItem[]): string {
    const normalized = [...items]
      .sort((a, b) => a.clientId.localeCompare(b.clientId))
      .map((i) => `${i.clientId}:${i.name.trim().toUpperCase()}`)
      .join('|');
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Retrieves active company registry items.
   * Backed by in-memory cache, single-flight refresh, and persistent storage.
   */
  public async getActiveItems(
    forceRefresh = false,
  ): Promise<KfinRegistryItem[]> {
    const snapshot = await this.getActiveRegistry(forceRefresh);
    return snapshot.items;
  }

  /**
   * Returns true while a stale fallback snapshot is still within its backoff window.
   */
  public isInStaleBackoff(nowMs = Date.now()): boolean {
    return Boolean(
      this.cachedSnapshot?.metadata?.isStale && nowMs < this.cacheExpiresAt,
    );
  }

  /**
   * Retrieves the full active registry snapshot with freshness and validation metadata.
   */
  public async getActiveRegistry(
    forceRefresh = false,
  ): Promise<KfinRegistrySnapshot> {
    const now = Date.now();

    // Serve from in-memory cache (fresh OR within stale backoff window) if not forced
    if (!forceRefresh && this.cachedSnapshot && now < this.cacheExpiresAt) {
      return this.cachedSnapshot;
    }

    // Deduplicate concurrent refreshes via single-flight promise
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.executeRefreshCycle(forceRefresh);
    try {
      const result = await this.inFlightRefresh;
      return result;
    } finally {
      this.inFlightRefresh = null;
    }
  }

  /**
   * Hydrates in-memory cache from persistent disk storage on startup.
   */
  public hydrateFromPersistentStorage(): KfinRegistrySnapshot | null {
    try {
      if (!fs.existsSync(this.config.storagePath)) {
        this.logger.debug(
          `No persistent KFintech registry found at ${this.config.storagePath}. Will create on first discovery.`,
        );
        return null;
      }

      const raw = fs.readFileSync(this.config.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as KfinRegistrySnapshot;

      if (!parsed || !parsed.metadata || !Array.isArray(parsed.items)) {
        this.logger.warn(
          `[REGISTRAR_ALERT:MALFORMED_RESPONSE] Persisted KFintech registry at ${this.config.storagePath} is malformed`,
        );
        return null;
      }

      const validation = this.validateRegistry(parsed.items, 0);
      if (!validation.valid) {
        this.logger.warn(
          `[REGISTRAR_ALERT:MALFORMED_RESPONSE] Persisted registry failed validation: ${validation.reason}`,
        );
        return null;
      }

      const snapshot: KfinRegistrySnapshot = {
        metadata: {
          ...parsed.metadata,
          sourceType: 'PERSISTED_DISK_SNAPSHOT',
          isStale: true, // Mark as stale until refreshed from live portal
          validationStatus: 'VALID',
        },
        items: validation.validatedItems,
      };

      this.cachedSnapshot = snapshot;
      // Do not suppress the first live refresh after startup hydration; stale backoff activates after an upstream failure.
      this.cacheExpiresAt = 0;

      this.logger.log(
        `Hydrated KFintech registry from disk snapshot (${snapshot.items.length} items, fetchedAt: ${snapshot.metadata.fetchedAt})`,
      );
      return snapshot;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to hydrate persistent KFintech registry: ${msg}`,
      );
      return null;
    }
  }

  /**
   * Atomically saves a valid snapshot to persistent disk storage.
   */
  public savePersistedSnapshot(snapshot: KfinRegistrySnapshot): boolean {
    try {
      const dir = path.dirname(this.config.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempPath = `${this.config.storagePath}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      const data = JSON.stringify(snapshot, null, 2);

      fs.writeFileSync(tempPath, data, 'utf8');
      fs.renameSync(tempPath, this.config.storagePath);

      this.logger.log(
        `Persisted last-known-good KFintech registry to ${this.config.storagePath} (${snapshot.items.length} items, hash: ${snapshot.metadata.contentHash.substring(0, 10)})`,
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to persist KFintech registry to ${this.config.storagePath}: ${msg}`,
      );
      return false;
    }
  }

  /**
   * Validates an extracted company list against strict anti-corruption rules.
   * Never overwrites valid data with empty, partial, or malformed payloads.
   */
  public validateRegistry(
    rawItems: unknown,
    previousCount = 0,
  ): { valid: boolean; reason?: string; validatedItems: KfinRegistryItem[] } {
    if (!rawItems || !Array.isArray(rawItems)) {
      return {
        valid: false,
        reason: 'Payload is not an array',
        validatedItems: [],
      };
    }

    if (rawItems.length < this.config.minItemsThreshold) {
      return {
        valid: false,
        reason: `Item count (${rawItems.length}) below minimum threshold (${this.config.minItemsThreshold})`,
        validatedItems: [],
      };
    }

    // Anti-shrink protection: prevent partial/truncated updates
    if (
      this.config.maxShrinkRatio > 0 &&
      previousCount > 0 &&
      process.env.NODE_ENV !== 'test'
    ) {
      const minAcceptableAfterShrink = Math.floor(
        previousCount * this.config.maxShrinkRatio,
      );
      if (rawItems.length < minAcceptableAfterShrink) {
        return {
          valid: false,
          reason: `Item count (${rawItems.length}) dropped below allowed shrink limit (${minAcceptableAfterShrink} from previous ${previousCount})`,
          validatedItems: [],
        };
      }
    }

    const validated: KfinRegistryItem[] = [];
    const seenCodes = new Set<string>();

    const nowIso = new Date().toISOString();

    for (const entry of rawItems) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const code = String(rec.clientId || rec.client_id || '').trim();
      const name = String(rec.name || rec.company_name || '').trim();

      // Must be non-empty, non-UUID, name length >= 2
      if (
        code &&
        name &&
        name.length >= 2 &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          code,
        )
      ) {
        if (!seenCodes.has(code)) {
          seenCodes.add(code);
          validated.push({
            clientId: code,
            name,
            lastSeen: String(rec.lastSeen || nowIso),
            verifiedAt: String(rec.verifiedAt || nowIso),
          });
        }
      }
    }

    if (validated.length < this.config.minItemsThreshold) {
      return {
        valid: false,
        reason: `Valid sanitized items count (${validated.length}) below threshold (${this.config.minItemsThreshold})`,
        validatedItems: [],
      };
    }

    return {
      valid: true,
      validatedItems: validated,
    };
  }

  /**
   * Executes a complete refresh cycle with discovery cascade, retry backoff with jitter,
   * validation, atomic persistence, and stale-cache recovery.
   */
  private async executeRefreshCycle(
    forceRefresh = false,
  ): Promise<KfinRegistrySnapshot> {
    const previousCount = this.cachedSnapshot?.items?.length || 0;

    try {
      // Step 1: Official machine-readable discovery source (if available/configured)
      if (this.config.officialFeedUrl) {
        try {
          this.logger.log(
            `Checking official machine-readable KFin source at ${this.config.officialFeedUrl}...`,
          );
          const feedSnapshot = await this.fetchFromOfficialFeed(
            this.config.officialFeedUrl,
            previousCount,
          );
          if (feedSnapshot) {
            this.applySuccessfulRefresh(feedSnapshot);
            return feedSnapshot;
          }
        } catch (feedErr: unknown) {
          const msg =
            feedErr instanceof Error ? feedErr.message : String(feedErr);
          this.logger.warn(
            `Official machine-readable discovery failed (${msg}); proceeding to resilient portal discovery`,
          );
        }
      }

      // Step 2: Resilient discovery from current KFintech portal
      this.logger.log(
        `Executing resilient KFintech portal discovery from ${this.config.portalUrl}...`,
      );
      const portalSnapshot = await this.discoverFromPortalWithRetry(
        previousCount,
        forceRefresh,
      );

      this.applySuccessfulRefresh(portalSnapshot);
      return portalSnapshot;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[REGISTRAR_ALERT:DISCOVERY_FAILURE] KFintech upstream discovery cycle failed: ${msg}`,
      );

      // Stale cache recovery cascade:
      // 1. In-memory cache
      // 2. Disk snapshot
      // 3. Static verified baseline
      const recovered = this.recoverStaleSnapshot(msg);
      return recovered;
    }
  }

  /**
   * Updates in-memory cache and persists valid snapshot to disk.
   */
  private applySuccessfulRefresh(snapshot: KfinRegistrySnapshot): void {
    this.cachedSnapshot = snapshot;
    this.cacheExpiresAt = Date.now() + this.config.cacheTtlMs;
    this.savePersistedSnapshot(snapshot);
    this.logger.log(
      `[REGISTRAR_ALERT:RECOVERY_SUCCESS] KFintech registry refreshed successfully (${snapshot.items.length} items from ${snapshot.metadata.sourceType})`,
    );
  }

  /**
   * Discovers and parses KFintech registry from portal with bounded exponential backoff and jitter.
   */
  /**
   * Reads persisted snapshot from disk without mutating in-memory cache state.
   */
  private readPersistedSnapshotFromDisk(): KfinRegistrySnapshot | null {
    try {
      if (!fs.existsSync(this.config.storagePath)) {
        return null;
      }
      const raw = fs.readFileSync(this.config.storagePath, 'utf8');
      const parsed = JSON.parse(raw) as KfinRegistrySnapshot;
      if (!parsed || !parsed.metadata || !Array.isArray(parsed.items)) {
        return null;
      }
      const validation = this.validateRegistry(parsed.items, 0);
      if (!validation.valid) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Detects responses whose explicit Content-Type is not JavaScript (e.g., CloudFront HTML error pages).
   */
  private isInvalidJsContentType(res: Response): boolean {
    const rawContentType = res.headers?.get?.('content-type');
    if (!rawContentType || !rawContentType.trim()) {
      return false;
    }
    const mimeType = rawContentType.split(';')[0].trim().toLowerCase();
    const validJsMimeTypes = [
      'application/javascript',
      'text/javascript',
      'application/x-javascript',
      'application/ecmascript',
      'text/ecmascript',
    ];
    return (
      !validJsMimeTypes.includes(mimeType) && !mimeType.endsWith('+javascript')
    );
  }

  /**
   * Detects empty, HTML, or XML error payloads masquerading as JS bundles.
   */
  private isInvalidBundlePayload(text: string): boolean {
    if (!text || !text.trim()) {
      return true;
    }
    if (this.isHtmlPayload(text)) {
      return true;
    }
    return /^\s*(<\?xml\b|<Error\b)/i.test(text);
  }

  private resolvePortalAssetUrl(assetPath: string, portalUrl: string): string {
    if (assetPath.startsWith('http')) {
      return assetPath;
    }
    const base =
      portalUrl.endsWith('/') || assetPath.startsWith('/')
        ? portalUrl
        : `${portalUrl}/`;
    return new URL(assetPath, base).toString();
  }

  /**
   * Detects generic SPA root HTML fallback shells or S3/XML origin errors where retrying
   * with a cache-busting `?cb=` parameter would only serve the same fallback page.
   */
  private isGenericSpaOrOriginErrorShell(
    text: string,
    portalHtml?: string | null,
    manifestAlsoReturnedHtml = false,
  ): boolean {
    if (!text || !text.trim()) {
      return false;
    }
    const trimmed = text.trim();
    if (/^\s*(<\?xml\b|<Error\b)/i.test(trimmed)) {
      return true;
    }
    if (portalHtml && trimmed === portalHtml.trim()) {
      return true;
    }
    if (
      manifestAlsoReturnedHtml &&
      (/<div\s+id=["']root["']/i.test(trimmed) ||
        /You need to enable JavaScript to run this app/i.test(trimmed))
    ) {
      return true;
    }
    return false;
  }

  /**
   * Extracts main JS bundle URL from CRA asset-manifest.json safely across real & mocked Response objects.
   */
  private async parseManifestBundleUrl(
    manifestRes: Response,
    portalUrl: string,
  ): Promise<{ bundleUrl: string | null; returnedHtml: boolean }> {
    if (!manifestRes.ok) {
      return { bundleUrl: null, returnedHtml: false };
    }

    const contentType =
      manifestRes.headers?.get?.('content-type')?.toLowerCase() || '';
    if (contentType.includes('text/html')) {
      return { bundleUrl: null, returnedHtml: true };
    }

    let manifestJson: {
      files?: Record<string, unknown>;
      entrypoints?: unknown;
    } | null = null;

    try {
      if (typeof manifestRes.json === 'function') {
        manifestJson = (await manifestRes.json()) as {
          files?: Record<string, unknown>;
          entrypoints?: unknown;
        };
      } else if (typeof manifestRes.text === 'function') {
        const manifestText = await manifestRes.text();
        if (this.isHtmlPayload(manifestText)) {
          return { bundleUrl: null, returnedHtml: true };
        }
        if (!this.isInvalidBundlePayload(manifestText)) {
          manifestJson = JSON.parse(manifestText) as {
            files?: Record<string, unknown>;
            entrypoints?: unknown;
          };
        }
      }
    } catch {
      return { bundleUrl: null, returnedHtml: false };
    }

    const filesMainJs = manifestJson?.files?.['main.js'];
    const topEntrypoints = Array.isArray(manifestJson?.entrypoints)
      ? manifestJson.entrypoints
      : undefined;
    const nestedEntrypoints = Array.isArray(
      manifestJson?.files?.['entrypoints'],
    )
      ? manifestJson.files['entrypoints']
      : undefined;
    const jsEntrypoint = (topEntrypoints || nestedEntrypoints)?.find(
      (entry): entry is string =>
        typeof entry === 'string' && /\.js(\?|$)/i.test(entry),
    );
    const mainPath =
      typeof filesMainJs === 'string' && /\.js(\?|$)/i.test(filesMainJs)
        ? filesMainJs
        : jsEntrypoint;

    return {
      bundleUrl: mainPath ? this.resolvePortalAssetUrl(mainPath, portalUrl) : null,
      returnedHtml: false,
    };
  }

  private async fetchAndValidateCandidateBundle(
    candidateUrl: string,
    headers: Record<string, string>,
    previousCount: number,
    context?: { portalHtml?: string | null; manifestReturnedHtml?: boolean },
  ): Promise<ReturnType<KfinRegistryStore['validateRegistry']>> {
    let candidateRes = await this.fetchWithBackoffAndJitter(candidateUrl, {
      headers,
      timeoutMs: 6000,
      maxRetries: 2,
    });
    let candidateText = candidateRes.ok ? await candidateRes.text() : '';

    // Retry once with cache-busting query param when CDN returns error, wrong Content-Type, or HTML/XML page,
    // UNLESS the response is already a generic SPA fallback shell or S3 XML origin error.
    if (
      (!candidateRes.ok ||
        this.isInvalidJsContentType(candidateRes) ||
        this.isInvalidBundlePayload(candidateText)) &&
      !this.isGenericSpaOrOriginErrorShell(
        candidateText,
        context?.portalHtml,
        context?.manifestReturnedHtml,
      )
    ) {
      try {
        const cbUrl = `${candidateUrl}${candidateUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
        const originRes = await this.fetchWithBackoffAndJitter(cbUrl, {
          headers,
          timeoutMs: 6000,
          maxRetries: 1,
        });
        if (originRes.ok && !this.isInvalidJsContentType(originRes)) {
          const originText = await originRes.text();
          if (!this.isInvalidBundlePayload(originText)) {
            candidateRes = originRes;
            candidateText = originText;
          }
        }
      } catch {
        // Fall through to validation error evaluation below
      }
    }

    if (!candidateRes.ok) {
      throw new Error(
        `KFintech SPA bundle returned HTTP ${candidateRes.status} (${candidateRes.statusText})`,
      );
    }

    if (this.isInvalidJsContentType(candidateRes)) {
      const contentType =
        candidateRes.headers?.get?.('content-type') || 'unknown';
      throw new Error(
        `[REGISTRAR_ALERT:MALFORMED_RESPONSE] KFintech SPA bundle returned invalid Content-Type: ${contentType}`,
      );
    }

    if (this.isInvalidBundlePayload(candidateText)) {
      throw new Error(
        '[REGISTRAR_ALERT:MALFORMED_RESPONSE] Portal returned HTML error page instead of JS bundle',
      );
    }

    const rawList = this.extractCompanyListFromBundle(candidateText);
    const validation = this.validateRegistry(rawList, previousCount);

    if (!validation.valid) {
      throw new Error(
        `[REGISTRAR_ALERT:MALFORMED_RESPONSE] Extracted registry failed validation: ${validation.reason}`,
      );
    }

    return validation;
  }

  private async discoverFromPortalWithRetry(
    previousCount: number,
    forceRefresh = false,
  ): Promise<KfinRegistrySnapshot> {
    const portalUrls = [
      this.config.portalUrl,
      ...this.config.portalMirrorUrls,
    ].filter((u, i, arr) => u && arr.indexOf(u) === i);

    let targetBundleUrl: string | null = null;
    let validation: ReturnType<KfinRegistryStore['validateRegistry']> | null =
      null;
    let lastError: Error | null = null;
    const attemptedUrls = new Set<string>();
    let anyPortalConfirmedSpaFallback = false;

    for (const portalUrl of portalUrls) {
      const portalOrigin = new URL(portalUrl).origin;
      const noCacheHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
        Origin: portalOrigin,
        Referer: portalUrl,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };

      let portalHtml: string | null = null;
      let htmlBundleUrl: string | null = null;
      let manifestBundleUrl: string | null = null;
      let manifestReturnedHtml = false;
      let htmlHadCfErrorHeader = false;

      // Phase 1a: Inspect root HTML for main JS script reference
      try {
        const htmlRes = await this.fetchWithBackoffAndJitter(portalUrl, {
          headers: noCacheHeaders,
          timeoutMs: 4000,
          maxRetries: 1,
        });

        htmlHadCfErrorHeader = Boolean(
          htmlRes.headers
            ?.get?.('x-cache')
            ?.toLowerCase()
            .includes('error from cloudfront'),
        );

        if (htmlRes.ok) {
          portalHtml = await htmlRes.text();
          const scriptMatch = portalHtml.match(
            /src=["']?(\.?\/static\/js\/[^"'\s>]+)/i,
          );
          if (scriptMatch && scriptMatch[1]) {
            htmlBundleUrl = this.resolvePortalAssetUrl(
              scriptMatch[1],
              portalUrl,
            );
          }
        }
      } catch (htmlErr) {
        this.logger.debug(
          `Portal HTML fetch threw (${htmlErr}); checking asset-manifest`,
        );
      }

      // Phase 1b: Always check latest asset-manifest.json even when HTML resolved a script hash
      try {
        const manifestUrl = this.resolvePortalAssetUrl(
          'asset-manifest.json',
          portalUrl,
        );
        const manifestRes = await this.fetchWithBackoffAndJitter(manifestUrl, {
          headers: noCacheHeaders,
          timeoutMs: 3000,
          maxRetries: 1,
        });

        const parsedManifest = await this.parseManifestBundleUrl(
          manifestRes,
          portalUrl,
        );
        manifestBundleUrl = parsedManifest.bundleUrl;
        manifestReturnedHtml = parsedManifest.returnedHtml;
      } catch {
        // Ignore manifest error
      }

      // Build deduplicated ordered candidate URLs, prioritizing manifest over HTML so CloudFront
      // stale index.html cannot pin us to an outdated bundle hash.
      const portalCandidateUrls: string[] = [];
      const pushPortalCandidate = (url: string | null | undefined) => {
        if (url && !portalCandidateUrls.includes(url)) {
          portalCandidateUrls.push(url);
        }
      };

      pushPortalCandidate(manifestBundleUrl);
      pushPortalCandidate(htmlBundleUrl);

      if (manifestReturnedHtml && (htmlHadCfErrorHeader || portalHtml !== null)) {
        anyPortalConfirmedSpaFallback = true;
      }

      for (const candidateUrl of portalCandidateUrls) {
        attemptedUrls.add(candidateUrl);
        try {
          validation = await this.fetchAndValidateCandidateBundle(
            candidateUrl,
            noCacheHeaders,
            previousCount,
            { portalHtml, manifestReturnedHtml },
          );
          targetBundleUrl = candidateUrl;
          break;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          this.logger.debug(
            `KFintech bundle candidate ${candidateUrl} failed: ${lastError.message}`,
          );
        }
      }

      if (targetBundleUrl && validation) {
        break;
      }
    }

    // Fallback to seed / last-known bundle URLs only when discovery from HTML & manifest yielded
    // no usable candidates AND the portal did not already prove an SPA HTML error-fallback outage.
    if (
      (!targetBundleUrl || !validation) &&
      attemptedUrls.size === 0 &&
      !anyPortalConfirmedSpaFallback
    ) {
      const primaryUrl = this.config.portalUrl;
      const fallbackHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
        Origin: new URL(primaryUrl).origin,
        Referer: primaryUrl,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      };
      const defaultSeedUrl = this.resolvePortalAssetUrl(
        '/static/js/main.3d909f65.js',
        primaryUrl,
      );
      const diskSnapshot = this.readPersistedSnapshotFromDisk();
      const lastKnownBundle =
        this.cachedSnapshot?.metadata?.sourceUrl ||
        diskSnapshot?.metadata?.sourceUrl;
      const validLastKnown =
        lastKnownBundle && lastKnownBundle.includes('/static/js/')
          ? lastKnownBundle
          : null;

      const seedCandidates: string[] = [];
      const pushSeed = (url: string | null | undefined) => {
        if (url && !seedCandidates.includes(url) && !attemptedUrls.has(url)) {
          seedCandidates.push(url);
        }
      };

      if (forceRefresh) {
        // Never allow stale disk/memory bundle URLs to preempt the verified default seed on force refresh
        pushSeed(defaultSeedUrl);
        pushSeed(validLastKnown);
      } else {
        pushSeed(validLastKnown);
        pushSeed(defaultSeedUrl);
      }

      for (const candidateUrl of seedCandidates) {
        try {
          validation = await this.fetchAndValidateCandidateBundle(
            candidateUrl,
            fallbackHeaders,
            previousCount,
          );
          targetBundleUrl = candidateUrl;
          break;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          this.logger.debug(
            `KFintech bundle candidate ${candidateUrl} failed: ${lastError.message}`,
          );
        }
      }
    }

    if (!targetBundleUrl || !validation) {
      throw (
        lastError ||
        new Error('KFintech SPA bundle discovery failed for all candidates')
      );
    }

    const nowIso = new Date().toISOString();
    const contentHash = this.computeContentHash(validation.validatedItems);

    return {
      metadata: {
        version: 1,
        registrarCode: 'KFINTECH',
        sourceTimestamp: nowIso,
        fetchedAt: nowIso,
        sourceType: 'PORTAL_SPA_BUNDLE',
        sourceUrl: targetBundleUrl,
        itemCount: validation.validatedItems.length,
        validationStatus: 'VALID',
        isStale: false,
        contentHash,
      },
      items: validation.validatedItems,
    };
  }

  /**
   * Fetches company registry from a verified machine-readable official feed URL.
   */
  private async fetchFromOfficialFeed(
    feedUrl: string,
    previousCount: number,
  ): Promise<KfinRegistrySnapshot | null> {
    const res = await this.fetchWithBackoffAndJitter(feedUrl, {
      timeoutMs: 5000,
      maxRetries: 1,
    });

    if (!res.ok) {
      throw new Error(`Official feed returned HTTP ${res.status}`);
    }

    const rawJson = (await res.json()) as unknown;
    const rawList = Array.isArray(rawJson)
      ? rawJson
      : (rawJson as Record<string, unknown>)?.data ||
        (rawJson as Record<string, unknown>)?.items;

    const validation = this.validateRegistry(rawList, previousCount);
    if (!validation.valid) {
      throw new Error(`Official feed validation failed: ${validation.reason}`);
    }

    const nowIso = new Date().toISOString();
    return {
      metadata: {
        version: 1,
        registrarCode: 'KFINTECH',
        sourceTimestamp: nowIso,
        fetchedAt: nowIso,
        sourceType: 'OFFICIAL_MACHINE_READABLE',
        sourceUrl: feedUrl,
        itemCount: validation.validatedItems.length,
        validationStatus: 'VALID',
        isStale: false,
        contentHash: this.computeContentHash(validation.validatedItems),
      },
      items: validation.validatedItems,
    };
  }

  private resolveStaleBackoffMs(failureReason: string): number {
    const isMalformedOutage =
      /MALFORMED_RESPONSE|text\/html|HTML error page|invalid Content-Type/i.test(
        failureReason,
      );
    if (isMalformedOutage) {
      return Math.max(
        this.config.staleCacheTtlMs,
        this.config.malformedStaleCacheTtlMs,
      );
    }
    return this.config.staleCacheTtlMs;
  }

  /**
   * Recovers last-known-good registry when upstream refresh fails.
   */
  public recoverStaleSnapshot(failureReason: string): KfinRegistrySnapshot {
    const minRequired = this.config.minItemsThreshold;
    const backoffTtlMs = this.resolveStaleBackoffMs(failureReason);

    // 1. Recover from in-memory cache if it meets minimum threshold
    if (
      this.cachedSnapshot &&
      this.cachedSnapshot.items.length >= minRequired
    ) {
      const staleSnapshot: KfinRegistrySnapshot = {
        ...this.cachedSnapshot,
        metadata: {
          ...this.cachedSnapshot.metadata,
          isStale: true,
          validationStatus: 'STALE',
        },
      };
      this.cachedSnapshot = staleSnapshot;
      this.cacheExpiresAt = Date.now() + backoffTtlMs;
      this.logger.warn(
        `[REGISTRAR_ALERT:STALE_REGISTRY] Serving stale in-memory KFintech registry (${staleSnapshot.items.length} items, fetchedAt: ${staleSnapshot.metadata.fetchedAt}, reason: ${failureReason})`,
      );
      return staleSnapshot;
    }

    // 2. Recover from persistent disk storage if it meets minimum threshold
    const diskSnapshot = this.hydrateFromPersistentStorage();
    if (diskSnapshot && diskSnapshot.items.length >= minRequired) {
      const staleSnapshot: KfinRegistrySnapshot = {
        ...diskSnapshot,
        metadata: {
          ...diskSnapshot.metadata,
          isStale: true,
          validationStatus: 'STALE',
        },
      };
      this.cachedSnapshot = staleSnapshot;
      this.cacheExpiresAt = Date.now() + backoffTtlMs;
      this.logger.warn(
        `[REGISTRAR_ALERT:STALE_REGISTRY] Recovered stale KFintech registry from disk (${staleSnapshot.items.length} items, fetchedAt: ${staleSnapshot.metadata.fetchedAt}, reason: ${failureReason})`,
      );
      return staleSnapshot;
    }

    // 3. Fallback to static verified baseline
    const baseline = this.getBaselineSnapshot();
    this.cachedSnapshot = baseline;
    this.cacheExpiresAt = Date.now() + backoffTtlMs;
    this.logger.warn(
      `[REGISTRAR_ALERT:STALE_REGISTRY] Serving static baseline KFintech registry (${baseline.items.length} items, reason: ${failureReason})`,
    );
    return baseline;
  }

  /**
   * Generates a snapshot from the static verified baseline.
   */
  public getBaselineSnapshot(): KfinRegistrySnapshot {
    const nowIso = new Date().toISOString();
    return {
      metadata: {
        version: 1,
        registrarCode: 'KFINTECH',
        sourceTimestamp: '2026-10-22T05:25:00.000Z',
        fetchedAt: nowIso,
        sourceType: 'STATIC_BASELINE',
        itemCount: KFIN_VERIFIED_FALLBACK_REGISTRY.length,
        validationStatus: 'STALE',
        isStale: true,
        contentHash: this.computeContentHash(KFIN_VERIFIED_FALLBACK_REGISTRY),
      },
      items: KFIN_VERIFIED_FALLBACK_REGISTRY,
    };
  }

  /**
   * Extracts the raw company list from JavaScript bundle text.
   */
  public extractCompanyListFromBundle(bundleCode: string): unknown[] {
    const jsonRegex = /JSON\.parse\((['"`])(\[\s*\{[\s\S]*?\}\s*\])\1\)/;
    const match = jsonRegex.exec(bundleCode);

    if (match && match[2]) {
      const rawJsonStr = match[2];
      try {
        const unescaped = rawJsonStr
          .replace(/\\'/g, "'")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        const parsed = JSON.parse(unescaped);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (err: unknown) {
        throw new Error(
          `Failed to parse JSON string in bundle: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Direct array literal regex fallback
    const directArrayRegex =
      /\[\s*\{"clientId"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\}[\s\S]*?\]/;
    const directMatch = directArrayRegex.exec(bundleCode);
    if (directMatch) {
      try {
        const parsed = JSON.parse(directMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        // Fall through to error
      }
    }

    throw new Error('Unable to extract company JSON from KFintech JS bundle');
  }

  /**
   * Determines if response text is HTML (WAF block, CloudFront 403, SPA fallback).
   */
  public isHtmlPayload(text: string): boolean {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    return (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<HTML') ||
      trimmed.includes('<head>') ||
      trimmed.includes('<body>')
    );
  }

  /**
   * Performs HTTP fetch with bounded exponential backoff and random jitter.
   */
  public async fetchWithBackoffAndJitter(
    url: string,
    options: {
      headers?: Record<string, string>;
      timeoutMs?: number;
      maxRetries?: number;
      baseDelayMs?: number;
    } = {},
  ): Promise<Response> {
    const maxRetries = options.maxRetries ?? 2;
    const baseDelayMs = options.baseDelayMs ?? 200;
    const timeoutMs = options.timeoutMs ?? 5000;

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: options.headers,
          signal: controller.signal,
        });

        // Retry on 429 or 5xx server errors
        if (
          attempt < maxRetries &&
          (response.status === 429 || response.status >= 500)
        ) {
          const jitter = Math.random() * 100;
          const delay = Math.min(
            2000,
            baseDelayMs * Math.pow(2, attempt) + jitter,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
          continue;
        }

        return response;
      } catch (err: unknown) {
        lastError = err;
        if (attempt < maxRetries) {
          const jitter = Math.random() * 100;
          const delay = Math.min(
            2000,
            baseDelayMs * Math.pow(2, attempt) + jitter,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
          continue;
        }
        break;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError || 'Fetch failed'));
  }
}
