import { BadRequestException } from '@nestjs/common';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { FyersBrokerAdapter, extractIsinFromFyers } from './fyers.adapter';

describe('FyersBrokerAdapter', () => {
  let adapter: FyersBrokerAdapter;
  let mockConfigService: any;

  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'FYERS_BASE_URL') return 'https://api-t1.fyers.in/api/v3';
        if (key === 'FYERS_APP_ID') return 'test-fyers-app-id';
        if (key === 'FYERS_SECRET_KEY') return 'test-fyers-secret-key';
        if (key === 'FYERS_REDIRECT_URI')
          return 'https://app.example.com/callback/fyers';
        return undefined;
      }),
    };

    adapter = new FyersBrokerAdapter(mockConfigService as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractIsinFromFyers helper', () => {
    it('extracts ISIN from pipe, colon, or plain INE string', () => {
      expect(extractIsinFromFyers('NSE_EQ|INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromFyers('NSE:INE002A01018-EQ')).toBe('INE002A01018');
      expect(extractIsinFromFyers('INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromFyers('')).toBe('');
      expect(extractIsinFromFyers(null)).toBe('');
    });
  });

  describe('Basic properties & capabilities', () => {
    it('declares FYERS brokerType and proper capabilities', () => {
      expect(adapter.brokerType).toBe(BrokerType.FYERS);
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
    it('generates a valid OAuth authorization URL with configured parameters', async () => {
      const urlString = await adapter.getAuthorizationUrl({
        state: 'csrf-state-123',
        redirectUri: 'https://app.example.com/custom-redirect',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://api-t1.fyers.in');
      expect(url.pathname).toBe('/api/v3/generate-authcode');
      expect(url.searchParams.get('client_id')).toBe('test-fyers-app-id');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/custom-redirect',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
    });

    it('throws BadRequestException if app ID is not configured', async () => {
      const emptyAdapter = new FyersBrokerAdapter({
        get: jest.fn().mockReturnValue(undefined),
      } as any);

      await expect(
        emptyAdapter.getAuthorizationUrl({ state: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges code with SHA-256 appIdHash and returns normalized tokens', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          s: 'ok',
          code: 200,
          access_token: 'mock-fyers-access-token',
          refresh_token: 'mock-fyers-refresh-token',
        }),
      } as any);

      const tokens = await adapter.exchangeAuthorizationCode({
        code: 'valid-fyers-auth-code',
      });

      expect(tokens).toEqual({
        accessToken: 'mock-fyers-access-token',
        refreshToken: 'mock-fyers-refresh-token',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      });
    });

    it('throws BadRequestException if token validation fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid auth code' }),
      } as any);

      await expect(
        adapter.exchangeAuthorizationCode({ code: 'bad-code' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProfile', () => {
    it('fetches profile and normalizes fields', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          s: 'ok',
          data: {
            fy_id: 'FY12345',
            name: 'Fyers Trader',
            email_id: 'trader@example.com',
          },
        }),
      } as any);

      const profile = await adapter.getProfile(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(profile).toEqual({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'FY12345',
        displayName: 'Fyers Trader',
        email: 'trader@example.com',
      });
    });
  });

  describe('getHoldings', () => {
    it('fetches FYERS holdings and normalizes primarily by ISIN', async () => {
      const mockHoldingsResponse = {
        s: 'ok',
        holdings: [
          {
            isin: 'INE002A01018',
            symbol: 'NSE:RELIANCE-EQ',
            quantity: 50,
            costPrice: 500.0,
            ltp: 650.0,
            pl: 7500.0,
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
          quantity: 50,
          averagePrice: 500.0,
          lastPrice: 650.0,
          currentValue: 32500.0,
          unrealizedPnl: 7500.0,
        }),
      );
    });
  });

  describe('getTrades', () => {
    it('fetches FYERS tradebook and normalizes side, quantity, price, and ISIN', async () => {
      const mockTradebookResponse = {
        s: 'ok',
        tradeBook: [
          {
            id: 'fyers-trade-001',
            isin: 'INE002A01018',
            symbol: 'NSE:RELIANCE-EQ',
            side: -1, // SELL
            tradedQty: 50,
            tradePrice: 700.0,
            orderDateTime: '2026-09-22 10:15:30',
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTradebookResponse,
      } as any);

      const trades = await adapter.getTrades(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(trades).toHaveLength(1);
      expect(trades[0]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-uuid-1',
          brokerTradeId: 'fyers-trade-001',
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
    it('fetches market quote from FYERS and normalizes quote data', async () => {
      const mockQuoteResponse = {
        s: 'ok',
        d: [
          {
            n: 'NSE:INE002A01018-EQ',
            s: 'ok',
            v: {
              lp: 720.0,
            },
          },
        ],
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
          lastPrice: 720.0,
        }),
      );
    });
  });
});
