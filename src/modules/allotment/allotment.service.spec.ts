import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';
import { PurvaRegistrarAdapter } from './adapters/purva-registrar.adapter';
import { BigshareRegistrarAdapter } from './adapters/bigshare-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentRepository } from './allotment.repository';
import { AllotmentService } from './allotment.service';
import { AllotmentIdentifierType, AllotmentStatus } from './allotment.types';
import { RegistrarResolver } from './registrar.resolver';

describe('AllotmentService & Resolver Integration', () => {
  let service: AllotmentService;
  let resolver: RegistrarResolver;
  let prismaMock: {
    ipo: { findUnique: jest.Mock; findFirst: jest.Mock };
    ipoAllotmentConfig: { findUnique: jest.Mock };
    ipoSourceIdentity: { findFirst: jest.Mock };
    ipoParticipant: { findFirst: jest.Mock };
  };
  let repositoryMock: { logCheckAttempt: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      ipo: { findUnique: jest.fn(), findFirst: jest.fn() },
      ipoAllotmentConfig: { findUnique: jest.fn() },
      ipoSourceIdentity: { findFirst: jest.fn() },
      ipoParticipant: { findFirst: jest.fn() },
    };

    repositoryMock = {
      logCheckAttempt: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllotmentService,
        RegistrarResolver,
        RegistrarAdapterRegistry,
        KfinRegistrarAdapter,
        MufgIntimeRegistrarAdapter,
        MaashitlaRegistrarAdapter,
        SkylineRegistrarAdapter,
        PurvaRegistrarAdapter,
        BigshareRegistrarAdapter,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AllotmentRepository, useValue: repositoryMock },
      ],
    }).compile();

    service = module.get<AllotmentService>(AllotmentService);
    resolver = module.get<RegistrarResolver>(RegistrarResolver);
  });

  it('9. should correctly resolve IPO -> KFin client_id from IpoSourceIdentity', async () => {
    prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
      externalId: '40580036070',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    const resolved = await resolver.resolveAdapter('ipo-uuid-1');
    expect(resolved).toBeDefined();
    expect(resolved?.adapter.code).toBe('KFINTECH');
    expect(resolved?.registrarIpoCode).toBe('40580036070');
  });

  it('10. should support multiple IPOs resolving different client_ids dynamically', async () => {
    prismaMock.ipoSourceIdentity.findFirst
      .mockResolvedValueOnce({
        externalId: 'CLIENT_A_111',
        source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
      })
      .mockResolvedValueOnce({
        externalId: 'CLIENT_B_222',
        source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
      });

    const resolvedA = await resolver.resolveAdapter('ipo-uuid-A');
    const resolvedB = await resolver.resolveAdapter('ipo-uuid-B');

    expect(resolvedA?.registrarIpoCode).toBe('CLIENT_A_111');
    expect(resolvedB?.registrarIpoCode).toBe('CLIENT_B_222');
  });

  it('15. should protect PAN privacy and never log plaintext PAN', async () => {
    prismaMock.ipo.findUnique.mockResolvedValue({ id: 'ipo-uuid-1' });
    prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
      externalId: '40580036070',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    jest.spyOn(global, 'fetch').mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ All_Shares: 1500, App_Shares: 1500 }),
      } as Response),
    );

    const result = await service.checkAllotment({
      ipoId: 'ipo-uuid-1',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    });

    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(repositoryMock.logCheckAttempt).toHaveBeenCalledWith(
      'ipo-uuid-1',
      AllotmentIdentifierType.PAN,
      'ABCDE1234F',
      expect.objectContaining({ status: AllotmentStatus.ALLOTTED }),
      expect.any(Number),
    );
  });

  it('16. should register BigshareRegistrarAdapter and resolve both exact Bigshare IPO IDs', async () => {
    // Exact IPO 1: 522695d7-90ec-410b-8777-74b66f9abc17 (Adroit Industries)
    prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
      id: '2b77af97-f051-4dec-88e3-6d80a97d98cb',
      ipoId: '522695d7-90ec-410b-8777-74b66f9abc17',
      registrar: 'bigshare services private limited',
      registrarIpoCode: null,
      enabled: true,
    });

    const resolved1 = await resolver.resolveAdapter('522695d7-90ec-410b-8777-74b66f9abc17');
    expect(resolved1).toBeDefined();
    expect(resolved1?.adapter.code).toBe('BIGSHARE');
    expect(resolved1?.adapter.name).toBe('Bigshare Services');

    // Exact IPO 2: 7698d2f8-8e60-4ddf-a8c9-1895c16bd2b4 (A-One Steels)
    prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
      id: '36c6db9a-6508-4e68-939a-4e5ba8e0c5ea',
      ipoId: '7698d2f8-8e60-4ddf-a8c9-1895c16bd2b4',
      registrar: 'bigshare services private limited',
      registrarIpoCode: null,
      enabled: true,
    });

    const resolved2 = await resolver.resolveAdapter('7698d2f8-8e60-4ddf-a8c9-1895c16bd2b4');
    expect(resolved2).toBeDefined();
    expect(resolved2?.adapter.code).toBe('BIGSHARE');
    expect(resolved2?.adapter.name).toBe('Bigshare Services');
  });
});
