import { BrokerType, ExchangeListing } from '@prisma/client';
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
} from './broker.types';

/**
 * Common adapter contract that all broker integrations must implement.
 * Operates purely on normalized domain types without exposing Prisma models,
 * raw tokens, or broker-specific payload details.
 */
export interface BrokerAdapter {
  /**
   * The canonical BrokerType enum value for this adapter.
   */
  readonly brokerType: BrokerType;

  /**
   * Feature capability flags supported by this broker adapter.
   */
  readonly capabilities: BrokerCapabilities;

  /**
   * Validates that required server-side credentials and configuration are present.
   * Throws BadRequestException if not configured.
   */
  validateConfiguration?(): void;

  /**
   * Generates the OAuth authorization URL for user authentication and consent.
   */
  getAuthorizationUrl(params: GetAuthorizationUrlParams): Promise<string>;

  /**
   * Exchanges an authorization code for initial access and refresh tokens.
   */
  exchangeAuthorizationCode(
    params: ExchangeCodeParams,
  ): Promise<BrokerAuthTokens>;

  /**
   * Refreshes an expired access token using a valid refresh token.
   */
  refreshToken(params: RefreshTokenParams): Promise<BrokerAuthTokens>;

  /**
   * Retrieves the normalized user/client profile from the broker.
   */
  getProfile(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<BrokerProfile>;

  /**
   * Fetches the current normalized portfolio holdings for the account.
   */
  getHoldings(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
  ): Promise<NormalizedHolding[]>;

  /**
   * Fetches the normalized trade/order execution history for the account.
   */
  getTrades(
    tokens: BrokerAuthTokens,
    brokerAccountId: string,
    options?: GetTradesOptions,
  ): Promise<NormalizedTrade[]>;

  /**
   * Retrieves a real-time or delayed normalized market quote for an instrument.
   */
  getQuote(
    tokens: BrokerAuthTokens,
    isin: string,
    exchange: ExchangeListing,
    symbol?: string | null,
  ): Promise<NormalizedQuote>;

  /**
   * Optionally fetches real-time market quotes in bulk for multiple instruments.
   */
  getQuotes?(
    tokens: BrokerAuthTokens,
    instruments: Array<{
      isin?: string | null;
      symbol?: string | null;
      exchange?: ExchangeListing | null;
    }>,
  ): Promise<NormalizedQuote[]>;

  /**
   * Explicitly revokes active tokens and disconnects the session on the broker side.
   */
  revokeConnection(tokens: BrokerAuthTokens): Promise<void>;
}
