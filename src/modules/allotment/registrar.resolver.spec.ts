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
      ipoSourceIdentity: {
        findFirst: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    registry = {
      get: jest.fn(),
    } as unknown as jest.Mocked<RegistrarAdapterRegistry>;

    resolver = new RegistrarResolver(prismaService, registry);
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
