import { KfinIdentityDiscoveryAdapter } from './kfin-identity-discovery.adapter';
import { SourceIdentitySyncService } from './source-identity-sync.service';
import { SourceIdentitySyncStatus } from './registrar-identity-discovery.types';
import { PrismaService } from '../../../database/prisma.service';

describe('Registrar Source Identity Discovery', () => {
  let discoveryAdapter: KfinIdentityDiscoveryAdapter;
  let syncService: SourceIdentitySyncService;
  let mockPrisma: Record<string, Record<string, jest.Mock>>;

  const mockKfinBundleJs = `
     eo="https://risop.kfintech.com/ipostatus/",to="https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=",
     rf=JSON.parse('[{"clientId":"64793825640","name":"ASHUTOSH FIBRE LIMITED"},{"clientId":"94818267561","name":"DHOOT TRANSMISSION LIMITED"},{"clientId":"11111111111","name":"AMBIGUOUS ALPHA LIMITED"},{"clientId":"22222222222","name":"AMBIGUOUS ALPHA PRIVATE LIMITED"}]')
  `;

  beforeEach(() => {
    discoveryAdapter = new KfinIdentityDiscoveryAdapter();

    mockPrisma = {
      source: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'kfin-source-id',
          code: 'KFINTECH',
        }),
      },
      ipo: {
        findMany: jest.fn(),
      },
      ipoSourceIdentity: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    syncService = new SourceIdentitySyncService(
      mockPrisma as unknown as PrismaService,
    );
  });

  describe('KfinIdentityDiscoveryAdapter', () => {
    it('A & B: correctly parses Dhoot and Ashutosh client IDs from KFin bundle JS', () => {
      const issues = discoveryAdapter.parseKfinRegistryBundle(mockKfinBundleJs);

      expect(issues.length).toBe(4);

      const dhoot = issues.find((i) => i.externalName.includes('DHOOT'));
      expect(dhoot).toBeDefined();
      expect(dhoot?.externalId).toBe('94818267561');
      expect(dhoot?.registrarCode).toBe('KFINTECH');

      const ashutosh = issues.find((i) => i.externalName.includes('ASHUTOSH'));
      expect(ashutosh).toBeDefined();
      expect(ashutosh?.externalId).toBe('64793825640');
      expect(ashutosh?.registrarCode).toBe('KFINTECH');
    });
  });

  describe('SourceIdentitySyncService', () => {
    it('C: detects EXTERNAL_ID_CHANGED when stale Dhoot identity (64793825641) is present and updates it to 94818267561', async () => {
      const mockIpos = [
        {
          id: '22222222-3333-4444-b555-666666666666',
          symbol: 'DHOOT',
          company: {
            displayName: 'Dhoot Transmission',
            legalName: 'Dhoot Transmission Limited',
          },
          sourceIdentities: [
            {
              id: 'identity-dhoot-123',
              externalId: '64793825641', // STALE SEED ID
            },
          ],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(mockIpos);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '94818267561', // LIVE DISCOVERED ID
            externalName: 'DHOOT TRANSMISSION LIMITED',
            registrarCode: 'KFINTECH',
            discoveredAt: new Date(),
          },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.changedCount).toBe(1);
      expect(summary.syncRecords[0]?.status).toBe(
        SourceIdentitySyncStatus.EXTERNAL_ID_CHANGED,
      );
      expect(summary.syncRecords[0]?.previousExternalId).toBe('64793825641');
      expect(summary.syncRecords[0]?.newExternalId).toBe('94818267561');

      expect(mockPrisma.ipoSourceIdentity.update).toHaveBeenCalledWith({
        where: { id: 'identity-dhoot-123' },
        data: { externalId: '94818267561' },
      });
    });

    it('D: returns NO_CHANGE when existing Ashutosh identity (64793825640) matches live discovery', async () => {
      const mockIpos = [
        {
          id: '11111111-2222-4333-a444-555555555555',
          symbol: 'ASHUTOSH',
          company: {
            displayName: 'Ashutosh Fibre',
            legalName: 'Ashutosh Fibre Limited',
          },
          sourceIdentities: [
            {
              id: 'identity-ashutosh-123',
              externalId: '64793825640', // ALREADY MATCHES LIVE ID
            },
          ],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(mockIpos);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '64793825640',
            externalName: 'ASHUTOSH FIBRE LIMITED',
            registrarCode: 'KFINTECH',
            discoveredAt: new Date(),
          },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.noChangeCount).toBe(1);
      expect(summary.syncRecords[0]?.status).toBe(
        SourceIdentitySyncStatus.NO_CHANGE,
      );
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });

    it('E: marks ambiguous company matches as UNRESOLVED without updating database', async () => {
      const mockIpos = [
        {
          id: 'ipo-ambiguous-1',
          symbol: null,
          company: {
            displayName: 'Ambiguous Alpha',
            legalName: 'Ambiguous Alpha Limited',
          },
          sourceIdentities: [],
        },
        {
          id: 'ipo-ambiguous-2',
          symbol: null,
          company: {
            displayName: 'Ambiguous Alpha',
            legalName: 'Ambiguous Alpha Private Limited',
          },
          sourceIdentities: [],
        },
      ];

      mockPrisma.ipo.findMany.mockResolvedValue(mockIpos);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '99999999999',
            externalName: 'AMBIGUOUS ALPHA',
            registrarCode: 'KFINTECH',
            discoveredAt: new Date(),
          },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.status).toBe(
        SourceIdentitySyncStatus.UNRESOLVED,
      );
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoSourceIdentity.update).not.toHaveBeenCalled();
    });

    it('F: marks issues with no matching canonical IPO as UNRESOLVED', async () => {
      mockPrisma.ipo.findMany.mockResolvedValue([]);

      const mockAdapter = {
        registrarCode: 'KFINTECH',
        name: 'Mock KFin Adapter',
        discoverIssues: jest.fn().mockResolvedValue([
          {
            externalId: '88888888888',
            externalName: 'UNKNOWN UNMAPPED IPO LIMITED',
            registrarCode: 'KFINTECH',
            discoveredAt: new Date(),
          },
        ]),
      };

      const summary = await syncService.syncRegistrarIdentities(mockAdapter);

      expect(summary.unresolvedCount).toBe(1);
      expect(summary.syncRecords[0]?.status).toBe(
        SourceIdentitySyncStatus.UNRESOLVED,
      );
      expect(mockPrisma.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });
  });
});
