import { RegistrarResolver } from './registrar.resolver';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';

describe('RegistrarResolver tests', () => {
  let resolver: RegistrarResolver;
  let prismaService: jest.Mocked<PrismaService>;
  let registry: jest.Mocked<RegistrarAdapterRegistry>;

  const mockKfinAdapter = new KfinRegistrarAdapter();
  const mockMaashitlaAdapter = new MaashitlaRegistrarAdapter();
  const mockSkylineAdapter = new SkylineRegistrarAdapter();

  beforeEach(() => {
    prismaService = {
      ipoAllotmentConfig: {
        findUnique: jest.fn(),
      },
      ipo: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      ipoSourceIdentity: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    registry = {
      get: jest.fn(),
    } as unknown as jest.Mocked<RegistrarAdapterRegistry>;

    resolver = new RegistrarResolver(prismaService, registry);
  });

  it('1. should use explicit registrarIpoCode from IpoAllotmentConfig when present', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'KFINTECH',
      registrarIpoCode: '40580036070',
    });
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBe('40580036070');
    expect(prismaService.ipoSourceIdentity.findFirst).not.toHaveBeenCalled();
  });

  it('2. should fallback to KFINTECH IpoSourceIdentity externalId when IpoAllotmentConfig registrarIpoCode is empty', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'kfin technologies ltd.',
      registrarIpoCode: null,
    });
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue({
      externalId: '37168935020',
      source: {
        code: 'KFINTECH',
        sourceType: 'REGISTRAR',
      },
    });
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBe('37168935020');
    expect(prismaService.ipoSourceIdentity.findFirst).toHaveBeenCalledWith({
      where: {
        ipoId: '16ad8e62-1881-4c3b-b1f3-1ea2af818b6a',
        source: {
          code: 'KFINTECH',
          sourceType: 'REGISTRAR',
        },
      },
      include: {
        source: true,
      },
    });
  });

  it('3. should return undefined registrarIpoCode when IpoAllotmentConfig has empty code and no source identity exists anywhere', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'KFINTECH',
      registrarIpoCode: '',
    });
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValue({
      id: '16ad8e62-1881-4c3b-b1f3-1ea2af818b6a',
      companyId: 'comp-1',
      company: { displayName: 'SRIT India', legalName: 'SRIT India' },
    });
    (prismaService.ipoSourceIdentity.findMany as jest.Mock).mockResolvedValue([]);
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBeUndefined();
  });

  it('3a. should fallback to same-company sibling KFINTECH identity when direct identity is absent', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'KFINTECH',
      registrarIpoCode: null,
    });
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValue({
      id: '16ad8e62-1881-4c3b-b1f3-1ea2af818b6a',
      companyId: 'comp-1',
      company: { displayName: 'SRIT India', legalName: 'SRIT India' },
    });
    (prismaService.ipoSourceIdentity.findMany as jest.Mock).mockResolvedValue([
      { externalId: '37168935020' },
    ]);
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBe('37168935020');
  });

  it('3b. should remain unresolved when multiple conflicting same-company KFINTECH identities exist', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'KFINTECH',
      registrarIpoCode: null,
    });
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(null);
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValue({
      id: '16ad8e62-1881-4c3b-b1f3-1ea2af818b6a',
      companyId: 'comp-1',
      company: { displayName: 'SRIT India', legalName: 'SRIT India' },
    });
    (prismaService.ipoSourceIdentity.findMany as jest.Mock).mockResolvedValue([
      { externalId: '37168935020' },
      { externalId: '99999999999' },
    ]);
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBeUndefined();
  });

  it('4. should not query KFin source identity when IpoAllotmentConfig registrar is non-KFin', async () => {
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValue({
      enabled: true,
      registrar: 'MAASHITLA',
      registrarIpoCode: null,
    });
    (registry.get as jest.Mock).mockReturnValue(mockMaashitlaAdapter);

    const resolved = await resolver.resolveAdapter('16ad8e62-1881-4c3b-b1f3-1ea2af818b6a');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockMaashitlaAdapter);
    expect(resolved?.registrarIpoCode).toBeUndefined();
    expect(prismaService.ipoSourceIdentity.findFirst).not.toHaveBeenCalled();
  });

  it('9. should resolve correct IPO -> client_id mapping from database', async () => {
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue({
      externalId: '40580036070',
      source: {
        code: 'KFINTECH',
      },
    });

    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolved = await resolver.resolveAdapter('ipo-111');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockKfinAdapter);
    expect(resolved?.registrarIpoCode).toBe('40580036070');
  });

  it('10. should handle multiple IPOs with different client IDs dynamically', async () => {
    // IPO A -> KFin client_id 40580036070
    (
      prismaService.ipoSourceIdentity.findFirst as jest.Mock
    ).mockResolvedValueOnce({
      externalId: '40580036070',
      source: { code: 'KFINTECH' },
    });
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);

    const resolvedA = await resolver.resolveAdapter('ipo-A');
    expect(resolvedA?.registrarIpoCode).toBe('40580036070');

    // IPO B -> KFin client_id 99990001111
    (
      prismaService.ipoSourceIdentity.findFirst as jest.Mock
    ).mockResolvedValueOnce({
      externalId: '99990001111',
      source: { code: 'KFINTECH' },
    });

    const resolvedB = await resolver.resolveAdapter('ipo-B');
    expect(resolvedB?.registrarIpoCode).toBe('99990001111');
  });

  it('11. should resolve MAASHITLA registrar when mapped in database', async () => {
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue({
      externalId: 'SPECTRAA TECHNOLOGY SOLUTIONS LIMITED',
      source: {
        code: 'MAASHITLA',
      },
    });

    (registry.get as jest.Mock).mockReturnValue(mockMaashitlaAdapter);

    const resolved = await resolver.resolveAdapter('ipo-maashitla');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockMaashitlaAdapter);
    expect(resolved?.adapter.code).toBe('MAASHITLA');
    expect(resolved?.registrarIpoCode).toBe('SPECTRAA TECHNOLOGY SOLUTIONS LIMITED');
  });

  it('12. should resolve SKYLINE registrar when mapped in database', async () => {
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue({
      externalId: '3418',
      source: {
        code: 'SKYLINE',
      },
    });

    (registry.get as jest.Mock).mockReturnValue(mockSkylineAdapter);

    const resolved = await resolver.resolveAdapter('ipo-skyline');

    expect(resolved).toBeDefined();
    expect(resolved?.adapter).toBe(mockSkylineAdapter);
    expect(resolved?.adapter.code).toBe('SKYLINE');
    expect(resolved?.registrarIpoCode).toBe('3418');
  });

  it('should return undefined and log warning when no source identity is registered (NO guessing)', async () => {
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(
      null,
    );

    const resolved = await resolver.resolveAdapter('unmapped-ipo');
    expect(resolved).toBeUndefined();
  });
});
