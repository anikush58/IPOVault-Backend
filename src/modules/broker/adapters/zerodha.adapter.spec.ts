import { BadRequestException } from '@nestjs/common';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { ZerodhaBrokerAdapter, extractIsinFromZerodha } from './zerodha.adapter';

describe('ZerodhaBrokerAdapter', () => {
  let adapter: ZerodhaBrokerAdapter;
  let mockConfigService: any;

  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'ZERODHA_BASE_URL') return 'https://api.kite.trade';
        if (key === 'ZERODHA_LOGIN_URL')
          return 'https://kite.zerodha.com/connect/login';
        if (key === 'ZERODHA_API_KEY') return 'test-kite-api-key';
        if (key === 'ZERODHA_API_SECRET') return 'test-kite-api-secret';
        if (key === 'ZERODHA_REDIRECT_URI')
          return 'https://app.example.com/callback/zerodha';
        return undefined;
      }),
    };

    adapter = new ZerodhaBrokerAdapter(mockConfigService as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractIsinFromZerodha helper', () => {
    it('extracts ISIN from pipe, colon, or plain INE string', () => {
      expect(extractIsinFromZerodha('NSE_EQ|INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromZerodha('NSE:INE002A01018-EQ')).toBe('INE002A01018');
      expect(extractIsinFromZerodha('INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromZerodha('')).toBe('');
      expect(extractIsinFromZerodha(null)).toBe('');
    });
  });

  describe('Basic properties & capabilities', () => {
    it('declares ZERODHA brokerType and proper capabilities for free Personal plan', () => {
      expect(adapter.brokerType).toBe(BrokerType.ZERODHA);
      expect(adapter.capabilities).toEqual({
        authorization: true,
        holdings: true,
        trades: true,
        quotes: false,
        tokenRefresh: false,
        revocation: true,
      });
    });
  });

  describe('getAuthorizationUrl', () => {
    it('generates a valid Kite Connect login authorization URL with configured parameters', async () => {
      const urlString = await adapter.getAuthorizationUrl({
        state: 'csrf-state-123',
        redirectUri: 'https://app.example.com/custom-redirect',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://kite.zerodha.com');
      expect(url.pathname).toBe('/connect/login');
      expect(url.searchParams.get('api_key')).toBe('test-kite-api-key');
      expect(url.searchParams.get('v')).toBe('3');
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
      expect(url.searchParams.get('redirect_params')).toBe(
        'state=csrf-state-123',
      );
    });

    it('throws BadRequestException if API key is not configured', async () => {
      const emptyAdapter = new ZerodhaBrokerAdapter({
        get: jest.fn().mockReturnValue(undefined),
      } as any);

      await expect(
        emptyAdapter.getAuthorizationUrl({ state: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges request_token with SHA-256 checksum and returns normalized tokens', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            user_id: 'XX0000',
            user_name: 'Test Zerodha User',
            email: 'zerodha@example.com',
            access_token: 'mock-kite-access-token',
            public_token: 'mock-kite-public-token',
            refresh_token: 'mock-kite-refresh-token',
          },
        }),
      } as any);

      const tokens = await adapter.exchangeAuthorizationCode({
        code: 'valid-kite-request-token',
      });

      expect(tokens).toEqual({
        accessToken: 'mock-kite-access-token',
        refreshToken: 'mock-kite-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      });
    });

    it('throws BadRequestException if token exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'error',
          message: 'Token exception: Invalid checksum or token expired',
        }),
      } as any);

      await expect(
        adapter.exchangeAuthorizationCode({ code: 'bad-request-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProfile', () => {
    it('fetches profile and normalizes fields', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            user_id: 'ZD12345',
            user_name: 'Zerodha Investor',
            email: 'investor@example.com',
          },
        }),
      } as any);

      const profile = await adapter.getProfile(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(profile).toEqual({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'ZD12345',
        displayName: 'Zerodha Investor',
        email: 'investor@example.com',
      });
    });
  });

  describe('getHoldings', () => {
    it('fetches Kite holdings and normalizes primarily by ISIN', async () => {
      const mockHoldingsResponse = {
        status: 'success',
        data: [
          {
            isin: 'INE002A01018',
            tradingsymbol: 'RELIANCE',
            exchange: 'NSE',
            quantity: 50,
            t1_quantity: 10,
            average_price: 500.0,
            last_price: 650.0,
            pnl: 9000.0,
          },
        ],
      };

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
          quantity: 60,
          averagePrice: 500.0,
          lastPrice: 650.0,
          currentValue: 39000.0,
          unrealizedPnl: 9000.0,
        }),
      );
    });
  });

  describe('getTrades', () => {
    it('fetches Kite executed trades and normalizes side, quantity, price, and ISIN', async () => {
      const mockTradesResponse = {
        status: 'success',
        data: [
          {
            trade_id: 'kite-trade-001',
            isin: 'INE002A01018',
            tradingsymbol: 'RELIANCE',
            exchange: 'NSE',
            transaction_type: 'SELL',
            quantity: 50,
            average_price: 700.0,
            fill_timestamp: '2026-09-22 10:15:30',
          },
        ],
      };

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
          brokerTradeId: 'kite-trade-001',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          side: BrokerTradeSide.SELL,
          quantity: 50,
          price: 700.0,
        }),
      );
    });
  });

  describe('getQuote', () => {
    it('throws BadRequestException indicating quote lookups are not supported on free Personal plan', async () => {
      await expect(
        adapter.getQuote(
          { accessToken: 'mock-token' },
          'INE002A01018',
          ExchangeListing.NSE,
        ),
      ).rejects.toThrow(
        'Zerodha Kite Connect Personal plan does not support real-time quote lookups',
      );
    });
  });
});
