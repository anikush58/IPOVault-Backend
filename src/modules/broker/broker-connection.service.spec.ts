import { NotFoundException } from '@nestjs/common';
import { BrokerConnectionStatus } from '@prisma/client';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerAccountService } from './broker-account.service';
import { PrismaService } from '../../database/prisma.service';

describe('BrokerConnectionService', () => {
  let service: BrokerConnectionService;
  let mockPrisma: any;
  let mockAccountService: any;

  const mockDate = new Date('2026-09-21T12:00:00Z');

  const sampleConnection = {
    id: 'conn-uuid-1',
    brokerAccountId: 'acc-uuid-1',
    status: BrokerConnectionStatus.PENDING,
    connectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: mockDate,
    updatedAt: mockDate,
  };

  beforeEach(() => {
    mockPrisma = {
      brokerConnection: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    mockAccountService = {
      verifyOwnership: jest.fn(),
    };

    service = new BrokerConnectionService(
      mockPrisma as unknown as PrismaService,
      mockAccountService as unknown as BrokerAccountService,
    );
  });

  describe('getConnection', () => {
    it('returns connection metadata without exposing tokens or secrets', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue(sampleConnection);

      const result = await service.getConnection('user-123', 'acc-uuid-1');

      expect(result).toEqual(sampleConnection);
      expect(mockAccountService.verifyOwnership).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result).not.toHaveProperty('refreshTokenEncrypted');
      expect(result).not.toHaveProperty('token');
    });

    it('rejects when user does not own the broker account', async () => {
      mockAccountService.verifyOwnership.mockRejectedValue(
        new NotFoundException('Broker account not found'),
      );

      await expect(
        service.getConnection('other-user', 'acc-uuid-1'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.brokerConnection.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when connection record is missing', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue(null);

      await expect(
        service.getConnection('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markPending', () => {
    it('sets status to PENDING and clears errors after ownership check', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      const pendingConn = {
        ...sampleConnection,
        status: BrokerConnectionStatus.PENDING,
        lastError: null,
        lastErrorAt: null,
      };
      mockPrisma.brokerConnection.update.mockResolvedValue(pendingConn);

      const result = await service.markPending('user-123', 'acc-uuid-1');

      expect(result.status).toBe(BrokerConnectionStatus.PENDING);
      expect(mockPrisma.brokerConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brokerAccountId: 'acc-uuid-1' },
          data: {
            status: BrokerConnectionStatus.PENDING,
            lastError: null,
            lastErrorAt: null,
          },
        }),
      );
    });
  });

  describe('markConnected', () => {
    it('sets status to CONNECTED, records connectedAt timestamp, and clears error state', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      const connectedConn = {
        ...sampleConnection,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      };
      mockPrisma.brokerConnection.update.mockResolvedValue(connectedConn);

      const result = await service.markConnected('user-123', 'acc-uuid-1');

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
      expect(mockPrisma.brokerConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brokerAccountId: 'acc-uuid-1' },
          data: expect.objectContaining({
            status: BrokerConnectionStatus.CONNECTED,
            lastError: null,
            lastErrorAt: null,
          }),
        }),
      );
    });
  });

  describe('markExpired', () => {
    it('sets status to EXPIRED and stores a safe error message without secrets', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      const expiredConn = {
        ...sampleConnection,
        status: BrokerConnectionStatus.EXPIRED,
        lastError: 'Session expired by broker',
        lastErrorAt: new Date(),
      };
      mockPrisma.brokerConnection.update.mockResolvedValue(expiredConn);

      const result = await service.markExpired(
        'user-123',
        'acc-uuid-1',
        'Session expired by broker',
      );

      expect(result.status).toBe(BrokerConnectionStatus.EXPIRED);
      expect(mockPrisma.brokerConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brokerAccountId: 'acc-uuid-1' },
          data: expect.objectContaining({
            status: BrokerConnectionStatus.EXPIRED,
            lastError: 'Session expired by broker',
          }),
        }),
      );
    });
  });
});
