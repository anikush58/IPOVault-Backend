import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  BrokerConnectionStatus,
  BrokerTradeSide,
  BrokerType,
  ExchangeListing,
} from '@prisma/client';
import { BrokerAccountController } from './broker-account.controller';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerInvestmentService } from './broker-investment.service';
import { BrokerOAuthStateService } from './security/broker-oauth-state.service';
import { BrokerRegistry } from './broker.registry';

describe('BrokerAccountController', () => {
  let controller: BrokerAccountController;
  let mockAccountService: any;
  let mockConnectionService: any;
  let mockInvestmentService: any;
  let mockRegistry: any;
  let mockOAuthStateService: any;
  let mockUpstoxAdapter: any;
  let mockDhanAdapter: any;
  let mockFyersAdapter: any;
  let mockZerodhaAdapter: any;
  let mockGrowwAdapter: any;
  let mockMillionsAdapter: any;

  const mockDate = new Date('2026-09-21T12:00:00Z');

  const sampleAccountPrisma = {
    id: 'acc-uuid-1',
    userId: 'user-123',
    profileId: 'profile-abc',
    broker: BrokerType.DHAN,
    accountName: 'My Dhan Account',
    clientId: 'DHAN12345',
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
      // Sensitive fields if present on Prisma model
      accessTokenEncrypted: 'sensitive-enc-token',
      refreshTokenEncrypted: 'sensitive-refresh-token',
    },
  };

  const sampleUpstoxAccountPrisma = {
    ...sampleAccountPrisma,
    broker: BrokerType.UPSTOX,
    accountName: 'My Upstox Account',
    clientId: 'UPSTOX123',
  };

  const sampleFyersAccountPrisma = {
    ...sampleAccountPrisma,
    broker: BrokerType.FYERS,
    accountName: 'My Fyers Account',
    clientId: 'FYERS123',
  };

  const sampleZerodhaAccountPrisma = {
    ...sampleAccountPrisma,
    broker: BrokerType.ZERODHA,
    accountName: 'My Zerodha Account',
    clientId: 'ZERODHA123',
  };

  const sampleGrowwAccountPrisma = {
    ...sampleAccountPrisma,
    broker: BrokerType.GROWW,
    accountName: 'My Groww Account',
    clientId: 'GROWW123',
  };

  const sampleMillionsAccountPrisma = {
    ...sampleAccountPrisma,
    broker: BrokerType.MILLIONS,
    accountName: 'My Millions Account',
    clientId: 'MILLIONS123',
  };

  const sampleConnectionPrisma = {
    id: 'conn-uuid-1',
    brokerAccountId: 'acc-uuid-1',
    status: BrokerConnectionStatus.PENDING,
    connectedAt: null,
    lastSyncAt: null,
    lastErrorAt: null,
    lastError: null,
    createdAt: mockDate,
    updatedAt: mockDate,
    // Sensitive fields
    accessTokenEncrypted: 'sensitive-enc-token',
    refreshTokenEncrypted: 'sensitive-refresh-token',
  };

  beforeEach(() => {
    mockAccountService = {
      getAccounts: jest.fn(),
      createAccount: jest.fn(),
      getAccount: jest.fn(),
      deactivate: jest.fn(),
    };

    mockConnectionService = {
      getConnection: jest.fn(),
      markPending: jest.fn(),
      saveTokens: jest.fn(),
      getDecryptedTokens: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['holdings'],
      }),
    };

    mockInvestmentService = {
      recordAllotmentInvestment: jest.fn().mockResolvedValue({
        id: 'inv-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        ipoId: 'ipo-uuid-1',
        allottedQuantity: 50,
        allotmentPrice: 500,
        allotmentDate: mockDate,
      }),
      getDerivedInvestmentSummary: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        ipoId: 'ipo-uuid-1',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        allottedQuantity: 50,
        allotmentPrice: 500,
        allotmentDate: mockDate,
        totalSoldQuantity: 0,
        remainingQuantity: 50,
        currentHoldingQuantity: 50,
        status: 'HOLDING',
        sellTrades: [],
        holding: null,
      }),
      syncAndMatchInvestment: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        ipoId: 'ipo-uuid-1',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        allottedQuantity: 50,
        allotmentPrice: 500,
        allotmentDate: mockDate,
        totalSoldQuantity: 0,
        remainingQuantity: 50,
        currentHoldingQuantity: 50,
        status: 'HOLDING',
        sellTrades: [],
        holding: null,
      }),
      syncAccountPostListingInvestments: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        syncTimestamp: mockDate,
        syncedInvestmentsCount: 1,
        investments: [],
      }),
    };

    mockOAuthStateService = {
      generateState: jest.fn().mockReturnValue('mock-crypto-state-token'),
      validateAndConsumeState: jest.fn(),
    };

    mockUpstoxAdapter = {
      brokerType: BrokerType.UPSTOX,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://api.upstox.com/v2/login/authorization/dialog?response_type=code'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['holdings'],
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'UPSTOX123',
        displayName: 'Test User',
      }),
      getHoldings: jest.fn().mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 10,
          averagePrice: 2400.5,
          lastPrice: 2450.0,
          currentValue: 24500.0,
          unrealizedPnl: 495.0,
          asOf: mockDate,
        },
      ]),
      getTrades: jest.fn().mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: '2609220001',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.BUY,
          quantity: 10,
          price: 2400.5,
          tradedAt: mockDate,
        },
      ]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockDhanAdapter = {
      brokerType: BrokerType.DHAN,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.dhan.co/consent-login?partner_id=test-id'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-dhan-access-token',
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'DHAN123',
        displayName: null,
      }),
      getHoldings: jest.fn().mockResolvedValue([]),
      getTrades: jest.fn().mockResolvedValue([]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockFyersAdapter = {
      brokerType: BrokerType.FYERS,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://api-t1.fyers.in/api/v3/generate-authcode?client_id=test-id'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-fyers-access-token',
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'FYERS123',
        displayName: 'Fyers User',
      }),
      getHoldings: jest.fn().mockResolvedValue([]),
      getTrades: jest.fn().mockResolvedValue([]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockZerodhaAdapter = {
      brokerType: BrokerType.ZERODHA,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://kite.zerodha.com/connect/login?v=3&api_key=test-id'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-kite-access-token',
        refreshToken: 'mock-kite-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'ZERODHA123',
        displayName: 'Zerodha User',
      }),
      getHoldings: jest.fn().mockResolvedValue([]),
      getTrades: jest.fn().mockResolvedValue([]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockGrowwAdapter = {
      brokerType: BrokerType.GROWW,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://groww.in/oauth/authorize?client_id=test-id'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-groww-access-token',
        refreshToken: 'mock-groww-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'GROWW123',
        displayName: 'Groww User',
      }),
      getHoldings: jest.fn().mockResolvedValue([]),
      getTrades: jest.fn().mockResolvedValue([]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockMillionsAdapter = {
      brokerType: BrokerType.MILLIONS,
      getAuthorizationUrl: jest.fn().mockResolvedValue('https://auth.dhan.co/consent-login?partner_id=test-id'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-millions-access-token',
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'MILLIONS123',
        displayName: 'Millions User',
      }),
      getHoldings: jest.fn().mockResolvedValue([]),
      getTrades: jest.fn().mockResolvedValue([]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        lastPrice: 2450.0,
        asOf: mockDate,
      }),
    };

    mockRegistry = {
      getAdapter: jest.fn((broker: BrokerType) => {
        if (broker === BrokerType.DHAN) return mockDhanAdapter;
        if (broker === BrokerType.FYERS) return mockFyersAdapter;
        if (broker === BrokerType.ZERODHA) return mockZerodhaAdapter;
        if (broker === BrokerType.GROWW) return mockGrowwAdapter;
        if (broker === BrokerType.MILLIONS) return mockMillionsAdapter;
        return mockUpstoxAdapter;
      }),
    };

    controller = new BrokerAccountController(
      mockAccountService as unknown as BrokerAccountService,
      mockConnectionService as unknown as BrokerConnectionService,
      mockInvestmentService as unknown as BrokerInvestmentService,
      mockRegistry as unknown as BrokerRegistry,
      mockOAuthStateService as unknown as BrokerOAuthStateService,
    );
  });

  describe('Authentication (x-user-id)', () => {
    it('1. throws UnauthorizedException (401) when x-user-id is missing or empty on all endpoints', async () => {
      // GET list
      await expect(controller.getAccounts(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getAccounts('')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(controller.getAccounts('   ')).rejects.toThrow(
        UnauthorizedException,
      );

      // POST create
      await expect(
        controller.createAccount(
          { profileId: 'p1', broker: BrokerType.DHAN },
          undefined,
        ),
      ).rejects.toThrow(UnauthorizedException);

      // GET account
      await expect(controller.getAccount('acc-1', undefined)).rejects.toThrow(
        UnauthorizedException,
      );

      // GET connection
      await expect(
        controller.getConnection('acc-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // POST disconnect
      await expect(
        controller.disconnectAccount('acc-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET connect upstox
      await expect(
        controller.startUpstoxConnect('acc-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET connect upstox callback
      await expect(
        controller.completeUpstoxConnect('acc-1', 'auth-code', 'auth-state', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET holdings
      await expect(
        controller.getHoldings('acc-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET trades
      await expect(
        controller.getTrades('acc-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET quote
      await expect(
        controller.getQuote('acc-1', 'INE002A01018', 'NSE', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // POST match investment
      await expect(
        controller.recordAllotmentInvestment('acc-1', { ipoId: 'ipo-1', isin: 'INE002A01018', allottedQuantity: 50, allotmentPrice: 500 }, undefined),
      ).rejects.toThrow(UnauthorizedException);

      // GET investment summary
      await expect(
        controller.getInvestmentSummary('acc-1', 'ipo-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      // POST sync investment
      await expect(
        controller.syncInvestment('acc-1', 'ipo-1', undefined),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockAccountService.getAccounts).not.toHaveBeenCalled();
      expect(mockAccountService.createAccount).not.toHaveBeenCalled();
      expect(mockAccountService.getAccount).not.toHaveBeenCalled();
      expect(mockConnectionService.getConnection).not.toHaveBeenCalled();
      expect(mockAccountService.deactivate).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.getHoldings).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.getTrades).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.getQuote).not.toHaveBeenCalled();
      expect(mockInvestmentService.recordAllotmentInvestment).not.toHaveBeenCalled();
      expect(mockInvestmentService.getDerivedInvestmentSummary).not.toHaveBeenCalled();
      expect(mockInvestmentService.syncAndMatchInvestment).not.toHaveBeenCalled();
    });
  });


  describe('GET /api/v1/broker-accounts (list)', () => {
    it('2. passes authenticated userId to service and returns safe accounts', async () => {
      mockAccountService.getAccounts!.mockResolvedValue([
        sampleAccountPrisma as any,
      ]);

      const result = await controller.getAccounts('  user-123  ');

      expect(mockAccountService.getAccounts).toHaveBeenCalledWith('user-123');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'acc-uuid-1',
        profileId: 'profile-abc',
        broker: BrokerType.DHAN,
        accountName: 'My Dhan Account',
        clientId: 'DHAN12345',
        isActive: true,
        connection: {
          id: 'conn-uuid-1',
          status: BrokerConnectionStatus.PENDING,
          connectedAt: null,
          lastSyncAt: null,
          lastErrorAt: null,
          lastError: null,
        },
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      // 8. Verify sensitive token fields are excluded
      expect(result[0]).not.toHaveProperty('accessTokenEncrypted');
      expect(result[0]).not.toHaveProperty('refreshTokenEncrypted');
      expect(result[0].connection).not.toHaveProperty('accessTokenEncrypted');
      expect(result[0].connection).not.toHaveProperty('refreshTokenEncrypted');
    });
  });

  describe('POST /api/v1/broker-accounts (create)', () => {
    it('3. never accepts userId from body; uses x-user-id for ownership boundary', async () => {
      mockAccountService.createAccount!.mockResolvedValue(
        sampleAccountPrisma as any,
      );

      const maliciousBody = {
        userId: 'attacker-id-999',
        profileId: 'profile-abc',
        broker: BrokerType.DHAN,
        accountName: 'My Dhan',
        clientId: 'DHAN123',
      };

      await controller.createAccount(maliciousBody, 'legitimate-user-123');

      expect(mockAccountService.createAccount).toHaveBeenCalledWith({
        userId: 'legitimate-user-123',
        profileId: 'profile-abc',
        broker: BrokerType.DHAN,
        accountName: 'My Dhan',
        clientId: 'DHAN123',
      });
      expect(mockAccountService.createAccount).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'attacker-id-999' }),
      );
    });

    it('4. passes x-user-id + profileId + broker to service and returns safe account', async () => {
      mockAccountService.createAccount!.mockResolvedValue(
        sampleAccountPrisma as any,
      );

      const validBody = {
        profileId: 'profile-abc',
        broker: BrokerType.DHAN,
        accountName: 'My Dhan Account',
        clientId: 'DHAN12345',
      };

      const result = await controller.createAccount(validBody, 'user-123');

      expect(mockAccountService.createAccount).toHaveBeenCalledWith({
        userId: 'user-123',
        profileId: 'profile-abc',
        broker: BrokerType.DHAN,
        accountName: 'My Dhan Account',
        clientId: 'DHAN12345',
      });
      expect(result.id).toBe('acc-uuid-1');
      expect(result.broker).toBe(BrokerType.DHAN);
      expect(result.connection?.status).toBe(BrokerConnectionStatus.PENDING);

      // 8. Verify sensitive token fields are excluded
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result.connection).not.toHaveProperty('accessTokenEncrypted');
    });

    it('rejects invalid body (missing profileId, invalid broker) with BadRequestException', async () => {
      // Missing profileId
      await expect(
        controller.createAccount({ broker: BrokerType.DHAN }, 'user-123'),
      ).rejects.toThrow(BadRequestException);

      // Invalid broker string
      await expect(
        controller.createAccount(
          { profileId: 'p1', broker: 'UNSUPPORTED_BROKER' },
          'user-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockAccountService.createAccount).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id (get)', () => {
    it('5. passes x-user-id + accountId to service and returns safe account', async () => {
      mockAccountService.getAccount!.mockResolvedValue(
        sampleAccountPrisma as any,
      );

      const result = await controller.getAccount('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(result.id).toBe('acc-uuid-1');
      expect(result.profileId).toBe('profile-abc');
      expect(result).not.toHaveProperty('accessTokenEncrypted');
    });

    it('throws BadRequestException if account id param is empty', async () => {
      await expect(controller.getAccount('', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connection (connection status)', () => {
    it('6. passes x-user-id + accountId to service and returns connection metadata only', async () => {
      mockConnectionService.getConnection!.mockResolvedValue(
        sampleConnectionPrisma as any,
      );

      const result = await controller.getConnection('acc-uuid-1', 'user-123');

      expect(mockConnectionService.getConnection).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(result).toEqual({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.PENDING,
        connectedAt: null,
        lastSyncAt: null,
        lastErrorAt: null,
        lastError: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      // 8. Verify no BrokerToken fields or secrets are exposed
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result).not.toHaveProperty('refreshTokenEncrypted');
      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('secret');
    });

    it('throws BadRequestException if account id param is empty', async () => {
      await expect(controller.getConnection('', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('POST /api/v1/broker-accounts/:id/disconnect (disconnect)', () => {
    it('7. passes x-user-id + accountId to deactivate and returns safe deactivated account', async () => {
      const deactivatedAccount = {
        ...sampleAccountPrisma,
        isActive: false,
        connection: {
          ...sampleAccountPrisma.connection,
          status: BrokerConnectionStatus.DISCONNECTED,
        },
      };

      mockAccountService.deactivate!.mockResolvedValue(
        deactivatedAccount as any,
      );

      const result = await controller.disconnectAccount(
        'acc-uuid-1',
        'user-123',
      );

      expect(mockAccountService.deactivate).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(result.id).toBe('acc-uuid-1');
      expect(result.isActive).toBe(false);
      expect(result.connection?.status).toBe(
        BrokerConnectionStatus.DISCONNECTED,
      );
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result.connection).not.toHaveProperty('accessTokenEncrypted');
    });

    it('throws BadRequestException if account id param is empty', async () => {
      await expect(
        controller.disconnectAccount('', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/upstox (start Upstox OAuth)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startUpstoxConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.UPSTOX);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockUpstoxAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://api.upstox.com/v2/login/authorization/dialog?response_type=code',
      });
    });

    it('rejects if the account is for a different broker (e.g. DHAN)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleAccountPrisma); // broker: DHAN

      await expect(
        controller.startUpstoxConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockOAuthStateService.generateState).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if account id param is empty', async () => {
      await expect(
        controller.startUpstoxConnect('', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/upstox/callback (complete Upstox OAuth)', () => {
    it('validates single-use state, exchanges code, retrieves profile, persists encrypted tokens, and marks CONNECTED', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeUpstoxConnect(
        'acc-uuid-1',
        'valid-oauth-code',
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.UPSTOX);
      expect(mockUpstoxAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'valid-oauth-code',
      });
      expect(mockUpstoxAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-access-token' }),
      );

      expect(result).toEqual({
        id: 'conn-uuid-1',
        brokerAccountId: 'acc-uuid-1',
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
        lastSyncAt: null,
        lastErrorAt: null,
        lastError: null,
        createdAt: mockDate,
        updatedAt: mockDate,
      });

      // Never expose sensitive token fields or secrets
      expect(result).not.toHaveProperty('accessTokenEncrypted');
      expect(result).not.toHaveProperty('refreshTokenEncrypted');
      expect(result).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('secret');
    });

    it('rejects if authorization code is missing', async () => {
      await expect(
        controller.completeUpstoxConnect('acc-uuid-1', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.completeUpstoxConnect('acc-uuid-1', undefined, 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockOAuthStateService.validateAndConsumeState).not.toHaveBeenCalled();
      expect(mockAccountService.getAccount).not.toHaveBeenCalled();
    });

    it('rejects and halts flow when state validation fails (invalid, expired, or reused state)', async () => {
      mockOAuthStateService.validateAndConsumeState.mockImplementation(() => {
        throw new BadRequestException('Invalid or already used OAuth state');
      });

      await expect(
        controller.completeUpstoxConnect(
          'acc-uuid-1',
          'valid-code',
          'reused-state-token',
          'user-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockAccountService.getAccount).not.toHaveBeenCalled();
      expect(mockUpstoxAdapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(mockConnectionService.saveTokens).not.toHaveBeenCalled();
    });

    it('rejects if account broker is not UPSTOX', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleAccountPrisma); // DHAN

      await expect(
        controller.completeUpstoxConnect('acc-uuid-1', 'valid-code', 'mock-crypto-state-token', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockUpstoxAdapter.exchangeAuthorizationCode).not.toHaveBeenCalled();
      expect(mockConnectionService.saveTokens).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/dhan (start Dhan OAuth/consent)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleAccountPrisma); // DHAN
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startDhanConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.DHAN);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockDhanAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://auth.dhan.co/consent-login?partner_id=test-id',
      });
    });

    it('rejects if the account is for a different broker (e.g. UPSTOX)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await expect(
        controller.startDhanConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockDhanAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/dhan/callback (complete Dhan OAuth/consent)', () => {
    it('validates state, exchanges tokenId / code, retrieves profile, and persists tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeDhanConnect(
        'acc-uuid-1',
        undefined,
        'dhan-token-id-123',
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.DHAN);
      expect(mockDhanAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'dhan-token-id-123',
      });
      expect(mockDhanAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-dhan-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-dhan-access-token' }),
      );

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
    });

    it('rejects if authorization code / tokenId is missing', async () => {
      await expect(
        controller.completeDhanConnect('acc-uuid-1', '', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/fyers (start FYERS OAuth)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleFyersAccountPrisma); // FYERS
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startFyersConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.FYERS);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockFyersAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://api-t1.fyers.in/api/v3/generate-authcode?client_id=test-id',
      });
    });

    it('rejects if the account is for a different broker (e.g. UPSTOX)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await expect(
        controller.startFyersConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockFyersAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/fyers/callback (complete FYERS OAuth)', () => {
    it('validates state, exchanges code / auth_code, retrieves profile, and persists tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleFyersAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeFyersConnect(
        'acc-uuid-1',
        'fyers-auth-code-123',
        undefined,
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.FYERS);
      expect(mockFyersAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'fyers-auth-code-123',
      });
      expect(mockFyersAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-fyers-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-fyers-access-token' }),
      );

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
    });

    it('rejects if authorization code is missing', async () => {
      await expect(
        controller.completeFyersConnect('acc-uuid-1', '', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/zerodha (start Zerodha OAuth)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleZerodhaAccountPrisma);
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startZerodhaConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.ZERODHA);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockZerodhaAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://kite.zerodha.com/connect/login?v=3&api_key=test-id',
      });
    });

    it('rejects if the account is for a different broker (e.g. UPSTOX)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await expect(
        controller.startZerodhaConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockZerodhaAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/zerodha/callback (complete Zerodha OAuth)', () => {
    it('validates state, exchanges request_token, retrieves profile, and persists tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleZerodhaAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeZerodhaConnect(
        'acc-uuid-1',
        'kite-request-token-123',
        undefined,
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.ZERODHA);
      expect(mockZerodhaAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'kite-request-token-123',
      });
      expect(mockZerodhaAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-kite-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-kite-access-token' }),
      );

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
    });

    it('rejects if request_token/code is missing', async () => {
      await expect(
        controller.completeZerodhaConnect('acc-uuid-1', '', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/groww (start Groww OAuth)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleGrowwAccountPrisma);
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startGrowwConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.GROWW);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockGrowwAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://groww.in/oauth/authorize?client_id=test-id',
      });
    });

    it('rejects if the account is for a different broker (e.g. UPSTOX)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await expect(
        controller.startGrowwConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockGrowwAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/groww/callback (complete Groww OAuth)', () => {
    it('validates state, exchanges code, retrieves profile, and persists tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleGrowwAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeGrowwConnect(
        'acc-uuid-1',
        'groww-code-123',
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.GROWW);
      expect(mockGrowwAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'groww-code-123',
      });
      expect(mockGrowwAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-groww-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-groww-access-token' }),
      );

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
    });

    it('rejects if code is missing', async () => {
      await expect(
        controller.completeGrowwConnect('acc-uuid-1', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/millions (start Millions OAuth)', () => {
    it('verifies ownership, marks connection PENDING, generates cryptographically secure state, and returns authorization URL', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleMillionsAccountPrisma);
      mockConnectionService.markPending.mockResolvedValue(sampleConnectionPrisma);

      const result = await controller.startMillionsConnect('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockConnectionService.markPending).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.MILLIONS);
      expect(mockOAuthStateService.generateState).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockMillionsAdapter.getAuthorizationUrl).toHaveBeenCalledWith({
        state: 'mock-crypto-state-token',
      });
      expect(result).toEqual({
        authorizationUrl: 'https://auth.dhan.co/consent-login?partner_id=test-id',
      });
    });

    it('rejects if the account is for a different broker (e.g. UPSTOX)', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await expect(
        controller.startMillionsConnect('acc-uuid-1', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockConnectionService.markPending).not.toHaveBeenCalled();
      expect(mockMillionsAdapter.getAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/connect/millions/callback (complete Millions OAuth)', () => {
    it('validates state, exchanges code / tokenId, retrieves profile, and persists tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleMillionsAccountPrisma);
      const connectedConn = {
        ...sampleConnectionPrisma,
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: mockDate,
      };
      mockConnectionService.saveTokens.mockResolvedValue(connectedConn);

      const result = await controller.completeMillionsConnect(
        'acc-uuid-1',
        'millions-code-123',
        undefined,
        'mock-crypto-state-token',
        'user-123',
      );

      expect(mockOAuthStateService.validateAndConsumeState).toHaveBeenCalledWith(
        'mock-crypto-state-token',
        'user-123',
        'acc-uuid-1',
      );
      expect(mockAccountService.getAccount).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.MILLIONS);
      expect(mockMillionsAdapter.exchangeAuthorizationCode).toHaveBeenCalledWith({
        code: 'millions-code-123',
      });
      expect(mockMillionsAdapter.getProfile).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-millions-access-token' }),
        'acc-uuid-1',
      );
      expect(mockConnectionService.saveTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({ accessToken: 'mock-millions-access-token' }),
      );

      expect(result.status).toBe(BrokerConnectionStatus.CONNECTED);
    });

    it('rejects if code/tokenId is missing', async () => {
      await expect(
        controller.completeMillionsConnect('acc-uuid-1', '', '', 'state', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/holdings (read holdings)', () => {
    it('retrieves normalized holdings using decrypted in-memory tokens', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      const result = await controller.getHoldings('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockConnectionService.getDecryptedTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.UPSTOX);
      expect(mockUpstoxAdapter.getHoldings).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-access-token' }),
        'acc-uuid-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        brokerAccountId: 'acc-uuid-1',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        quantity: 10,
        averagePrice: 2400.5,
        lastPrice: 2450.0,
        currentValue: 24500.0,
        unrealizedPnl: 495.0,
        asOf: mockDate,
      });
      // Ensure no tokens leaked
      expect(result[0]).not.toHaveProperty('accessToken');
    });

    it('throws BadRequestException when account id is empty', async () => {
      await expect(controller.getHoldings('', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockConnectionService.getDecryptedTokens).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/trades (read trades)', () => {
    it("retrieves today's normalized trades using decrypted in-memory tokens", async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      const result = await controller.getTrades('acc-uuid-1', 'user-123');

      expect(mockAccountService.getAccount).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockConnectionService.getDecryptedTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.UPSTOX);
      expect(mockUpstoxAdapter.getTrades).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-access-token' }),
        'acc-uuid-1',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        brokerAccountId: 'acc-uuid-1',
        brokerTradeId: '2609220001',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        side: BrokerTradeSide.BUY,
        quantity: 10,
        price: 2400.5,
        tradedAt: mockDate,
      });
      expect(result[0]).not.toHaveProperty('accessToken');
    });

    it('throws BadRequestException when account id is empty', async () => {
      await expect(controller.getTrades('', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockConnectionService.getDecryptedTokens).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/broker-accounts/:id/quote (read quote)', () => {
    it('retrieves normalized market quote for ISIN and exchange', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      const result = await controller.getQuote(
        'acc-uuid-1',
        'INE002A01018',
        'NSE',
        'user-123',
      );

      expect(mockAccountService.getAccount).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockConnectionService.getDecryptedTokens).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
      );
      expect(mockRegistry.getAdapter).toHaveBeenCalledWith(BrokerType.UPSTOX);
      expect(mockUpstoxAdapter.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ accessToken: 'mock-access-token' }),
        'INE002A01018',
        ExchangeListing.NSE,
      );
      expect(result).toEqual({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 2450.0,
        asOf: mockDate,
      });
      expect(result).not.toHaveProperty('accessToken');
    });

    it('defaults exchange to NSE when exchange query param is omitted', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await controller.getQuote('acc-uuid-1', 'INE002A01018', undefined, 'user-123');

      expect(mockUpstoxAdapter.getQuote).toHaveBeenCalledWith(
        expect.anything(),
        'INE002A01018',
        ExchangeListing.NSE,
      );
    });

    it('supports BSE exchange query parameter', async () => {
      mockAccountService.getAccount.mockResolvedValue(sampleUpstoxAccountPrisma);

      await controller.getQuote('acc-uuid-1', 'INE002A01018', 'BSE', 'user-123');

      expect(mockUpstoxAdapter.getQuote).toHaveBeenCalledWith(
        expect.anything(),
        'INE002A01018',
        ExchangeListing.BSE,
      );
    });

    it('throws BadRequestException if ISIN is missing or empty', async () => {
      await expect(
        controller.getQuote('acc-uuid-1', '', 'NSE', 'user-123'),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.getQuote('acc-uuid-1', undefined, 'NSE', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if exchange is invalid', async () => {
      await expect(
        controller.getQuote('acc-uuid-1', 'INE002A01018', 'INVALID_EXCHANGE', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /api/v1/broker-accounts/:id/investments/match (record allotment investment)', () => {
    it('validates request and delegates to BrokerInvestmentService.recordAllotmentInvestment', async () => {
      const body = {
        ipoId: 'ipo-uuid-1',
        isin: 'INE002A01018',
        allottedQuantity: 50,
        allotmentPrice: 500,
        profileId: 'profile-abc',
      };

      const result = await controller.recordAllotmentInvestment(
        'acc-uuid-1',
        body,
        'user-123',
      );

      expect(mockInvestmentService.recordAllotmentInvestment).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        expect.objectContaining({
          ipoId: 'ipo-uuid-1',
          isin: 'INE002A01018',
          allottedQuantity: 50,
          allotmentPrice: 500,
          profileId: 'profile-abc',
        }),
      );
      expect(result).toHaveProperty('id', 'inv-uuid-1');
    });

    it('throws BadRequestException on invalid payload', async () => {
      await expect(
        controller.recordAllotmentInvestment(
          'acc-uuid-1',
          { isin: 'INE002A01018', allottedQuantity: -5 }, // missing ipoId and invalid qty
          'user-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GET /api/v1/broker-accounts/:id/investments/:ipoId (derived summary)', () => {
    it('delegates to BrokerInvestmentService.getDerivedInvestmentSummary', async () => {
      const result = await controller.getInvestmentSummary(
        'acc-uuid-1',
        'ipo-uuid-1',
        'user-123',
      );

      expect(mockInvestmentService.getDerivedInvestmentSummary).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );
      expect(result).toHaveProperty('status', 'HOLDING');
      expect(result).toHaveProperty('allottedQuantity', 50);
    });

    it('throws BadRequestException if ipoId is empty', async () => {
      await expect(
        controller.getInvestmentSummary('acc-uuid-1', '', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /api/v1/broker-accounts/:id/investments/:ipoId/sync (live sync)', () => {
    it('delegates to BrokerInvestmentService.syncAndMatchInvestment', async () => {
      const result = await controller.syncInvestment(
        'acc-uuid-1',
        'ipo-uuid-1',
        'user-123',
      );

      expect(mockInvestmentService.syncAndMatchInvestment).toHaveBeenCalledWith(
        'user-123',
        'acc-uuid-1',
        'ipo-uuid-1',
      );
      expect(result).toHaveProperty('status', 'HOLDING');
    });

    it('throws BadRequestException if ipoId is empty', async () => {
      await expect(
        controller.syncInvestment('acc-uuid-1', '', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('POST /api/v1/broker-accounts/:id/sync (manual sync now)', () => {
    it('delegates to BrokerInvestmentService.syncAccountPostListingInvestments', async () => {
      const result = await controller.syncAccountNow(
        'acc-uuid-1',
        'user-123',
      );

      expect(
        mockInvestmentService.syncAccountPostListingInvestments,
      ).toHaveBeenCalledWith('user-123', 'acc-uuid-1');
      expect(result).toHaveProperty('brokerAccountId', 'acc-uuid-1');
      expect(result).toHaveProperty('syncedInvestmentsCount', 1);
    });

    it('throws BadRequestException if account id is empty', async () => {
      await expect(
        controller.syncAccountNow('   ', 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});


