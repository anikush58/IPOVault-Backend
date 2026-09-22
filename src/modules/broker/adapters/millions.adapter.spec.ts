import { BrokerType, ExchangeListing } from '@prisma/client';
import { MillionsBrokerAdapter } from './millions.adapter';
import { DhanBrokerAdapter } from './dhan.adapter';

describe('MillionsBrokerAdapter', () => {
  let adapter: MillionsBrokerAdapter;
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
          return 'https://app.example.com/callback/millions';
        return undefined;
      }),
    };

    adapter = new MillionsBrokerAdapter(mockConfigService as any);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('Inheritance & Properties', () => {
    it('extends DhanBrokerAdapter and declares MILLIONS brokerType', () => {
      expect(adapter).toBeInstanceOf(DhanBrokerAdapter);
      expect(adapter.brokerType).toBe(BrokerType.MILLIONS);
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

  describe('Reuses DhanHQ API flows', () => {
    it('generates DhanHQ authorization URL with Millions configuration', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            consentId: 'dhan-consent-123',
            consentUrl: 'https://auth.dhan.co/consent-login?consentId=dhan-consent-123',
          },
        }),
      } as any);

      const url = await adapter.getAuthorizationUrl({ state: 'mock-state' });
      expect(url).toContain('https://auth.dhan.co');
    });

    it('fetches holdings and normalizes via shared Dhan logic', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            isin: 'INE002A01018',
            tradingSymbol: 'RELIANCE',
            exchange: 'NSE',
            totalQty: 25,
            avgCostPrice: 500.0,
            lastPrice: 600.0,
          },
        ],
      } as any);

      const holdings = await adapter.getHoldings(
        { accessToken: 'mock-token' },
        'acc-millions-1',
      );

      expect(holdings).toHaveLength(1);
      expect(holdings[0]).toEqual(
        expect.objectContaining({
          brokerAccountId: 'acc-millions-1',
          isin: 'INE002A01018',
          exchange: ExchangeListing.NSE,
          symbol: 'RELIANCE',
          quantity: 25,
          averagePrice: 500.0,
          lastPrice: 600.0,
          currentValue: 15000.0,
        }),
      );
    });
  });
});
