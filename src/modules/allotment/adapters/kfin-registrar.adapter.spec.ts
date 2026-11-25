import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KfinRegistrarAdapter } from './kfin-registrar.adapter';
import { KfinRegistryStore } from '../discovery/kfin-registry.store';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
} from '../allotment.types';

describe('KfinRegistrarAdapter — CloudFront Backoff & Live Snapshot Safeguards', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kfin-adapter-spec-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('1. avoids hammering upstream across multiple IPOs when CloudFront returns 200 text/html (MALFORMED_RESPONSE) and rejects stale PERSISTED_DISK_SNAPSHOT under requireLiveActiveList', async () => {
    const storagePath = path.join(tmpDir, 'kfintech-registry.json');
    fs.writeFileSync(
      storagePath,
      JSON.stringify({
        metadata: {
          version: 1,
          registrarCode: 'KFINTECH',
          sourceTimestamp: '2026-10-27T04:44:41.235Z',
          fetchedAt: '2026-10-27T04:44:41.235Z',
          sourceType: 'PORTAL_SPA_BUNDLE',
          sourceUrl: 'https://ipostatus.kfintech.com/static/js/main.bd1f330c.js',
          itemCount: 1,
          validationStatus: 'VALID',
          isStale: false,
          contentHash: 'deadbeef',
        },
        items: [
          {
            clientId: '78061126051',
            name: 'JIO PLATFORMS LIMITED',
          },
        ],
      }),
      'utf8',
    );

    const store = new KfinRegistryStore({
      storagePath,
      minItemsThreshold: 1,
    });
    const adapter = new KfinRegistrarAdapter(store);

    const spaFallbackHtml =
      '<!doctype html><html lang="en"><head><script defer="defer" src="./static/js/main.3d909f65.js"></script></head><body><div id="root"></div></body></html>';

    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({
            'content-type': 'text/html',
            'x-cache': 'Error from cloudfront',
          }),
          text: async () => spaFallbackHtml,
        } as unknown as Response;
      });

    const origNow = Date.now;
    let fakeNowMs = origNow();
    Date.now = () => fakeNowMs;

    try {
      // First IPO check (even with skipForceRefresh omitted) attempts discovery ONCE,
      // receives 200 text/html -> MALFORMED_RESPONSE -> recovers stale disk snapshot
      // with 5m backoff and returns SOURCE_UNAVAILABLE (must NOT re-hit fetch for force refresh).
      const firstResult = await adapter.resolveRegistrarIpoCode({
        ipoId: 'ipo-jio',
        identifierType: AllotmentIdentifierType.PAN,
        identifierValue: '',
        companyName: 'Jio Platforms',
        requireLiveActiveList: true,
      });

      expect(typeof firstResult).not.toBe('string');
      expect((firstResult as { status: AllotmentStatus }).status).toBe(
        AllotmentStatus.SOURCE_UNAVAILABLE,
      );
      expect(store.isInStaleBackoff(fakeNowMs)).toBe(true);
      const fetchesAfterFirstIpo = fetchSpy.mock.calls.length;
      expect(fetchesAfterFirstIpo).toBe(3); // root HTML, asset-manifest, main JS (no ?cb=, no duplicate force refresh)

      // Subsequent IPO checks 1 minute later (still inside 5-minute MALFORMED_RESPONSE backoff)
      // must reuse stale backoff cache with ZERO additional HTTP requests, even for unlisted IPOs
      // present or absent in the persisted disk snapshot.
      fakeNowMs += 60 * 1000;
      const secondResult = await adapter.resolveRegistrarIpoCode({
        ipoId: 'ipo-watrana',
        identifierType: AllotmentIdentifierType.PAN,
        identifierValue: '',
        companyName: 'Watrana Rentals',
        requireLiveActiveList: true,
      });
      const thirdResult = await adapter.resolveRegistrarIpoCode({
        ipoId: 'ipo-mahacoal',
        identifierType: AllotmentIdentifierType.PAN,
        identifierValue: '',
        companyName: 'Mahanadi Coalfields Limited',
        symbol: 'MAHACOAL',
        requireLiveActiveList: true,
      });

      expect((secondResult as { status: AllotmentStatus }).status).toBe(
        AllotmentStatus.SOURCE_UNAVAILABLE,
      );
      expect((thirdResult as { status: AllotmentStatus }).status).toBe(
        AllotmentStatus.SOURCE_UNAVAILABLE,
      );
      expect(fetchSpy.mock.calls.length).toBe(fetchesAfterFirstIpo);
    } finally {
      Date.now = origNow;
    }
  });

  it('2. rejects isStale=true and PERSISTED_DISK_SNAPSHOT when requireLiveActiveList is true, even if item exists in snapshot', async () => {
    const store = new KfinRegistryStore({
      storagePath: path.join(tmpDir, 'nonexistent.json'),
      minItemsThreshold: 1,
    });
    const adapter = new KfinRegistrarAdapter(store);

    jest.spyOn(store, 'getActiveRegistry').mockResolvedValue({
      metadata: {
        version: 1,
        registrarCode: 'KFINTECH',
        sourceTimestamp: '2026-10-27T04:44:41.235Z',
        fetchedAt: '2026-10-27T04:44:41.235Z',
        sourceType: 'PERSISTED_DISK_SNAPSHOT',
        itemCount: 1,
        validationStatus: 'STALE',
        isStale: true,
        contentHash: 'deadbeef',
      },
      items: [
        {
          clientId: '88356314970',
          name: 'MAXWELL ENGINEERING SOLUTIONS LIMITED',
        },
      ],
    });

    const res = await adapter.resolveRegistrarIpoCode({
      ipoId: 'ipo-maxwell',
      registrarIpoCode: '88356314970',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: '',
      companyName: 'Maxwell Engineering Solutions',
      requireLiveActiveList: true,
    });

    expect(typeof res).not.toBe('string');
    expect((res as { status: AllotmentStatus }).status).toBe(
      AllotmentStatus.SOURCE_UNAVAILABLE,
    );
    expect((res as { errorMessage?: string }).errorMessage).toContain(
      'PERSISTED_DISK_SNAPSHOT',
    );
  });
});
