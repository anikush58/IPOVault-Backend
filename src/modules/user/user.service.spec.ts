import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../../database/prisma.service';

describe('UserService', () => {
  let service: UserService;
  let prismaMock: {
    userSavedPan: {
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prismaMock = {
      userSavedPan: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should create new UserSavedPan if not existing', async () => {
    prismaMock.userSavedPan.findFirst.mockResolvedValue(null);
    prismaMock.userSavedPan.create.mockResolvedValue({
      id: 'pan-1',
      panMasked: 'ABCDE****F',
    });

    const res = await service.syncPans('user-1', {
      pans: [{ pan: 'ABCDE1234F', name: 'Test User' }],
    });

    expect(res.syncedCount).toBe(1);
    expect(res.pans[0].maskedPan).toBe('ABCDE****F');
    expect(prismaMock.userSavedPan.create).toHaveBeenCalled();
  });

  it('should update existing UserSavedPan if found', async () => {
    prismaMock.userSavedPan.findFirst.mockResolvedValue({
      id: 'existing-1',
      name: 'Old Name',
    });
    prismaMock.userSavedPan.update.mockResolvedValue({
      id: 'existing-1',
      panMasked: 'ABCDE****F',
    });

    const res = await service.syncPans('user-1', {
      pans: [{ pan: 'ABCDE1234F', name: 'Updated Name' }],
    });

    expect(res.syncedCount).toBe(1);
    expect(prismaMock.userSavedPan.update).toHaveBeenCalled();
  });
});
