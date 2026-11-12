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
    ipo: { findUnique: jest.Mock; findFirst: jest.Mock; updateMany: jest.Mock };
    ipoAllotmentConfig: { findUnique: jest.Mock; updateMany: jest.Mock };
    ipoSourceIdentity: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      upsert?: jest.Mock;
    };
    ipoParticipant: { findFirst: jest.Mock; findMany: jest.Mock };
  };
  let repositoryMock: { logCheckAttempt: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      ipo: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ipoAllotmentConfig: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ipoSourceIdentity: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      ipoParticipant: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
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

  it('17. should transition IPO to ALLOTMENT_COMPLETED when an individual check confirms ALLOTTED', async () => {
    prismaMock.ipo.findUnique.mockResolvedValue({
      id: 'ipo-uuid-live',
      status: 'ALLOTMENT_PENDING',
      allotmentResultAvailableAt: null,
    });
    prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
      externalId: '40580036070',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    jest.spyOn(global, 'fetch').mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ All_Shares: 50, App_Shares: 50 }),
      } as Response),
    );

    const result = await service.checkAllotment({
      ipoId: 'ipo-uuid-live',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    });

    expect(result.status).toBe(AllotmentStatus.ALLOTTED);
    expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'ipo-uuid-live',
        status: { in: ['CLOSED', 'ALLOTMENT_PENDING'] },
      },
      data: expect.objectContaining({
        status: 'ALLOTMENT_COMPLETED',
      }),
    });
  });

  it('18. should NOT alter IPO declaration status when check returns APPLICATION_NOT_FOUND', async () => {
    prismaMock.ipo.findUnique.mockResolvedValue({
      id: 'ipo-uuid-not-found',
      status: 'ALLOTMENT_PENDING',
      allotmentResultAvailableAt: null,
    });
    prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
      externalId: '40580036070',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ error: 'Record not found for given PAN' }),
      } as Response),
    );

    const result = await service.checkAllotment({
      ipoId: 'ipo-uuid-not-found',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ZZZZZ9999Z',
    });

    expect(result.status).toBe(AllotmentStatus.APPLICATION_NOT_FOUND);
    expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
  });

  it('19. should NOT alter IPO declaration status on registrar errors or malformed response', async () => {
    prismaMock.ipo.findUnique.mockResolvedValue({
      id: 'ipo-uuid-err',
      status: 'ALLOTMENT_PENDING',
      allotmentResultAvailableAt: null,
    });
    prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
      externalId: '40580036070',
      source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
    });

    jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('ETIMEDOUT: Connection timed out to registrar')),
    );

    const result = await service.checkAllotment({
      ipoId: 'ipo-uuid-err',
      identifierType: AllotmentIdentifierType.PAN,
      identifierValue: 'ABCDE1234F',
    });

    expect(result.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
    expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
  });

  describe('checkIpoAllotmentAvailability probe', () => {
    it('20. should return available: true immediately if IPO is already ALLOTMENT_COMPLETED or LISTED', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-completed-1',
        status: 'ALLOTMENT_COMPLETED',
        allotmentResultAvailableAt: new Date('2026-10-15T12:00:00Z'),
        company: { displayName: 'Completed IPO' },
        allotmentConfig: { registrarIpoCode: '606' },
      });

      const res = await service.checkIpoAllotmentAvailability('ipo-completed-1');
      expect(res.available).toBe(true);
      expect(res.status).toBe('ALLOTMENT_COMPLETED');
      expect(res.registrarCode).toBe('606');
    });

    it('21. should live-probe registrar and transition to ALLOTMENT_COMPLETED when allotment is newly detected', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-awaiting-1',
        status: 'ALLOTMENT_PENDING',
        allotmentResultAvailableAt: null,
        company: { displayName: 'Acme India', legalName: 'Acme India Industries Limited' },
        allotmentConfig: { registrar: 'bigshare', registrarIpoCode: null },
      });

      const mockAdapter = {
        code: 'BIGSHARE',
        name: 'Bigshare Services',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('606'),
      };

      jest.spyOn(resolver, 'resolveAdapter').mockResolvedValue({
        adapter: mockAdapter as any,
        registrarIpoCode: undefined,
      });

      const res = await service.checkIpoAllotmentAvailability('ipo-awaiting-1');
      expect(res.available).toBe(true);
      expect(res.status).toBe('ALLOTMENT_COMPLETED');
      expect(res.registrarCode).toBe('606');
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ALLOTMENT_COMPLETED',
          }),
        }),
      );
      expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
        where: { ipoId: 'ipo-awaiting-1' },
        data: { registrarIpoCode: '606' },
      });
    });

    it('22. should return available: false when registrar has not yet released the allotment', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-awaiting-2',
        status: 'ALLOTMENT_PENDING',
        allotmentResultAvailableAt: null,
        company: { displayName: 'Pending Co', legalName: 'Pending Company Limited' },
        allotmentConfig: { registrar: 'bigshare', registrarIpoCode: null },
      });

      const mockAdapter = {
        code: 'BIGSHARE',
        name: 'Bigshare Services',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue(null),
      };

      jest.spyOn(resolver, 'resolveAdapter').mockResolvedValue({
        adapter: mockAdapter as any,
        registrarIpoCode: undefined,
      });

      const res = await service.checkIpoAllotmentAvailability('ipo-awaiting-2');
      expect(res.available).toBe(false);
      expect(res.status).toBe('ALLOTMENT_PENDING');
    });

    it('23. should persist discovered KFintech clientId and backfill allotmentResultAvailableAt during checkAllotment on a LISTED IPO without altering status', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
      });
      prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue(null);
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: null,
        enabled: true,
      });

      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.f0d85b13.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.3d909f65.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.3d909f65.js')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"88356314970","name":"MAXWELL ENGINEERING SOLUTIONS LIMITED"}]');`,
            } as unknown as Response);
          }
          if (urlStr.includes('0uz601ms56.execute-api')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => [
                {
                  All_Shares: 0,
                  App_Shares: 100,
                  Name: 'SYNTHETIC APPLICANT',
                  Appln_No: '900112233',
                  Pan_No: 'XXXXXX1234F',
                },
              ],
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
        });

      try {
        const result = await service.checkAllotment({
          ipoId: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: 'ABCDE1234F',
        });

        expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
        expect(persistSpy).toHaveBeenCalledWith(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
          'KFINTECH',
          '88356314970',
        );
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
            allotmentResultAvailableAt: null,
          },
          data: {
            allotmentResultAvailableAt: expect.any(Date),
          },
        });
      } finally {
        fetchSpy.mockRestore();
        persistSpy.mockRestore();
      }
    });

    it('24. should persist discovered KFintech clientId and backfill allotmentResultAvailableAt in checkIpoAllotmentAvailability for already-LISTED IPO', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-maxwell-listed-avail',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
      });

      const mockAdapter = {
        code: 'KFINTECH',
        name: 'KFin Technologies',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
      };

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue({
          adapter: mockAdapter as unknown as KfinRegistrarAdapter,
          registrarIpoCode: undefined,
        });
      const persistSpy = jest
        .spyOn(resolver, 'persistDiscoveredRegistrarIdentity')
        .mockResolvedValue(undefined);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-maxwell-listed-avail',
        );

        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '88356314970',
        });
        expect(persistSpy).toHaveBeenCalledWith(
          'ipo-maxwell-listed-avail',
          'KFINTECH',
          '88356314970',
        );
        expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
          where: { ipoId: 'ipo-maxwell-listed-avail' },
          data: { registrarIpoCode: '88356314970' },
        });
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'ipo-maxwell-listed-avail',
            allotmentResultAvailableAt: null,
          },
          data: {
            allotmentResultAvailableAt: expect.any(Date),
          },
        });
      } finally {
        resolveSpy.mockRestore();
        persistSpy.mockRestore();
      }
    });

    it('25. should reject fallback-only and STATIC_BASELINE KFintech matches during post-allotment checkIpoAllotmentAvailability backfill', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: '88356314970',
        enabled: true,
      });

      const realKfinAdapter = moduleAdapterForTest(service);
      const resolveCodeSpy = jest.spyOn(
        realKfinAdapter,
        'resolveRegistrarIpoCode',
      );
      let failUpstream = false;
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          if (failUpstream) {
            return Promise.reject(new Error('ECONNREFUSED'));
          }
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.no-maxwell.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.no-maxwell.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.no-maxwell.js')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"94818267561","name":"DHOOT TRANSMISSION LIMITED"}]');`,
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
        });

      try {
        // Case A: Fresh live bundle omits Maxwell (exists in KFIN_VERIFIED_FALLBACK_REGISTRY)
        const resA = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );
        expect(resA).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(resolveCodeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ requireLiveActiveList: true }),
        );
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();

        // Case B: Upstream unavailable -> STATIC_BASELINE
        failUpstream = true;
        const resB = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );
        expect(resB).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        resolveCodeSpy.mockRestore();
      }
    });

    it('26. should reject fallback-only and STATIC_BASELINE KFintech matches during pre-allotment checkIpoAllotmentAvailability probe', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'ALLOTMENT_PENDING',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: '88356314970',
        enabled: true,
      });

      const realKfinAdapter = moduleAdapterForTest(service);
      const resolveCodeSpy = jest.spyOn(
        realKfinAdapter,
        'resolveRegistrarIpoCode',
      );
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );

        expect(resolveCodeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ requireLiveActiveList: true }),
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_PENDING',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        resolveCodeSpy.mockRestore();
      }
    });

    it('27. should still use static fallback during checkAllotment and set allotmentResultAvailableAt on a real registrar outcome', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'ALLOTMENT_PENDING',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: null,
        enabled: true,
      });
      prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue(null);

      let sentClientId: string | undefined;
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown, init?: RequestInit) => {
          const urlStr = String(url);
          if (urlStr.includes('0uz601ms56.execute-api')) {
            sentClientId = (init?.headers as Record<string, string>)?.client_id;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => [
                {
                  All_Shares: 0,
                  App_Shares: 100,
                  Name: 'SYNTHETIC APPLICANT',
                  Appln_No: '900112233',
                  Pan_No: 'XXXXXX1234F',
                },
              ],
            } as unknown as Response);
          }
          return Promise.reject(new Error('Portal bundle network down'));
        });

      try {
        const result = await service.checkAllotment({
          ipoId: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: 'ABCDE1234F',
        });

        expect(sentClientId).toBe('88356314970');
        expect(result.status).toBe(AllotmentStatus.NOT_ALLOTTED);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
            status: { in: ['CLOSED', 'ALLOTMENT_PENDING'] },
          },
          data: {
            status: 'ALLOTMENT_COMPLETED',
            allotmentResultAvailableAt: expect.any(Date),
          },
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    const mockKfinBundleFetch = (
      items: Array<{ clientId: string; name: string }>,
    ) =>
      jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr === 'https://ipostatus.kfintech.com/') {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: async () =>
              '<!doctype html><html><head><script src="./static/js/main.live-test.js"></script></head><body></body></html>',
          } as unknown as Response);
        }
        if (urlStr.includes('/asset-manifest.json')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              files: { 'main.js': './static/js/main.live-test.js' },
            }),
          } as unknown as Response);
        }
        if (urlStr.includes('main.live-test.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/javascript' }),
            text: async () => `var rf=JSON.parse('${JSON.stringify(items)}');`,
          } as unknown as Response);
        }
        return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
      });

    it('28. should return available: false for unconfirmed KFin LISTED IPO when absent from live active list or identified via adapter', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: null,
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue(null);
      prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
        externalId: '88356314970',
        source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
      });

      const fetchSpy = mockKfinBundleFetch([
        { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
      ]);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );
        expect(res).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('29. should return available: false for unconfirmed KFin ALLOTMENT_COMPLETED IPO without availability timestamp', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'ALLOTMENT_COMPLETED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'KFin Technologies Limited',
          registrarIpoCode: '88356314970',
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'KFin Technologies Limited',
        registrarIpoCode: '88356314970',
        enabled: true,
      });

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('30. should return available: true for confirmed KFin IPO with allotmentResultAvailableAt populated even if backfill probe fails', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-kfin-confirmed-no-code',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: new Date('2026-10-15T12:00:00Z'),
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: null,
        enabled: true,
      });

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-confirmed-no-code',
        );
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: undefined,
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('31. should return available: true when fresh live KFin confirmation succeeds and backfill allotmentResultAvailableAt', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        status: 'ALLOTMENT_COMPLETED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: null,
        enabled: true,
      });

      const fetchSpy = mockKfinBundleFetch([
        {
          clientId: '88356314970',
          name: 'MAXWELL ENGINEERING SOLUTIONS LIMITED',
        },
      ]);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
        );
        expect(res).toEqual({
          available: true,
          status: 'ALLOTMENT_COMPLETED',
          registrarCode: '88356314970',
        });
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'cc511556-ee9f-493b-8eb1-fb0580a7fd93',
            allotmentResultAvailableAt: null,
          },
          data: {
            allotmentResultAvailableAt: expect.any(Date),
          },
        });
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it('32. should return available: false when KFin adapter cannot be resolved or resolution throws', async () => {
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-kfin-unresolved-1',
        status: 'LISTED',
        symbol: 'KFINUNRES1',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'KFin Unresolved One',
          legalName: 'KFin Unresolved One Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
        },
      });
      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce(undefined);

      try {
        const resUnresolved = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-unresolved-1',
        );
        expect(resUnresolved).toEqual({
          available: false,
          status: 'LISTED',
        });

        prismaMock.ipo.findUnique.mockResolvedValueOnce({
          id: 'ipo-kfin-unresolved-2',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'KFINUNRES2',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'KFin Unresolved Two',
            legalName: 'KFin Unresolved Two Limited',
          },
          allotmentConfig: {
            registrar: 'KFIN',
            registrarIpoCode: null,
          },
        });
        resolveSpy.mockRejectedValueOnce(new Error('Resolver failure'));

        const resRejected = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-unresolved-2',
        );
        expect(resRejected).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('33. should preserve available: true for older non-KFin IPOs without an availability timestamp', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-mufg-old-listed',
          status: 'LISTED',
          symbol: 'OLDMUFG',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Old MUFG Co',
            legalName: 'Old MUFG Co Limited',
          },
          allotmentConfig: {
            registrar: 'Link Intime India Private Limited',
            registrarIpoCode: '12345',
          },
        })
        .mockResolvedValueOnce({
          id: 'ipo-bigshare-old-completed',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'OLDBIG',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Old Bigshare Co',
            legalName: 'Old Bigshare Co Limited',
          },
          allotmentConfig: {
            registrar: 'bigshare',
            registrarIpoCode: '606',
          },
        });

      const mockMufgAdapter = {
        code: 'MUFG_INTIME',
        name: 'MUFG Intime India',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue({
          status: AllotmentStatus.NOT_YET_AVAILABLE,
          sourceCode: 'MUFG_INTIME',
          checkedAt: new Date(),
        }),
      };

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: mockMufgAdapter as unknown as MufgIntimeRegistrarAdapter,
          registrarIpoCode: '12345',
        })
        .mockResolvedValueOnce(undefined);

      try {
        const resMufg = await service.checkIpoAllotmentAvailability(
          'ipo-mufg-old-listed',
        );
        expect(resMufg).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '12345',
        });

        const resBigshare = await service.checkIpoAllotmentAvailability(
          'ipo-bigshare-old-completed',
        );
        expect(resBigshare).toEqual({
          available: true,
          status: 'ALLOTMENT_COMPLETED',
          registrarCode: '606',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('34. should keep existing fast-path intact when registrarIpoCode and allotmentResultAvailableAt are already populated', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-kfin-fast-path',
          status: 'LISTED',
          symbol: 'FASTKFIN',
          allotmentResultAvailableAt: new Date('2026-10-20T09:00:00Z'),
          company: {
            displayName: 'Fast KFin IPO',
            legalName: 'Fast KFin IPO Limited',
          },
          allotmentConfig: {
            registrar: 'kfintech',
            registrarIpoCode: '88356314970',
          },
        })
        .mockResolvedValueOnce({
          id: 'ipo-non-kfin-fast-path',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'FASTBIG',
          allotmentResultAvailableAt: new Date('2026-10-20T09:00:00Z'),
          company: {
            displayName: 'Fast Bigshare IPO',
            legalName: 'Fast Bigshare IPO Limited',
          },
          allotmentConfig: {
            registrar: 'bigshare',
            registrarIpoCode: '606',
          },
        });

      const resolveSpy = jest.spyOn(resolver, 'resolveAdapter');

      try {
        const resKfin =
          await service.checkIpoAllotmentAvailability('ipo-kfin-fast-path');
        expect(resKfin).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '88356314970',
        });

        const resNonKfin = await service.checkIpoAllotmentAvailability(
          'ipo-non-kfin-fast-path',
        );
        expect(resNonKfin).toEqual({
          available: true,
          status: 'ALLOTMENT_COMPLETED',
          registrarCode: '606',
        });

        expect(resolveSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('35. should return available: false when KFin identity is present via sourceIdentities or participants with null allotmentConfig and resolver fails or returns undefined', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-kfin-null-config-throw',
          status: 'LISTED',
          symbol: 'KFINNULL1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'KFin SourceIdentity IPO',
            legalName: 'KFin SourceIdentity IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: '88356314970',
              source: {
                code: 'KFINTECH',
                name: 'KFin Technologies Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [],
        })
        .mockResolvedValueOnce({
          id: 'ipo-kfin-participant-only',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'KFINPART1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'KFin Participant IPO',
            legalName: 'KFin Participant IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'KFin Technologies Limited',
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'ipo-kfin-fallback-query-only',
          status: 'LISTED',
          symbol: 'KFINQUERY',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'KFin Fallback Query IPO',
            legalName: 'KFin Fallback Query IPO Limited',
          },
          allotmentConfig: null,
        });

      prismaMock.ipoSourceIdentity.findMany.mockResolvedValueOnce([
        {
          externalId: '88356314970',
          source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
        },
      ]);

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockRejectedValueOnce(new Error('DB lookup error'))
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Resolver failure'));
      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );

      try {
        const resThrow = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-null-config-throw',
        );
        expect(resThrow).toEqual({
          available: false,
          status: 'LISTED',
        });

        const resParticipant = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-participant-only',
        );
        expect(resParticipant).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });

        const resFallbackQuery = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-fallback-query-only',
        );
        expect(resFallbackQuery).toEqual({
          available: false,
          status: 'LISTED',
        });

        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
        expect(persistSpy).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
        persistSpy.mockRestore();
      }
    });

    it('36. should return available: false for an unknown or unrecognized registrar when allotmentResultAvailableAt is null', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-unknown-registrar-1',
          status: 'LISTED',
          symbol: 'UNKNOWN1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Unknown Registrar Co',
            legalName: 'Unknown Registrar Co Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [],
        })
        .mockResolvedValueOnce({
          id: 'ipo-unknown-registrar-2',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'UNKNOWN2',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Unrecognized Registrar With Code Co',
            legalName: 'Unrecognized Registrar With Code Co Limited',
          },
          allotmentConfig: {
            registrar: 'UNKNOWN_RTA',
            registrarIpoCode: '606',
          },
          sourceIdentities: [],
          participants: [],
        });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const resUnknownNull = await service.checkIpoAllotmentAvailability(
          'ipo-unknown-registrar-1',
        );
        expect(resUnknownNull).toEqual({
          available: false,
          status: 'LISTED',
        });

        const resUnknownString = await service.checkIpoAllotmentAvailability(
          'ipo-unknown-registrar-2',
        );
        expect(resUnknownString).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });

        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('37. should preserve available: true for positively identified historical non-KFin IPOs via sourceIdentities or participants even with null allotmentConfig', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-cameo-source-identity',
          status: 'LISTED',
          symbol: 'OLDCAMEO',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Old Cameo Co',
            legalName: 'Old Cameo Co Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: 'CAMEO-101',
              source: {
                code: 'CAMEO',
                name: 'Cameo Corporate Services Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [],
        })
        .mockResolvedValueOnce({
          id: 'ipo-mufg-participant',
          status: 'LISTING_PENDING',
          symbol: 'OLDLINK',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Old Link Intime Co',
            legalName: 'Old Link Intime Co Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'Link Intime India Private Limited',
            },
          ],
        });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const resCameo = await service.checkIpoAllotmentAvailability(
          'ipo-cameo-source-identity',
        );
        expect(resCameo).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: undefined,
        });

        const resMufgParticipant = await service.checkIpoAllotmentAvailability(
          'ipo-mufg-participant',
        );
        expect(resMufgParticipant).toEqual({
          available: true,
          status: 'LISTING_PENDING',
          registrarCode: undefined,
        });

        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('38. should return available: false for unconfirmed KFin LISTING_PENDING IPO without altering status or writing timestamp', async () => {
      const ipoId = '11111111-1111-4111-8111-111111111381';
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: ipoId,
        status: 'LISTING_PENDING',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
        },
        sourceIdentities: [],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: '88356314970',
        enabled: true,
      });

      const realKfinAdapter = moduleAdapterForTest(service);
      const resolveCodeSpy = jest.spyOn(
        realKfinAdapter,
        'resolveRegistrarIpoCode',
      );
      const fetchSpy = mockKfinBundleFetch([
        { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
      ]);

      try {
        const res = await service.checkIpoAllotmentAvailability(ipoId);
        expect(res).toEqual({
          available: false,
          status: 'LISTING_PENDING',
        });
        expect(resolveCodeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ requireLiveActiveList: true }),
        );
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        resolveCodeSpy.mockRestore();
      }
    });

    it('39. should return available: true with persisted LISTING_PENDING status for already-confirmed KFin IPOs', async () => {
      const fastId = '11111111-1111-4111-8111-111111111391';
      const noCodeId = '11111111-1111-4111-8111-111111111392';
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: fastId,
          status: 'LISTING_PENDING',
          symbol: 'FASTLP',
          allotmentResultAvailableAt: new Date('2026-10-20T09:00:00Z'),
          company: {
            displayName: 'Fast Listing Pending IPO',
            legalName: 'Fast Listing Pending IPO Limited',
          },
          allotmentConfig: {
            registrar: 'kfintech',
            registrarIpoCode: '88356314970',
          },
        })
        .mockResolvedValueOnce({
          id: noCodeId,
          status: 'LISTING_PENDING',
          symbol: 'MAXWELL',
          allotmentResultAvailableAt: new Date('2026-10-20T09:00:00Z'),
          company: {
            displayName: 'Maxwell Engineering Solutions',
            legalName: 'Maxwell Engineering Solutions Limited',
          },
          allotmentConfig: {
            registrar: 'kfintech',
            registrarIpoCode: null,
          },
          sourceIdentities: [],
          participants: [],
        });

      const resolveSpy = jest.spyOn(resolver, 'resolveAdapter');

      try {
        // A: Fast-path LISTING_PENDING
        const resFast = await service.checkIpoAllotmentAvailability(fastId);
        expect(resFast).toEqual({
          available: true,
          status: 'LISTING_PENDING',
          registrarCode: '88356314970',
        });
        expect(resolveSpy).not.toHaveBeenCalled();

        // B: Already confirmed LISTING_PENDING without code when probe fails
        const fetchSpy = jest
          .spyOn(global, 'fetch')
          .mockRejectedValue(new Error('ECONNREFUSED'));
        try {
          prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
            registrar: 'kfintech',
            registrarIpoCode: null,
            enabled: true,
          });
          const resConfirmedNoCode =
            await service.checkIpoAllotmentAvailability(noCodeId);
          expect(resConfirmedNoCode).toEqual({
            available: true,
            status: 'LISTING_PENDING',
            registrarCode: undefined,
          });
          expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('40. should backfill allotmentResultAvailableAt and registrarIpoCode on fresh live KFin confirmation for LISTING_PENDING IPO without overwriting status', async () => {
      const ipoId = '11111111-1111-4111-8111-111111111401';
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: ipoId,
        status: 'LISTING_PENDING',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
        sourceIdentities: [],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValue({
        registrar: 'kfintech',
        registrarIpoCode: null,
        enabled: true,
      });

      const realKfinAdapter = moduleAdapterForTest(service);
      const resolveCodeSpy = jest.spyOn(
        realKfinAdapter,
        'resolveRegistrarIpoCode',
      );
      const fetchSpy = mockKfinBundleFetch([
        {
          clientId: '88356314970',
          name: 'MAXWELL ENGINEERING SOLUTIONS LIMITED',
        },
      ]);

      try {
        const resLive = await service.checkIpoAllotmentAvailability(ipoId);
        expect(resLive).toEqual({
          available: true,
          status: 'LISTING_PENDING',
          registrarCode: '88356314970',
        });
        expect(resolveCodeSpy).toHaveBeenCalledWith(
          expect.objectContaining({ requireLiveActiveList: true }),
        );
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: ipoId,
            allotmentResultAvailableAt: null,
          },
          data: {
            allotmentResultAvailableAt: expect.any(Date),
          },
        });
        expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
          where: { ipoId },
          data: { registrarIpoCode: '88356314970' },
        });
      } finally {
        fetchSpy.mockRestore();
        resolveCodeSpy.mockRestore();
      }
    });

    it('41. should NOT eagerly persist an unverified candidate registrarIpoCode when live active-list verification fails', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-kfin-candidate-unverified',
        status: 'LISTED',
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
        },
        sourceIdentities: [],
        participants: [],
      });

      const realKfinAdapter = moduleAdapterForTest(service);
      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue({
          adapter: realKfinAdapter,
          registrarIpoCode: '88356314970',
        });
      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      const fetchSpy = mockKfinBundleFetch([
        { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
      ]);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-kfin-candidate-unverified',
        );
        expect(res).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(persistSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
        persistSpy.mockRestore();
        fetchSpy.mockRestore();
      }
    });

    it('42. should fail closed when sourceIdentities contains both MUFG_INTIME and KFINTECH', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-ambiguous-mufg-kfin',
        status: 'LISTED',
        symbol: 'AMBMK',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Ambiguous MUFG KFin IPO',
          legalName: 'Ambiguous MUFG KFin IPO Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'MUFG Intime India',
              sourceType: 'REGISTRAR',
            },
          },
          {
            externalId: '88356314970',
            source: {
              code: 'KFINTECH',
              name: 'KFin Technologies Limited',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-ambiguous-mufg-kfin',
        );
        expect(res).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('43. should fail closed when sourceIdentities contains conflicting non-KFin registrars (MUFG_INTIME and BIGSHARE)', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-ambiguous-mufg-bigshare',
        status: 'ALLOTMENT_COMPLETED',
        symbol: 'AMBMGB',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Ambiguous MUFG Bigshare IPO',
          legalName: 'Ambiguous MUFG Bigshare IPO Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'Link Intime India Private Limited',
              sourceType: 'REGISTRAR',
            },
          },
          {
            externalId: '606',
            source: {
              code: 'BIGSHARE',
              name: 'Bigshare Services Pvt Ltd',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-ambiguous-mufg-bigshare',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('44. should fail closed when sourceIdentities and participants disagree (MUFG in sourceIdentities, KFINTECH in participants)', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-disagree-sources',
          status: 'LISTING_PENDING',
          symbol: 'DISAGREE1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Disagree Sources IPO',
            legalName: 'Disagree Sources IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: '12345',
              source: {
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'KFin Technologies Limited',
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'ipo-disagree-participants',
          status: 'LISTED',
          symbol: 'DISAGREE2',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Disagree Participants IPO',
            legalName: 'Disagree Participants IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [
            { role: 'REGISTRAR', name: 'MUFG Intime India' },
            { role: 'REGISTRAR', name: 'Bigshare Services Pvt Ltd' },
          ],
        });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const resCross = await service.checkIpoAllotmentAvailability(
          'ipo-disagree-sources',
        );
        expect(resCross).toEqual({
          available: false,
          status: 'LISTING_PENDING',
        });

        const resParticipants = await service.checkIpoAllotmentAvailability(
          'ipo-disagree-participants',
        );
        expect(resParticipants).toEqual({
          available: false,
          status: 'LISTED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('45. should fail closed when MUFG_INTIME is paired with an unrecognized registrar entry', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-mufg-plus-unknown-id',
          status: 'LISTED',
          symbol: 'UNKMIX1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'MUFG Plus Unknown Identity IPO',
            legalName: 'MUFG Plus Unknown Identity IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: '12345',
              source: {
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India',
                sourceType: 'REGISTRAR',
              },
            },
            {
              externalId: '999',
              source: {
                code: 'UNKNOWN_RTA',
                name: 'Mystery Registrar Pvt Ltd',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [],
        })
        .mockResolvedValueOnce({
          id: 'ipo-mufg-plus-unknown-participant',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'UNKMIX2',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'MUFG Plus Unknown Participant IPO',
            legalName: 'MUFG Plus Unknown Participant IPO Limited',
          },
          allotmentConfig: {
            registrar: 'MUFG_INTIME',
            registrarIpoCode: '12345',
            enabled: true,
          },
          sourceIdentities: [],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'Unrecognized Boutique RTA Ltd',
            },
          ],
        });

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue(undefined);

      try {
        const resUnknownId = await service.checkIpoAllotmentAvailability(
          'ipo-mufg-plus-unknown-id',
        );
        expect(resUnknownId).toEqual({
          available: false,
          status: 'LISTED',
        });

        const resUnknownPart = await service.checkIpoAllotmentAvailability(
          'ipo-mufg-plus-unknown-participant',
        );
        expect(resUnknownPart).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('46. should fail closed when resolver returns MUFG_INTIME while another source identifies KFINTECH, without trusting unordered findFirst', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-resolver-mufg-source-kfin',
          status: 'LISTED',
          symbol: 'RESCONFLICT1',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Resolver MUFG Source KFin IPO',
            legalName: 'Resolver MUFG Source KFin IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: '12345',
              source: {
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India',
                sourceType: 'REGISTRAR',
              },
            },
            {
              externalId: '88356314970',
              source: {
                code: 'KFINTECH',
                name: 'KFin Technologies Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [],
        })
        .mockResolvedValueOnce({
          id: 'ipo-resolver-mufg-findmany-kfin',
          status: 'LISTING_PENDING',
          symbol: 'RESCONFLICT2',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Resolver MUFG FindMany KFin IPO',
            legalName: 'Resolver MUFG FindMany KFin IPO Limited',
          },
          allotmentConfig: null,
        })
        .mockResolvedValueOnce({
          id: 'ipo-resolver-mufg-participant-only-kfin',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'RESCONFLICT3',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Resolver MUFG Participant KFin IPO',
            legalName: 'Resolver MUFG Participant KFin IPO Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'KFin Technologies Limited',
            },
          ],
        });

      const mockMufgAdapter = {
        code: 'MUFG_INTIME',
        name: 'MUFG Intime India',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue({
          status: AllotmentStatus.NOT_YET_AVAILABLE,
          sourceCode: 'MUFG_INTIME',
          checkedAt: new Date(),
        }),
      };

      prismaMock.ipoSourceIdentity.findFirst.mockResolvedValue({
        externalId: '12345',
        source: { code: 'MUFG_INTIME', sourceType: 'REGISTRAR' },
      });
      prismaMock.ipoSourceIdentity.findMany.mockResolvedValueOnce([
        {
          externalId: '12345',
          source: { code: 'MUFG_INTIME', sourceType: 'REGISTRAR' },
        },
        {
          externalId: '88356314970',
          source: { code: 'KFINTECH', sourceType: 'REGISTRAR' },
        },
      ]);

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValue({
          adapter: mockMufgAdapter as unknown as MufgIntimeRegistrarAdapter,
          registrarIpoCode: '12345',
        });

      try {
        const resRelations = await service.checkIpoAllotmentAvailability(
          'ipo-resolver-mufg-source-kfin',
        );
        expect(resRelations).toEqual({
          available: false,
          status: 'LISTED',
        });

        const resFindMany = await service.checkIpoAllotmentAvailability(
          'ipo-resolver-mufg-findmany-kfin',
        );
        expect(resFindMany).toEqual({
          available: false,
          status: 'LISTING_PENDING',
        });

        const resParticipantOnly = await service.checkIpoAllotmentAvailability(
          'ipo-resolver-mufg-participant-only-kfin',
        );
        expect(resParticipantOnly).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
        expect(prismaMock.ipoSourceIdentity.findMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.ipoSourceIdentity.findFirst).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('47. should continue working for genuinely unambiguous KFin and non-KFin identities across multiple agreeing sources', async () => {
      prismaMock.ipo.findUnique
        .mockResolvedValueOnce({
          id: 'ipo-unambiguous-mufg',
          status: 'LISTED',
          symbol: 'UNAMBMUFG',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Unambiguous MUFG IPO',
            legalName: 'Unambiguous MUFG IPO Limited',
          },
          allotmentConfig: {
            registrar: 'MUFG_INTIME',
            registrarIpoCode: '12345',
            enabled: true,
          },
          sourceIdentities: [
            {
              externalId: 'UNAMBMUFG',
              source: {
                code: 'NSE',
                name: 'National Stock Exchange',
                sourceType: 'EXCHANGE',
              },
            },
            {
              externalId: '12345',
              source: {
                code: 'LINKINTIME',
                name: 'Link Intime India Private Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'MUFG Intime India Pvt Ltd',
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'ipo-unambiguous-kfin-unconfirmed',
          status: 'ALLOTMENT_COMPLETED',
          symbol: 'MAXWELL',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Maxwell Engineering Solutions',
            legalName: 'Maxwell Engineering Solutions Limited',
          },
          allotmentConfig: {
            registrar: 'kfintech',
            registrarIpoCode: null,
            enabled: true,
          },
          sourceIdentities: [
            {
              externalId: '88356314970',
              source: {
                code: 'KFINTECH',
                name: 'KFin Technologies Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [
            {
              role: 'REGISTRAR',
              name: 'Karvy Fintech Pvt Ltd',
            },
          ],
        });

      const mockMufgAdapter = {
        code: 'MUFG_INTIME',
        name: 'MUFG Intime India',
        supportedIdentifiers: new Set([AllotmentIdentifierType.PAN]),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue({
          status: AllotmentStatus.NOT_YET_AVAILABLE,
          sourceCode: 'MUFG_INTIME',
          checkedAt: new Date(),
        }),
      };

      const resolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: mockMufgAdapter as unknown as MufgIntimeRegistrarAdapter,
          registrarIpoCode: '12345',
        })
        .mockResolvedValueOnce(undefined);

      try {
        const resMufg = await service.checkIpoAllotmentAvailability(
          'ipo-unambiguous-mufg',
        );
        expect(resMufg).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '12345',
        });

        const resKfinUnconfirmed = await service.checkIpoAllotmentAvailability(
          'ipo-unambiguous-kfin-unconfirmed',
        );
        expect(resKfinUnconfirmed).toEqual({
          available: false,
          status: 'ALLOTMENT_COMPLETED',
        });
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('48. should keep previously confirmed allotmentResultAvailableAt fast path intact even with conflicting sourceIdentities', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-confirmed-fast-with-conflict',
        status: 'LISTED',
        symbol: 'FASTCONF',
        allotmentResultAvailableAt: new Date('2026-10-20T09:00:00Z'),
        company: {
          displayName: 'Fast Confirmed Conflict IPO',
          legalName: 'Fast Confirmed Conflict IPO Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: '88356314970',
          enabled: true,
        },
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'MUFG Intime India',
              sourceType: 'REGISTRAR',
            },
          },
          {
            externalId: '88356314970',
            source: {
              code: 'KFINTECH',
              name: 'KFin Technologies Limited',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const resolveSpy = jest.spyOn(resolver, 'resolveAdapter');

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-confirmed-fast-with-conflict',
        );
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '88356314970',
        });
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpy.mockRestore();
      }
    });

    it('49. Finding 1: detects unrecognized non-empty companion fields within the same registrar record and fails closed', async () => {
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-companion-source-unknown-name',
        symbol: 'COMPCON',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Companion Conflict Corp',
          legalName: 'Companion Conflict Corp Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'Mystery Boutique RTA Ltd',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const persistSpy1 = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-companion-source-unknown-name',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(persistSpy1).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        persistSpy1.mockRestore();
      }

      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-companion-source-unknown-code',
        symbol: 'COMPSLUG',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Companion Slug Corp',
          legalName: 'Companion Slug Corp Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '88356314970',
            source: {
              code: 'CUSTOM_SLUG_RTA',
              name: 'KFin Technologies Limited',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const persistSpy2 = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-companion-source-unknown-code',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(persistSpy2).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        persistSpy2.mockRestore();
      }

      prismaMock.ipo.findUnique.mockResolvedValue({
        id: 'ipo-companion-participant-unknown-entity',
        symbol: 'COMPPART',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Companion Participant Corp',
          legalName: 'Companion Participant Corp Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [],
        participants: [
          {
            role: 'REGISTRAR',
            name: 'MUFG Intime India',
            entityName: 'Unrecognized Partner Services',
          },
        ],
      });

      const persistSpy3 = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-companion-participant-unknown-entity',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(persistSpy3).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        persistSpy3.mockRestore();
      }
    });

    it('50. Finding 2a: rejects genuine conflicting or unknown stored registrar metadata even when a live adapter probe succeeds', async () => {
      const mufgStubAdapter = {
        code: 'MUFG_INTIME',
        name: 'MUFG Intime',
        isSupported: () => true,
        checkAllotment: jest.fn(),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('12345'),
      };

      // Case A: Post-allotment LISTED with conflicting sourceIdentities where mocked resolver returns MUFG live probe
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-probe-conflict-mufg-kfin',
        symbol: 'PCMK',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Probe Conflict MUFG KFin Ltd',
          legalName: 'Probe Conflict MUFG KFin Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'MUFG Intime India Pvt Ltd',
              sourceType: 'REGISTRAR',
            },
          },
          {
            externalId: '88356314970',
            source: {
              code: 'KFINTECH',
              name: 'KFin Technologies Limited',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });

      const resolveConflictSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: mufgStubAdapter as never,
          registrarIpoCode: '12345',
        });
      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );

      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-probe-conflict-mufg-kfin',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(persistSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveConflictSpy.mockRestore();
        persistSpy.mockRestore();
      }

      // Case B: Unknown config registrar (UNKNOWN_RTA) where KFin live active list matches
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111150',
        symbol: 'PUCL',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Probe Unknown Config Ltd',
          legalName: 'Probe Unknown Config Ltd',
        },
        allotmentConfig: {
          registrar: 'UNKNOWN_RTA',
          registrarIpoCode: null,
          enabled: true,
        },
        sourceIdentities: [],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
        registrar: 'UNKNOWN_RTA',
        registrarIpoCode: null,
        enabled: true,
      });

      const realKfinForUnknown = moduleAdapterForTest(service);
      const resolveUnknownSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: realKfinForUnknown,
          registrarIpoCode: '88356314970',
        });
      const fetchSpyUnknown = mockKfinBundleFetch([
        { clientId: '88356314970', name: 'PROBE UNKNOWN CONFIG LTD' },
      ]);
      const persistSpyUnknown = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '11111111-1111-4111-8111-111111111150',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(persistSpyUnknown).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveUnknownSpy.mockRestore();
        fetchSpyUnknown.mockRestore();
        persistSpyUnknown.mockRestore();
      }

      // Case C: Pre-allotment ALLOTMENT_PENDING with conflicting BIGSHARE config vs KFin participant
      const bigshareStubAdapter = {
        code: 'BIGSHARE',
        name: 'Bigshare Services',
        isSupported: () => true,
        checkAllotment: jest.fn(),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('606'),
      };
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-pre-conflict-bigshare-kfin',
        symbol: 'PCBK',
        status: 'ALLOTMENT_PENDING',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Pre Conflict Bigshare KFin Ltd',
          legalName: 'Pre Conflict Bigshare KFin Limited',
        },
        allotmentConfig: {
          registrar: 'BIGSHARE',
          registrarIpoCode: '606',
          enabled: true,
        },
        sourceIdentities: [],
        participants: [
          {
            role: 'REGISTRAR',
            name: 'KFin Technologies Limited',
            entityName: 'KFin Technologies Limited',
          },
        ],
      });

      const preResolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: bigshareStubAdapter as never,
          registrarIpoCode: '606',
        });
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-pre-conflict-bigshare-kfin',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_PENDING',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        preResolveSpy.mockRestore();
      }

      // Case D: Unrecognized companion field alongside matching registrar fails closed even if live probe succeeds
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-pre-companion-unknown',
        symbol: 'PPCU',
        status: 'ALLOTMENT_PENDING',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Pre Companion Unknown Ltd',
          legalName: 'Pre Companion Unknown Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'Mystery Companion RTA',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });
      const companionResolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: mufgStubAdapter as never,
          registrarIpoCode: '12345',
        });
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-pre-companion-unknown',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_PENDING',
        });
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        companionResolveSpy.mockRestore();
      }
    });

    it('51. Finding 2b: accepts stale non-conflicting metadata when live active-list evidence safely establishes the authoritative registrar', async () => {
      // Case A: Stale registrarIpoCode and stale sourceIdentity externalId alongside agreeing KFINTECH registrar
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111151',
        symbol: 'STALEMETA',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Stale Meta Technologies Limited',
          legalName: 'Stale Meta Technologies Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: 'OLD_STALE_999',
          enabled: true,
        },
        sourceIdentities: [
          {
            externalId: 'STALE_ID',
            source: {
              code: 'KFINTECH',
              name: 'KFin Technologies Limited',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
        registrar: 'KFINTECH',
        registrarIpoCode: 'OLD_STALE_999',
        enabled: true,
      });

      const fetchSpyStale = mockKfinBundleFetch([
        { clientId: '88356314970', name: 'STALE META TECHNOLOGIES LIMITED' },
      ]);
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '11111111-1111-4111-8111-111111111151',
        );
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '88356314970',
        });
        expect(
          prismaMock.ipoAllotmentConfig.updateMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ipoId: '11111111-1111-4111-8111-111111111151' },
            data: expect.objectContaining({
              registrarIpoCode: '88356314970',
            }),
          }),
        );
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: '11111111-1111-4111-8111-111111111151',
            }),
            data: expect.objectContaining({
              allotmentResultAvailableAt: expect.any(Date),
            }),
          }),
        );
      } finally {
        fetchSpyStale.mockRestore();
      }

      // Case B: Legacy/stale registrar brand alias (Link Intime -> MUFG_INTIME) with placeholder code 'TBD'
      const mufgStubAdapter = {
        code: 'MUFG_INTIME',
        name: 'MUFG Intime',
        isSupported: () => true,
        checkAllotment: jest.fn(),
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('12345'),
      };
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222251',
        symbol: 'LEGALIAS',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Legacy Alias Industries Limited',
          legalName: 'Legacy Alias Industries Limited',
        },
        allotmentConfig: {
          registrar: 'MUFG_INTIME',
          registrarIpoCode: 'TBD',
          enabled: true,
        },
        sourceIdentities: [],
        participants: [
          {
            role: 'REGISTRAR',
            name: 'Link Intime India Private Limited',
            entityName: 'Link Intime India Private Limited',
          },
        ],
      });
      const legacyResolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: mufgStubAdapter as never,
          registrarIpoCode: '12345',
        });
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '22222222-2222-4222-8222-222222222251',
        );
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '12345',
        });
        expect(
          prismaMock.ipoAllotmentConfig.updateMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ipoId: '22222222-2222-4222-8222-222222222251' },
            data: expect.objectContaining({
              registrarIpoCode: '12345',
            }),
          }),
        );
      } finally {
        legacyResolveSpy.mockRestore();
      }
    });

    it('51b. Finding 2b: accepts clean unpopulated registrar metadata (only EXCHANGE/BRLM) when Step 4 live KFin evidence confirms allotment', async () => {
      // Pre-allotment ALLOTMENT_PENDING with unpopulated registrar metadata (only EXCHANGE/BRLM)
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333351',
        symbol: 'UNPOPMETA',
        status: 'ALLOTMENT_PENDING',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Unpopulated Meta Infra Limited',
          legalName: 'Unpopulated Meta Infra Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [
          {
            externalId: 'UNPOPMETA',
            source: {
              code: 'NSE',
              name: 'National Stock Exchange',
              sourceType: 'EXCHANGE',
            },
          },
        ],
        participants: [
          {
            role: 'BRLM',
            name: 'Axis Capital Limited',
            entityName: 'Axis Capital Limited',
          },
        ],
      });
      const fetchSpyUnpop = mockKfinBundleFetch([
        { clientId: '88356314970', name: 'UNPOPULATED META INFRA LIMITED' },
      ]);
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '33333333-3333-4333-8333-333333333351',
        );
        expect(res).toEqual({
          available: true,
          status: 'ALLOTMENT_COMPLETED',
          registrarCode: '88356314970',
        });
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: '33333333-3333-4333-8333-333333333351',
            }),
            data: expect.objectContaining({
              status: 'ALLOTMENT_COMPLETED',
              allotmentResultAvailableAt: expect.any(Date),
            }),
          }),
        );
      } finally {
        fetchSpyUnpop.mockRestore();
      }
    });

    it('52. Finding 3a: rejects placeholder registrar codes (TBD, N/A, NONE, UNKNOWN, -) in fast path and probe results', async () => {
      const kfinAdapter = moduleAdapterForTest(service);
      const kfinProbeSpy = jest.spyOn(kfinAdapter, 'resolveRegistrarIpoCode');
      const fetchSpyUnrelated = mockKfinBundleFetch([
        { clientId: '99999999999', name: 'UNRELATED ACTIVE CORP LIMITED' },
      ]);

      try {
        // Unconfirmed post-allotment IPO with placeholder codes must never short-circuit to available: true
        for (const placeholder of ['TBD', 'N/A', 'NONE', 'UNKNOWN', '-']) {
          kfinProbeSpy.mockClear();
          prismaMock.ipo.findUnique.mockResolvedValue({
            id: '11111111-1111-4111-8111-111111111152',
            symbol: 'PHFAST',
            status: 'LISTED',
            allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
            listingDate: new Date('2025-01-13T00:00:00.000Z'),
            allotmentResultAvailableAt: null,
            company: {
              displayName: 'Placeholder Fast Corp',
              legalName: 'Placeholder Fast Corp Limited',
            },
            allotmentConfig: {
              registrar: 'KFINTECH',
              registrarIpoCode: placeholder,
              enabled: true,
            },
            sourceIdentities: [],
            participants: [],
          });
          prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
            registrar: 'KFINTECH',
            registrarIpoCode: placeholder,
            enabled: true,
          });

          const res = await service.checkIpoAllotmentAvailability(
            '11111111-1111-4111-8111-111111111152',
          );
          expect(res).toEqual({ available: false, status: 'LISTED' });
          expect(res.registrarCode).toBeUndefined();
          expect(kfinProbeSpy).toHaveBeenCalled();
        }
      } finally {
        kfinProbeSpy.mockRestore();
        fetchSpyUnrelated.mockRestore();
      }

      // Live probe returning a placeholder code must be rejected and never persisted
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333352',
        symbol: 'PRP',
        status: 'ALLOTMENT_PENDING',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Probe Returns Placeholder Ltd',
          legalName: 'Probe Returns Placeholder Limited',
        },
        allotmentConfig: {
          registrar: 'BIGSHARE',
          registrarIpoCode: null,
          enabled: true,
        },
        sourceIdentities: [],
        participants: [],
      });
      const placeholderResolveSpy = jest
        .spyOn(resolver, 'resolveAdapter')
        .mockResolvedValueOnce({
          adapter: {
            code: 'BIGSHARE',
            name: 'Bigshare Services',
            isSupported: () => true,
            checkAllotment: jest.fn(),
            resolveRegistrarIpoCode: jest.fn().mockResolvedValue('N/A'),
          } as never,
          registrarIpoCode: 'N/A',
        });
      const persistPlaceholderSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '33333333-3333-4333-8333-333333333352',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_PENDING',
        });
        expect(persistPlaceholderSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      } finally {
        placeholderResolveSpy.mockRestore();
        persistPlaceholderSpy.mockRestore();
      }
    });

    it('52b. Finding 3a: confirmed fast-path ignores TBD and replaces it live; checkAllotment ignores TBD config code', async () => {
      // Confirmed fast-path with placeholder 'TBD' must NOT return registrarCode: 'TBD'; probes and replaces it
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '22222222-2222-4222-8222-222222222252',
        symbol: 'PHTBDFAST',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: new Date('2025-01-10T10:00:00.000Z'),
        company: {
          displayName: 'Placeholder Fast Replacement Corp',
          legalName: 'Placeholder Fast Replacement Corp Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: 'TBD',
          enabled: true,
        },
        sourceIdentities: [],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
        registrar: 'KFINTECH',
        registrarIpoCode: 'TBD',
        enabled: true,
      });

      const fetchSpyReplaceTbd = mockKfinBundleFetch([
        {
          clientId: '88356314970',
          name: 'PLACEHOLDER FAST REPLACEMENT CORP LIMITED',
        },
      ]);
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '22222222-2222-4222-8222-222222222252',
        );
        expect(fetchSpyReplaceTbd).toHaveBeenCalled();
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '88356314970',
        });
        expect(
          prismaMock.ipoAllotmentConfig.updateMany,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { ipoId: '22222222-2222-4222-8222-222222222252' },
            data: expect.objectContaining({
              registrarIpoCode: '88356314970',
            }),
          }),
        );
      } finally {
        fetchSpyReplaceTbd.mockRestore();
      }
    });

    it('52c. Finding 3a: checkAllotment ignores placeholder TBD config code and resolves real KFin clientId', async () => {
      // checkAllotment ignores placeholder 'TBD' on config and resolves real KFin clientId
      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '44444444-4444-4444-8444-444444444452',
        symbol: 'PHCHK',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: new Date('2025-01-10T10:00:00.000Z'),
        company: {
          displayName: 'Placeholder Check Corp',
          legalName: 'Placeholder Check Corp Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: 'TBD',
          enabled: true,
        },
        sourceIdentities: [],
        participants: [],
      });
      prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
        registrar: 'KFINTECH',
        registrarIpoCode: 'TBD',
        enabled: true,
      });

      const kfinAdapter = moduleAdapterForTest(service);
      const kfinCheckSpy = jest
        .spyOn(kfinAdapter, 'checkAllotment')
        .mockImplementation(async () => ({
          status: AllotmentStatus.NOT_ALLOTTED,
          sourceCode: 'KFINTECH',
          checkedAt: new Date(),
          rawResponse: {},
        }));
      try {
        await service.checkAllotment({
          ipoId: '44444444-4444-4444-8444-444444444452',
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: 'ABCDE1234F',
        });
        expect(kfinCheckSpy).toHaveBeenCalledWith(
          expect.objectContaining({ registrarIpoCode: undefined }),
        );
      } finally {
        kfinCheckSpy.mockRestore();
      }

      // Direct KFin adapter checkAllotment with placeholder 'TBD' triggers resolution to '88356314970'
      const kfinProbeSpy = jest.spyOn(kfinAdapter, 'resolveRegistrarIpoCode');
      const fetchSpyGateway = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.live-test.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.live-test.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.live-test.js')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('${JSON.stringify([{ clientId: '88356314970', name: 'PLACEHOLDER CHECK CORP' }])}');`,
            } as unknown as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ All_Shares: 0, App_Shares: 100 }),
          } as unknown as Response);
        });
      try {
        await kfinAdapter.checkAllotment({
          ipoId: '44444444-4444-4444-8444-444444444452',
          registrarIpoCode: 'TBD',
          companyName: 'Placeholder Check Corp',
          companyLegalName: 'Placeholder Check Corp Limited',
          symbol: 'PHCHK',
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: 'ABCDE1234F',
        });
        expect(kfinProbeSpy).toHaveBeenCalled();
        expect(
          await kfinProbeSpy.mock.results[0].value,
        ).toBe('88356314970');
      } finally {
        kfinProbeSpy.mockRestore();
        fetchSpyGateway.mockRestore();
      }
    });

    it('53. Finding 3b: respects allotmentConfig.enabled === false on confirmed fast path, live probe, and non-KFin fallback', async () => {
      // Confirmed fast path blocked when enabled === false
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-disabled-fast-path',
        symbol: 'DFPC',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: new Date('2025-01-10T10:00:00.000Z'),
        company: {
          displayName: 'Disabled Fast Path Corp',
          legalName: 'Disabled Fast Path Corp Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: '88356314970',
          enabled: false,
        },
        sourceIdentities: [],
        participants: [],
      });
      const resolveSpyDisabled1 = jest.spyOn(resolver, 'resolveAdapter');
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-disabled-fast-path',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(resolveSpyDisabled1).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpyDisabled1.mockRestore();
      }

      // Live probe blocked when enabled === false
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-disabled-probe',
        symbol: 'DPC',
        status: 'ALLOTMENT_PENDING',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Disabled Probe Corp',
          legalName: 'Disabled Probe Corp Limited',
        },
        allotmentConfig: {
          registrar: 'KFINTECH',
          registrarIpoCode: '88356314970',
          enabled: false,
        },
        sourceIdentities: [],
        participants: [],
      });
      const resolveSpyDisabled2 = jest.spyOn(resolver, 'resolveAdapter');
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-disabled-probe',
        );
        expect(res).toEqual({
          available: false,
          status: 'ALLOTMENT_PENDING',
        });
        expect(resolveSpyDisabled2).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpyDisabled2.mockRestore();
      }

      // Non-KFin sourceIdentities fallback blocked when enabled === false
      prismaMock.ipo.findUnique.mockResolvedValueOnce({
        id: 'ipo-disabled-non-kfin',
        symbol: 'DNKC',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Disabled Non KFin Corp',
          legalName: 'Disabled Non KFin Corp Limited',
        },
        allotmentConfig: {
          registrar: 'MUFG_INTIME',
          registrarIpoCode: '12345',
          enabled: false,
        },
        sourceIdentities: [
          {
            externalId: '12345',
            source: {
              code: 'MUFG_INTIME',
              name: 'MUFG Intime India Pvt Ltd',
              sourceType: 'REGISTRAR',
            },
          },
        ],
        participants: [],
      });
      const resolveSpyDisabled3 = jest.spyOn(resolver, 'resolveAdapter');
      try {
        const res = await service.checkIpoAllotmentAvailability(
          'ipo-disabled-non-kfin',
        );
        expect(res).toEqual({ available: false, status: 'LISTED' });
        expect(resolveSpyDisabled3).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      } finally {
        resolveSpyDisabled3.mockRestore();
      }
    });

    it('54a. suppresses RegistrarResolver Step 4 eager persistence on rejected strict probes (conflicting/unknown metadata in post- and pre-allotment paths)', async () => {
      const sourceFindUnique = jest
        .fn()
        .mockResolvedValue({ id: 'src-kfin-step4' });
      const identityUpsert = jest.fn().mockResolvedValue({});
      const configUpsert = jest.fn().mockResolvedValue({});

      (prismaMock as unknown as Record<string, unknown>).source = {
        findUnique: sourceFindUnique,
      };
      prismaMock.ipoSourceIdentity.upsert = identityUpsert;
      (
        prismaMock.ipoAllotmentConfig as unknown as { upsert?: jest.Mock }
      ).upsert = configUpsert;

      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      const resolveSpy = jest.spyOn(resolver, 'resolveAdapter');

      try {
        // Case A: Post-allotment LISTED with UNKNOWN_RTA reaching REAL RegistrarResolver Step 4
        prismaMock.ipo.findUnique.mockResolvedValue({
          id: '55555555-5555-4555-8555-555555555554',
          symbol: 'REJSTEP4',
          status: 'LISTED',
          allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
          listingDate: new Date('2025-01-13T00:00:00.000Z'),
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Rejected Step4 Unknown Corp',
            legalName: 'Rejected Step4 Unknown Corp Limited',
          },
          allotmentConfig: {
            registrar: 'UNKNOWN_RTA',
            registrarIpoCode: null,
            enabled: true,
          },
          sourceIdentities: [],
          participants: [],
        });
        prismaMock.ipoAllotmentConfig.findUnique.mockResolvedValueOnce({
          registrar: 'UNKNOWN_RTA',
          registrarIpoCode: null,
          enabled: true,
        });

        const fetchSpyRejected = mockKfinBundleFetch([
          { clientId: '88356314970', name: 'REJECTED STEP4 UNKNOWN CORP LIMITED' },
        ]);
        try {
          const res = await service.checkIpoAllotmentAvailability(
            '55555555-5555-4555-8555-555555555554',
          );
          expect(res).toEqual({ available: false, status: 'LISTED' });
          expect(resolveSpy).toHaveBeenCalledWith(
            '55555555-5555-4555-8555-555555555554',
            undefined,
            {
              requireLiveActiveList: true,
              skipIdentityPersistence: true,
            },
          );
          expect(persistSpy).not.toHaveBeenCalled();
          expect(sourceFindUnique).not.toHaveBeenCalled();
          expect(identityUpsert).not.toHaveBeenCalled();
          expect(configUpsert).not.toHaveBeenCalled();
          expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
          expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        } finally {
          fetchSpyRejected.mockRestore();
        }

        // Case B: Pre-allotment ALLOTMENT_PENDING with conflicting stored metadata where Step 4 discovers KFINTECH live
        prismaMock.ipo.findUnique.mockResolvedValue({
          id: '77777777-7777-4777-8777-777777777754',
          symbol: 'PRECONSTEP4',
          status: 'ALLOTMENT_PENDING',
          allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
          listingDate: new Date('2025-01-13T00:00:00.000Z'),
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Rejected Step4 Unknown Corp',
            legalName: 'Rejected Step4 Unknown Corp Limited',
          },
          allotmentConfig: null,
          sourceIdentities: [
            {
              externalId: '12345',
              source: {
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India Pvt Ltd',
                sourceType: 'REGISTRAR',
              },
            },
            {
              externalId: '88356314970',
              source: {
                code: 'KFINTECH',
                name: 'KFin Technologies Limited',
                sourceType: 'REGISTRAR',
              },
            },
          ],
          participants: [],
        });

        const fetchSpyPreConflict = mockKfinBundleFetch([
          { clientId: '88356314970', name: 'REJECTED STEP4 UNKNOWN CORP LIMITED' },
        ]);
        try {
          const res = await service.checkIpoAllotmentAvailability(
            '77777777-7777-4777-8777-777777777754',
          );
          expect(res).toEqual({
            available: false,
            status: 'ALLOTMENT_PENDING',
          });
          expect(resolveSpy).toHaveBeenCalledWith(
            '77777777-7777-4777-8777-777777777754',
            undefined,
            {
              requireLiveActiveList: true,
              skipIdentityPersistence: true,
            },
          );
          expect(persistSpy).not.toHaveBeenCalled();
          expect(sourceFindUnique).not.toHaveBeenCalled();
          expect(identityUpsert).not.toHaveBeenCalled();
          expect(configUpsert).not.toHaveBeenCalled();
          expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
          expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        } finally {
          fetchSpyPreConflict.mockRestore();
        }
      } finally {
        persistSpy.mockRestore();
        resolveSpy.mockRestore();
        delete (prismaMock as unknown as Record<string, unknown>).source;
        delete (
          prismaMock.ipoAllotmentConfig as unknown as { upsert?: jest.Mock }
        ).upsert;
      }
    });

    it('54b. persists discovered registrar identity and registrarIpoCode on unpopulated metadata only AFTER strict live confirmation and reconciliation', async () => {
      const events: string[] = [];
      const sourceFindUnique = jest
        .fn()
        .mockResolvedValue({ id: 'src-kfin-step4' });
      const identityUpsert = jest.fn().mockImplementation(async () => {
        events.push('db:ipoSourceIdentity.upsert');
        return {};
      });
      const configUpsert = jest.fn().mockImplementation(async () => {
        events.push('db:ipoAllotmentConfig.upsert');
        return {};
      });

      (prismaMock as unknown as Record<string, unknown>).source = {
        findUnique: sourceFindUnique,
      };
      prismaMock.ipoSourceIdentity.upsert = identityUpsert;
      (
        prismaMock.ipoAllotmentConfig as unknown as { upsert?: jest.Mock }
      ).upsert = configUpsert;

      const persistSpy = jest.spyOn(
        resolver,
        'persistDiscoveredRegistrarIdentity',
      );
      const kfinAdapter = moduleAdapterForTest(service);
      const origResolveCode =
        kfinAdapter.resolveRegistrarIpoCode.bind(kfinAdapter);
      const kfinResolveSpy = jest
        .spyOn(kfinAdapter, 'resolveRegistrarIpoCode')
        .mockImplementation(async (req) => {
          events.push('adapter:resolveRegistrarIpoCode:start');
          const out = await origResolveCode(req);
          events.push('adapter:resolveRegistrarIpoCode:end');
          return out;
        });
      const proto = Object.getPrototypeOf(service) as {
        reconcileStoredRegistrarMetadata: (
          m: unknown,
          c?: string,
        ) => string | undefined;
      };
      const reconcileSpy = jest
        .spyOn(
          service as unknown as {
            reconcileStoredRegistrarMetadata: (
              m: unknown,
              c?: string,
            ) => string | undefined;
          },
          'reconcileStoredRegistrarMetadata',
        )
        .mockImplementationOnce((meta: unknown, code?: string) => {
          events.push('service:reconcileStoredRegistrarMetadata');
          return proto.reconcileStoredRegistrarMetadata.call(
            service,
            meta,
            code,
          );
        });

      prismaMock.ipo.findUnique.mockResolvedValue({
        id: '66666666-6666-4666-8666-666666666654',
        symbol: 'ACCSTEP4',
        status: 'LISTED',
        allotmentDate: new Date('2025-01-10T00:00:00.000Z'),
        listingDate: new Date('2025-01-13T00:00:00.000Z'),
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Accepted Step4 Unpopulated Ltd',
          legalName: 'Accepted Step4 Unpopulated Limited',
        },
        allotmentConfig: null,
        sourceIdentities: [],
        participants: [],
      });

      const fetchSpyAccepted = mockKfinBundleFetch([
        {
          clientId: '94818267561',
          name: 'ACCEPTED STEP4 UNPOPULATED LIMITED',
        },
      ]);
      try {
        const res = await service.checkIpoAllotmentAvailability(
          '66666666-6666-4666-8666-666666666654',
        );
        expect(res).toEqual({
          available: true,
          status: 'LISTED',
          registrarCode: '94818267561',
        });
        // Persist must run exactly once and strictly AFTER reconciliation
        expect(persistSpy).toHaveBeenCalledTimes(1);
        expect(persistSpy).toHaveBeenCalledWith(
          '66666666-6666-4666-8666-666666666654',
          'KFINTECH',
          '94818267561',
        );
        expect(identityUpsert).toHaveBeenCalledTimes(1);
        expect(configUpsert).toHaveBeenCalledTimes(1);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledTimes(1);

        const reconcileIdx = events.indexOf(
          'service:reconcileStoredRegistrarMetadata',
        );
        const firstUpsertIdx = events.indexOf('db:ipoSourceIdentity.upsert');
        expect(reconcileIdx).toBeGreaterThan(-1);
        expect(firstUpsertIdx).toBeGreaterThan(reconcileIdx);
      } finally {
        persistSpy.mockRestore();
        kfinResolveSpy.mockRestore();
        reconcileSpy.mockRestore();
        fetchSpyAccepted.mockRestore();
        delete (prismaMock as unknown as Record<string, unknown>).source;
        delete (
          prismaMock.ipoAllotmentConfig as unknown as { upsert?: jest.Mock }
        ).upsert;
      }
    });
  });
});

function moduleAdapterForTest(
  service: AllotmentService,
): KfinRegistrarAdapter {
  return (service as unknown as { kfinAdapter: KfinRegistrarAdapter })
    .kfinAdapter;
}
