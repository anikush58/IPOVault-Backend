import { KfinIdentityDiscoveryAdapter } from './kfin-identity-discovery.adapter';
import { MufgIdentityDiscoveryAdapter, parseMufgRegistryHtml } from './mufg-identity-discovery.adapter';
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
      expect(issues.length).toBe(93);

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

    it('parseMufgRegistryHtml: extracts valid options, trims whitespace, sets registrarCode, discoveredAt, and rawPayload', () => {
      expect(mufgAdapter.registrarCode).toBe('MUFG_INTIME');
      const html = `
        <select name="ddlCompany">
          <option value="0">--Select Company--</option>
          <option value="-1"> Select Company </option>
          <option value=" 99887 ">  SPARTAN TECH LIMITED  </option>
        </select>
      `;
      const issues = parseMufgRegistryHtml(html);
      expect(issues.length).toBe(1);
      expect(issues[0]?.externalId).toBe('99887');
      expect(issues[0]?.externalName).toBe('SPARTAN TECH LIMITED');
      expect(issues[0]?.registrarCode).toBe('MUFG_INTIME');
      expect(issues[0]?.discoveredAt).toBeInstanceOf(Date);
      expect(issues[0]?.rawPayload).toEqual({ value: '99887', text: 'SPARTAN TECH LIMITED' });
    });

    it('parseMufgRegistryHtml: ignores value "0", "-1", "--select--", and "Select Company"', () => {
      const html = `
        <option value="0">Zero Value</option>
        <option value="-1">Minus One Value</option>
        <option value="100">--Select--</option>
        <option value="101">Select Company</option>
      `;
      const issues = parseMufgRegistryHtml(html);
      expect(issues.length).toBe(0);
    });

    it('parseMufgRegistryHtml: safely ignores malformed option markup', () => {
      const html = `
        <option value="">Empty Value</option>
        <option>No Value Attribute</option>
        <div>Not an option</div>
      `;
      const issues = parseMufgRegistryHtml(html);
      expect(issues.length).toBe(0);
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
  });
});
