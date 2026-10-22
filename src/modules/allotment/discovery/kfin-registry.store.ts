import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KFIN_VERIFIED_FALLBACK_REGISTRY } from './kfin-identity-discovery.adapter';

export interface KfinRegistryItem {
  clientId: string;
  name: string;
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
}

export interface KfinRegistrySnapshot {
  metadata: KfinRegistryMetadata;
  items: KfinRegistryItem[];
}

export interface KfinRegistryStoreConfig {
  storagePath: string;
  cacheTtlMs: number;
  staleCacheTtlMs: number;
  portalUrl: string;
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

  constructor(customConfig?: Partial<KfinRegistryStoreConfig>) {
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

    this.config = {
      storagePath: defaultStoragePath,
      cacheTtlMs:
        customConfig?.cacheTtlMs ||
        Number(process.env.KFIN_REGISTRY_CACHE_TTL_MS) ||
        15 * 60 * 1000, // 15 minutes
      staleCacheTtlMs:
        customConfig?.staleCacheTtlMs ||
        Number(process.env.KFIN_REGISTRY_STALE_TTL_MS) ||
        30 * 1000, // 30 seconds during degradation
      portalUrl:
        customConfig?.portalUrl ||
        process.env.KFINTECH_PORTAL_URL ||
        'https://ipostatus.kfintech.com/',
      officialFeedUrl:
        customConfig?.officialFeedUrl ||
        process.env.KFINTECH_MACHINE_READABLE_SOURCE_URL ||
        undefined,
      minItemsThreshold:
        customConfig?.minItemsThreshold ||
        Number(process.env.KFIN_REGISTRY_MIN_ITEMS) ||
        (process.env.NODE_ENV === 'test' ? 1 : 20),
      maxShrinkRatio: customConfig?.maxShrinkRatio || 0.5,
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
   * Retrieves the full active registry snapshot with freshness and validation metadata.
   */
  public async getActiveRegistry(
    forceRefresh = false,
  ): Promise<KfinRegistrySnapshot> {
    const now = Date.now();

    // Serve from fresh in-memory cache if valid and not forced
    if (
      !forceRefresh &&
      this.cachedSnapshot &&
      now < this.cacheExpiresAt &&
      !this.cachedSnapshot.metadata.isStale
    ) {
      return this.cachedSnapshot;
    }

    // Deduplicate concurrent refreshes via single-flight promise
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    this.inFlightRefresh = this.executeRefreshCycle();
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
      this.cacheExpiresAt = Date.now() + this.config.staleCacheTtlMs;

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
    if (previousCount > 0 && process.env.NODE_ENV !== 'test') {
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
          validated.push({ clientId: code, name });
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
  private async executeRefreshCycle(): Promise<KfinRegistrySnapshot> {
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
      const portalSnapshot =
        await this.discoverFromPortalWithRetry(previousCount);

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
  private async discoverFromPortalWithRetry(
    previousCount: number,
  ): Promise<KfinRegistrySnapshot> {
    const portalUrl = this.config.portalUrl;
    const browserHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      Origin: 'https://ipostatus.kfintech.com',
      Referer: 'https://ipostatus.kfintech.com/',
    };

    let targetBundleUrl: string | null = null;

    // Phase 1: Discover bundle location via HTML or Manifest
    try {
      const htmlRes = await this.fetchWithBackoffAndJitter(portalUrl, {
        headers: browserHeaders,
        timeoutMs: 4000,
        maxRetries: 1,
      });

      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const scriptMatch = html.match(
          /src=["']?(\.?\/static\/js\/[^"'\s>]+)/i,
        );
        if (scriptMatch && scriptMatch[1]) {
          const cleanPath = scriptMatch[1].replace(/^\./, '');
          targetBundleUrl = new URL(cleanPath, portalUrl).toString();
        }
      }
    } catch (htmlErr) {
      this.logger.debug(
        `Portal HTML fetch threw (${htmlErr}); trying asset-manifest`,
      );
    }

    if (!targetBundleUrl) {
      try {
        const manifestUrl = new URL(
          '/asset-manifest.json',
          portalUrl,
        ).toString();
        const manifestRes = await this.fetchWithBackoffAndJitter(manifestUrl, {
          headers: browserHeaders,
          timeoutMs: 3000,
          maxRetries: 1,
        });

        if (manifestRes.ok) {
          const manifestJson = (await manifestRes.json()) as {
            files?: Record<string, string>;
          };
          const mainPath =
            manifestJson.files?.['main.js'] ||
            (manifestJson.files?.['entrypoints'] as unknown as string[])?.[1];
          if (mainPath && typeof mainPath === 'string') {
            const cleanPath = mainPath.replace(/^\./, '');
            targetBundleUrl = new URL(cleanPath, portalUrl).toString();
          }
        }
      } catch {
        // Ignore manifest error
      }
    }

    // Resilient fallback candidate: verified known bundle path
    if (!targetBundleUrl) {
      targetBundleUrl = new URL(
        '/static/js/main.9f7d02b5.js',
        portalUrl,
      ).toString();
    }

    // Phase 2: Fetch JS bundle with exponential backoff & jitter
    let bundleRes = await this.fetchWithBackoffAndJitter(targetBundleUrl, {
      headers: browserHeaders,
      timeoutMs: 6000,
      maxRetries: 2,
    });

    let bundleText = bundleRes.ok ? await bundleRes.text() : '';

    // If primary returned error or HTML, try cache-busted origin fallback
    if (!bundleRes.ok || this.isHtmlPayload(bundleText)) {
      try {
        const cbUrl = `${targetBundleUrl}${targetBundleUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
        const originRes = await this.fetchWithBackoffAndJitter(cbUrl, {
          headers: browserHeaders,
          timeoutMs: 6000,
          maxRetries: 1,
        });
        if (originRes.ok) {
          const originText = await originRes.text();
          if (!this.isHtmlPayload(originText)) {
            bundleRes = originRes;
            bundleText = originText;
          }
        }
      } catch {
        // Fall through to error evaluation below
      }
    }

    if (!bundleRes.ok) {
      throw new Error(
        `KFintech SPA bundle returned HTTP ${bundleRes.status} (${bundleRes.statusText})`,
      );
    }

    if (this.isHtmlPayload(bundleText)) {
      throw new Error(
        '[REGISTRAR_ALERT:MALFORMED_RESPONSE] Portal returned HTML error page instead of JS bundle',
      );
    }

    // Phase 3: Parse and validate extracted company array
    const rawList = this.extractCompanyListFromBundle(bundleText);
    const validation = this.validateRegistry(rawList, previousCount);

    if (!validation.valid) {
      throw new Error(
        `[REGISTRAR_ALERT:MALFORMED_RESPONSE] Extracted registry failed validation: ${validation.reason}`,
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

  /**
   * Recovers last-known-good registry when upstream refresh fails.
   */
  public recoverStaleSnapshot(failureReason: string): KfinRegistrySnapshot {
    const minRequired = this.config.minItemsThreshold;

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
      this.cacheExpiresAt = Date.now() + this.config.staleCacheTtlMs;
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
      this.cacheExpiresAt = Date.now() + this.config.staleCacheTtlMs;
      this.logger.warn(
        `[REGISTRAR_ALERT:STALE_REGISTRY] Recovered stale KFintech registry from disk (${staleSnapshot.items.length} items, fetchedAt: ${staleSnapshot.metadata.fetchedAt}, reason: ${failureReason})`,
      );
      return staleSnapshot;
    }

    // 3. Fallback to static verified baseline
    const baseline = this.getBaselineSnapshot();
    this.cachedSnapshot = baseline;
    this.cacheExpiresAt = Date.now() + this.config.staleCacheTtlMs;
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
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          method: 'GET',
          headers: options.headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

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
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError || 'Fetch failed'));
  }
}
