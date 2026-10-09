import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/errors/app.exception';

describe('UserService', () => {
  let service: UserService;
  let prismaMock: {
    userSavedPan: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeAll(() => {
    process.env.ALLOTMENT_ENCRYPTION_SECRET =
      'test_encryption_secret_key_32_bytes!';
    process.env.ALLOTMENT_HASH_SECRET = 'test_hash_secret_16_bytes!';
  });

  beforeEach(async () => {
    prismaMock = {
      userSavedPan: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
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

  describe('syncPans', () => {
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

  describe('deletePan (Data Minimization)', () => {
    it('should successfully delete a single PAN owned by authenticated user', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue({
        id: 'pan-123',
        userId: 'user-1',
      });
      prismaMock.userSavedPan.delete.mockResolvedValue({
        id: 'pan-123',
      });

      const res = await service.deletePan('user-1', 'pan-123');

      expect(res.success).toBe(true);
      expect(res.id).toBe('pan-123');
      expect(res.deleted).toBe(true);
      expect(prismaMock.userSavedPan.delete).toHaveBeenCalledWith({
        where: { id: 'pan-123' },
      });
    });

    it('should reject with 404 if User A attempts to delete User B PAN', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue({
        id: 'pan-user-b',
        userId: 'user-b',
      });

      await expect(
        service.deletePan('user-a', 'pan-user-b'),
      ).rejects.toThrow(AppException);

      expect(prismaMock.userSavedPan.delete).not.toHaveBeenCalled();
    });

    it('should reject with 404 if PAN record does not exist', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue(null);

      await expect(
        service.deletePan('user-a', 'non-existent'),
      ).rejects.toThrow(AppException);
    });
  });

  describe('deleteAllPans (Data Minimization)', () => {
    it('should delete all PANs strictly scoped to authenticated user', async () => {
      prismaMock.userSavedPan.deleteMany.mockResolvedValue({
        count: 5,
      });

      const res = await service.deleteAllPans('user-1');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(5);
      expect(prismaMock.userSavedPan.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });
});
