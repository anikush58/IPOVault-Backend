import { Test, TestingModule } from '@nestjs/testing';
import { SourceType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  BSE_SME_SOURCE_CODE,
  BSE_SOURCE_CODE,
  NSE_EMERGE_SOURCE_CODE,
  NSE_SOURCE_CODE,
  SEBI_SOURCE_CODE,
} from './adapters/source-adapter';
import { SourceRegistryService } from './source-registry.service';

describe('SourceRegistryService', () => {
  let service: SourceRegistryService;
  let mockPrisma: {
    source: {
      upsert: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrisma = {
      source: {
        upsert: jest.fn().mockImplementation(({ where, create }) => {
          return Promise.resolve({
            id: `src-${where.code}`,
            code: where.code,
            name: create.name,
            sourceType: create.sourceType,
            baseUrl: create.baseUrl,
            priority: create.priority,
            enabled: create.enabled,
          });
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SourceRegistryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<SourceRegistryService>(SourceRegistryService);
  });

  it('ensures BSE_SME source exists with EXCHANGE sourceType and priority 2', async () => {
    const source = await service.ensureSource(BSE_SME_SOURCE_CODE);

    expect(source.code).toBe(BSE_SME_SOURCE_CODE);
    expect(source.sourceType).toBe(SourceType.EXCHANGE);
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'bse_sme' },
        create: expect.objectContaining({
          code: 'bse_sme',
          name: 'BSE SME Platform',
          sourceType: SourceType.EXCHANGE,
        }),
      }),
    );
  });

  it('ensures NSE_EMERGE source exists with EXCHANGE sourceType', async () => {
    const source = await service.ensureSource(NSE_EMERGE_SOURCE_CODE);

    expect(source.code).toBe(NSE_EMERGE_SOURCE_CODE);
    expect(source.sourceType).toBe(SourceType.EXCHANGE);
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'nse_emerge' },
      }),
    );
  });

  it('ensures all known statutory and exchange discovery sources safely without duplication', async () => {
    const sources = await service.ensureAllDiscoverySources();

    expect(sources.length).toBe(5);
    const codes = sources.map((s) => s.code);
    expect(codes).toContain(BSE_SME_SOURCE_CODE);
    expect(codes).toContain(BSE_SOURCE_CODE);
    expect(codes).toContain(NSE_EMERGE_SOURCE_CODE);
    expect(codes).toContain(NSE_SOURCE_CODE);
    expect(codes).toContain(SEBI_SOURCE_CODE);
    expect(mockPrisma.source.upsert).toHaveBeenCalledTimes(5);
  });
});
