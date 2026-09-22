import { BrokerTradeSide, ExchangeListing } from '@prisma/client';

/**
 * Normalized profile data retrieved from a broker connection.
 */
export interface BrokerProfile {
  brokerAccountId: string;
  clientId?: string | null;
  displayName?: string | null;
  email?: string | null;
}

/**
 * Normalized holding item across any supported broker.
 */
export interface NormalizedHolding {
  brokerAccountId: string;
  isin: string;
  exchange: ExchangeListing;
  symbol?: string | null;
  quantity: number;
  averagePrice?: number | null;
  lastPrice?: number | null;
  currentValue?: number | null;
  unrealizedPnl?: number | null;
  asOf: Date;
}

/**
 * Normalized trade/transaction record across any supported broker.
 */
export interface NormalizedTrade {
  brokerAccountId: string;
  brokerTradeId: string;
  isin: string;
  exchange: ExchangeListing;
  symbol?: string | null;
  side: BrokerTradeSide;
  quantity: number;
  price: number;
  tradedAt: Date;
}

/**
 * Normalized market quote for an instrument from a broker.
 */
export interface NormalizedQuote {
  isin: string;
  exchange: ExchangeListing;
  symbol?: string | null;
  lastPrice: number;
  asOf: Date;
}

/**
 * Capability flags defining what features a specific broker adapter supports.
 */
export interface BrokerCapabilities {
  authorization: boolean;
  holdings: boolean;
  trades: boolean;
  quotes: boolean;
  tokenRefresh: boolean;
  revocation: boolean;
}

/**
 * Decrypted authentication tokens passed to/from broker adapter operations.
 * Never persisted or returned directly in API responses.
 */
export interface BrokerAuthTokens {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresAt?: Date | null;
  scopes?: string[] | null;
}

/**
 * Parameters for generating a broker authorization URL.
 */
export interface GetAuthorizationUrlParams {
  state: string;
  redirectUri?: string;
  scopes?: string[];
}

/**
 * Parameters for exchanging an authorization code for broker tokens.
 */
export interface ExchangeCodeParams {
  code: string;
  redirectUri?: string;
  codeVerifier?: string;
}

/**
 * Parameters for refreshing an expired broker access token.
 */
export interface RefreshTokenParams {
  refreshToken: string;
}

/**
 * Filter options for querying historical broker trades.
 */
export interface GetTradesOptions {
  fromDate?: Date;
  toDate?: Date;
}
