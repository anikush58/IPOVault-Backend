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

export function extractIsinFromGroww(symbolOrKey?: string | null): string {
  if (!symbolOrKey) return '';
  const trimmed = symbolOrKey.trim();
  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    return (parts[1] || parts[0]).replace(/-EQ$/i, '');
  }
  const clean = trimmed.replace(/^(NSE|BSE):/i, '').replace(/-EQ$/i, '');
  if (clean.startsWith('INE')) return clean;
  return '';
}

@Injectable()
export class GrowwBrokerAdapter implements BrokerAdapter {
  private readonly logger = new Logger(GrowwBrokerAdapter.name);

  readonly brokerType: BrokerType = BrokerType.GROWW;

  readonly capabilities: BrokerCapabilities = {
    authorization: true,
    holdings: true,
    trades: true,
    quotes: true,
    tokenRefresh: true,
    revocation: true,
  };

  private readonly baseUrl: string;
  private readonly authBaseUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly redirectUri?: string;

  constructor(
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {
    this.baseUrl =
      this.configService?.get('GROWW_BASE_URL', { infer: true }) ||
      'https://api.groww.in/v1';
    this.authBaseUrl =
      this.configService?.get('GROWW_AUTH_BASE_URL', { infer: true }) ||
      'https://groww.in/oauth';
    this.apiKey = this.configService?.get('GROWW_API_KEY', { infer: true });
    this.apiSecret = this.configService?.get('GROWW_API_SECRET', {
      infer: true,
    });
    this.redirectUri = this.configService?.get('GROWW_REDIRECT_URI', {
      infer: true,
    });
  }

  private getAuthHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'X-API-KEY': this.apiKey || '',
      Accept: 'application/json',
    };
  }

  /**
   * Validates that Groww API credentials are configured.
   */
  validateConfiguration(): void {
    if (!this.apiKey) {
      throw new BadRequestException('Groww API Key is not configured');
    }
  }

  /**
   * Generates Groww OAuth authorization URL.
   */
  async getAuthorizationUrl(
    params: GetAuthorizationUrlParams,
  ): Promise<string> {
    this.validateConfiguration();
    const apiKey = this.apiKey!;
    const redirectUri = params.redirectUri || this.redirectUri;
    if (!redirectUri) {
      throw new BadRequestException('Groww redirectUri is required');
    }

    const url = new URL(`${this.authBaseUrl}/authorize`);
    url.searchParams.set('client_id', apiKey);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', params.state);

    return url.toString();
  }

  /**
   * Exchanges an authorization code for Groww access and refresh tokens.
   * Never logs secret keys or raw access tokens.
   */
  async exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens> {
    const apiKey = this.apiKey;
    const apiSecret = this.apiSecret;
    const redirectUri = params.redirectUri || this.redirectUri;

    if (!apiKey || !apiSecret) {
      throw new BadRequestException(
        'Groww API credentials (api_key / api_secret) are not configured',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Authorization code is required');
    }

    const tokenUrl = `${this.authBaseUrl}/token`;

    try {
      const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code.trim(),
        client_id: apiKey,
        client_secret: apiSecret,
      });
      if (redirectUri) {
        bodyParams.set('redirect_uri', redirectUri);
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: bodyParams.toString(),
      });

      const responseData = (await response.json()) as Record<string, any>;

      const data = responseData.data || responseData;
      const accessToken = data.access_token || data.accessToken;

      if (!response.ok || !accessToken || responseData.status === 'ERROR') {
        const errorMsg =
          responseData.message ||
          responseData.error ||
          responseData.error_description ||
          `Token exchange failed with status ${response.status}`;
        this.logger.warn(`Groww token exchange failed: ${errorMsg}`);
        throw new BadRequestException(`Groww authentication failed: ${errorMsg}`);
      }

      const expiresInSec = data.expires_in ?? responseData.expires_in;
      const expiresAt =
        typeof expiresInSec === 'number'
          ? new Date(Date.now() + expiresInSec * 1000)
          : null;

      return {
        accessToken,
        refreshToken: data.refresh_token || responseData.refresh_token || null,
        tokenType: 'Bearer',
        expiresAt,
        scopes: null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Groww exchangeAuthorizationCode error: ${msg}`);
      throw new BadRequestException('Failed to exchange Groww authorization code');
    }
  }

  /**
   * Refreshes an expired Groww access token using refresh token.
   */
  async refreshToken(params: RefreshTokenParams): Promise<BrokerAuthTokens> {
    const apiKey = this.apiKey;
    const apiSecret = this.apiSecret;

    if (!apiKey || !apiSecret) {
      throw new BadRequestException(
        'Groww API credentials are not configured for token refresh',
      );
    }
    if (!params.refreshToken) {
      throw new BadRequestException('Refresh token is required');
    }

    const tokenUrl = `${this.authBaseUrl}/token`;

    try {
      const bodyParams = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: params.refreshToken.trim(),
        client_id: apiKey,
        client_secret: apiSecret,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: bodyParams.toString(),
      });

      const responseData = (await response.json()) as Record<string, any>;
      const data = responseData.data || responseData;
      const accessToken = data.access_token || data.accessToken;

      if (!response.ok || !accessToken || responseData.status === 'ERROR') {
        const errorMsg =
          responseData.message ||
          responseData.error ||
          `Token refresh failed with status ${response.status}`;
        throw new BadRequestException(`Groww token refresh failed: ${errorMsg}`);
      }

      const expiresInSec = data.expires_in ?? responseData.expires_in;
      const expiresAt =
        typeof expiresInSec === 'number'
          ? new Date(Date.now() + expiresInSec * 1000)
          : null;

      return {
        accessToken,
        refreshToken:
          data.refresh_token || responseData.refresh_token || params.refreshToken,
        tokenType: 'Bearer',
        expiresAt,
        scopes: null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Groww refreshToken error: ${msg}`);
      throw new BadRequestException('Failed to refresh Groww access token');
    }
  }

  /**
   * Retrieves user profile details from Groww.
   * GET /user/profile
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
        headers: this.getAuthHeaders(tokens.accessToken),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok || json.status === 'ERROR') {
        const errorMsg =
          json.message || `Profile request failed with status ${response.status}`;
        throw new BadRequestException(`Groww profile fetch failed: ${errorMsg}`);
      }

      const data = json.data || json;

      return {
        brokerAccountId,
        clientId: data.client_id || data.userId || data.user_id || null,
        displayName: data.name || data.display_name || data.user_name || null,
        email: data.email || data.email_id || null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Groww getProfile error: ${msg}`);
      throw new BadRequestException('Failed to fetch Groww user profile');
    }
  }

  /**
   * Fetches portfolio holdings from Groww.
   * GET /holdings
   */
  async getHoldings(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<NormalizedHolding[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/holdings`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(tokens.accessToken),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok || json.status === 'ERROR') {
        const errorMsg =
          json.message || `Holdings request failed with status ${response.status}`;
        throw new BadRequestException(`Groww holdings fetch failed: ${errorMsg}`);
      }

      const rawHoldings: any[] = Array.isArray(json.data?.holdings)
        ? json.data.holdings
        : Array.isArray(json.holdings)
        ? json.holdings
        : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];

      const asOf = new Date();

      return rawHoldings
        .map((item): NormalizedHolding | null => {
          const isin = (
            item.isin ||
            extractIsinFromGroww(item.trading_symbol) ||
            extractIsinFromGroww(item.symbol)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawExchange = String(item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            rawExchange === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const rawSymbol = String(
            item.trading_symbol || item.symbol || '',
          ).trim();
          const symbol = rawSymbol
            ? rawSymbol.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '')
            : null;

          const quantity = Number(
            item.quantity ?? item.total_quantity ?? item.qty ?? 0,
          );
          const averagePrice =
            item.average_price != null
              ? Number(item.average_price)
              : item.avg_price != null
              ? Number(item.avg_price)
              : item.cost_price != null
              ? Number(item.cost_price)
              : null;
          const lastPrice =
            item.last_price != null
              ? Number(item.last_price)
              : item.ltp != null
              ? Number(item.ltp)
              : null;
          const currentValue =
            lastPrice != null && quantity > 0 ? quantity * lastPrice : null;
          const unrealizedPnl =
            item.pnl != null
              ? Number(item.pnl)
              : item.unrealized_pnl != null
              ? Number(item.unrealized_pnl)
              : lastPrice != null && averagePrice != null && quantity > 0
              ? (lastPrice - averagePrice) * quantity
              : null;

          return {
            brokerAccountId,
            isin,
            exchange,
            symbol,
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
      this.logger.error(`Groww getHoldings error: ${msg}`);
      throw new BadRequestException('Failed to fetch Groww holdings');
    }
  }

  /**
   * Fetches executed trades from Groww.
   * GET /trades
   */
  async getTrades(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
    _options?: GetTradesOptions,
  ): Promise<NormalizedTrade[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/trades`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(tokens.accessToken),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok || json.status === 'ERROR') {
        const errorMsg =
          json.message || `Trades request failed with status ${response.status}`;
        throw new BadRequestException(`Groww trades fetch failed: ${errorMsg}`);
      }

      const rawTrades: any[] = Array.isArray(json.data?.trades)
        ? json.data.trades
        : Array.isArray(json.trades)
        ? json.trades
        : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];

      return rawTrades
        .map((item): NormalizedTrade | null => {
          const isin = (
            item.isin ||
            extractIsinFromGroww(item.trading_symbol) ||
            extractIsinFromGroww(item.symbol)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawExchange = String(item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            rawExchange === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const rawSymbol = String(
            item.trading_symbol || item.symbol || '',
          ).trim();
          const symbol = rawSymbol
            ? rawSymbol.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '')
            : null;

          const transactionType = String(
            item.transaction_type || item.side || '',
          ).toUpperCase();
          const side =
            transactionType === 'SELL' || transactionType === 'S'
              ? BrokerTradeSide.SELL
              : BrokerTradeSide.BUY;

          const quantity = Number(
            item.quantity ?? item.trade_quantity ?? item.qty ?? 0,
          );
          const price = Number(
            item.price ?? item.average_price ?? item.trade_price ?? 0,
          );
          const tradeId = String(
            item.trade_id ||
              item.tradeId ||
              item.order_id ||
              `${isin}_${Date.now()}`,
          );

          let tradedAt = new Date();
          const timeStr =
            item.trade_time || item.fill_timestamp || item.order_timestamp;
          if (timeStr) {
            const parsed = new Date(timeStr);
            if (!isNaN(parsed.getTime())) {
              tradedAt = parsed;
            }
          }

          return {
            brokerAccountId,
            brokerTradeId: tradeId,
            isin,
            exchange,
            symbol,
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
      this.logger.error(`Groww getTrades error: ${msg}`);
      throw new BadRequestException("Failed to fetch Groww today's trades");
    }
  }

  /**
   * Fetches real-time market quote from Groww.
   * GET /quotes?symbol=NSE:SYMBOL
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

    const exchPrefix = exchange === ExchangeListing.BSE ? 'BSE' : 'NSE';
    const symbolKey = `${exchPrefix}:${isin.trim()}`;
    const url = `${this.baseUrl}/quotes?symbol=${encodeURIComponent(symbolKey)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(tokens.accessToken),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok || json.status === 'ERROR') {
        const errorMsg =
          json.message || `Quote request failed with status ${response.status}`;
        throw new BadRequestException(`Groww quote fetch failed: ${errorMsg}`);
      }

      const quoteData = json.data || json;
      const lastPrice = Number(
        quoteData.last_price ?? quoteData.ltp ?? quoteData.lastPrice ?? 0,
      );

      const asOf = new Date();

      return {
        isin: isin.trim(),
        exchange,
        symbol: symbolKey,
        lastPrice,
        asOf,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Groww getQuote error: ${msg}`);
      throw new BadRequestException('Failed to fetch Groww market quote');
    }
  }

  /**
   * Revokes Groww session / connection.
   * POST /oauth/revoke
   */
  async revokeConnection(tokens: BrokerAuthTokens): Promise<void> {
    if (!tokens.accessToken) {
      return;
    }

    const url = `${this.authBaseUrl}/revoke`;

    try {
      await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(tokens.accessToken),
      });
      this.logger.log('Groww connection revoked');
    } catch (err: unknown) {
      this.logger.warn(
        `Groww revokeConnection warning: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
