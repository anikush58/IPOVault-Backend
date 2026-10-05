import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { UpstoxBrokerAdapter, extractIsinFromInstrumentKey } from './upstox.adapter';

describe('UpstoxBrokerAdapter', () => {
  let adapter: UpstoxBrokerAdapter;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;

  // Save global fetch
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'UPSTOX_BASE_URL') return 'https://api.upstox.com/v2';
        if (key === 'UPSTOX_API_KEY') return 'test-upstox-api-key';
        if (key === 'UPSTOX_API_SECRET') return 'test-upstox-api-secret';
        if (key === 'UPSTOX_REDIRECT_URI')
          return 'https://app.example.com/callback/upstox';
        return undefined;
      }) as any,
    };

    adapter = new UpstoxBrokerAdapter(
      mockConfigService as any,
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('extractIsinFromInstrumentKey helper', () => {
    it('correctly extracts ISIN from pipe, colon, or plain strings', () => {
      expect(extractIsinFromInstrumentKey('NSE_EQ|INE002A01018')).toBe(
        'INE002A01018',
      );
      expect(extractIsinFromInstrumentKey('BSE_EQ:INE123A01010')).toBe(
        'INE123A01010',
      );
      expect(extractIsinFromInstrumentKey('INE002A01018')).toBe('INE002A01018');
      expect(extractIsinFromInstrumentKey('')).toBe('');
      expect(extractIsinFromInstrumentKey(null)).toBe('');
    });
  });

  describe('Basic properties & capabilities', () => {
    it('declares UPSTOX brokerType and proper capabilities', () => {
      expect(adapter.brokerType).toBe(BrokerType.UPSTOX);
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
        scopes: ['read', 'orders'],
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://api.upstox.com');
      expect(url.pathname).toBe('/v2/login/authorization/dialog');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe('test-upstox-api-key');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://app.example.com/custom-redirect',
      );
      expect(url.searchParams.get('state')).toBe('csrf-state-123');
      expect(url.searchParams.get('scope')).toBe('read orders');
    });

    it('defaults to fixed production HTTPS redirect URL when custom scheme is passed', async () => {
      const defaultAdapter = new UpstoxBrokerAdapter({
        get: jest.fn((key: string) => {
          if (key === 'UPSTOX_API_KEY') return 'test-upstox-api-key';
          return undefined;
        }),
      } as any);

      const urlString = await defaultAdapter.getAuthorizationUrl({
        state: 'csrf-state-456',
        redirectUri: 'ipovault://broker-callback',
      });

      const url = new URL(urlString);
      expect(url.searchParams.get('client_id')).toBe('test-upstox-api-key');
      expect(url.searchParams.get('state')).toBe('csrf-state-456');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://api.getipovault.in/api/v1/broker-accounts/connect/upstox/callback',
      );
    });

    it('throws BadRequestException if API key is not configured', async () => {
      const emptyAdapter = new UpstoxBrokerAdapter({
        get: jest.fn().mockReturnValue(undefined),
      } as any);

      await expect(
        emptyAdapter.getAuthorizationUrl({ state: '123' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('exchanges code for access token and returns normalized tokens', async () => {
      const mockTokenResponse = {
        email: 'investor@example.com',
        exchanges: ['NSE', 'BSE'],
        products: ['D', 'I'],
        broker: 'UPSTOX',
        user_id: 'UP12345',
        user_name: 'John Doe',
        user_type: 'individual',
        is_active: true,
        access_token: 'upstox-access-token-xyz',
        extended_token: 'extended-refresh-abc',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockTokenResponse),
      });

      const tokens = await adapter.exchangeAuthorizationCode({
        code: 'auth-code-123',
        redirectUri: 'https://app.example.com/callback/upstox',
      });

      expect(tokens).toEqual({
        accessToken: 'upstox-access-token-xyz',
        refreshToken: 'extended-refresh-abc',
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: ['D', 'I'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.upstox.com/v2/login/authorization/token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        }),
      );
    });

    it('throws BadRequestException when token exchange response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: jest
          .fn()
          .mockResolvedValue({ message: 'Invalid authorization code' }),
      });

      await expect(
        adapter.exchangeAuthorizationCode({
          code: 'bad-code',
          redirectUri: 'https://app.example.com/callback/upstox',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('rejects with BadRequestException since Upstox API v2 tokens are valid for the day without refresh', async () => {
      await expect(
        adapter.refreshToken({ refreshToken: 'any-token' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getProfile', () => {
    it('fetches and maps profile response to BrokerProfile', async () => {
      const mockProfileResponse = {
        status: 'success',
        data: {
          email: 'investor@example.com',
          exchanges: ['NSE', 'BSE'],
          products: ['D', 'I'],
          broker: 'UPSTOX',
          user_id: 'UP8888',
          user_name: 'Anish Kushwaha',
          user_type: 'individual',
          is_active: true,
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockProfileResponse),
      });

      const profile = await adapter.getProfile(
        { accessToken: 'valid-token' },
        'acc-uuid-1',
      );

      expect(profile).toEqual({
        brokerAccountId: 'acc-uuid-1',
        clientId: 'UP8888',
        displayName: 'Anish Kushwaha',
        email: 'investor@example.com',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.upstox.com/v2/user/profile',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer valid-token',
          }),
        }),
      );
    });
  });

  describe('getHoldings', () => {
    it('fetches and normalizes portfolio holdings, matching by ISIN', async () => {
      const mockHoldingsResponse = {
        status: 'success',
        data: [
          {
            isin: 'INE002A01018',
            cnc_used_quantity: 0,
            collateral_type: null,
            company_name: 'RELIANCE INDUSTRIES LTD',
            haircut: 0.12,
            instrument_token: 'NSE_EQ|INE002A01018',
            trading_symbol: 'RELIANCE',
            last_price: 2450.0,
            pnl: 495.0,
            product: 'D',
            quantity: 10,
            average_price: 2400.5,
            close_price: 2400.5,
            exchange: 'NSE',
          },
          {
            isin: 'INE123B01015',
            company_name: 'TATA MOTORS LTD',
            instrument_token: 'BSE_EQ|INE123B01015',
            trading_symbol: 'TATAMOTORS',
            last_price: 700.0,
            pnl: -200.0,
            quantity: 20,
            average_price: 710.0,
            exchange: 'BSE',
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockHoldingsResponse),
      });

      const holdings = await adapter.getHoldings(
        { accessToken: 'valid-token' },
        'acc-uuid-1',
      );

      expect(holdings).toHaveLength(2);

      // Verify ISIN matching and normalized structure
      expect(holdings[0]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 10,
          averagePrice: 2400.5,
          lastPrice: 2450.0,
          currentValue: 24500.0,
          unrealizedPnl: 495.0,
          asOf: expect.any(Date),
        }),
      );

      expect(holdings[1]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-uuid-1',
          isin: 'INE123B01015',
          exchange: ExchangeListing.BSE,
          symbol: 'TATAMOTORS',
          quantity: 20,
          averagePrice: 710.0,
          lastPrice: 700.0,
          currentValue: 14000.0,
          unrealizedPnl: -200.0,
        }),
      );
    });
  });

  describe('getTrades', () => {
    it("fetches and normalizes today's trade executions", async () => {
      const mockTradesResponse = {
        status: 'success',
        data: [
          {
            trade_id: '2609220001',
            order_id: 'ORD12345',
            exchange: 'NSE',
            trading_symbol: 'RELIANCE',
            instrument_token: 'NSE_EQ|INE002A01018',
            isin: 'INE002A01018',
            transaction_type: 'BUY',
            quantity: 10,
            price: 2400.5,
            trade_timestamp: '2026-09-22 10:15:30',
          },
          {
            trade_id: '2609220002',
            order_id: 'ORD12346',
            exchange: 'BSE',
            trading_symbol: 'TATAMOTORS',
            instrument_token: 'BSE_EQ|INE123B01015',
            transaction_type: 'SELL',
            quantity: 5,
            price: 705.0,
            trade_timestamp: '2026-09-22 11:20:00',
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockTradesResponse),
      });

      const trades = await adapter.getTrades(
        { accessToken: 'valid-token' },
        'acc-uuid-1',
      );

      expect(trades).toHaveLength(2);

      expect(trades[0]).toEqual({
        brokerAccountId: 'acc-uuid-1',
        brokerTradeId: '2609220001',
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        side: BrokerTradeSide.BUY,
        quantity: 10,
        price: 2400.5,
        tradedAt: new Date('2026-09-22 10:15:30'),
      });

      expect(trades[1]).toEqual({
        brokerAccountId: 'acc-uuid-1',
        brokerTradeId: '2609220002',
        isin: 'INE123B01015',
        exchange: ExchangeListing.BSE,
        symbol: 'TATAMOTORS',
        side: BrokerTradeSide.SELL,
        quantity: 5,
        price: 705.0,
        tradedAt: new Date('2026-09-22 11:20:00'),
      });
    });
  });

  describe('getQuote and getQuotes', () => {
    it('fetches and normalizes market quote for an ISIN and exchange', async () => {
      const mockQuoteResponse = {
        status: 'success',
        data: {
          'NSE_EQ:INE002A01018': {
            last_price: 2450.0,
            symbol: 'RELIANCE',
            timestamp: '2026-09-22T10:30:00.000Z',
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockQuoteResponse),
      });

      const quote = await adapter.getQuote(
        { accessToken: 'valid-token' },
        'INE002A01018',
        ExchangeListing.NSE,
      );

      expect(quote).toEqual({
        isin: 'INE002A01018',
        exchange: ExchangeListing.NSE,
        symbol: 'RELIANCE',
        lastPrice: 2450.0,
        asOf: new Date('2026-09-22T10:30:00.000Z'),
      });
    });

    it('correctly maps Upstox response keyed by trading symbol (NSE_EQ:TATATECH) to requested ISIN (INE848E01016)', async () => {
      const mockQuoteResponse = {
        status: 'success',
        data: {
          'NSE_EQ:TATATECH': {
            last_price: 1045.5,
            instrument_token: 'NSE_EQ|INE848E01016',
            timestamp: '2026-10-04T10:30:00.000Z',
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockQuoteResponse),
      });

      const quote = await adapter.getQuote(
        { accessToken: 'valid-token' },
        'INE848E01016',
        ExchangeListing.NSE,
        'TATATECH',
      );

      expect(quote).toEqual({
        isin: 'INE848E01016',
        exchange: ExchangeListing.NSE,
        symbol: 'TATATECH',
        lastPrice: 1045.5,
        asOf: new Date('2026-10-04T10:30:00.000Z'),
      });
    });

    it('correctly matches quote when Upstox instrument_token contains ISIN (NSE_EQ|INE848E01016)', async () => {
      const mockQuoteResponse = {
        status: 'success',
        data: {
          '51834': {
            last_price: 1045.5,
            instrument_token: 'NSE_EQ|INE848E01016',
            symbol: 'TATATECH',
            timestamp: '2026-10-04T10:30:00.000Z',
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockQuoteResponse),
      });

      const quotes = await adapter.getQuotes({ accessToken: 'valid-token' }, [
        { isin: 'INE848E01016', symbol: 'TATATECH', exchange: ExchangeListing.NSE },
      ]);

      expect(quotes).toHaveLength(1);
      expect(quotes[0]).toEqual({
        isin: 'INE848E01016',
        exchange: ExchangeListing.NSE,
        symbol: 'TATATECH',
        lastPrice: 1045.5,
        asOf: new Date('2026-10-04T10:30:00.000Z'),
      });
    });

    it('fetches multiple quotes in bulk via getQuotes without mixing up instruments', async () => {
      const mockBulkResponse = {
        status: 'success',
        data: {
          'NSE_EQ:TATATECH': {
            last_price: 1045.5,
            instrument_token: 'NSE_EQ|INE848E01016',
            symbol: 'TATATECH',
          },
          'NSE_EQ:BELRISE': {
            last_price: 237.0,
            instrument_token: 'NSE_EQ|INE00AA01010',
            symbol: 'BELRISE',
          },
        },
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockBulkResponse),
      });

      const quotes = await adapter.getQuotes({ accessToken: 'valid-token' }, [
        { isin: 'INE848E01016', symbol: 'TATATECH', exchange: ExchangeListing.NSE },
        { isin: 'INE00AA01010', symbol: 'BELRISE', exchange: ExchangeListing.NSE },
      ]);

      expect(quotes).toHaveLength(2);
      expect(quotes[0].isin).toBe('INE848E01016');
      expect(quotes[0].lastPrice).toBe(1045.5);
      expect(quotes[1].isin).toBe('INE00AA01010');
      expect(quotes[1].lastPrice).toBe(237.0);
    });
  });

  describe('revokeConnection', () => {
    it('calls DELETE on token endpoint and completes gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ status: 'success' }),
      });

      await expect(
        adapter.revokeConnection({ accessToken: 'valid-token' }),
      ).resolves.not.toThrow();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.upstox.com/v2/login/authorization/token',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });
});
