import { BadRequestException } from '@nestjs/common';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { DhanBrokerAdapter, extractIsinFromDhan } from './dhan.adapter';

describe('DhanBrokerAdapter', () => {
  let adapter: DhanBrokerAdapter;
  let mockConfigService: any;

  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'DHAN_BASE_URL') return 'https://api.dhan.co/v2';
        if (key === 'DHAN_AUTH_BASE_URL') return 'https://auth.dhan.co';
        if (key === 'DHAN_API_KEY') return 'test-dhan-partner-id';
        if (key === 'DHAN_API_SECRET') return 'test-dhan-partner-secret';
        if (key === 'DHAN_REDIRECT_URI')
          return 'https://app.example.com/callback/dhan';
        return undefined;
      }),
    };

    adapter = new DhanBrokerAdapter(mockConfigService as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractIsinFromDhan helper', () => {
    it('extracts ISIN from isin field or INE symbol prefix', () => {
      expect(extractIsinFromDhan('INE002A01018', 'RELIANCE')).toBe('INE002A01018');
      expect(extractIsinFromDhan(null, 'INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromDhan('', 'RELIANCE')).toBe('');
      expect(extractIsinFromDhan(null, null)).toBe('');
    });
  });

  describe('Basic properties & capabilities', () => {
    it('declares DHAN brokerType and proper capabilities', () => {
      expect(adapter.brokerType).toBe(BrokerType.DHAN);
      expect(adapter.capabilities).toEqual({
        authorization: true,
        holdings: true,
        trades: true,
        quotes: true,
        tokenRefresh: false,
        revocation: true,
      });
    });
  });

  describe('getAuthorizationUrl', () => {
    it('generates consent and returns consent login URL when partner API responds with consentId', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ consentId: 'mock-consent-999' }),
      } as any);

      const urlString = await adapter.getAuthorizationUrl({
        state: 'csrf-state-123',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://auth.dhan.co');
      expect(url.pathname).toBe('/consent-login');
      expect(url.searchParams.get('consentId')).toBe('mock-consent-999');
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
    });

    it('falls back to standard login URL when generate consent is not available', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Not supported' }),
      } as any);

      const urlString = await adapter.getAuthorizationUrl({
        state: 'csrf-state-123',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://auth.dhan.co');
      expect(url.pathname).toBe('/consent-login');
      expect(url.searchParams.get('partner_id')).toBe('test-dhan-partner-id');
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
    });

    it('throws BadRequestException if API key / partner_id is not configured', async () => {
      const emptyAdapter = new DhanBrokerAdapter({
        get: jest.fn().mockReturnValue(undefined),
      } as any);

      await expect(
        emptyAdapter.getAuthorizationUrl({ state: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges tokenId for access token and returns normalized tokens', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          accessToken: 'mock-dhan-jwt-token',
          dhanClientId: 'DHAN_10001',
        }),
      } as any);

      const tokens = await adapter.exchangeAuthorizationCode({
        code: 'mock-token-id-123',
      });

      expect(tokens).toEqual({
        accessToken: 'mock-dhan-jwt-token',
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      });
    });

    it('throws BadRequestException if token exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ errorMessage: 'Invalid tokenId or expired' }),
      } as any);

      await expect(
        adapter.exchangeAuthorizationCode({ code: 'bad-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProfile', () => {
    it('returns normalized profile object', async () => {
      const profile = await adapter.getProfile(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(profile).toEqual({
        brokerAccountId: 'acc-uuid-1',
        clientId: null,
        displayName: null,
        email: null,
      });
    });
  });

  describe('getHoldings', () => {
    it('fetches Dhan holdings and normalizes primarily by ISIN', async () => {
      const mockHoldingsResponse = [
        {
          exchange: 'NSE',
          isin: 'INE002A01018',
          tradingSymbol: 'RELIANCE',
          totalQty: 50,
          dpQty: 50,
          t1Qty: 0,
          availableQty: 50,
          avgCostPrice: 500.0,
          lastPrice: 650.0,
          pnl: 7500.0,
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockHoldingsResponse,
      } as any);

      const holdings = await adapter.getHoldings(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(holdings).toHaveLength(1);
      expect(holdings[0]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 50,
          averagePrice: 500.0,
          lastPrice: 650.0,
          currentValue: 32500.0,
          unrealizedPnl: 7500.0,
        }),
      );
    });

    it('throws BadRequestException if fetch fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ errorMessage: 'Internal Dhan Error' }),
      } as any);

      await expect(
        adapter.getHoldings({ accessToken: 'mock-token' }, 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTrades', () => {
    it('fetches Dhan trades and normalizes side, quantity, price, and ISIN', async () => {
      const mockTradesResponse = [
        {
          exchangeTradeId: 'dhan-trade-001',
          orderId: 'dhan-ord-001',
          exchange: 'NSE',
          isin: 'INE002A01018',
          tradingSymbol: 'RELIANCE',
          transactionType: 'SELL',
          tradedQuantity: 50,
          tradedPrice: 700.0,
          exchangeTime: '2026-09-22T10:15:30Z',
        },
      ];

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTradesResponse,
      } as any);

      const trades = await adapter.getTrades(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(trades).toHaveLength(1);
      expect(trades[0]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'dhan-trade-001',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.SELL,
          quantity: 50,
          price: 700.0,
          tradedAt: new Date('2026-09-22T10:15:30Z'),
        }),
      );
    });

    it('throws BadRequestException if trades request fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ errorMessage: 'Session expired' }),
      } as any);

      await expect(
        adapter.getTrades({ accessToken: 'mock-token' }, 'acc-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getQuote', () => {
    it('fetches quote and returns normalized quote data', async () => {
      const mockQuoteResponse = {
        data: {
          NSE_EQ: {
            INE002A01018: {
              last_price: 720.0,
              tradingSymbol: 'RELIANCE',
            },
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockQuoteResponse,
      } as any);

      const quote = await adapter.getQuote(
        { accessToken: 'mock-token' },
        'INE002A01018',
        ExchangeListing.NSE,
      );

      expect(quote).toEqual(
        expect.objectContaining({
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          lastPrice: 720.0,
        }),
      );
    });
  });
});
