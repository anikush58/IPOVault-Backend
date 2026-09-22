import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BrokerConnectionStatus } from '@prisma/client';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerCryptoService } from './security/broker-crypto.service';
import { PrismaService } from '../../database/prisma.service';

describe('BrokerConnectionService', () => {
  let service: BrokerConnectionService;
  let mockPrisma: any;
  let mockAccountService: any;
  let mockCryptoService: any;

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
      brokerToken: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    mockAccountService = {
      verifyOwnership: jest.fn(),
    };

    mockCryptoService = {
      encrypt: jest.fn((val: string) => `enc_${val}`),
      decrypt: jest.fn((val: string) => val.replace('enc_', '')),
    };

    service = new BrokerConnectionService(
      mockPrisma as unknown as PrismaService,
      mockAccountService as unknown as BrokerAccountService,
      mockCryptoService as unknown as BrokerCryptoService,
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

  describe('saveTokens', () => {
    it('encrypts tokens and upserts BrokerToken while updating connection to CONNECTED', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue({ id: 'conn-uuid-1' });

      const connectedConn = {
        ...sampleConnection,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      };
      mockPrisma.brokerConnection.update.mockResolvedValue(connectedConn);

      const tokens = {
        accessToken: 'plain-access-token',
        refreshToken: 'plain-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['holdings', 'orders'],
      };

      const result = await service.saveTokens('user-123', 'acc-uuid-1', tokens);

      expect(mockAccountService.verifyOwnership).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockCryptoService.encrypt).toHaveBeenCalledWith('plain-access-token');
      expect(mockCryptoService.encrypt).toHaveBeenCalledWith('plain-refresh-token');
      expect(mockPrisma.brokerToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { connectionId: 'conn-uuid-1' },
          create: expect.objectContaining({
            connectionId: 'conn-uuid-1',
            accessTokenEncrypted: 'enc_plain-access-token',
            refreshTokenEncrypted: 'enc_plain-refresh-token',
            tokenType: 'Bearer',
          }),
          update: expect.objectContaining({
            accessTokenEncrypted: 'enc_plain-access-token',
            refreshTokenEncrypted: 'enc_plain-refresh-token',
            tokenType: 'Bearer',
          }),
        }),
      );
      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result).not.toHaveProperty('refreshTokenEncrypted');
      expect(result).not.toHaveProperty('token');
    });

    it('rejects when account ownership verification fails', async () => {
      mockAccountService.verifyOwnership.mockRejectedValue(
        new NotFoundException('Broker account not found'),
      );

      await expect(
        service.saveTokens('unauth-user', 'acc-uuid-1', {
          accessToken: 'test-token',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.brokerToken.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when broker connection does not exist', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue(null);

      await expect(
        service.saveTokens('user-123', 'acc-uuid-1', {
          accessToken: 'test-token',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.brokerToken.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getDecryptedTokens', () => {
    it('retrieves and decrypts tokens in memory for an active connected connection', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.CONNECTED,
        token: {
          accessTokenEncrypted: 'enc_upstox-access-secret',
          refreshTokenEncrypted: 'enc_upstox-refresh-secret',
          tokenType: 'Bearer',
          expiresAt: null,
          scopes: ['holdings', 'orders'],
        },
      });

      const tokens = await service.getDecryptedTokens('user-123', 'acc-uuid-1');

      expect(mockAccountService.verifyOwnership).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockCryptoService.decrypt).toHaveBeenCalledWith('enc_upstox-access-secret');
      expect(mockCryptoService.decrypt).toHaveBeenCalledWith('enc_upstox-refresh-secret');
      expect(tokens).toEqual({
        accessToken: 'upstox-access-secret',
        refreshToken: 'upstox-refresh-secret',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['holdings', 'orders'],
      });
    });

    it('throws NotFoundException if connection is not found', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue(null);

      await expect(
        service.getDecryptedTokens('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if connection status is not CONNECTED (e.g. PENDING or DISCONNECTED)', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.PENDING,
        token: {
          accessTokenEncrypted: 'enc_token',
        },
      });

      await expect(
        service.getDecryptedTokens('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if access token is missing', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      mockPrisma.brokerConnection.findUnique.mockResolvedValue({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.CONNECTED,
        token: null,
      });

      await expect(
        service.getDecryptedTokens('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks connection EXPIRED and throws BadRequestException if token has expired', async () => {
      mockAccountService.verifyOwnership.mockResolvedValue({ id: 'acc-uuid-1' });
      const pastDate = new Date(Date.now() - 3600 * 1000);
      mockPrisma.brokerConnection.findUnique.mockResolvedValue({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.CONNECTED,
        token: {
          accessTokenEncrypted: 'enc_token',
          expiresAt: pastDate,
        },
      });
      mockPrisma.brokerConnection.update.mockResolvedValue({
        ...sampleConnection,
        status: BrokerConnectionStatus.EXPIRED,
      });

      await expect(
        service.getDecryptedTokens('user-123', 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.brokerConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { brokerAccountId: 'acc-uuid-1' },
          data: expect.objectContaining({
            status: BrokerConnectionStatus.EXPIRED,
          }),
        }),
      );
    });
  });
});

