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

export function extractIsinFromDhan(
  isin?: string | null,
  symbol?: string | null,
): string {
  if (isin && isin.trim()) {
    return isin.trim().toUpperCase();
  }
  if (symbol && symbol.trim().startsWith('INE')) {
    return symbol.trim().toUpperCase();
  }
  return '';
}

@Injectable()
export class DhanBrokerAdapter implements BrokerAdapter {
  private readonly logger = new Logger(DhanBrokerAdapter.name);

  readonly brokerType: BrokerType = BrokerType.DHAN;

  readonly capabilities: BrokerCapabilities = {
    authorization: true,
    holdings: true,
    trades: true,
    quotes: true,
    tokenRefresh: false,
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
      this.configService?.get('DHAN_BASE_URL', { infer: true }) ||
      'https://api.dhan.co/v2';
    this.authBaseUrl =
      this.configService?.get('DHAN_AUTH_BASE_URL', { infer: true }) ||
      'https://auth.dhan.co';
    this.apiKey = this.configService?.get('DHAN_API_KEY', { infer: true });
    this.apiSecret = this.configService?.get('DHAN_API_SECRET', {
      infer: true,
    });
    this.redirectUri =
      this.configService?.get('DHAN_REDIRECT_URI', { infer: true }) ||
      'https://api.getipovault.in/api/v1/broker-accounts/connect/dhan/callback';
  }

  /**
   * Validates that Dhan API credentials are configured.
   */
  validateConfiguration(): void {
    if (!this.apiKey) {
      throw new BadRequestException(
        'Dhan partner ID / API key is not configured',
      );
    }
  }

  /**
   * Generates Dhan partner consent / login URL.
   * Calls generate-consent when credentials are configured, or constructs login URL.
   */
  async getAuthorizationUrl(
    params: GetAuthorizationUrlParams,
  ): Promise<string> {
    this.validateConfiguration();
    const partnerId = this.apiKey!;
    const partnerSecret = this.apiSecret;
    const redirectUri =
      params.redirectUri ||
      this.redirectUri ||
      'https://api.getipovault.in/api/v1/broker-accounts/connect/dhan/callback';

    try {
      if (partnerSecret) {
        const consentUrl = `${this.authBaseUrl}/partner/generate-consent`;
        const response = await fetch(consentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            partner_id: partnerId,
            partner_secret: partnerSecret,
          },
          body: JSON.stringify({
            state: params.state,
            redirect_uri: redirectUri,
          }),
        });

        if (response.ok) {
          const json = (await response.json()) as Record<string, any>;
          const consentId =
            json.consentId ||
            json.consentAppId ||
            json.data?.consentId ||
            json.data?.consentAppId;

          if (consentId) {
            const loginUrl = new URL(`${this.authBaseUrl}/consent-login`);
            loginUrl.searchParams.set('consentId', consentId);
            loginUrl.searchParams.set('state', params.state);
            return loginUrl.toString();
          }
        }
      }

      // Standard Dhan consent login URL construction
      const loginUrl = new URL(`${this.authBaseUrl}/consent-login`);
      loginUrl.searchParams.set('partner_id', partnerId);
      loginUrl.searchParams.set('state', params.state);
      if (redirectUri) {
        loginUrl.searchParams.set('redirect_uri', redirectUri);
      }
      return loginUrl.toString();
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Dhan getAuthorizationUrl error: ${msg}`);
      throw new BadRequestException('Failed to generate Dhan authorization URL');
    }
  }

  /**
   * Exchanges Dhan tokenId / consent token for an access token.
   * Never logs client credentials or raw tokens.
   */
  async exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens> {
    const partnerId = this.apiKey;
    const partnerSecret = this.apiSecret;

    if (!partnerId) {
      throw new BadRequestException(
        'Dhan API credentials (partner_id / client_id) are not configured',
      );
    }
    if (!params.code) {
      throw new BadRequestException('Authorization code / tokenId is required');
    }

    const consumeUrl = `${this.authBaseUrl}/partner/consume-consent?tokenId=${encodeURIComponent(
      params.code.trim(),
    )}`;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        partner_id: partnerId,
      };
      if (partnerSecret) {
        headers.partner_secret = partnerSecret;
      }

      const response = await fetch(consumeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tokenId: params.code.trim(),
        }),
      });

      const responseData = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          responseData.message ||
          responseData.errorMessage ||
          responseData.error ||
          `Token exchange failed with status ${response.status}`;
        this.logger.warn(`Dhan token exchange failed: ${errorMsg}`);
        throw new BadRequestException(`Dhan authentication failed: ${errorMsg}`);
      }

      const token =
        responseData.accessToken ||
        responseData.access_token ||
        responseData.token ||
        responseData.data?.accessToken ||
        responseData.data?.access_token ||
        responseData.data?.token;

      if (!token) {
        throw new BadRequestException(
          'Dhan authentication response did not contain an access token',
        );
      }

      return {
        accessToken: token,
        refreshToken: null,
        tokenType: 'Bearer',
        expiresAt: null,
        scopes: null,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Dhan exchangeAuthorizationCode error: ${msg}`);
      throw new BadRequestException('Failed to exchange Dhan authorization code');
    }
  }

  /**
   * Dhan API v2 does not support refresh tokens (tokens are valid for 24h).
   */
  async refreshToken(_params: RefreshTokenParams): Promise<BrokerAuthTokens> {
    throw new BadRequestException(
      'Dhan API does not support token refresh; re-authentication is required',
    );
  }

  /**
   * Retrieves profile information from Dhan.
   */
  async getProfile(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<BrokerProfile> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    try {
      const url = `${this.baseUrl}/profile`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'access-token': tokens.accessToken,
          Accept: 'application/json',
        },
      });

      if (response.ok) {
        const json = (await response.json()) as Record<string, any>;
        const data = json.data || json;
        return {
          brokerAccountId,
          clientId:
            data.dhanClientId || data.clientId || data.client_id || null,
          displayName:
            data.clientName || data.name || data.displayName || null,
          email: data.email || data.emailId || null,
        };
      }
    } catch {
      // Profile fetch is optional fallback
    }

    return {
      brokerAccountId,
      clientId: null,
      displayName: null,
      email: null,
    };
  }

  /**
   * Fetches holdings from Dhan and normalizes by ISIN.
   * GET /v2/holdings
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
          'access-token': tokens.accessToken,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message ||
          json.errorMessage ||
          `Holdings request failed with status ${response.status}`;
        throw new BadRequestException(`Dhan holdings fetch failed: ${errorMsg}`);
      }

      const items: any[] = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
        ? json.data
        : [];
      const asOf = new Date();

      return items
        .map((item): NormalizedHolding | null => {
          const isin = extractIsinFromDhan(
            item.isin || item.isinNumber,
            item.tradingSymbol || item.symbol,
          );

          if (!isin) {
            return null;
          }

          const exchangeStr = (item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            exchangeStr === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const quantity = Number(
            item.totalQty ?? item.quantity ?? item.dpQty ?? 0,
          );
          const averagePrice =
            item.avgCostPrice != null
              ? Number(item.avgCostPrice)
              : item.averagePrice != null
              ? Number(item.averagePrice)
              : null;
          const lastPrice =
            item.lastPrice != null
              ? Number(item.lastPrice)
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
            symbol: item.tradingSymbol || item.symbol || null,
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
      this.logger.error(`Dhan getHoldings error: ${msg}`);
      throw new BadRequestException('Failed to fetch Dhan holdings');
    }
  }

  /**
   * Fetches today's trade book executions from Dhan.
   * GET /v2/trades
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
        headers: {
          'access-token': tokens.accessToken,
          Accept: 'application/json',
        },
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message ||
          json.errorMessage ||
          `Trades request failed with status ${response.status}`;
        throw new BadRequestException(`Dhan trades fetch failed: ${errorMsg}`);
      }

      const items: any[] = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
        ? json.data
        : [];

      return items
        .map((item): NormalizedTrade | null => {
          const isin = extractIsinFromDhan(
            item.isin || item.isinNumber,
            item.tradingSymbol || item.symbol,
          );

          if (!isin) {
            return null;
          }

          const exchangeStr = (item.exchange || 'NSE').trim().toUpperCase();
          const exchange =
            exchangeStr === 'BSE' ? ExchangeListing.BSE : ExchangeListing.NSE;

          const txnType = (
            item.transactionType ||
            item.side ||
            item.tradeType ||
            ''
          )
            .trim()
            .toUpperCase();
          const side =
            txnType === 'SELL' ? BrokerTradeSide.SELL : BrokerTradeSide.BUY;

          const quantity = Number(
            item.tradedQuantity ?? item.quantity ?? item.filledQty ?? 0,
          );
          const price = Number(
            item.tradedPrice ?? item.price ?? item.avgPrice ?? 0,
          );
          const tradeId = String(
            item.exchangeTradeId ||
              item.tradeId ||
              item.orderId ||
              `${isin}_${Date.now()}`,
          );

          let tradedAt = new Date();
          const timeStr = item.exchangeTime || item.createTime || item.tradeTime;
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
            symbol: item.tradingSymbol || item.symbol || null,
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
      this.logger.error(`Dhan getTrades error: ${msg}`);
      throw new BadRequestException("Failed to fetch Dhan today's trades");
    }
  }

  /**
   * Fetches real-time market quote from Dhan.
   * POST /v2/marketfeed/ltp or POST /v2/marketfeed/quote
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
    const url = `${this.baseUrl}/marketfeed/ltp`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'access-token': tokens.accessToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          [exchSegment]: [isin.trim()],
        }),
      });

      const json = (await response.json()) as Record<string, any>;

      if (!response.ok) {
        const errorMsg =
          json.message ||
          json.errorMessage ||
          `Quote request failed with status ${response.status}`;
        throw new BadRequestException(`Dhan quote fetch failed: ${errorMsg}`);
      }

      const segmentData =
        json.data?.[exchSegment] || json[exchSegment] || json.data || json;
      const quoteItem =
        segmentData[isin.trim()] || Object.values(segmentData)[0] || {};

      const lastPrice = Number(
        quoteItem.last_price ??
          quoteItem.lastPrice ??
          quoteItem.ltp ??
          quoteItem.Ltp ??
          0,
      );

      const asOf = new Date();

      return {
        isin: isin.trim(),
        exchange,
        symbol: quoteItem.tradingSymbol || quoteItem.symbol || null,
        lastPrice,
        asOf,
      };
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Dhan getQuote error: ${msg}`);
      throw new BadRequestException('Failed to fetch Dhan market quote');
    }
  }

  /**
   * Revokes Dhan session / connection.
   */
  async revokeConnection(_tokens: BrokerAuthTokens): Promise<void> {
    // Dhan access token revocation is handled client-side / on expiry
    this.logger.log('Dhan connection revoked');
  }
}
