import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import { Env } from '../../../config/env';
import { BrokerAdapter } from '../broker.adapter';
import {
  BrokerAuthTokens,
  BrokerCapabilities,
  BrokerProfile,
  ExchangeCodeParams,
  GetAuthorizationUrlParams,
  GetTradesOptions,
  NormalizedHolding,
  NormalizedQuote,
  NormalizedTrade,
  RefreshTokenParams,
} from '../broker.types';

export function extractIsinFromInstrumentKey(key?: string | null): string {
  if (!key) return '';
  const trimmed = key.trim();
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    return parts[1] || parts[0];
  }
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    return parts[1] || parts[0];
  }
  return trimmed;
}

@Injectable()
export class UpstoxBrokerAdapter implements BrokerAdapter {
  private readonly logger = new Logger(UpstoxBrokerAdapter.name);

  readonly brokerType: BrokerType = BrokerType.UPSTOX;

  readonly capabilities: BrokerCapabilities = {
    authorization: true,
    holdings: true,
    trades: true,
    quotes: true,
    tokenRefresh: false,
    revocation: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly redirectUri?: string;

  constructor(
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {
    this.baseUrl =
      this.configService?.get('UPSTOX_BASE_URL', { infer: true }) ||
      'https://api.upstox.com/v2';
    this.apiKey = this.configService?.get('UPSTOX_API_KEY', { infer: true });
    this.apiSecret = this.configService?.get('UPSTOX_API_SECRET', {
      infer: true,
    });
    this.redirectUri =
      this.configService?.get('UPSTOX_REDIRECT_URI', {
        infer: true,
      }) ||
      'https://api.getipovault.in/api/v1/broker-accounts/connect/upstox/callback';
  }

  /**
   * Validates that Upstox API credentials are configured.
   */
  validateConfiguration(): void {
    if (!this.apiKey) {
      throw new BadRequestException(
        'Upstox API key / client_id is not configured',
      );
    }
  }

  /**
   * Generates Upstox OAuth 2.0 authorization dialog URL with fixed HTTPS redirect URL.
   */
  async getAuthorizationUrl(
    params: GetAuthorizationUrlParams,
  ): Promise<string> {
    this.validateConfiguration();
    const redirectUri =
      params.redirectUri && params.redirectUri.startsWith('https://')
        ? params.redirectUri
        : this.redirectUri;
    const clientId = this.apiKey!;
    if (!redirectUri) {
      throw new BadRequestException('Upstox redirectUri is required');
    }

    const url = new URL(`${this.baseUrl}/login/authorization/dialog`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', params.state);

    if (params.scopes && params.scopes.length > 0) {
      url.searchParams.set('scope', params.scopes.join(' '));
    }

    return url.toString();
  }

  /**
   * Exchanges an authorization code for an Upstox access token.
   * Never logs authorization codes or client secrets.
   */
  async exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens> {
    const clientId = this.apiKey;
    const clientSecret = this.apiSecret;
    const redirectUri =
      params.redirectUri && params.redirectUri.startsWith('https://')
        ? params.redirectUri
        : this.redirectUri;

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        'Upstox API credentials (client_id / client_secret) are not configured',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Authorization code is required');
    }
    if (!redirectUri) {
      throw new BadRequestException('Redirect URI is required');
    }

    const tokenUrl = `${this.baseUrl}/login/authorization/token`;
    const formBody = new URLSearchParams();
    formBody.set('code', params.code);
    formBody.set('client_id', clientId);
    formBody.set('client_secret', clientSecret);
    formBody.set('redirect_uri', redirectUri);
    formBody.set('grant_type', 'authorization_code');

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody.toString(),
      });

      const responseData = (await response.json()) as Record<string, any>;

      if (!response.ok || !responseData.access_token) {
        const errorMsg =
          responseData.message ||
          responseData.error_description ||
          responseData.error ||
          `Token exchange failed with status ${response.status}`;
        this.logger.warn(`Upstox token exchange failed: ${errorMsg}`);
        throw new BadRequestException(`Upstox authentication failed: ${errorMsg}`);
      }

      return {
        accessToken: responseData.access_token,
        refreshToken: responseData.extended_token || null,
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: Array.isArray(responseData.products)
          ? responseData.products
          : null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox token exchange unexpected error: ${msg}`);
      throw new BadRequestException('Failed to exchange Upstox authorization code');
    }
  }

  /**
   * Upstox API v2 does not support token refresh (tokens are valid for trading day).
   */
  async refreshToken(_params: RefreshTokenParams): Promise<BrokerAuthTokens> {
    throw new BadRequestException(
      'Upstox API v2 does not support token refresh; re-authorization is required',
    );
  }

  /**
   * Retrieves user profile information from Upstox.
   */
  async getProfile(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<BrokerProfile> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/user/profile`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Profile request failed with status ${response.status}`;
        throw new BadRequestException(`Upstox profile fetch failed: ${errorMsg}`);
      }

      const data = json.data || json;

      return {
        brokerAccountId,
        clientId: data.user_id || data.userId || null,
        displayName: data.user_name || data.userName || null,
        email: data.email || null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox getProfile error: ${msg}`);
      throw new BadRequestException('Failed to fetch Upstox user profile');
    }
  }

  /**
   * Fetches long-term portfolio holdings from Upstox, matching primarily by ISIN.
   */
  async getHoldings(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<NormalizedHolding[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/portfolio/long-term-holdings`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Holdings request failed with status ${response.status}`;
        throw new BadRequestException(`Upstox holdings fetch failed: ${errorMsg}`);
      }

      const items: any[] = Array.isArray(json.data) ? json.data : [];
      const asOf = new Date();

      return items
        .map((item): NormalizedHolding | null => {
          const isin = (
            item.isin || extractIsinFromInstrumentKey(item.instrument_token)
          )?.trim();

          if (!isin) {
            return null;
          }

          const exchangeStr = (item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            exchangeStr === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const quantity = Number(item.quantity ?? 0);
          const averagePrice =
            item.average_price != null ? Number(item.average_price) : null;
          const lastPrice =
            item.last_price != null ? Number(item.last_price) : null;
          const currentValue =
            lastPrice != null && quantity > 0 ? quantity * lastPrice : null;
          const unrealizedPnl = item.pnl != null ? Number(item.pnl) : null;

          return {
            brokerAccountId,
            isin,
            exchange,
            symbol: item.trading_symbol || item.symbol || null,
            quantity,
            averagePrice,
            lastPrice,
            currentValue,
            unrealizedPnl,
            asOf,
          };
        })
        .filter((h): h is NormalizedHolding => h !== null);
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox getHoldings error: ${msg}`);
      throw new BadRequestException('Failed to fetch Upstox holdings');
    }
  }

  /**
   * Fetches today's trade book executions from Upstox.
   */
  async getTrades(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
    _options?: GetTradesOptions,
  ): Promise<NormalizedTrade[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/order/trades/get-trades-for-day`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Trades request failed with status ${response.status}`;
        throw new BadRequestException(`Upstox trades fetch failed: ${errorMsg}`);
      }

      const items: any[] = Array.isArray(json.data) ? json.data : [];

      return items
        .map((item): NormalizedTrade | null => {
          const isin = (
            item.isin || extractIsinFromInstrumentKey(item.instrument_token)
          )?.trim();

          if (!isin) {
            return null;
          }

          const exchangeStr = (item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            exchangeStr === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const txnType = (item.transaction_type || '').trim().toUpperCase();
          const side =
            txnType === 'SELL' ? BrokerTradeSide.SELL : BrokerTradeSide.BUY;

          const quantity = Number(item.quantity ?? 0);
          const price = Number(item.price ?? 0);
          const tradeId = String(
            item.trade_id || item.order_id || `${isin}_${Date.now()}`,
          );

          let tradedAt = new Date();
          if (item.trade_timestamp) {
            const parsed = new Date(item.trade_timestamp);
            if (!isNaN(parsed.getTime())) {
              tradedAt = parsed;
            }
          }

          return {
            brokerAccountId,
            brokerTradeId: tradeId,
            isin,
            exchange,
            symbol: item.trading_symbol || item.symbol || null,
            side,
            quantity,
            price,
            tradedAt,
          };
        })
        .filter((t): t is NormalizedTrade => t !== null);
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox getTrades error: ${msg}`);
      throw new BadRequestException("Failed to fetch Upstox today's trades");
    }
  }

  /**
   * Fetches real-time market quote from Upstox for an instrument key.
   */
  async getQuote(
    tokens: BrokerAuthTokens,
    isin: string,
    exchange: ExchangeListing,
  ): Promise<NormalizedQuote> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }
    if (!isin || !isin.trim()) {
      throw new BadRequestException('ISIN is required for quote');
    }

    const exchSegment = exchange === ExchangeListing.BSE ? 'BSE_EQ' : 'NSE_EQ';
    const instrumentKey = `${exchSegment}|${isin.trim()}`;
    const url = `${this.baseUrl}/market-quote/quotes?instrument_key=${encodeURIComponent(
      instrumentKey,
    )}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Quote request failed with status ${response.status}`;
        throw new BadRequestException(`Upstox quote fetch failed: ${errorMsg}`);
      }

      const quoteData =
        json.data?.[`${exchSegment}:${isin.trim()}`] ||
        json.data?.[instrumentKey] ||
        Object.values(json.data || {})[0] ||
        {};

      const lastPrice = Number(
        (quoteData as any).last_price ?? (quoteData as any).lastPrice ?? 0,
      );

      let asOf = new Date();
      if ((quoteData as any).timestamp) {
        const parsed = new Date((quoteData as any).timestamp);
        if (!isNaN(parsed.getTime())) {
          asOf = parsed;
        }
      }

      return {
        isin: isin.trim(),
        exchange,
        symbol: (quoteData as any).symbol || null,
        lastPrice,
        asOf,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox getQuote error: ${msg}`);
      throw new BadRequestException('Failed to fetch Upstox market quote');
    }
  }

  /**
   * Explicitly revokes the Upstox access token.
   */
  async revokeConnection(tokens: BrokerAuthTokens): Promise<void> {
    if (!tokens.accessToken) return;

    const url = `${this.baseUrl}/login/authorization/token`;

    try {
      await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Upstox revokeConnection warning: ${msg}`);
    }
  }
}
