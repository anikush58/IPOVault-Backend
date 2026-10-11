import { BadRequestException, NotFoundException } from '@nestjs/common';
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
        findUniqueOrThrow: jest.fn(),
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
      $executeRaw: jest.fn().mockResolvedValue(1),
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
        include: expect.anything(),
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

    it('re-uses existing broker account idempotently when already created', async () => {
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(sampleAccount);

      const result = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-abc',
        broker: BrokerType.UPSTOX,
      });

      expect(result).toEqual(sampleAccount);
      expect(mockPrisma.brokerAccount.create).not.toHaveBeenCalled();
    });

    it('updates existing broker account details when metadata changes on repeat connect', async () => {
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(sampleAccount);
      const updatedAccount = { ...sampleAccount, accountName: 'Updated Name' };
      mockPrisma.brokerAccount.update.mockResolvedValue(updatedAccount);

      const result = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-abc',
        broker: BrokerType.UPSTOX,
        accountName: 'Updated Name',
      });

      expect(result).toEqual(updatedAccount);
      expect(mockPrisma.brokerAccount.update).toHaveBeenCalledWith({
        where: { id: sampleAccount.id },
        data: {
          accountName: 'Updated Name',
          clientId: sampleAccount.clientId,
          isActive: true,
        },
        include: expect.anything(),
      });
      expect(mockPrisma.brokerAccount.create).not.toHaveBeenCalled();
    });

    it('handles concurrent create race condition (P2002) idempotently without throwing', async () => {
      mockPrisma.brokerAccount.findUnique.mockResolvedValueOnce(null);
      const p2002Error = new Error('Unique constraint failed on the fields: (`user_id`,`profile_id`,`broker`)');
      (p2002Error as any).code = 'P2002';
      mockPrisma.brokerAccount.create.mockRejectedValueOnce(p2002Error);
      mockPrisma.brokerAccount.findUniqueOrThrow.mockResolvedValueOnce(sampleAccount);

      const result = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-abc',
        broker: BrokerType.UPSTOX,
        accountName: 'My Upstox',
        clientId: 'UP12345',
      });

      expect(result).toEqual(sampleAccount);
      expect(mockPrisma.brokerAccount.findUniqueOrThrow).toHaveBeenCalledWith({
        where: {
          userId_profileId_broker: {
            userId: 'user-123',
            profileId: 'profile-abc',
            broker: BrokerType.UPSTOX,
          },
        },
        include: expect.anything(),
      });
    });

    it('re-links existing broker account when clientId matches for the same user and broker across profile changes', async () => {
      // Not found by (userId, profile-new, broker)
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(null);
      // But found by (userId, broker, clientId) under profile-old
      const existingOldProfile = {
        ...sampleAccount,
        profileId: 'profile-old',
        accountName: 'Old Name',
      };
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(existingOldProfile);
      const reLinkedAccount = {
        ...sampleAccount,
        profileId: 'profile-new',
        accountName: 'New Name',
      };
      mockPrisma.brokerAccount.update.mockResolvedValue(reLinkedAccount);

      const result = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-new',
        broker: BrokerType.UPSTOX,
        accountName: 'New Name',
        clientId: 'UP12345',
      });

      expect(result).toEqual(reLinkedAccount);
      expect(mockPrisma.brokerAccount.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          broker: BrokerType.UPSTOX,
          clientId: 'UP12345',
        },
        include: expect.anything(),
      });
      expect(mockPrisma.brokerAccount.update).toHaveBeenCalledWith({
        where: { id: sampleAccount.id },
        data: {
          profileId: 'profile-new',
          accountName: 'New Name',
          clientId: 'UP12345',
          isActive: true,
        },
        include: expect.anything(),
      });
      expect(mockPrisma.brokerAccount.create).not.toHaveBeenCalled();
    });

    it('preserves genuinely separate accounts at the same broker with distinct client IDs or profiles', async () => {
      // Alice creates Dhan account with client ID ALICE1
      mockPrisma.brokerAccount.findUnique.mockResolvedValue(null);
      mockPrisma.brokerAccount.findFirst.mockResolvedValue(null);
      const aliceAccount = {
        ...sampleAccount,
        id: 'acc-alice',
        profileId: 'profile-alice',
        clientId: 'ALICE1',
        broker: BrokerType.DHAN,
      };
      mockPrisma.brokerAccount.create.mockResolvedValueOnce(aliceAccount);

      const resAlice = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-alice',
        broker: BrokerType.DHAN,
        clientId: 'ALICE1',
      });
      expect(resAlice.id).toBe('acc-alice');

      // Bob creates distinct Dhan account with client ID BOB2
      const bobAccount = {
        ...sampleAccount,
        id: 'acc-bob',
        profileId: 'profile-bob',
        clientId: 'BOB2',
        broker: BrokerType.DHAN,
      };
      mockPrisma.brokerAccount.create.mockResolvedValueOnce(bobAccount);

      const resBob = await service.createAccount({
        userId: 'user-123',
        profileId: 'profile-bob',
        broker: BrokerType.DHAN,
        clientId: 'BOB2',
      });
      expect(resBob.id).toBe('acc-bob');
      expect(mockPrisma.brokerAccount.create).toHaveBeenCalledTimes(2);
    });

    it('serializes concurrent requests with different profile IDs but same broker client ID, preventing duplicate accounts', async () => {
      // Shared in-memory account representation across simulated concurrent transactions
      let storedAccount: any = null;
      let lockHeld = false;
      const waiters: Array<() => void> = [];

      // Simulate PostgreSQL transaction-level advisory lock serialization
      mockPrisma.$executeRaw = jest.fn().mockImplementation(async () => {
        if (lockHeld) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        lockHeld = true;
        return 1;
      });

      mockPrisma.$transaction = jest.fn().mockImplementation(async (callback) => {
        try {
          return await callback(mockPrisma);
        } finally {
          lockHeld = false;
          const next = waiters.shift();
          if (next) {
            lockHeld = true;
            next();
          }
        }
      });

      // findUnique checks if record exists by (userId, profileId, broker)
      mockPrisma.brokerAccount.findUnique = jest.fn().mockImplementation(async ({ where }) => {
        if (
          storedAccount &&
          storedAccount.userId === where.userId_profileId_broker.userId &&
          storedAccount.profileId === where.userId_profileId_broker.profileId &&
          storedAccount.broker === where.userId_profileId_broker.broker
        ) {
          return storedAccount;
        }
        return null;
      });

      // findFirst checks if record exists by (userId, broker, clientId)
      mockPrisma.brokerAccount.findFirst = jest.fn().mockImplementation(async ({ where }) => {
        if (
          storedAccount &&
          storedAccount.userId === where.userId &&
          storedAccount.broker === where.broker &&
          storedAccount.clientId === where.clientId
        ) {
          return storedAccount;
        }
        return null;
      });

      // create creates a new account in simulated storage
      mockPrisma.brokerAccount.create = jest.fn().mockImplementation(async ({ data }) => {
        storedAccount = {
          id: 'acc-race-winner',
          userId: data.userId,
          profileId: data.profileId,
          broker: data.broker,
          accountName: data.accountName,
          clientId: data.clientId,
          isActive: true,
          connection: {
            id: 'conn-race-winner',
            status: BrokerConnectionStatus.PENDING,
          },
        };
        return storedAccount;
      });

      // update modifies the existing account in simulated storage (e.g. re-linking profileId)
      mockPrisma.brokerAccount.update = jest.fn().mockImplementation(async ({ where, data }) => {
        if (storedAccount && storedAccount.id === where.id) {
          storedAccount = {
            ...storedAccount,
            ...data,
          };
          return storedAccount;
        }
        throw new Error('Record not found');
      });

      // Simulate concurrent requests arriving at the same time:
      // Same userId, same broker, same clientId ('SHARED-CLIENT-99'), but DIFFERENT profileIds
      const [res1, res2] = await Promise.all([
        service.createAccount({
          userId: 'user-123',
          profileId: 'profile-alpha',
          broker: BrokerType.UPSTOX,
          clientId: 'SHARED-CLIENT-99',
          accountName: 'Alpha Upstox',
        }),
        service.createAccount({
          userId: 'user-123',
          profileId: 'profile-beta',
          broker: BrokerType.UPSTOX,
          clientId: 'SHARED-CLIENT-99',
          accountName: 'Beta Upstox',
        }),
      ]);

      // Verify that create was invoked only once across both concurrent requests
      expect(mockPrisma.brokerAccount.create).toHaveBeenCalledTimes(1);

      // Verify advisory locking was executed for both transactions to guarantee serialization
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2);

      // Verify both requests resolved to the same logical account ID
      expect(res1.id).toBe('acc-race-winner');
      expect(res2.id).toBe('acc-race-winner');

      // Verify only one logical account exists in the database
      expect(storedAccount.id).toBe('acc-race-winner');
      expect(storedAccount.clientId).toBe('SHARED-CLIENT-99');
    });

    it('validates broker credentials before creating account and does not create dangling records when unconfigured', async () => {
      const mockAdapter = {
        validateConfiguration: jest.fn().mockImplementation(() => {
          throw new BadRequestException('Upstox API key / client_id is not configured');
        }),
      };
      const mockRegistry = {
        getAdapter: jest.fn().mockReturnValue(mockAdapter),
      };
      const serviceWithRegistry = new BrokerAccountService(
        mockPrisma as unknown as PrismaService,
        mockRegistry as any,
      );

      mockPrisma.brokerAccount.findUnique.mockResolvedValue(null);

      await expect(
        serviceWithRegistry.createAccount({
          userId: 'user-123',
          profileId: 'profile-abc',
          broker: BrokerType.UPSTOX,
        }),
      ).rejects.toThrow('Upstox API key / client_id is not configured');

      expect(mockPrisma.brokerAccount.create).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
