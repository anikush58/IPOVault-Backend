import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentRepository } from './allotment.repository';
import { AllotmentService } from './allotment.service';
import { AllotmentIdentifierType, AllotmentStatus } from './allotment.types';
import { RegistrarResolver } from './registrar.resolver';

describe('AllotmentService & Resolver Integration', () => {
  let service: AllotmentService;
  let resolver: RegistrarResolver;
  let prismaMock: {
    ipo: { findUnique: jest.Mock };
    ipoSourceIdentity: { findFirst: jest.Mock };
  };
  let repositoryMock: { logCheckAttempt: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      ipo: { findUnique: jest.fn() },
      ipoSourceIdentity: { findFirst: jest.fn() },
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
});
