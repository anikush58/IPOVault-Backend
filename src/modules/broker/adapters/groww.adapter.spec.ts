import { BadRequestException } from '@nestjs/common';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { GrowwBrokerAdapter, extractIsinFromGroww } from './groww.adapter';

describe('GrowwBrokerAdapter', () => {
  let adapter: GrowwBrokerAdapter;
  let mockConfigService: any;

  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'GROWW_BASE_URL') return 'https://api.groww.in/v1';
        if (key === 'GROWW_AUTH_BASE_URL') return 'https://groww.in/oauth';
        if (key === 'GROWW_API_KEY') return 'test-groww-api-key';
        if (key === 'GROWW_API_SECRET') return 'test-groww-api-secret';
        if (key === 'GROWW_REDIRECT_URI')
          return 'https://app.example.com/callback/groww';
        return undefined;
      }),
    };

    adapter = new GrowwBrokerAdapter(mockConfigService as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractIsinFromGroww helper', () => {
    it('extracts ISIN from pipe, colon, or plain INE string', () => {
      expect(extractIsinFromGroww('NSE_EQ|INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromGroww('NSE:INE002A01018-EQ')).toBe('INE002A01018');
      expect(extractIsinFromGroww('INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromGroww('')).toBe('');
      expect(extractIsinFromGroww(null)).toBe('');
    });
  });

  describe('Basic properties & capabilities', () => {
    it('declares GROWW brokerType and proper capabilities', () => {
      expect(adapter.brokerType).toBe(BrokerType.GROWW);
      expect(adapter.capabilities).toEqual({
        authorization: true,
        holdings: true,
        trades: true,
        quotes: true,
        tokenRefresh: true,
        revocation: true,
      });
    });
  });

  describe('getAuthorizationUrl', () => {
    it('generates a valid Groww OAuth authorization URL with configured parameters', async () => {
      const urlString = await adapter.getAuthorizationUrl({
        state: 'csrf-state-123',
        redirectUri: 'https://app.example.com/custom-redirect',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://groww.in');
      expect(url.pathname).toBe('/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('test-groww-api-key');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/custom-redirect',
      );
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
    });

    it('throws BadRequestException if API key is not configured', async () => {
      const emptyAdapter = new GrowwBrokerAdapter({
        get: jest.fn().mockReturnValue(undefined),
      } as any);

      await expect(
        emptyAdapter.getAuthorizationUrl({ state: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges code for access token and refresh token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'SUCCESS',
          data: {
            access_token: 'mock-groww-access-token',
            refresh_token: 'mock-groww-refresh-token',
            expires_in: 86400,
          },
        }),
      } as any);

      const tokens = await adapter.exchangeAuthorizationCode({
        code: 'valid-groww-code',
      });

      expect(tokens.accessToken).toBe('mock-groww-access-token');
      expect(tokens.refreshToken).toBe('mock-groww-refresh-token');
      expect(tokens.tokenType).toBe('Bearer');
      expect(tokens.expiresAt).toBeInstanceOf(Date);
    });

    it('throws BadRequestException if token exchange fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          status: 'ERROR',
          message: 'Invalid authorization code',
        }),
      } as any);

      await expect(
        adapter.exchangeAuthorizationCode({ code: 'bad-code' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('refreshes token and returns new tokens', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'SUCCESS',
          data: {
            access_token: 'new-mock-groww-access-token',
            refresh_token: 'new-mock-groww-refresh-token',
            expires_in: 86400,
          },
        }),
      } as any);

      const tokens = await adapter.refreshToken({
        refreshToken: 'old-groww-refresh-token',
      });

      expect(tokens.accessToken).toBe('new-mock-groww-access-token');
      expect(tokens.refreshToken).toBe('new-mock-groww-refresh-token');
    });
  });

  describe('getProfile', () => {
    it('fetches profile and normalizes fields', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'SUCCESS',
          data: {
            client_id: 'GW12345',
            name: 'Groww Trader',
            email: 'trader@example.com',
          },
        }),
      } as any);

      const profile = await adapter.getProfile(
        { accessToken: 'mock-token' },
        'acc-uuid-1',
      );

      expect(profile).toEqual({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'GW12345',
        displayName: 'Groww Trader',
        email: 'trader@example.com',
      });
    });
  });

  describe('getHoldings', () => {
    it('fetches Groww holdings and normalizes primarily by ISIN', async () => {
      const mockHoldingsResponse = {
        status: 'SUCCESS',
        data: {
          holdings: [
            {
              isin: 'INE002A01018',
              trading_symbol: 'RELIANCE',
              exchange: 'NSE',
              quantity: 50,
              average_price: 500.0,
              last_price: 650.0,
              pnl: 7500.0,
            },
          ],
        },
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
    it('fetches Groww executed trades and normalizes side, quantity, price, and ISIN', async () => {
      const mockTradesResponse = {
        status: 'SUCCESS',
        data: {
          trades: [
            {
              trade_id: 'groww-trade-001',
              isin: 'INE002A01018',
              trading_symbol: 'RELIANCE',
              exchange: 'NSE',
              transaction_type: 'SELL',
              quantity: 50,
              price: 700.0,
              trade_time: '2026-09-22 10:15:30',
            },
          ],
        },
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
          brokerTradeId: 'groww-trade-001',
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
    it('fetches market quote from Groww and normalizes quote data', async () => {
      const mockQuoteResponse = {
        status: 'SUCCESS',
        data: {
          symbol: 'NSE:INE002A01018',
          last_price: 720.0,
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
          lastPrice: 720.0,
        }),
      );
    });
  });
});
