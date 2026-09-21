import { Test, TestingModule } from '@nestjs/testing';
import { IpoController } from '../ipos/ipo.controller';
import { IpoService } from '../ipos/ipo.service';
import { IpoRepository } from '../ipos/ipo.repository';
import { PrismaService } from '../../database/prisma.service';

describe('Public IPO API Hardening & Publication Filtering', () => {
  let ipoController: IpoController;
  let ipoRepository: IpoRepository;

  const mockPrisma = {
    ipo: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpoController],
      providers: [
        IpoRepository,
        {
          provide: IpoService,
          useValue: {
            list: jest.fn((query) => ipoRepository.findMany(query, 0)),
          },
        },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    ipoController = module.get<IpoController>(IpoController);
    ipoRepository = module.get<IpoRepository>(IpoRepository);
    jest.clearAllMocks();
  });

  it('GET /ipos/new-ipos enforces publicationStatus = PUBLISHED and status IN (UPCOMING, OPEN)', async () => {
    mockPrisma.ipo.findMany.mockResolvedValue([
      {
        id: 'published-open-ipo',
        companyId: 'comp-1',
        publicationStatus: 'PUBLISHED',
        status: 'OPEN',
        company: { legalName: 'Veegaland Developers' },
        lifecycleEvents: [],
      },
    ]);

    await ipoController.newIpos({ page: 1, limit: 10 });

    expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicationStatus: 'PUBLISHED',
          status: { in: ['UPCOMING', 'OPEN', 'CLOSING_TODAY'] },
        }),
      }),
    );
  });

  it('Default public query excludes DRAFT records', async () => {
    mockPrisma.ipo.findMany.mockResolvedValue([]);

    await ipoController.list({ page: 1, limit: 10 });

    expect(mockPrisma.ipo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publicationStatus: 'PUBLISHED',
        }),
      }),
    );
  });
});
