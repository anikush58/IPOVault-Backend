import { BrokerType, BrokerTradeSide, ExchangeListing } from '@prisma/client';
import { BrokerRegistry } from './broker.registry';
import { BrokerAdapter } from './broker.adapter';
import { UnsupportedBrokerAdapterException } from './broker.errors';
import {
  BrokerAuthTokens,
  BrokerCapabilities,
  BrokerProfile,
  NormalizedHolding,
  NormalizedQuote,
  NormalizedTrade,
} from './broker.types';

describe('BrokerRegistry & Broker Domain Types', () => {
  let registry: BrokerRegistry;

  const sampleDate = new Date('2026-09-22T10:00:00Z');

  // Minimal mock adapter for testing registry behavior without contacting external services
  const createMockAdapter = (
    brokerType: BrokerType,
    capabilitiesOverride?: Partial<BrokerCapabilities>,
  ): BrokerAdapter => {
    const defaultCapabilities: BrokerCapabilities = {
      authorization: true,
      holdings: true,
      trades: true,
      quotes: false,
      tokenRefresh: true,
      revocation: true,
      ...capabilitiesOverride,
    };

    return {
      brokerType,
      capabilities: defaultCapabilities,
      getAuthorizationUrl: jest
        .fn()
        .mockResolvedValue(`https://${brokerType.toLowerCase()}.example.com/oauth/authorize?state=123`),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresAt: new Date(Date.now() + 3600000),
      }),
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: 'mock-refreshed-access-token',
        refreshToken: 'mock-refreshed-token',
      }),
      getProfile: jest.fn().mockResolvedValue({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'CLIENT123',
        displayName: 'Test User',
        email: 'user@example.com',
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
          asOf: sampleDate,
        },
      ]),
      getTrades: jest.fn().mockResolvedValue([
        {
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'trade-999',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.BUY,
          quantity: 10,
          price: 2400.5,
          tradedAt: sampleDate,
        },
      ]),
      getQuote: jest.fn().mockResolvedValue({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 2450.0,
        asOf: sampleDate,
      }),
      revokeConnection: jest.fn().mockResolvedValue(undefined),
    };
  };

  beforeEach(() => {
    registry = new BrokerRegistry();
  });

  describe('1. Domain Types and Capability Model Compilation', () => {
    it('instantiates normalized domain entities and capability flags correctly', () => {
      const capabilities: BrokerCapabilities = {
        authorization: true,
        holdings: true,
        trades: false,
        quotes: true,
        tokenRefresh: true,
        revocation: false,
      };

      const profile: BrokerProfile = {
        brokerAccountId: 'acc-1',
        clientId: 'CL-001',
        displayName: 'John Doe',
        email: 'john@example.com',
      };

      const holding: NormalizedHolding = {
        brokerAccountId: 'acc-1',
        isin: 'INE123A01010',
        exchange: ExchangeListing.NSE,
        symbol: 'TATAMOTORS',
        quantity: 50,
        averagePrice: 600,
        lastPrice: 620,
        currentValue: 31000,
        unrealizedPnl: 1000,
        asOf: sampleDate,
      };

      const trade: NormalizedTrade = {
        brokerAccountId: 'acc-1',
        brokerTradeId: 'tr-001',
        isin: 'INE123A01010',
        exchange: ExchangeListing.NSE,
        symbol: 'TATAMOTORS',
        side: BrokerTradeSide.BUY,
        quantity: 50,
        price: 600,
        tradedAt: sampleDate,
      };

      const quote: NormalizedQuote = {
        isin: 'INE123A01010',
        exchange: ExchangeListing.NSE,
        symbol: 'TATAMOTORS',
        lastPrice: 620,
        asOf: sampleDate,
      };

      const tokens: BrokerAuthTokens = {
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        expiresAt: sampleDate,
      };

      expect(capabilities.holdings).toBe(true);
      expect(profile.brokerAccountId).toBe('acc-1');
      expect(holding.isin).toBe('INE123A01010');
      expect(trade.side).toBe(BrokerTradeSide.BUY);
      expect(quote.lastPrice).toBe(620);
      expect(tokens.accessToken).toBe('access-123');
    });
  });

  describe('2. Registry Rejection for Unregistered Brokers', () => {
    it('throws UnsupportedBrokerAdapterException when retrieving an unregistered broker', () => {
      expect(registry.hasAdapter(BrokerType.DHAN)).toBe(false);
      expect(registry.hasAdapter(BrokerType.UPSTOX)).toBe(false);
      expect(registry.getSupportedBrokers()).toEqual([]);

      expect(() => registry.getAdapter(BrokerType.DHAN)).toThrow(
        UnsupportedBrokerAdapterException,
      );
      expect(() => registry.getAdapter(BrokerType.UPSTOX)).toThrow(
        UnsupportedBrokerAdapterException,
      );
    });
  });

  describe('3. Registry Registration and Retrieval', () => {
    it('returns the registered adapter when one is supplied', () => {
      const dhanAdapter = createMockAdapter(BrokerType.DHAN);
      registry.register(dhanAdapter);

      expect(registry.hasAdapter(BrokerType.DHAN)).toBe(true);
      expect(registry.hasAdapter(BrokerType.MILLIONS)).toBe(false);

      const retrieved = registry.getAdapter(BrokerType.DHAN);
      expect(retrieved).toBe(dhanAdapter);
      expect(retrieved.brokerType).toBe(BrokerType.DHAN);
      expect(retrieved.capabilities.holdings).toBe(true);

      expect(registry.getSupportedBrokers()).toEqual([BrokerType.DHAN]);
      expect(registry.getAllAdapters()).toEqual([dhanAdapter]);
    });

    it('supports multiple distinct registered adapters', () => {
      const upstoxAdapter = createMockAdapter(BrokerType.UPSTOX);
      const fyersAdapter = createMockAdapter(BrokerType.FYERS);
      const zerodhaAdapter = createMockAdapter(BrokerType.ZERODHA);
      const growwAdapter = createMockAdapter(BrokerType.GROWW);

      registry.register(upstoxAdapter);
      registry.register(fyersAdapter);
      registry.register(zerodhaAdapter);
      registry.register(growwAdapter);

      expect(registry.getSupportedBrokers()).toEqual([
        BrokerType.UPSTOX,
        BrokerType.FYERS,
        BrokerType.ZERODHA,
        BrokerType.GROWW,
      ]);
      expect(registry.getAdapter(BrokerType.UPSTOX)).toBe(upstoxAdapter);
      expect(registry.getAdapter(BrokerType.FYERS)).toBe(fyersAdapter);
      expect(registry.getAdapter(BrokerType.ZERODHA)).toBe(zerodhaAdapter);
      expect(registry.getAdapter(BrokerType.GROWW)).toBe(growwAdapter);
    });

    it('rejects invalid adapter registration without brokerType', () => {
      expect(() => registry.register({} as any)).toThrow(
        'Invalid broker adapter: brokerType is required',
      );
    });
  });

  describe('4. Safe Error Behavior (No Token / Secret Leakage)', () => {
    it('ensures UnsupportedBrokerAdapterException contains only safe diagnostic message', () => {
      try {
        registry.getAdapter(BrokerType.MILLIONS);
        fail('Expected getAdapter to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(UnsupportedBrokerAdapterException);
        expect(err.message).toBe(
          "Broker adapter for 'MILLIONS' is not supported or registered",
        );
        // Ensure no sensitive keywords or leakages in error payload
        expect(err.message).not.toContain('token');
        expect(err.message).not.toContain('secret');
        expect(err.message).not.toContain('key');
        expect(err.message).not.toContain('password');
      }
    });
  });
});
