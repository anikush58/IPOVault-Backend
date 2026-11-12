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

  it('14. should forward requireLiveActiveList and skipForceRefresh probe options during Step 4 dynamic discovery', async () => {
    const dynamicIpoId = '16ad8e62-1881-4c3b-b1f3-1ea2af818b99';
    (
      prismaService.ipoAllotmentConfig.findUnique as jest.Mock
    ).mockResolvedValue(null);
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(
      null,
    );
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValue({
      id: dynamicIpoId,
      symbol: 'MAXWELL',
      company: {
        displayName: 'Maxwell Engineering Solutions',
        legalName: 'Maxwell Engineering Solutions Limited',
      },
    });
    (
      prismaService.ipoSourceIdentity as unknown as { upsert: jest.Mock }
    ).upsert = jest.fn();
    const persistSpy = jest
      .spyOn(resolver, 'persistDiscoveredRegistrarIdentity')
      .mockResolvedValue(undefined);

    const kfinSpy = {
      code: 'KFINTECH',
      resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
    };
    (registry as unknown as { getAll: jest.Mock }).getAll = jest
      .fn()
      .mockReturnValue([kfinSpy]);

    try {
      const resolved = await resolver.resolveAdapter(dynamicIpoId, undefined, {
        requireLiveActiveList: true,
        skipForceRefresh: true,
      });

      expect(kfinSpy.resolveRegistrarIpoCode).toHaveBeenCalledWith(
        expect.objectContaining({
          ipoId: dynamicIpoId,
          requireLiveActiveList: true,
          skipForceRefresh: true,
        }),
      );
      expect(resolved?.registrarIpoCode).toBe('88356314970');
    } finally {
      persistSpy.mockRestore();
    }
  });

  it('ignores placeholder registrar codes (TBD, N/A) in config/sourceIdentity and never persists Step 4 placeholder codes', async () => {
    (registry.get as jest.Mock).mockReturnValue(mockKfinAdapter);
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      registrar: 'KFINTECH',
      registrarIpoCode: 'TBD',
      enabled: true,
    });
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValueOnce({
      externalId: '37168935020',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    const fallbackResolved = await resolver.resolveAdapter(
      '16ad8e62-1881-4c3b-b1f3-1ea2af818b77',
    );
    expect(fallbackResolved?.adapter.code).toBe('KFINTECH');
    expect(fallbackResolved?.registrarIpoCode).toBe('37168935020');

    // Step 2 IpoSourceIdentity with placeholder 'N/A' ignores 'N/A'
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValueOnce(
      null,
    );
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValueOnce({
      externalId: 'N/A',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });
    const sourcePlaceholder = await resolver.resolveAdapter(
      '16ad8e62-1881-4c3b-b1f3-1ea2af818b78',
    );
    expect(sourcePlaceholder?.adapter.code).toBe('KFINTECH');
    expect(sourcePlaceholder?.registrarIpoCode).toBeUndefined();

    // Step 4 dynamic probe returning 'TBD' must never persist or return 'TBD'
    (prismaService.ipoAllotmentConfig.findUnique as jest.Mock).mockResolvedValueOnce(
      null,
    );
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValueOnce(
      null,
    );
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValueOnce({
      id: '16ad8e62-1881-4c3b-b1f3-1ea2af818b79',
      symbol: 'PHSTEP4',
      company: {
        displayName: 'Placeholder Step4 Corp',
        legalName: 'Placeholder Step4 Corp Limited',
      },
    });

    const persistSpy = jest
      .spyOn(resolver, 'persistDiscoveredRegistrarIdentity')
      .mockResolvedValue(undefined);
    const kfinPlaceholderSpy = {
      code: 'KFINTECH',
      resolveRegistrarIpoCode: jest.fn().mockResolvedValue('TBD'),
    };
    (registry as unknown as { getAll: jest.Mock }).getAll = jest
      .fn()
      .mockReturnValue([kfinPlaceholderSpy]);

    try {
      const unresolvedPlaceholder = await resolver.resolveAdapter(
        '16ad8e62-1881-4c3b-b1f3-1ea2af818b79',
      );
      expect(persistSpy).not.toHaveBeenCalled();
      expect(unresolvedPlaceholder).toBeUndefined();
    } finally {
      persistSpy.mockRestore();
    }
  });

  it('15. suppresses Step 4 eager identity persistence under requireLiveActiveList or skipIdentityPersistence while preserving non-strict persistence', async () => {
    const targetId = '16ad8e62-1881-4c3b-b1f3-1ea2af818b88';
    const sourceFindUnique = jest.fn().mockResolvedValue({ id: 'src-kfin-1' });
    const identityUpsert = jest.fn().mockResolvedValue({});
    const configUpsert = jest.fn().mockResolvedValue({});

    (prismaService as unknown as Record<string, unknown>).source = {
      findUnique: sourceFindUnique,
    };
    (
      prismaService.ipoSourceIdentity as unknown as { upsert: jest.Mock }
    ).upsert = identityUpsert;
    (
      prismaService.ipoAllotmentConfig as unknown as { upsert: jest.Mock }
    ).upsert = configUpsert;

    (
      prismaService.ipoAllotmentConfig.findUnique as jest.Mock
    ).mockResolvedValue(null);
    (prismaService.ipoSourceIdentity.findFirst as jest.Mock).mockResolvedValue(
      null,
    );
    (prismaService.ipo.findUnique as jest.Mock).mockResolvedValue({
      id: targetId,
      symbol: 'STRICT1',
      company: {
        displayName: 'Strict Persistence Test Ltd',
        legalName: 'Strict Persistence Test Limited',
      },
    });

    const kfinSpy = {
      code: 'KFINTECH',
      resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
    };
    (registry as unknown as { getAll: jest.Mock }).getAll = jest
      .fn()
      .mockReturnValue([kfinSpy]);

    const persistSpy = jest.spyOn(resolver, 'persistDiscoveredRegistrarIdentity');

    try {
      const strictResolved = await resolver.resolveAdapter(targetId, undefined, {
        requireLiveActiveList: true,
      });
      expect(strictResolved?.registrarIpoCode).toBe('88356314970');
      expect(persistSpy).not.toHaveBeenCalled();
      expect(sourceFindUnique).not.toHaveBeenCalled();
      expect(identityUpsert).not.toHaveBeenCalled();
      expect(configUpsert).not.toHaveBeenCalled();

      const explicitSuppressed = await resolver.resolveAdapter(
        targetId,
        undefined,
        {
          skipIdentityPersistence: true,
        },
      );
      expect(explicitSuppressed?.registrarIpoCode).toBe('88356314970');
      expect(persistSpy).not.toHaveBeenCalled();
      expect(identityUpsert).not.toHaveBeenCalled();
      expect(configUpsert).not.toHaveBeenCalled();

      // Non-strict workflow continues to persist Step 4 discovered identity normally
      const nonStrictResolved = await resolver.resolveAdapter(targetId);
      expect(nonStrictResolved?.registrarIpoCode).toBe('88356314970');
      // Wait a microtask tick for the fire-and-forget Step 4 persistence promise
      await Promise.resolve();
      await Promise.resolve();
      expect(persistSpy).toHaveBeenCalledWith(
        targetId,
        'KFINTECH',
        '88356314970',
      );
      expect(identityUpsert).toHaveBeenCalledTimes(1);
      expect(configUpsert).toHaveBeenCalledTimes(1);
    } finally {
      persistSpy.mockRestore();
    }
  });
});
