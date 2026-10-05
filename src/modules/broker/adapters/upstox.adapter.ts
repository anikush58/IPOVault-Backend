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
   * Fetches real-time market quotes in bulk from Upstox.
   * Matches returned data using the identity hierarchy:
   * 1. Exact Upstox instrument_token (e.g. NSE_EQ|INE848E01016)
   * 2. ISIN extracted from instrument_token
   * 3. Exchange + normalized trading symbol (e.g. NSE_EQ:TATATECH)
   * 4. Existing instrument key / response dictionary key
   * 5. Conservative fallback only when single instrument is unambiguous
   */
  async getQuotes(
    tokens: BrokerAuthTokens,
    instruments: Array<{
      isin?: string | null;
      symbol?: string | null;
      exchange?: ExchangeListing | null;
    }>,
  ): Promise<NormalizedQuote[]> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }
    if (!instruments || instruments.length === 0) {
      return [];
    }

    const keyDescriptors = instruments
      .map((inst) => {
        const isin = inst.isin?.trim().toUpperCase() || null;
        const symbol = inst.symbol?.trim().toUpperCase() || null;
        const exchange =
          inst.exchange === ExchangeListing.BSE
            ? ExchangeListing.BSE
            : ExchangeListing.NSE;
        const exchSegment =
          exchange === ExchangeListing.BSE ? 'BSE_EQ' : 'NSE_EQ';
        const instrumentKey = isin
          ? `${exchSegment}|${isin}`
          : symbol
            ? `${exchSegment}|${symbol}`
            : null;

        return {
          isin,
          symbol,
          exchange,
          exchSegment,
          instrumentKey,
        };
      })
      .filter((k) => Boolean(k.instrumentKey));

    if (keyDescriptors.length === 0) {
      return [];
    }

    const instrumentKeys = Array.from(
      new Set(keyDescriptors.map((k) => k.instrumentKey!)),
    );
    const url = `${this.baseUrl}/market-quote/quotes?instrument_key=${encodeURIComponent(
      instrumentKeys.join(','),
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

      const dataObj = (json.data || {}) as Record<string, any>;
      const results: NormalizedQuote[] = [];

      for (const req of keyDescriptors) {
        let matchedKey: string | null = null;
        let matchedData: any = null;

        // Identity Hierarchy:
        // 1. Exact Upstox instrument_token match
        for (const [key, val] of Object.entries(dataObj)) {
          if (val && typeof val === 'object') {
            const token = val.instrument_token || val.instrumentToken;
            if (
              token &&
              req.instrumentKey &&
              String(token).toUpperCase() === req.instrumentKey.toUpperCase()
            ) {
              matchedKey = key;
              matchedData = val;
              break;
            }
          }
        }

        // 2. ISIN extracted from instrument_token or response key
        if (!matchedData && req.isin) {
          for (const [key, val] of Object.entries(dataObj)) {
            if (val && typeof val === 'object') {
              const tokenIsin = extractIsinFromInstrumentKey(
                val.instrument_token || val.instrumentToken,
              );
              const keyIsin = extractIsinFromInstrumentKey(key);
              if (
                (tokenIsin && tokenIsin.toUpperCase() === req.isin) ||
                (keyIsin && keyIsin.toUpperCase() === req.isin)
              ) {
                matchedKey = key;
                matchedData = val;
                break;
              }
            }
          }
        }

        // 3. Exchange + normalized trading symbol
        if (!matchedData && req.symbol) {
          const targetSymKey = `${req.exchSegment}:${req.symbol}`.toUpperCase();
          const targetSymPipeKey = `${req.exchSegment}|${req.symbol}`.toUpperCase();
          for (const [key, val] of Object.entries(dataObj)) {
            const upperKey = key.toUpperCase();
            const symbolFromKey = upperKey.includes(':')
              ? upperKey.split(':')[1]
              : upperKey.includes('|')
                ? upperKey.split('|')[1]
                : upperKey;
            const symbolFromVal = (val?.symbol || '').toUpperCase();
            if (
              upperKey === targetSymKey ||
              upperKey === targetSymPipeKey ||
              symbolFromKey === req.symbol ||
              symbolFromVal === req.symbol
            ) {
              matchedKey = key;
              matchedData = val;
              break;
            }
          }
        }

        // 4. Existing instrument key / response dictionary key
        if (!matchedData) {
          if (req.instrumentKey && dataObj[req.instrumentKey]) {
            matchedKey = req.instrumentKey;
            matchedData = dataObj[req.instrumentKey];
          } else if (req.isin && dataObj[`${req.exchSegment}:${req.isin}`]) {
            matchedKey = `${req.exchSegment}:${req.isin}`;
            matchedData = dataObj[`${req.exchSegment}:${req.isin}`];
          } else if (req.symbol && dataObj[req.symbol]) {
            matchedKey = req.symbol;
            matchedData = dataObj[req.symbol];
          }
        }

        // 5. Conservative fallback: single requested instrument & single response entry
        if (
          !matchedData &&
          keyDescriptors.length === 1 &&
          Object.keys(dataObj).length === 1
        ) {
          const [singleKey, singleVal] = Object.entries(dataObj)[0];
          matchedKey = singleKey;
          matchedData = singleVal;
        }

        if (matchedData) {
          const lastPrice = Number(
            matchedData.last_price ??
              matchedData.lastPrice ??
              matchedData.price ??
              0,
          );

          if (lastPrice > 0) {
            let asOf = new Date();
            if (matchedData.timestamp) {
              const parsed = new Date(matchedData.timestamp);
              if (!isNaN(parsed.getTime())) {
                asOf = parsed;
              }
            }

            const isinFromToken = extractIsinFromInstrumentKey(
              matchedData.instrument_token,
            );
            const finalIsin =
              req.isin ||
              (isinFromToken.startsWith('IN') ? isinFromToken : '');
            const finalSymbol =
              req.symbol ||
              matchedData.symbol ||
              (matchedKey && matchedKey.includes(':')
                ? matchedKey.split(':')[1]
                : null);

            results.push({
              isin: finalIsin,
              symbol: finalSymbol,
              exchange: req.exchange,
              lastPrice,
              asOf,
            });
          }
        }
      }

      return results;
    } catch (err: unknown) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upstox getQuotes error: ${msg}`);
      throw new BadRequestException('Failed to fetch Upstox market quotes');
    }
  }

  /**
   * Fetches real-time market quote from Upstox for an instrument key.
   */
  async getQuote(
    tokens: BrokerAuthTokens,
    isin: string,
    exchange: ExchangeListing,
    symbol?: string | null,
  ): Promise<NormalizedQuote> {
    if (!tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }
    if (!isin || !isin.trim()) {
      throw new BadRequestException('ISIN is required for quote');
    }

    const quotes = await this.getQuotes(tokens, [
      { isin: isin.trim(), exchange, symbol },
    ]);

    if (quotes.length > 0) {
      return quotes[0];
    }

    throw new BadRequestException(`Failed to find quote for ISIN: ${isin}`);
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
