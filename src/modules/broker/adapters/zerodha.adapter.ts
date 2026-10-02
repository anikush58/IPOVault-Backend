import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrokerTradeSide, BrokerType, ExchangeListing } from '@prisma/client';
import * as crypto from 'crypto';
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

export function extractIsinFromZerodha(symbolOrKey?: string | null): string {
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
export class ZerodhaBrokerAdapter implements BrokerAdapter {
  private readonly logger = new Logger(ZerodhaBrokerAdapter.name);

  readonly brokerType: BrokerType = BrokerType.ZERODHA;

  readonly capabilities: BrokerCapabilities = {
    authorization: true,
    holdings: true,
    trades: true,
    quotes: false,
    tokenRefresh: false,
    revocation: true,
  };

  private readonly baseUrl: string;
  private readonly loginUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly redirectUri?: string;

  constructor(
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {
    this.baseUrl =
      this.configService?.get('ZERODHA_BASE_URL', { infer: true }) ||
      'https://api.kite.trade';
    this.loginUrl =
      this.configService?.get('ZERODHA_LOGIN_URL', { infer: true }) ||
      'https://kite.zerodha.com/connect/login';
    this.apiKey = this.configService?.get('ZERODHA_API_KEY', { infer: true });
    this.apiSecret = this.configService?.get('ZERODHA_API_SECRET', {
      infer: true,
    });
    this.redirectUri =
      this.configService?.get('ZERODHA_REDIRECT_URI', {
        infer: true,
      }) ||
      'https://api.getipovault.in/api/v1/broker-accounts/connect/zerodha/callback';
  }

  private getAuthHeaders(accessToken: string): Record<string, string> {
    const authHeader = this.apiKey
      ? `token ${this.apiKey}:${accessToken}`
      : `token ${accessToken}`;

    return {
      Authorization: authHeader,
      'X-Kite-Version': '3',
      Accept: 'application/json',
    };
  }

  /**
   * Validates that Zerodha API credentials are configured.
   */
  validateConfiguration(): void {
    if (!this.apiKey) {
      throw new BadRequestException('Zerodha API Key is not configured');
    }
  }

  /**
   * Generates Zerodha Kite Connect login authorization URL with fixed HTTPS redirect URL.
   */
  async getAuthorizationUrl(
    params: GetAuthorizationUrlParams,
  ): Promise<string> {
    this.validateConfiguration();
    const apiKey = this.apiKey!;
    const redirectUri =
      params.redirectUri && params.redirectUri.startsWith('https://')
        ? params.redirectUri
        : this.redirectUri;

    const url = new URL(this.loginUrl);
    url.searchParams.set('v', '3');
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('state', params.state);
    if (redirectUri) {
      url.searchParams.set('redirect_params', `state=${params.state}`);
    }

    return url.toString();
  }

  /**
   * Exchanges request_token for Kite Connect access token using SHA-256 checksum.
   * Checksum formula: SHA-256(api_key + request_token + api_secret)
   * Never logs secret keys or raw access tokens.
   */
  async exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens> {
    const apiKey = this.apiKey;
    const apiSecret = this.apiSecret;

    if (!apiKey || !apiSecret) {
      throw new BadRequestException(
        'Zerodha API credentials (api_key / api_secret) are not configured',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Authorization code / request_token is required');
    }

    const requestToken = params.code.trim();
    const checksum = crypto
      .createHash('sha256')
      .update(`${apiKey}${requestToken}${apiSecret}`)
      .digest('hex');

    const tokenUrl = `${this.baseUrl}/session/token`;

    try {
      const bodyParams = new URLSearchParams({
        api_key: apiKey,
        request_token: requestToken,
        checksum,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Kite-Version': '3',
          Accept: 'application/json',
        },
        body: bodyParams.toString(),
      });

      const responseData = (await response.json()) as Record<string, any>;

      const data = responseData.data || responseData;
      const accessToken = data.access_token || data.accessToken;

      if (!response.ok || !accessToken || responseData.status === 'error') {
        const errorMsg =
          responseData.message ||
          responseData.error_type ||
          responseData.error ||
          `Token exchange failed with status ${response.status}`;
        this.logger.warn(`Zerodha token exchange failed: ${errorMsg}`);
        throw new BadRequestException(`Zerodha authentication failed: ${errorMsg}`);
      }

      return {
        accessToken,
        refreshToken: data.refresh_token || null,
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zerodha exchangeAuthorizationCode error: ${msg}`);
      throw new BadRequestException(
        'Failed to exchange Zerodha authorization code / request_token',
      );
    }
  }

  /**
   * Zerodha Kite API requires daily session authentication; refresh token is not supported.
   */
  async refreshToken(_params: RefreshTokenParams): Promise<BrokerAuthTokens> {
    throw new BadRequestException(
      'Zerodha Kite Connect does not support token refresh; daily re-authentication is required',
    );
  }

  /**
   * Retrieves user profile details from Zerodha Kite Connect.
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

      if (!response.ok || json.status === 'error') {
        const errorMsg =
          json.message || `Profile request failed with status ${response.status}`;
        throw new BadRequestException(`Zerodha profile fetch failed: ${errorMsg}`);
      }

      const data = json.data || json;

      return {
        brokerAccountId,
        clientId: data.user_id || data.userId || null,
        displayName: data.user_name || data.user_shortname || null,
        email: data.email || null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zerodha getProfile error: ${msg}`);
      throw new BadRequestException('Failed to fetch Zerodha user profile');
    }
  }

  /**
   * Fetches portfolio holdings from Zerodha Kite Connect.
   * GET /portfolio/holdings
   */
  async getHoldings(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<NormalizedHolding[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/portfolio/holdings`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(tokens.accessToken),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok || json.status === 'error') {
        const errorMsg =
          json.message || `Holdings request failed with status ${response.status}`;
        throw new BadRequestException(`Zerodha holdings fetch failed: ${errorMsg}`);
      }

      const rawHoldings: any[] = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.holdings)
        ? json.holdings
        : Array.isArray(json)
        ? json
        : [];

      const asOf = new Date();

      return rawHoldings
        .map((item): NormalizedHolding | null => {
          const isin = (
            item.isin ||
            extractIsinFromZerodha(item.tradingsymbol) ||
            extractIsinFromZerodha(item.symbol)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawExchange = String(item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            rawExchange === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const rawSymbol = String(
            item.tradingsymbol || item.symbol || '',
          ).trim();
          const symbol = rawSymbol
            ? rawSymbol.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '')
            : null;

          const quantity =
            Number(item.quantity ?? 0) + Number(item.t1_quantity ?? 0);
          const averagePrice =
            item.average_price != null
              ? Number(item.average_price)
              : item.avgPrice != null
              ? Number(item.avgPrice)
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
      this.logger.error(`Zerodha getHoldings error: ${msg}`);
      throw new BadRequestException('Failed to fetch Zerodha holdings');
    }
  }

  /**
   * Fetches executed trades from Zerodha Kite Connect.
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

      if (!response.ok || json.status === 'error') {
        const errorMsg =
          json.message || `Trades request failed with status ${response.status}`;
        throw new BadRequestException(`Zerodha trades fetch failed: ${errorMsg}`);
      }

      const rawTrades: any[] = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.trades)
        ? json.trades
        : Array.isArray(json)
        ? json
        : [];

      return rawTrades
        .map((item): NormalizedTrade | null => {
          const isin = (
            item.isin ||
            extractIsinFromZerodha(item.tradingsymbol) ||
            extractIsinFromZerodha(item.symbol)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawExchange = String(item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            rawExchange === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const rawSymbol = String(
            item.tradingsymbol || item.symbol || '',
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

          const quantity = Number(item.quantity ?? item.trade_quantity ?? 0);
          const price = Number(
            item.average_price ?? item.price ?? item.trade_price ?? 0,
          );
          const tradeId = String(
            item.trade_id ||
              item.tradeId ||
              item.order_id ||
              `${isin}_${Date.now()}`,
          );

          let tradedAt = new Date();
          const timeStr =
            item.fill_timestamp || item.trade_timestamp || item.order_timestamp;
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
      this.logger.error(`Zerodha getTrades error: ${msg}`);
      throw new BadRequestException("Failed to fetch Zerodha today's trades");
    }
  }

  /**
   * Market quote lookup is not supported on the free Zerodha Personal plan.
   * Preserves existing portfolio holding LTP and prevents paid API errors.
   */
  async getQuote(
    _tokens: BrokerAuthTokens,
    _isin: string,
    _exchange: ExchangeListing,
  ): Promise<NormalizedQuote> {
    throw new BadRequestException(
      'Zerodha Kite Connect Personal plan does not support real-time quote lookups',
    );
  }

  /**
   * Revokes Zerodha Kite Connect session / connection.
   * DELETE /session/token
   */
  async revokeConnection(tokens: BrokerAuthTokens): Promise<void> {
    if (!tokens.accessToken || !this.apiKey) {
      return;
    }

    const url = `${this.baseUrl}/session/token?api_key=${this.apiKey}&access_token=${tokens.accessToken}`;

    try {
      await fetch(url, {
        method: 'DELETE',
        headers: this.getAuthHeaders(tokens.accessToken),
      });
      this.logger.log('Zerodha connection revoked');
    } catch (err: unknown) {
      this.logger.warn(
        `Zerodha revokeConnection warning: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
