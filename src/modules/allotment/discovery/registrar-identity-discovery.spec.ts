import {
  KfinIdentityDiscoveryAdapter,
  KFIN_VERIFIED_FALLBACK_REGISTRY,
} from './kfin-identity-discovery.adapter';
import {
  MufgIdentityDiscoveryAdapter,
  parseMufgGetDetailsPayload,
  isValidMufgCompanyRecord,
  DEFAULT_MUFG_INTIME_COMPANY_LIST_URL,
  DEFAULT_MUFG_CACHE_TTL_MS,
  DEFAULT_MUFG_MAX_RESPONSE_BYTES,
} from './mufg-identity-discovery.adapter';
import { SourceIdentitySyncStatus } from './registrar-identity-discovery.types';
import { SourceIdentitySyncService } from './source-identity-sync.service';
import { PrismaService } from '../../../database/prisma.service';

describe('Registrar Source Identity Discovery & Sync', () => {
  let kfinAdapter: KfinIdentityDiscoveryAdapter;
  let mufgAdapter: MufgIdentityDiscoveryAdapter;
  let syncService: SourceIdentitySyncService;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;

  const mockKfinBundleJs = `
     eo="https://risop.kfintech.com/ipostatus/",to="https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=",
     rf=JSON.parse('[{"clientId":"64793825640","name":"ASHUTOSH FIBRE LIMITED"},{"clientId":"94818267561","name":"DHOOT TRANSMISSION LIMITED"}]')
  `;

  beforeEach(() => {
    kfinAdapter = new KfinIdentityDiscoveryAdapter();
    mufgAdapter = new MufgIdentityDiscoveryAdapter();

    mockPrisma = {
      source: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.code === 'KFINTECH') {
            return Promise.resolve({ id: 'kfin-source-id', code: 'KFINTECH' });
          }
          if (where.code === 'MUFG_INTIME') {
            return Promise.resolve({ id: 'mufg-source-id', code: 'MUFG_INTIME' });
          }
          return Promise.resolve(null);
        }),
      },
      ipo: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      company: {
        create: jest.fn(),
        update: jest.fn(),
      },
      ipoSourceIdentity: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    syncService = new SourceIdentitySyncService(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('Adapters', () => {
    it('parses KFin registry bundle JS', () => {
      const issues = kfinAdapter.parseKfinRegistryBundle(mockKfinBundleJs);
      expect(issues.length).toBe(2);
      expect(issues[0]?.externalId).toBe('64793825640');
      expect(issues[0]?.externalName).toBe('ASHUTOSH FIBRE LIMITED');
    });

    it('rejects HTML error payload without parsing', () => {
      const htmlPayload = `<!doctype html><html><head><title>404</title></head><body>Error from cloudfront</body></html>`;
      expect(() => kfinAdapter.parseKfinRegistryBundle(htmlPayload)).toThrow(
        'Received HTML payload instead of JavaScript bundle',
      );
    });

    it('prefers live CloudFront discovery when primary bundle fetch succeeds', async () => {
      const liveHtml = `<!doctype html><html><head><script src="/static/js/main.12345.js"></script></head><body></body></html>`;
      const liveJs = `var data = JSON.parse('[{"clientId":"99998888777","name":"LIVE NEW COMPANY LIMITED"}]');`;

      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes('.js') && !u.includes('cb=')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => liveJs,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => liveHtml,
        } as unknown as Response);
      });

      const issues = await kfinAdapter.discoverIssues();
      expect(issues.length).toBe(1);
      expect(issues[0]?.externalId).toBe('99998888777');
      expect(issues[0]?.externalName).toBe('LIVE NEW COMPANY LIMITED');
    });

    it('falls back to KFin origin bundle when CloudFront bundle returns HTML error', async () => {
      const liveHtml = `<!doctype html><html><head><script src="/static/js/main.30273529.js"></script></head><body></body></html>`;
      const cloudfrontHtmlError = `<!doctype html><html><head><title>404 Not Found</title></head><body>Error from cloudfront</body></html>`;
      const originJs = `var data = JSON.parse('[{"clientId":"93220762680","name":"ORIENT CABLES (INDIA) LIMITED-IPO"},{"clientId":"37168935020","name":"SRIT INDIA LIMITED"},{"clientId":"27219762590","name":"BENCH MARK INFOTECH SERVICES LIMITED"}]');`;

      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const u = String(url);
        if (u.includes('asset-manifest.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              files: { 'main.js': './static/js/main.30273529.js' },
            }),
          } as unknown as Response);
        }
        if (u.includes('cb=')) {
          // Origin fallback request
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => originJs,
          } as unknown as Response);
        }
        if (u.includes('main.30273529.js')) {
          // Broken CloudFront response returning HTML
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () => cloudfrontHtmlError,
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => liveHtml,
        } as unknown as Response);
      });

      const issues = await kfinAdapter.discoverIssues();
      expect(issues.length).toBe(3);

      const orient = issues.find((i) =>
        i.externalName.includes('ORIENT CABLES'),
      );
      expect(orient).toBeDefined();
      expect(orient?.externalId).toBe('93220762680');
      expect(orient?.externalName).toBe('ORIENT CABLES (INDIA) LIMITED-IPO');

      const srit = issues.find((i) => i.externalName.includes('SRIT INDIA'));
      expect(srit).toBeDefined();
      expect(srit?.externalId).toBe('37168935020');

      const benchmark = issues.find((i) =>
        i.externalName.includes('BENCH MARK INFOTECH'),
      );
      expect(benchmark).toBeDefined();
      expect(benchmark?.externalId).toBe('27219762590');
    });

    it('returns verified static fallback registry when both live CloudFront and origin discovery fail', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('CloudFront and Origin Network Error'));

      const issues = await kfinAdapter.discoverIssues();
      expect(issues.length).toBe(KFIN_VERIFIED_FALLBACK_REGISTRY.length);

      const srit = issues.find((i) => i.externalName === 'SRIT INDIA LIMITED');
      expect(srit).toBeDefined();
      expect(srit?.externalId).toBe('37168935020');
      expect(srit?.registrarCode).toBe('KFINTECH');

      const orient = issues.find((i) => i.externalName.includes('ORIENT CABLES'));
      expect(orient).toBeDefined();
      expect(orient?.externalId).toBe('93220762680');
      expect(orient?.registrarCode).toBe('KFINTECH');

      const dhoot = issues.find((i) => i.externalName === 'DHOOT TRANSMISSION LIMITED');
      expect(dhoot).toBeDefined();
      expect(dhoot?.externalId).toBe('94818267561');

      const prasol = issues.find((i) => i.externalName === 'PRASOL CHEMICALS LIMITED');
      expect(prasol).toBeDefined();
      expect(prasol?.externalId).toBe('75003530500');

      const sbi = issues.find((i) => i.externalName.includes('SBI FUNDS'));
      expect(sbi).toBeDefined();
      expect(sbi?.externalId).toBe('89468061991');

      const benchmark = issues.find((i) => i.externalName.includes('BENCH MARK INFOTECH'));
      expect(benchmark).toBeDefined();
      expect(benchmark?.externalId).toBe('27219762590');

      const elevate = issues.find((i) => i.externalName.includes('ELEVATE CAMPUSES'));
      expect(elevate).toBeDefined();
      expect(elevate?.externalId).toBe('30273060190');

      const varmora = issues.find((i) => i.externalName.includes('VARMORA GRANITO'));
      expect(varmora).toBeDefined();
      expect(varmora?.externalId).toBe('79990817560');

      // Ensure synthetic mock IDs are not present
      const syntheticIds = ['11111111111', '12345678901', '99999999999', '22222222222'];
      for (const item of issues) {
        expect(syntheticIds).not.toContain(item.externalId);
      }
    });

    describe('MUFG Intime GetDetails Parser & Identity Discovery', () => {
      const sampleMultiIpoXml = `<NewDataSet>
        <Table>
          <company_id>11971</company_id>
          <companyname>Vectras Enprocon Limited - IPO</companyname>
        </Table>
        <Table>
          <company_id>11968</company_id>
          <companyname>Suraksha Diagnostic Limited - IPO</companyname>
        </Table>
        <Table>
          <company_id>11965</company_id>
          <companyname>Property Share Investment Trust</companyname>
        </Table>
      </NewDataSet>`;

      it('1. parseMufgGetDetailsPayload: valid response with multiple IPO records', () => {
        expect(mufgAdapter.registrarCode).toBe('MUFG_INTIME');
        const payload = { d: sampleMultiIpoXml };
        const issues = parseMufgGetDetailsPayload(payload);

        expect(issues).toHaveLength(3);

        expect(issues[0]?.externalId).toBe('11971');
        expect(issues[0]?.externalName).toBe('Vectras Enprocon Limited - IPO');
        expect(issues[0]?.registrarCode).toBe('MUFG_INTIME');
        expect(issues[0]?.isStale).toBe(false);
        expect(issues[0]?.discoveredAt).toBeInstanceOf(Date);
        expect(issues[0]?.rawPayload).toEqual({
          company_id: '11971',
          companyname: 'Vectras Enprocon Limited - IPO',
        });

        expect(issues[1]?.externalId).toBe('11968');
        expect(issues[1]?.externalName).toBe('Suraksha Diagnostic Limited - IPO');

        expect(issues[2]?.externalId).toBe('11965');
        expect(issues[2]?.externalName).toBe('Property Share Investment Trust');
      });

      it('2. parseMufgGetDetailsPayload: correctly decodes CDATA, named XML entities, and numeric entities', () => {
        const payload = {
          d: `<NewDataSet>
            <Table>
              <company_id>  11971  </company_id>
              <companyname>   <![CDATA[Vectras & Enprocon]]> &#39;Special&#39; Limited &quot;SME&quot; - IPO   </companyname>
            </Table>
            <Table>
              <company_id>11972</company_id>
              <companyname>Numeric &amp; Entity &#38; Hex &#x26; Test Limited</companyname>
            </Table>
          </NewDataSet>`,
        };
        const issues = parseMufgGetDetailsPayload(payload);
        expect(issues).toHaveLength(2);
        expect(issues[0]?.externalId).toBe('11971');
        expect(issues[0]?.externalName).toBe(
          `Vectras & Enprocon 'Special' Limited "SME" - IPO`,
        );
        expect(issues[1]?.externalId).toBe('11972');
        expect(issues[1]?.externalName).toBe(
          'Numeric & Entity & Hex & Test Limited',
        );
      });

      it('3. parseMufgGetDetailsPayload: handles legitimate empty self-closing and closed NewDataSet', () => {
        expect(parseMufgGetDetailsPayload({ d: '<NewDataSet />' })).toEqual([]);
        expect(parseMufgGetDetailsPayload({ d: '<NewDataSet/>' })).toEqual([]);
        expect(
          parseMufgGetDetailsPayload({
            d: '<NewDataSet xmlns="http://tempuri.org" />',
          }),
        ).toEqual([]);
        expect(parseMufgGetDetailsPayload({ d: '<NewDataSet></NewDataSet>' })).toEqual([]);
        expect(parseMufgGetDetailsPayload({ d: '<NewDataSet />\r\n' })).toEqual([]);
        expect(parseMufgGetDetailsPayload({ d: '' })).toEqual([]);
      });

      it('4. parseMufgGetDetailsPayload: throws error on malformed JSON string', () => {
        expect(() =>
          parseMufgGetDetailsPayload('{"d": <invalid json>'),
        ).toThrow(/Malformed JSON payload from MUFG endpoint/);
      });

      it('5. parseMufgGetDetailsPayload: throws error on HTML error page or non-XML text', () => {
        // HTML error page
        const htmlPayload = {
          d: '<!doctype html><html><head><title>500</title></head><body>Internal Error</body></html>',
        };
        expect(() => parseMufgGetDetailsPayload(htmlPayload)).toThrow(
          /received HTML document/,
        );

        // Missing NewDataSet root tag
        const nonXmlPayload = { d: 'Plain text error without dataset elements' };
        expect(() => parseMufgGetDetailsPayload(nonXmlPayload)).toThrow(
          /missing NewDataSet root element/,
        );
      });

      it('6. parseMufgGetDetailsPayload: throws error when "d" property is missing or invalid', () => {
        expect(() => parseMufgGetDetailsPayload({})).toThrow(
          /Missing "d" property in MUFG company list response/,
        );
        expect(() => parseMufgGetDetailsPayload({ d: null })).toThrow(
          /Missing "d" property in MUFG company list response/,
        );
        expect(() => parseMufgGetDetailsPayload({ d: 12345 })).toThrow(
          /Invalid "d" property type in MUFG company list response/,
        );
      });

      it('7. parseMufgGetDetailsPayload: rejects several valid records followed by an unclosed Table tag (truncated XML)', () => {
        const truncatedXml = `<NewDataSet>
          <Table>
            <company_id>11971</company_id>
            <companyname>Vectras Enprocon Limited</companyname>
          </Table>
          <Table>
            <company_id>11968</company_id>
            <companyname>Suraksha Diagnostic Limited</companyname>
          </Table>
          <Table>
            <company_id>11965</company_id>
            <companyname>Unfinished Company Truncated`;

        expect(() =>
          parseMufgGetDetailsPayload({ d: truncatedXml }),
        ).toThrow(/(mismatched Table tags|unclosed Table element|missing closing <\/NewDataSet>)/);
      });

      it('8. parseMufgGetDetailsPayload: rejects truncation after complete records due to missing closing </NewDataSet>', () => {
        const missingRootCloseXml = `<NewDataSet>
          <Table>
            <company_id>11971</company_id>
            <companyname>Vectras Enprocon Limited</companyname>
          </Table>
          <Table>
            <company_id>11968</company_id>
            <companyname>Suraksha Diagnostic Limited</companyname>
          </Table>`;

        expect(() =>
          parseMufgGetDetailsPayload({ d: missingRootCloseXml }),
        ).toThrow(/missing closing <\/NewDataSet> root tag \(truncated XML\)/);
      });

      it('9. parseMufgGetDetailsPayload: safely ignores duplicate company IDs, retaining first occurrence', () => {
        const payload = {
          d: `<NewDataSet>
            <Table>
              <company_id>11971</company_id>
              <companyname>Vectras Enprocon Limited - Primary</companyname>
            </Table>
            <Table>
              <company_id>11971</company_id>
              <companyname>Vectras Enprocon Limited - Duplicate Entry</companyname>
            </Table>
            <Table>
              <company_id>11968</company_id>
              <companyname>Suraksha Diagnostic Limited - IPO</companyname>
            </Table>
          </NewDataSet>`,
        };
        const issues = parseMufgGetDetailsPayload(payload);
        expect(issues).toHaveLength(2);
        expect(issues[0]?.externalId).toBe('11971');
        expect(issues[0]?.externalName).toBe('Vectras Enprocon Limited - Primary');
        expect(issues[1]?.externalId).toBe('11968');
      });

      it('10. parseMufgGetDetailsPayload: ignores invalid IDs (0, -1, UUIDs, placeholders) and empty/select names', () => {
        const payload = {
          d: `<NewDataSet>
            <Table>
              <company_id>0</company_id>
              <companyname>Select Company</companyname>
            </Table>
            <Table>
              <company_id>-1</company_id>
              <companyname>--Select Company--</companyname>
            </Table>
            <Table>
              <company_id>TBD</company_id>
              <companyname>To Be Decided</companyname>
            </Table>
            <Table>
              <company_id>c6e18f2d-3277-44f3-b8ef-5e7e0129cf93</company_id>
              <companyname>UUID Company</companyname>
            </Table>
            <Table>
              <company_id>11999</company_id>
              <companyname></companyname>
            </Table>
            <Table>
              <company_id></company_id>
              <companyname>No ID Company</companyname>
            </Table>
            <Table>
              <company_id>11971</company_id>
              <companyname>Valid Alpha Tech Limited</companyname>
            </Table>
          </NewDataSet>`,
        };
        const issues = parseMufgGetDetailsPayload(payload);
        expect(issues).toHaveLength(1);
        expect(issues[0]?.externalId).toBe('11971');
        expect(issues[0]?.externalName).toBe('Valid Alpha Tech Limited');
        expect(isValidMufgCompanyRecord('11971', 'Valid Alpha Tech Limited')).toBe(true);
        expect(isValidMufgCompanyRecord('0', 'Some Company')).toBe(false);
        expect(isValidMufgCompanyRecord('-1', 'Some Company')).toBe(false);
        expect(isValidMufgCompanyRecord('11971', '--Select Company--')).toBe(false);
        expect(isValidMufgCompanyRecord('c6e18f2d-3277-44f3-b8ef-5e7e0129cf93', 'UUID Corp')).toBe(false);
      });

      it('11. MufgIdentityDiscoveryAdapter.discoverIssues: sends POST {} with proper headers and discovers fresh issues', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
          text: async () => JSON.stringify({ d: sampleMultiIpoXml }),
        } as unknown as Response);

        const issues = await mufgAdapter.discoverIssues();
        expect(issues).toHaveLength(3);
        expect(issues[0]?.isStale).toBe(false);
        expect(fetchSpy).toHaveBeenCalledWith(
          DEFAULT_MUFG_INTIME_COMPANY_LIST_URL,
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({}),
            headers: expect.objectContaining({
              'Content-Type': 'application/json; charset=utf-8',
              'X-Requested-With': 'XMLHttpRequest',
            }),
          }),
        );
        expect(mufgAdapter.getCachedIssues()).toHaveLength(3);
        expect(mufgAdapter.getCachedAt()).toBeDefined();
      });

      it('12. MufgIdentityDiscoveryAdapter.discoverIssues: rejects HTML Content-Type without rejecting omitted header', async () => {
        mufgAdapter.clearCache();

        // HTML Content-Type rejected
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          text: async () => '<html><body>Error page</body></html>',
        } as unknown as Response);

        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /returned HTML content-type/,
        );

        // Omitted Content-Type accepted if payload is valid JSON
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
          text: async () => JSON.stringify({ d: sampleMultiIpoXml }),
        } as unknown as Response);

        const issues = await mufgAdapter.discoverIssues();
        expect(issues).toHaveLength(3);
      });

      it('13. MufgIdentityDiscoveryAdapter.discoverIssues: rejects response exceeding maximum size limit (5MB)', async () => {
        mufgAdapter.clearCache();

        // 1. Content-Length header exceeding limit
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(DEFAULT_MUFG_MAX_RESPONSE_BYTES + 1024),
          }),
          text: async () => '{}',
        } as unknown as Response);

        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /exceeds maximum limit/,
        );

        // 2. Body size exceeding limit
        const hugePayload = ' '.repeat(DEFAULT_MUFG_MAX_RESPONSE_BYTES + 50);
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({}),
          text: async () => hugePayload,
        } as unknown as Response);

        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /exceeds maximum limit/,
        );
      });

      it('14. MufgIdentityDiscoveryAdapter.discoverIssues: handles HTTP failure and timeout when cache is empty (fail-closed)', async () => {
        mufgAdapter.clearCache();

        // HTTP 500
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers(),
          text: async () => 'Server error',
        } as unknown as Response);

        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /MUFG Intime discovery failed \(no cached registry available\): MUFG Intime company list returned HTTP status 500/,
        );

        // Abort timeout
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        jest.spyOn(global, 'fetch').mockRejectedValueOnce(abortError);

        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /MUFG Intime discovery failed \(no cached registry available\): MUFG Intime discovery request timed out after 8000ms/,
        );
      });

      it('15. MufgIdentityDiscoveryAdapter.discoverIssues: preserves valid cache during transient failure within TTL and marks issues as isStale', async () => {
        // 1. Initial successful discovery seeds cache
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ d: sampleMultiIpoXml }),
        } as unknown as Response);

        const initialIssues = await mufgAdapter.discoverIssues();
        expect(initialIssues).toHaveLength(3);
        expect(initialIssues[0]?.isStale).toBe(false);
        const initialCachedAt = mufgAdapter.getCachedAt();
        expect(initialCachedAt).not.toBeNull();

        // 2. Next cycle encounters HTTP 502 error -> returns cached registry, marked isStale: true
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 502,
          headers: new Headers(),
          text: async () => 'Bad Gateway',
        } as unknown as Response);

        const fallbackIssues = await mufgAdapter.discoverIssues();
        expect(fallbackIssues).toHaveLength(3);
        expect(fallbackIssues[0]?.externalId).toBe('11971');
        expect(fallbackIssues[0]?.isStale).toBe(true);
        expect(fallbackIssues[0]?.rawPayload?.isStale).toBe(true);
        expect(mufgAdapter.getCachedIssues()).toHaveLength(3);
      });

      it('16. MufgIdentityDiscoveryAdapter.discoverIssues: does NOT overwrite cache when a malformed/truncated response arrives after populated cache', async () => {
        // Seed cache with 3 valid items
        mufgAdapter.setCachedIssues([
          {
            externalId: '11971',
            externalName: 'Company A',
            registrarCode: 'MUFG_INTIME',
            discoveredAt: new Date(),
          },
          {
            externalId: '11968',
            externalName: 'Company B',
            registrarCode: 'MUFG_INTIME',
            discoveredAt: new Date(),
          },
        ]);

        // Malformed / truncated XML response arrives (contains 1 complete record but truncated stream)
        const truncatedXml = `<NewDataSet>
          <Table>
            <company_id>99999</company_id>
            <companyname>Truncated Stream Company</companyname>
          </Table>
          <Table><company_id>88888</company_id><companyname>Unclosed`;

        jest.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ d: truncatedXml }),
        } as unknown as Response);

        const recoveredIssues = await mufgAdapter.discoverIssues();
        // The cache must NOT be overwritten by the 1 truncated item! It must retain the 2 existing items!
        expect(recoveredIssues).toHaveLength(2);
        expect(recoveredIssues[0]?.externalId).toBe('11971');
        expect(recoveredIssues[0]?.isStale).toBe(true);
        expect(mufgAdapter.getCachedIssues()).toHaveLength(2);
      });

      it('17. MufgIdentityDiscoveryAdapter.discoverIssues: does NOT refresh cache timestamp when live request fails', async () => {
        const fixedTimestamp = Date.now() - 3600 * 1000; // 1 hour ago
        mufgAdapter.setCachedIssues(
          [
            {
              externalId: '11971',
              externalName: 'Company A',
              registrarCode: 'MUFG_INTIME',
              discoveredAt: new Date(fixedTimestamp),
            },
          ],
          fixedTimestamp,
        );

        jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network outage'));

        await mufgAdapter.discoverIssues();
        // cachedAt must remain fixed at 1 hour ago, not updated to now!
        expect(mufgAdapter.getCachedAt()).toBe(fixedTimestamp);
      });

      it('18. MufgIdentityDiscoveryAdapter.discoverIssues: expires cache after TTL (24h) and fails closed on refresh error', async () => {
        const expiredTimestamp = Date.now() - (DEFAULT_MUFG_CACHE_TTL_MS + 60 * 1000); // 24h + 1m ago
        mufgAdapter.setCachedIssues(
          [
            {
              externalId: '11971',
              externalName: 'Company A',
              registrarCode: 'MUFG_INTIME',
              discoveredAt: new Date(expiredTimestamp),
            },
          ],
          expiredTimestamp,
        );

        jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Portal unreachable'));

        // Since cache is expired, it must fail closed rather than serving expired stale data!
        await expect(mufgAdapter.discoverIssues()).rejects.toThrow(
          /MUFG Intime discovery failed \(cached registry expired/,
        );
      });

      it('19. MufgIdentityDiscoveryAdapter: supports MUFG_INTIME_COMPANY_LIST_URL and MUFG_INTIME_BASE_URL overrides', () => {
        const originalListUrl = process.env.MUFG_INTIME_COMPANY_LIST_URL;
        const originalBaseUrl = process.env.MUFG_INTIME_BASE_URL;
        try {
          delete process.env.MUFG_INTIME_COMPANY_LIST_URL;
          delete process.env.MUFG_INTIME_BASE_URL;
          expect(mufgAdapter.getCompanyListUrl()).toBe(
            'https://in.mpms.mufg.com/Initial_Offer/IPO.aspx/GetDetails',
          );

          process.env.MUFG_INTIME_BASE_URL = 'https://custom-mufg.example.com';
          expect(mufgAdapter.getCompanyListUrl()).toBe(
            'https://custom-mufg.example.com/Initial_Offer/IPO.aspx/GetDetails',
          );

          process.env.MUFG_INTIME_COMPANY_LIST_URL =
            'https://custom-mufg.example.com/api/v2/GetCompanyList';
          expect(mufgAdapter.getCompanyListUrl()).toBe(
            'https://custom-mufg.example.com/api/v2/GetCompanyList',
          );
        } finally {
          if (originalListUrl !== undefined) {
            process.env.MUFG_INTIME_COMPANY_LIST_URL = originalListUrl;
          } else {
            delete process.env.MUFG_INTIME_COMPANY_LIST_URL;
          }
          if (originalBaseUrl !== undefined) {
            process.env.MUFG_INTIME_BASE_URL = originalBaseUrl;
          } else {
            delete process.env.MUFG_INTIME_BASE_URL;
          }
        }
      });
    });
  });

  describe('SourceIdentitySyncService Safe Sync Rules', () => {
    // 1. KFin identity with exactly one matching canonical IPO -> creates IpoSourceIdentity
    it('1. KFin identity with exactly one matching canonical IPO creates IpoSourceIdentity', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-kfin-1',
          symbol: 'ASHUTOSH',
          company: { displayName: 'Ashutosh Fibre', legalName: 'Ashutosh Fibre Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '64793825640', externalName: 'ASHUTOSH FIBRE LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: { ipoId: 'ipo-kfin-1', sourceId: 'kfin-source-id', externalId: '64793825640' },
      });
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
    });

    // 2. MUFG identity with exactly one matching canonical IPO -> creates IpoSourceIdentity
    it('2. MUFG identity with exactly one matching canonical IPO creates IpoSourceIdentity', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-mufg-1',
          symbol: null,
          company: { displayName: 'ABC Infrastructure', legalName: 'ABC Infrastructure Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'MUFG_INTIME',
        name: 'Mock MUFG',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '12345', externalName: 'ABC INFRASTRUCTURE LIMITED', registrarCode: 'MUFG_INTIME' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: { ipoId: 'ipo-mufg-1', sourceId: 'mufg-source-id', externalId: '12345' },
      });
    });

    // 3. Existing identical source + externalId mapping -> idempotent; no duplicate
    it('3. Existing identical source + externalId mapping is idempotent with no duplicate', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          symbol: 'ASHUTOSH',
          company: { displayName: 'Ashutosh Fibre', legalName: 'Ashutosh Fibre Limited' },
          sourceIdentities: [{ id: 'identity-1', externalId: '64793825640' }],
        },
      ]);

      mockPrisma.ipoSourceIdentity.findFirst.mockResolvedValue({
        id: 'identity-1',
        ipoId: 'ipo-1',
        sourceId: 'kfin-source-id',
        externalId: '64793825640',
      });

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '64793825640', externalName: 'ASHUTOSH FIBRE LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.noChangeCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });

    // 4. Same registrar externalId already mapped to a different IPO -> conflict; no reassignment
    it('4. Same registrar externalId mapped to a different IPO triggers conflict rejection', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-target',
          symbol: 'DHOOT',
          company: { displayName: 'Dhoot Transmission', legalName: 'Dhoot Transmission Limited' },
          sourceIdentities: [],
        },
      ]);

      mockPrisma.ipoSourceIdentity.findFirst.mockResolvedValue({
        id: 'existing-identity',
        ipoId: 'different-ipo-id',
        sourceId: 'kfin-source-id',
        externalId: '94818267561',
      });

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '94818267561', externalName: 'DHOOT TRANSMISSION LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.reason).toContain('Conflict: externalId');
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });

    // 5. Registrar company name matches no canonical company -> unresolved; no IPO/company creation
    it('5. Unmatched company name remains unresolved with no record creation', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '99999', externalName: 'UNMATCHED PHANTOM LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
    });

    // 6. Registrar company name matches multiple companies -> ambiguous; no mapping
    it('6. Multiple company matches result in unresolved status with no mapping created', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-alpha-1',
          symbol: null,
          company: { displayName: 'Alpha Tech', legalName: 'Alpha Tech Limited' },
          sourceIdentities: [],
        },
        {
          id: 'ipo-alpha-2',
          symbol: null,
          company: { displayName: 'Alpha Tech', legalName: 'Alpha Tech Private Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '11111', externalName: 'ALPHA TECH LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.reason).toContain('Ambiguous');
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });

    // 7. One company has multiple IPOs and registrar provides only company name/externalId -> must NOT arbitrarily select an IPO
    it('7. One company with multiple canonical IPOs remains unresolved without arbitrary selection', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-series-1',
          symbol: null,
          company: { displayName: 'Beta Corp', legalName: 'Beta Corp Limited' },
          sourceIdentities: [],
        },
        {
          id: 'ipo-series-2',
          symbol: null,
          company: { displayName: 'Beta Corp', legalName: 'Beta Corp Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '22222', externalName: 'BETA CORP LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });

    // 8. Registrar data omits price/issue-size/etc. -> canonical IPO fields remain untouched
    it('8. Canonical IPO and Company fields are untouched during sync', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-untouched',
          symbol: 'GAMMA',
          company: { displayName: 'Gamma Ltd', legalName: 'Gamma Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '33333', externalName: 'GAMMA LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      await syncService.syncRegistrarIdentities(mockAdapter);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });

    // 9. Malformed/empty externalId -> safely rejected
    it('9. Malformed or empty externalId is safely rejected', async () => {
      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '   ', externalName: 'SOME COMPANY LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.reason).toContain('Malformed or empty');
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });

    // 10. Malformed/empty externalName -> safely unresolved/rejected
    it('10. Malformed or empty externalName is safely rejected', async () => {
      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '44444', externalName: '', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.reason).toContain('Malformed or empty');
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });

    // 11. Running sync twice with the same registrar identities -> produces the same database state
    it('11. Running sync twice produces identical state (idempotent execution)', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-repeat',
          symbol: 'DELTA',
          company: { displayName: 'Delta Ltd', legalName: 'Delta Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '55555', externalName: 'DELTA LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      // First run: discovers and creates mapping
      const summary1 = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary1.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledTimes(1);

      // Setup state for second run (mapping now exists in DB)
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-repeat',
          symbol: 'DELTA',
          company: { displayName: 'Delta Ltd', legalName: 'Delta Limited' },
          sourceIdentities: [{ id: 'identity-delta', externalId: '55555' }],
        },
      ]);
      mockPrisma.ipoSourceIdentity.findFirst.mockResolvedValue({
        id: 'identity-delta',
        ipoId: 'ipo-repeat',
        sourceId: 'kfin-source-id',
        externalId: '55555',
      });

      // Second run: no change
      const summary2 = await syncService.syncRegistrarIdentities(mockAdapter);
      expect(summary2.noChangeCount).toBe(1);
      expect(summary2.discoveredCount).toBe(0);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledTimes(1); // Not called again
    });

    // 12. Stale cached registrar issues (isStale: true) are marked SKIPPED and never persisted to database
    it('12. Stale cached registrar issues (isStale: true) are marked SKIPPED and never persisted to database', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-stale-test',
          symbol: 'STALE',
          company: { displayName: 'Stale Company', legalName: 'Stale Company Limited' },
          sourceIdentities: [],
        },
      ]);

      const mockStaleAdapter = {
        registrarCode: 'MUFG_INTIME',
        name: 'Mock MUFG',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '998877',
            externalName: 'STALE COMPANY LIMITED',
            registrarCode: 'MUFG_INTIME',
            isStale: true,
            rawPayload: { isStale: true, cachedAt: Date.now() - 3600 * 1000 },
          },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockStaleAdapter);

      expect(summary.isStale).toBe(true);
      expect(summary.totalDiscovered).toBe(1);
      expect(summary.discoveredCount).toBe(0);
      expect(summary.skippedCount).toBe(1);
      expect(summary.syncRecords[0]?.status).toBe(SourceIdentitySyncStatus.SKIPPED);
      expect(summary.syncRecords[0]?.reason).toContain('stale cached registrar issue cannot be persisted');

      // Crucial: database create/update must NOT have been called!
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });
  });

  describe('Cross-Registrar Isolation', () => {
    it('does not overwrite existing KFINTECH identity when MUFG_INTIME is synced for the same IPO', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-shared',
          symbol: 'SHARED',
          company: { displayName: 'Shared Corp', legalName: 'Shared Corp Limited' },
          sourceIdentities: [
            { id: 'identity-kfin', sourceId: 'kfin-source-id', externalId: 'KFIN-001' },
          ],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'MUFG_INTIME',
        name: 'Mock MUFG Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: 'MUFG-001', externalName: 'SHARED CORP LIMITED', registrarCode: 'MUFG_INTIME' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: {
          ipoId: 'ipo-shared',
          sourceId: 'mufg-source-id',
          externalId: 'MUFG-001',
        },
      });
    });

    it('does not treat an externalId from another registrar source as a conflict', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-shared-2',
          symbol: 'SHARED2',
          company: { displayName: 'Shared2 Corp', legalName: 'Shared2 Corp Limited' },
          sourceIdentities: [
            { id: 'identity-kfin', sourceId: 'kfin-source-id', externalId: 'KFIN-001' },
          ],
        },
      ]);

      // findFirst returns null because query is scoped to mufg-source-id
      mockPrisma.ipoSourceIdentity.findFirst.mockResolvedValue(null);

      const mockAdapter = {
        registrarCode: 'MUFG_INTIME',
        name: 'Mock MUFG Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: 'KFIN-001', externalName: 'SHARED2 CORP LIMITED', registrarCode: 'MUFG_INTIME' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: {
          ipoId: 'ipo-shared-2',
          sourceId: 'mufg-source-id',
          externalId: 'KFIN-001',
        },
      });
    });

    it('flags conflict when same registrar externalId is already mapped to a different IPO under same sourceId', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-b',
          symbol: 'IPO_B',
          company: { displayName: 'IPO B Corp', legalName: 'IPO B Corp Limited' },
          sourceIdentities: [],
        },
      ]);

      mockPrisma.ipoSourceIdentity.findFirst.mockResolvedValue({
        id: 'existing-mufg-mapping',
        ipoId: 'ipo-a',
        sourceId: 'mufg-source-id',
        externalId: 'MUFG-001',
      });

      const mockAdapter = {
        registrarCode: 'MUFG_INTIME',
        name: 'Mock MUFG Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: 'MUFG-001', externalName: 'IPO B CORP LIMITED', registrarCode: 'MUFG_INTIME' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.reason).toContain('Conflict: externalId');
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });

    it('prefers active configured IPO over unconfigured duplicate when matching KFin issue', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-unconfigured',
          symbol: 'SRIT',
          company: { displayName: 'SRIT India Limited', legalName: 'SRIT India Limited' },
          allotmentConfig: null,
          sourceIdentities: [],
        },
        {
          id: 'ipo-configured',
          symbol: null,
          company: { displayName: 'SRIT India', legalName: 'SRIT India' },
          allotmentConfig: { enabled: true, registrar: 'kfin technologies ltd.' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '37168935020', externalName: 'SRIT INDIA LIMITED', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: {
          ipoId: 'ipo-configured',
          sourceId: 'kfin-source-id',
          externalId: '37168935020',
        },
      });
    });

    it('tolerates common registrar typos like MANAGMENT for SBI Funds Management', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-sbi',
          symbol: null,
          company: { displayName: 'SBI Funds Management Limited', legalName: 'SBI Funds Management Limited' },
          allotmentConfig: { enabled: true, registrar: 'kfin technologies limited' },
          sourceIdentities: [],
        },
      ]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          { externalId: '89468061991', externalName: 'SBI FUNDS MANAGMENT LIMITED IPO', registrarCode: 'KFINTECH' },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.discoveredCount).toBe(1);
      expect(mockPrisma.ipoSourceIdentity.create).toHaveBeenCalledWith({
        data: {
          ipoId: 'ipo-sbi',
          sourceId: 'kfin-source-id',
          externalId: '89468061991',
        },
      });
    });

    it('creates ipoAllotmentConfig on live match without overwriting verified registrarIpoCode, and skips stale items', async () => {
      const mockUpsert = jest.fn().mockResolvedValue({});
      const mockFindConfig = jest.fn().mockResolvedValue(null);
      const mockSourceUpsert = jest
        .fn()
        .mockResolvedValue({ id: 'bigshare-source-id', code: 'BIGSHARE' });

      mockPrisma.ipoAllotmentConfig = {
        findUnique: mockFindConfig,
        upsert: mockUpsert,
      } as any;
      mockPrisma.ipoParticipant = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      } as any;
      mockPrisma.source.upsert = mockSourceUpsert as any;

      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-bs-live',
          symbol: 'BIGLIVE',
          company: { displayName: 'Big Live Corp', legalName: 'Big Live Corp Limited' },
          allotmentConfig: null,
          sourceIdentities: [],
        },
        {
          id: 'ipo-kf-stale',
          symbol: 'KFSTALE',
          company: { displayName: 'KF Stale Corp', legalName: 'KF Stale Corp Limited' },
          allotmentConfig: null,
          sourceIdentities: [],
        },
      ]);

      const bigshareMockAdapter = {
        registrarCode: 'BIGSHARE',
        name: 'Mock Bigshare',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: 'BS-LIVE-1',
            externalName: 'BIG LIVE CORP LIMITED',
            registrarCode: 'BIGSHARE',
            isStale: false,
          },
        ]),
      };

      await syncService.syncRegistrarIdentities(bigshareMockAdapter);

      expect(mockSourceUpsert).toHaveBeenCalled();
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ipoId: 'ipo-bs-live' },
          create: expect.objectContaining({
            ipoId: 'ipo-bs-live',
            registrar: 'BIGSHARE',
            registrarIpoCode: 'BS-LIVE-1',
            enabled: true,
          }),
        }),
      );

      mockUpsert.mockClear();
      const staleKfinAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock Stale KFin',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '9911223344',
            externalName: 'KF STALE CORP LIMITED',
            registrarCode: 'KFINTECH',
            isStale: true,
          },
        ]),
      };

      await syncService.syncRegistrarIdentities(staleKfinAdapter);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('Partial Registrar Reconciliation & Read-Only Audit Report', () => {
    it('reconciles partial IpoSourceIdentity/IpoParticipant records in apply mode while respecting dryRun, conflicts, and disabled configs', async () => {
      const mockConfigUpsert = jest.fn().mockResolvedValue({});
      const mockParticipantCreate = jest.fn().mockResolvedValue({});
      mockPrisma.ipoAllotmentConfig = {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: mockConfigUpsert,
      } as any;
      mockPrisma.ipoParticipant = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: mockParticipantCreate,
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-si-only',
          status: 'OPEN',
          publicationStatus: 'PUBLISHED',
          company: { legalName: 'Source Identity Only Ltd' },
          allotmentConfig: null,
          participants: [],
          sourceIdentities: [
            {
              externalId: '11999',
              source: { code: 'MUFG_INTIME', name: 'MUFG Intime', sourceType: 'REGISTRAR' },
            },
          ],
        },
        {
          id: 'ipo-participant-only',
          status: 'UPCOMING',
          publicationStatus: 'PUBLISHED',
          company: { legalName: 'Participant Only Ltd' },
          allotmentConfig: null,
          participants: [{ role: 'REGISTRAR', name: 'Bigshare Services Pvt. Ltd.' }],
          sourceIdentities: [],
        },
        {
          id: 'ipo-disabled',
          status: 'CLOSED',
          publicationStatus: 'PUBLISHED',
          company: { legalName: 'Disabled Config Ltd' },
          allotmentConfig: { registrar: null, registrarIpoCode: null, enabled: false },
          participants: [{ role: 'REGISTRAR', name: 'KFin Technologies Limited' }],
          sourceIdentities: [],
        },
        {
          id: 'ipo-conflict',
          status: 'OPEN',
          publicationStatus: 'PUBLISHED',
          company: { legalName: 'Conflict Ltd' },
          allotmentConfig: null,
          participants: [{ role: 'REGISTRAR', name: 'Bigshare Services Pvt Ltd' }],
          sourceIdentities: [
            {
              externalId: '9988',
              source: { code: 'KFINTECH', name: 'KFin', sourceType: 'REGISTRAR' },
            },
          ],
        },
      ]);

      const dryRunResult = await syncService.reconcilePartialRegistrarRecords({
        dryRun: true,
      });

      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.reconciledCount).toBe(2);
      expect(dryRunResult.skippedConflictCount).toBe(1);
      expect(dryRunResult.skippedDisabledCount).toBe(1);
      expect(mockConfigUpsert).not.toHaveBeenCalled();

      const applyResult = await syncService.reconcilePartialRegistrarRecords({
        dryRun: false,
      });

      expect(applyResult.dryRun).toBe(false);
      expect(applyResult.reconciledCount).toBe(2);
      expect(mockConfigUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ipoId: 'ipo-si-only' },
          create: expect.objectContaining({
            registrar: 'MUFG_INTIME',
            registrarIpoCode: '11999',
            enabled: true,
          }),
        }),
      );
      expect(mockConfigUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ipoId: 'ipo-participant-only' },
          create: expect.objectContaining({
            registrar: 'BIGSHARE',
            enabled: true,
          }),
        }),
      );
    });

    it('generates read-only coverage & duplicate PUBLISHED IPO audit report without mutating DB', async () => {
      const now = new Date('2026-11-25T05:00:00Z');
      mockPrisma.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          slug: 'dhoot-transmission-ipo',
          symbol: null,
          status: 'UPCOMING',
          marketSegment: 'MAINBOARD',
          publicationStatus: 'PUBLISHED',
          createdAt: new Date('2026-11-20T00:00:00Z'),
          company: { legalName: 'Dhoot Transmission Limited', displayName: 'Dhoot Transmission Limited' },
          allotmentConfig: null,
          participants: [],
          sourceIdentities: [],
          lifecycleEvents: [],
        },
        {
          id: 'ipo-2',
          slug: 'dhoot-transmission-limited-ipo',
          symbol: 'DHOOT',
          status: 'UPCOMING',
          marketSegment: 'MAINBOARD',
          publicationStatus: 'PUBLISHED',
          createdAt: new Date('2026-11-21T00:00:00Z'),
          company: { legalName: 'Dhoot Transmission Limited', displayName: 'Dhoot Transmission' },
          allotmentConfig: null,
          participants: [],
          sourceIdentities: [],
          lifecycleEvents: [],
        },
        {
          id: 'ipo-3',
          slug: 'old-listed-covered',
          symbol: 'OLDCOV',
          status: 'LISTED',
          marketSegment: 'MAINBOARD',
          publicationStatus: 'PUBLISHED',
          createdAt: new Date('2025-01-01T00:00:00Z'),
          company: { legalName: 'Old Covered Limited', displayName: 'Old Covered Limited' },
          allotmentConfig: { registrar: 'KFINTECH', registrarIpoCode: '12345', enabled: true },
          participants: [{ role: 'REGISTRAR', name: 'KFINTECH' }],
          sourceIdentities: [],
          lifecycleEvents: [{ eventType: 'LISTING', eventDate: new Date('2025-01-10T00:00:00Z') }],
        },
      ]);

      const report = await syncService.generateRegistrarCoverageAuditReport(now);

      expect(report.summary.totalPublished).toBe(3);
      expect(report.summary.missingAllRegistrars).toBe(2);
      expect(report.activeMissingRegistrars).toHaveLength(2);
      const upcomingBucket = report.byStatus.find(
        (b) => b.status === 'UPCOMING' && b.marketSegment === 'MAINBOARD',
      );
      expect(upcomingBucket?.missingAllRegistrars).toBe(2);
      expect(report.duplicatePublishedGroups).toHaveLength(1);
      expect(report.duplicatePublishedGroups[0]?.normalizedCompanyName).toContain('dhoot transmission');
      expect(report.duplicatePublishedGroups[0]?.records).toHaveLength(2);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
    });
  });
});
