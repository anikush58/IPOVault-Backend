import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { KfinRegistryStore, KfinRegistrySnapshot } from './kfin-registry.store';
import { KFIN_VERIFIED_FALLBACK_REGISTRY } from './kfin-identity-discovery.adapter';

describe('KfinRegistryStore — Permanent Registrar Reliability & Anti-Corruption Guard', () => {
  let tempStorageDir: string;
  let testStoragePath: string;
  let store: KfinRegistryStore;

  const validBundleWithNewIpos = `
    var rf=JSON.parse('[{"clientId":"99001122334","name":"ACME ROBOTICS INDIA LIMITED"},{"clientId":"15211216041","name":"TONBO IMAGING INDIA LIMITED"},{"clientId":"29931891190","name":"ZETWERK MANUFACTURING BUSINESSES LIMITED"}]');
  `;

  const validHtmlWithDynamicScript = `
    <!doctype html>
    <html lang="en">
      <head>
        <script defer="defer" src="/static/js/main.abc12345.js"></script>
      </head>
      <body><div id="root"></div></body>
    </html>
  `;

  beforeEach(() => {
    tempStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kfin-store-spec-'));
    testStoragePath = path.join(tempStorageDir, 'kfintech-registry.json');
    store = new KfinRegistryStore({
      storagePath: testStoragePath,
      cacheTtlMs: 500, // 500ms for testing
      staleCacheTtlMs: 200,
      minItemsThreshold: 1, // allow synthetic test bundles
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempStorageDir)) {
        fs.rmSync(tempStorageDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
    jest.restoreAllMocks();
  });

  describe('1. Dynamic Discovery & Bundle Resolution', () => {
    it('discovers newly added IPOs dynamically from live portal SPA bundle without hardcoded hash', async () => {
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (
            urlStr.includes('ipostatus.kfintech.com') &&
            !urlStr.includes('.js')
          ) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => validHtmlWithDynamicScript,
            } as unknown as Response);
          }
          if (urlStr.includes('main.abc12345.js')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () => validBundleWithNewIpos,
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
        });

      const items = await store.getActiveItems();
      expect(items.length).toBe(3);
      expect(items.find((i) => i.clientId === '99001122334')?.name).toBe(
        'ACME ROBOTICS INDIA LIMITED',
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('main.abc12345.js'),
        expect.anything(),
      );
    });

    it('falls back to asset-manifest.json when root HTML contains no script bundle tag', async () => {
      const manifestJson = {
        files: {
          'main.js': '/static/js/main.manifest99.js',
        },
      };

      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('asset-manifest.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => manifestJson,
          } as unknown as Response);
        }
        if (urlStr.includes('main.manifest99.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response);
        }
        if (
          urlStr.includes('ipostatus.kfintech.com') &&
          !urlStr.includes('.js')
        ) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => '<html><body>No scripts here</body></html>',
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unexpected ${urlStr}`));
      });

      const items = await store.getActiveItems();
      expect(items.length).toBe(3);
      expect(items.find((i) => i.clientId === '99001122334')).toBeDefined();
    });

    it('prioritizes verified official machine-readable feed over portal scraping when configured', async () => {
      const officialStore = new KfinRegistryStore({
        storagePath: testStoragePath,
        officialFeedUrl: 'https://api.kfintech.com/official/v1/active-ipos',
        minItemsThreshold: 1,
      });

      const officialPayload = [
        { clientId: 'OFFICIAL_101', name: 'OFFICIAL MACHINE READABLE CORP' },
        { clientId: 'OFFICIAL_102', name: 'SECURE CLOUD PLATFORMS LTD' },
      ];

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr.includes('official/v1/active-ipos')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => officialPayload,
            } as unknown as Response);
          }
          return Promise.reject(
            new Error('Portal scrape should not have been called'),
          );
        });

      const snapshot = await officialStore.getActiveRegistry();
      expect(snapshot.metadata.sourceType).toBe('OFFICIAL_MACHINE_READABLE');
      expect(snapshot.items.length).toBe(2);
      expect(snapshot.items[0]?.clientId).toBe('OFFICIAL_101');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.kfintech.com/official/v1/active-ipos',
        expect.anything(),
      );
    });

    it('defaults cache TTL to 30 minutes (1800000ms) for production stability', () => {
      const defaultStore = new KfinRegistryStore();
      expect(defaultStore.getConfig().cacheTtlMs).toBe(30 * 60 * 1000);
    });

    it('forces refresh on demand bypassing in-memory cache when forceRefresh=true', async () => {
      let fetchCount = 0;
      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('.js')) {
          fetchCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => validHtmlWithDynamicScript,
        } as unknown as Response);
      });

      // First fetch: populates cache
      await store.getActiveRegistry();
      expect(fetchCount).toBe(1);

      // Normal fetch within TTL: serves from cache
      await store.getActiveRegistry();
      expect(fetchCount).toBe(1);

      // Forced refresh: bypasses cache and hits network again
      await store.getActiveRegistry(true);
      expect(fetchCount).toBe(2);
    });
  });

  describe('2. Anti-Corruption Guard & Validation', () => {
    it('refuses to overwrite valid registry when portal returns HTML error page (CloudFront 403 / 502)', async () => {
      // First populate a valid registry
      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => validHtmlWithDynamicScript,
        } as unknown as Response);
      });

      const initialSnapshot = await store.getActiveRegistry(true);
      expect(initialSnapshot.items.length).toBe(3);

      // Now simulate CloudFront WAF returning HTML error page instead of JS
      jest.spyOn(global, 'fetch').mockImplementation(() => {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            `<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body>CloudFront WAF Blocked</body></html>`,
        } as unknown as Response);
      });

      const recoveredSnapshot = await store.getActiveRegistry(true);
      // Valid registry must NOT be overwritten by HTML
      expect(recoveredSnapshot.items.length).toBe(3);
      expect(recoveredSnapshot.metadata.isStale).toBe(true);
      expect(recoveredSnapshot.metadata.validationStatus).toBe('STALE');
    });

    it('refuses to overwrite with empty list or unparseable JSON', async () => {
      const validation = store.validateRegistry([], 3);
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('below minimum threshold');

      const nonArrayValidation = store.validateRegistry(
        { error: 'corrupt' },
        3,
      );
      expect(nonArrayValidation.valid).toBe(false);
      expect(nonArrayValidation.reason).toContain('not an array');
    });

    it('rejects entries with empty strings or UUIDs as clientIds', () => {
      const dirtyEntries = [
        {
          clientId: 'b97d10e5-7977-4b95-bdc1-402a77ec6e40',
          name: 'Fake UUID Company',
        },
        { clientId: '', name: 'Empty ID Company' },
        { clientId: '12345678901', name: '' },
        { clientId: '12345678901', name: 'Valid Company Limited' },
      ];

      const validation = store.validateRegistry(dirtyEntries, 0);
      expect(validation.valid).toBe(true);
      expect(validation.validatedItems.length).toBe(1);
      expect(validation.validatedItems[0]?.clientId).toBe('12345678901');
    });
  });

  describe('3. Persistence Across Process Restarts', () => {
    it('persists last-known-good registry to disk and recovers state in a new process instance', async () => {
      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => validHtmlWithDynamicScript,
        } as unknown as Response);
      });

      // 1. Process A fetches and persists snapshot
      await store.getActiveRegistry(true);
      expect(fs.existsSync(testStoragePath)).toBe(true);

      const diskContent = JSON.parse(
        fs.readFileSync(testStoragePath, 'utf8'),
      ) as KfinRegistrySnapshot;
      expect(diskContent.metadata.itemCount).toBe(3);
      expect(diskContent.metadata.contentHash).toBeDefined();

      // 2. Simulate process restart: instantiate new store pointing to same storage path
      // Upstream is completely down (offline)
      jest.spyOn(global, 'fetch').mockImplementation(() => {
        return Promise.reject(new Error('Network is down'));
      });

      const restartedStore = new KfinRegistryStore({
        storagePath: testStoragePath,
        minItemsThreshold: 1,
      });

      // Restarted store recovers immediately from disk snapshot without network
      const recovered = await restartedStore.getActiveRegistry();
      expect(recovered.items.length).toBe(3);
      expect(recovered.metadata.sourceType).toBe('PERSISTED_DISK_SNAPSHOT');
      expect(
        recovered.items.find((i) => i.clientId === '99001122334'),
      ).toBeDefined();
    });
  });

  describe('4. Single-Flight Concurrency & Bounded Backoff', () => {
    it('deduplicates 25 concurrent requests onto a single in-flight refresh promise', async () => {
      let networkFetchCount = 0;

      jest.spyOn(global, 'fetch').mockImplementation(async (url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes('.js')) {
          networkFetchCount++;
          await new Promise((resolve) => setTimeout(resolve, 50)); // simulate latency
          return {
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => validHtmlWithDynamicScript,
        } as unknown as Response;
      });

      // Fire 25 concurrent requests simultaneously
      const results = await Promise.all(
        Array.from({ length: 25 }, () => store.getActiveItems(true)),
      );

      expect(results.length).toBe(25);
      for (const res of results) {
        expect(res.length).toBe(3);
      }
      // Single-flight mutex guarantees bundle fetch is called only once
      expect(networkFetchCount).toBe(1);
    });

    it('retries on HTTP 429 and 500 with exponential backoff and jitter', async () => {
      let attempts = 0;
      jest.spyOn(global, 'fetch').mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
          } as unknown as Response);
        }
        if (attempts === 2) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            'var rf=JSON.parse(\'[{"clientId":"111","name":"RETRY SUCCESS"}]\');',
        } as unknown as Response);
      });

      const response = await store.fetchWithBackoffAndJitter(
        'https://ipostatus.kfintech.com/static/js/main.test.js',
        { maxRetries: 2, baseDelayMs: 20 },
      );

      expect(response.ok).toBe(true);
      expect(attempts).toBe(3);
    });
  });

  describe('5. Stale-Cache Recovery & Zero-Touch Self-Healing', () => {
    it('falls back to static verified baseline when no cache or disk snapshot exists', () => {
      const recovered = store.recoverStaleSnapshot(
        'Simulated portal total outage',
      );
      expect(recovered.metadata.sourceType).toBe('STATIC_BASELINE');
      expect(recovered.metadata.isStale).toBe(true);
      expect(recovered.items.length).toBe(
        KFIN_VERIFIED_FALLBACK_REGISTRY.length,
      );
      expect(
        recovered.items.find((i) => i.name === 'TONBO IMAGING INDIA LIMITED'),
      ).toBeDefined();
    });

    it('heals automatically when live portal recovers after temporary outage', async () => {
      let portalDown = true;

      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (portalDown) {
          return Promise.reject(new Error('CloudFront CDN 502 Bad Gateway'));
        }
        if (urlStr.includes('.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => validBundleWithNewIpos,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => validHtmlWithDynamicScript,
        } as unknown as Response);
      });

      // Attempt 1: Portal is down -> served from stale baseline
      const staleSnapshot = await store.getActiveRegistry(true);
      expect(staleSnapshot.metadata.isStale).toBe(true);

      // Portal recovers
      portalDown = false;

      // Fast-forward past stale TTL
      const origNow = Date.now;
      try {
        Date.now = () => origNow() + 1000;
        // Attempt 2: Portal is back -> seamlessly recovers to fresh live registry
        const freshSnapshot = await store.getActiveRegistry(true);
        expect(freshSnapshot.metadata.isStale).toBe(false);
        expect(freshSnapshot.metadata.validationStatus).toBe('VALID');
        expect(freshSnapshot.items.length).toBe(3);
      } finally {
        Date.now = origNow;
      }
    });
  });

  describe('8. NestJS Dependency Injection & Instantiation', () => {
    it('instantiates cleanly with zero constructor arguments using default configuration', () => {
      const defaultStore = new KfinRegistryStore();
      expect(defaultStore).toBeInstanceOf(KfinRegistryStore);
      expect(defaultStore.getActiveRegistry).toBeDefined();
    });

    it('resolves cleanly via NestJS DI container when registered as a standalone provider', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [KfinRegistryStore],
      }).compile();

      const injectedStore = module.get<KfinRegistryStore>(KfinRegistryStore);
      expect(injectedStore).toBeDefined();
      expect(injectedStore).toBeInstanceOf(KfinRegistryStore);
      expect(injectedStore.getActiveRegistry).toBeDefined();
    });
  });
});
