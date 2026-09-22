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

export function extractIsinFromFyers(symbolOrKey?: string | null): string {
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
export class FyersBrokerAdapter implements BrokerAdapter {
  private readonly logger = new Logger(FyersBrokerAdapter.name);

  readonly brokerType: BrokerType = BrokerType.FYERS;

  readonly capabilities: BrokerCapabilities = {
    authorization: true,
    holdings: true,
    trades: true,
    quotes: true,
    tokenRefresh: false,
    revocation: true,
  };

  private readonly baseUrl: string;
  private readonly appId?: string;
  private readonly secretKey?: string;
  private readonly redirectUri?: string;

  constructor(
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {
    this.baseUrl =
      this.configService?.get('FYERS_BASE_URL', { infer: true }) ||
      'https://api-t1.fyers.in/api/v3';
    this.appId = this.configService?.get('FYERS_APP_ID', { infer: true });
    this.secretKey = this.configService?.get('FYERS_SECRET_KEY', {
      infer: true,
    });
    this.redirectUri = this.configService?.get('FYERS_REDIRECT_URI', {
      infer: true,
    });
  }

  private getAuthHeader(accessToken: string): string {
    return this.appId ? `${this.appId}:${accessToken}` : `Bearer ${accessToken}`;
  }

  /**
   * Generates FYERS OAuth 2.0 authorization URL.
   */
  async getAuthorizationUrl(
    params: GetAuthorizationUrlParams,
  ): Promise<string> {
    const clientId = this.appId;
    const redirectUri = params.redirectUri || this.redirectUri;

    if (!clientId) {
      throw new BadRequestException('FYERS App ID / client_id is not configured');
    }
    if (!redirectUri) {
      throw new BadRequestException('FYERS redirectUri is required');
    }

    const url = new URL(`${this.baseUrl}/generate-authcode`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', params.state);

    return url.toString();
  }

  /**
   * Exchanges an authorization code for a FYERS access token using SHA-256 appIdHash.
   * Never logs secret keys or raw access tokens.
   */
  async exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens> {
    const appId = this.appId;
    const secretKey = this.secretKey;

    if (!appId || !secretKey) {
      throw new BadRequestException(
        'FYERS API credentials (app_id / secret_key) are not configured',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Authorization code is required');
    }

    const appIdHash = crypto
      .createHash('sha256')
      .update(`${appId}:${secretKey}`)
      .digest('hex');

    const tokenUrl = `${this.baseUrl}/validate-authcode`;

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          appIdHash,
          code: params.code.trim(),
        }),
      });

      const responseData = (await response.json()) as Record<string, any>;

      const token =
        responseData.access_token ||
        responseData.accessToken ||
        responseData.data?.access_token;

      if (!response.ok || !token) {
        const errorMsg =
          responseData.message ||
          responseData.error ||
          responseData.error_description ||
          `Token validation failed with status ${response.status}`;
        this.logger.warn(`FYERS token exchange failed: ${errorMsg}`);
        throw new BadRequestException(`FYERS authentication failed: ${errorMsg}`);
      }

      return {
        accessToken: token,
        refreshToken: responseData.refresh_token || null,
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FYERS exchangeAuthorizationCode error: ${msg}`);
      throw new BadRequestException('Failed to exchange FYERS authorization code');
    }
  }

  /**
   * FYERS API v3 does not support standalone refresh token endpoint.
   */
  async refreshToken(_params: RefreshTokenParams): Promise<BrokerAuthTokens> {
    throw new BadRequestException(
      'FYERS API does not support token refresh; re-authentication is required',
    );
  }

  /**
   * Retrieves user profile details from FYERS.
   */
  async getProfile(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<BrokerProfile> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/profile`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(tokens.accessToken),
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Profile request failed with status ${response.status}`;
        throw new BadRequestException(`FYERS profile fetch failed: ${errorMsg}`);
      }

      const data = json.data || json;

      return {
        brokerAccountId,
        clientId: data.fy_id || data.fyId || null,
        displayName: data.name || data.display_name || null,
        email: data.email_id || data.email || null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FYERS getProfile error: ${msg}`);
      throw new BadRequestException('Failed to fetch FYERS user profile');
    }
  }

  /**
   * Fetches portfolio holdings from FYERS.
   * GET /api/v3/holdings
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
        headers: {
          Authorization: this.getAuthHeader(tokens.accessToken),
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Holdings request failed with status ${response.status}`;
        throw new BadRequestException(`FYERS holdings fetch failed: ${errorMsg}`);
      }

      const rawHoldings: any[] = Array.isArray(json.holdings)
        ? json.holdings
        : Array.isArray(json.data?.holdings)
        ? json.data.holdings
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
            extractIsinFromFyers(item.symbol) ||
            extractIsinFromFyers(item.symbolName)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawSymbol = String(item.symbol || '').trim().toUpperCase();
          const exchange = rawSymbol.startsWith('BSE:')
            ? ExchangeListing.BSE
            : ExchangeListing.NSE;

          const symbol = rawSymbol
            ? rawSymbol.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '')
            : null;

          const quantity = Number(item.quantity ?? item.qty ?? item.totalQty ?? 0);
          const averagePrice =
            item.costPrice != null
              ? Number(item.costPrice)
              : item.avgPrice != null
              ? Number(item.avgPrice)
              : null;
          const lastPrice =
            item.ltp != null
              ? Number(item.ltp)
              : item.lastPrice != null
              ? Number(item.lastPrice)
              : null;
          const currentValue =
            lastPrice != null && quantity > 0 ? quantity * lastPrice : null;
          const unrealizedPnl =
            item.pl != null
              ? Number(item.pl)
              : item.pnl != null
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
      this.logger.error(`FYERS getHoldings error: ${msg}`);
      throw new BadRequestException('Failed to fetch FYERS holdings');
    }
  }

  /**
   * Fetches executed tradebook from FYERS.
   * GET /api/v3/tradebook
   */
  async getTrades(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
    _options?: GetTradesOptions,
  ): Promise<NormalizedTrade[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    const url = `${this.baseUrl}/tradebook`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(tokens.accessToken),
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Tradebook request failed with status ${response.status}`;
        throw new BadRequestException(`FYERS trades fetch failed: ${errorMsg}`);
      }

      const rawTrades: any[] = Array.isArray(json.tradeBook)
        ? json.tradeBook
        : Array.isArray(json.data?.tradeBook)
        ? json.data.tradeBook
        : Array.isArray(json.data)
        ? json.data
        : Array.isArray(json)
        ? json
        : [];

      return rawTrades
        .map((item): NormalizedTrade | null => {
          const isin = (
            item.isin ||
            extractIsinFromFyers(item.symbol) ||
            extractIsinFromFyers(item.symbolName)
          )?.trim();

          if (!isin) {
            return null;
          }

          const rawSymbol = String(item.symbol || '').trim().toUpperCase();
          const exchange = rawSymbol.startsWith('BSE:')
            ? ExchangeListing.BSE
            : ExchangeListing.NSE;

          const symbol = rawSymbol
            ? rawSymbol.replace(/^(NSE|BSE):/, '').replace(/-EQ$/, '')
            : null;

          const sideValue = item.side ?? item.transactionType;
          const isSell =
            sideValue === -1 ||
            String(sideValue).toUpperCase() === 'SELL' ||
            String(sideValue).toUpperCase() === 'S';
          const side = isSell ? BrokerTradeSide.SELL : BrokerTradeSide.BUY;

          const quantity = Number(
            item.tradedQty ?? item.tradeQty ?? item.qty ?? item.quantity ?? 0,
          );
          const price = Number(
            item.tradePrice ?? item.tradedPrice ?? item.price ?? 0,
          );
          const tradeId = String(
            item.id ||
              item.tradeNumber ||
              item.orderNumber ||
              `${isin}_${Date.now()}`,
          );

          let tradedAt = new Date();
          const timeStr = item.orderDateTime || item.tradeTime || item.orderTime;
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
      this.logger.error(`FYERS getTrades error: ${msg}`);
      throw new BadRequestException("Failed to fetch FYERS today's trades");
    }
  }

  /**
   * Fetches real-time market quote from FYERS.
   * GET /api/v3/quotes?symbols=...
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
    const symbolKey = `${exchPrefix}:${isin.trim()}-EQ`;
    const url = `${this.baseUrl}/quotes?symbols=${encodeURIComponent(symbolKey)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.getAuthHeader(tokens.accessToken),
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message || `Quote request failed with status ${response.status}`;
        throw new BadRequestException(`FYERS quote fetch failed: ${errorMsg}`);
      }

      const quoteItems: any[] = Array.isArray(json.d)
        ? json.d
        : Array.isArray(json.data)
        ? json.data
        : [];
      const quoteItem = quoteItems[0]?.v || quoteItems[0] || {};

      const lastPrice = Number(
        quoteItem.lp ?? quoteItem.ltp ?? quoteItem.last_price ?? 0,
      );

      const asOf = new Date();

      return {
        isin: isin.trim(),
        exchange,
        symbol: quoteItems[0]?.n || null,
        lastPrice,
        asOf,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`FYERS getQuote error: ${msg}`);
      throw new BadRequestException('Failed to fetch FYERS market quote');
    }
  }

  /**
   * Revokes FYERS session / connection.
   */
  async revokeConnection(_tokens: BrokerAuthTokens): Promise<void> {
    this.logger.log('FYERS connection revoked');
  }
}
