import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { BrokerConnectionStatus, BrokerType } from '@prisma/client';
import { BrokerAccountService } from './broker-account.service';
import { PrismaService } from '../../database/prisma.service';

describe('BrokerAccountService', () => {
  let service: BrokerAccountService;
  let mockPrisma: any;

  const mockDate = new Date('2026-09-21T12:00:00Z');

  const sampleAccount = {
    id: 'acc-uuid-1',
    userId: 'user-123',
    profileId: 'profile-abc',
    broker: BrokerType.UPSTOX,
    accountName: 'My Upstox',
    clientId: 'UP12345',
    isActive: true,
    createdAt: mockDate,
    updatedAt: mockDate,
    connection: {
      id: 'conn-uuid-1',
      status: BrokerConnectionStatus.PENDING,
      connectedAt: null,
      lastSyncAt: null,
      lastErrorAt: null,
      lastError: null,
      createdAt: mockDate,
      updatedAt: mockDate,
    },
  };

  beforeEach(() => {
    mockPrisma = {
      brokerAccount: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      brokerConnection: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    service = new BrokerAccountService(mockPrisma as unknown as PrismaService);
  });

  describe('createAccount', () => {
    it('successfully creates a BrokerAccount with an initial PENDING BrokerConnection in transaction', async () => {
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(null);
      mockPrisma.brokerAccount.create.mockResolvedValue(sampleAccount);

      const result = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-abc',
        broker: BrokerType.UPSTOX,
        accountName: 'My Upstox',
        clientId: 'UP12345',
      });

      expect(result).toEqual(sampleAccount);
      expect(mockPrisma.brokerAccount.findUnique).toHaveBeenCalledWith({
        where: {
          userId_profileId_broker: {
            userId: 'user-123',
            profileId: 'profile-abc',
            broker: BrokerType.UPSTOX,
          },
        },
      });
      expect(mockPrisma.brokerAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-123',
            profileId: 'profile-abc',
            broker: BrokerType.UPSTOX,
            isActive: true,
            connection: {
              create: {
                status: BrokerConnectionStatus.PENDING,
              },
            },
          }),
        }),
      );
    });

    it('rejects duplicate broker account creation with ConflictException', async () => {
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(sampleAccount);

      await expect(
        service.createAccount({
          userId: 'user-123',
          profileId: 'profile-abc',
          broker: BrokerType.UPSTOX,
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrisma.brokerAccount.create).not.toHaveBeenCalled();
    });

    it('validates required fields', async () => {
      await expect(
        service.createAccount({
          userId: '',
          profileId: 'profile-abc',
          broker: BrokerType.UPSTOX,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createAccount({
          userId: 'user-123',
          profileId: '',
          broker: BrokerType.UPSTOX,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createAccount({
          userId: 'user-123',
          profileId: 'profile-abc',
          broker: 'INVALID_BROKER' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAccounts', () => {
    it('returns only accounts belonging to the authenticated userId', async () => {
      mockPrisma.brokerAccount.findMany.mockResolvedValue([sampleAccount]);

      const result = await service.getAccounts('user-123');

      expect(result).toEqual([sampleAccount]);
      expect(mockPrisma.brokerAccount.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('rejects empty userId', async () => {
      await expect(service.getAccounts('')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAccount', () => {
    it('returns single account when accountId and userId match', async () => {
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(sampleAccount);

      const result = await service.getAccount('user-123', 'acc-uuid-1');

      expect(result).toEqual(sampleAccount);
      expect(mockPrisma.brokerAccount.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'acc-uuid-1',
          userId: 'user-123',
        },
        include: expect.any(Object),
      });
    });

    it('throws NotFoundException when account belongs to another user', async () => {
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.getAccount('other-user-999', 'acc-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getProfileAccounts', () => {
    it('enforces both userId and profileId in query', async () => {
      mockPrisma.brokerAccount.findMany.mockResolvedValue([sampleAccount]);

      const result = await service.getProfileAccounts('user-123', 'profile-abc');

      expect(result).toEqual([sampleAccount]);
      expect(mockPrisma.brokerAccount.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          profileId: 'profile-abc',
        },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('rejects missing profileId or userId', async () => {
      await expect(service.getProfileAccounts('user-123', '')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.getProfileAccounts('', 'profile-abc')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deactivate', () => {
    it('soft-deactivates BrokerAccount and sets connection to DISCONNECTED without deleting historical data', async () => {
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(sampleAccount);
      const deactivatedAccount = {
        ...sampleAccount,
        isActive: false,
        connection: {
          ...sampleAccount.connection,
          status: BrokerConnectionStatus.DISCONNECTED,
        },
      };

      mockPrisma.brokerAccount.update.mockResolvedValue(deactivatedAccount);
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(deactivatedAccount);

      const result = await service.deactivate('user-123', 'acc-uuid-1');

      expect(result.isActive).toBe(false);
      expect((result as any).connection?.status).toBe(BrokerConnectionStatus.DISCONNECTED);

      // Verify soft update
      expect(mockPrisma.brokerAccount.update).toHaveBeenCalledWith({
        where: { id: 'acc-uuid-1' },
        data: { isActive: false },
      });
      expect(mockPrisma.brokerConnection.updateMany).toHaveBeenCalledWith({
        where: { brokerAccountId: 'acc-uuid-1' },
        data: { status: BrokerConnectionStatus.DISCONNECTED },
      });

      // Confirm NO delete methods were invoked
      expect(mockPrisma.brokerAccount.delete).not.toHaveBeenCalled();
      expect(mockPrisma.brokerAccount.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.brokerConnection.delete).not.toHaveBeenCalled();
      expect(mockPrisma.brokerConnection.deleteMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when attempting to deactivate an account owned by another user', async () => {
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(null);

      await expect(
        service.deactivate('other-user-999', 'acc-uuid-1'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.brokerAccount.update).not.toHaveBeenCalled();
    });
  });
});
