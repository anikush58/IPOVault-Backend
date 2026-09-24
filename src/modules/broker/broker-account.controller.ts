import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { BrokerType, ExchangeListing } from '@prisma/client';
import { BrokerAccountService } from './broker-account.service';
import { BrokerConnectionService } from './broker-connection.service';
import { BrokerInvestmentService } from './broker-investment.service';
import { BrokerOAuthStateService } from './security/broker-oauth-state.service';
import { BrokerRegistry } from './broker.registry';
import {
  NormalizedHolding,
  NormalizedQuote,
  NormalizedTrade,
} from './broker.types';
import { createBrokerAccountSchema } from './dto/create-broker-account.dto';
import { recordAllotmentInvestmentSchema } from './dto/record-investment.dto';
import {
  BrokerAccountResponseDto,
  BrokerConnectionResponseDto,
} from './dto/broker-account-response.dto';

function mapAccountToSafeResponse(account: any): BrokerAccountResponseDto {
  return {
    id: account.id,
    profileId: account.profileId,
    broker: account.broker,
    accountName: account.accountName ?? null,
    clientId: account.clientId ?? null,
    isActive: account.isActive,
    connection: account.connection
      ? {
          id: account.connection.id,
          status: account.connection.status,
          connectedAt: account.connection.connectedAt ?? null,
          lastSyncAt: account.connection.lastSyncAt ?? null,
          lastErrorAt: account.connection.lastErrorAt ?? null,
          lastError: account.connection.lastError ?? null,
        }
      : null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

function mapConnectionToSafeResponse(
  connection: any,
): BrokerConnectionResponseDto {
  return {
    id: connection.id,
    brokerAccountId: connection.brokerAccountId,
    status: connection.status,
    connectedAt: connection.connectedAt ?? null,
    lastSyncAt: connection.lastSyncAt ?? null,
    lastErrorAt: connection.lastErrorAt ?? null,
    lastError: connection.lastError ?? null,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

@Controller('broker-accounts')
export class BrokerAccountController {
  constructor(
    private readonly brokerAccountService: BrokerAccountService,
    private readonly brokerConnectionService: BrokerConnectionService,
    private readonly brokerInvestmentService: BrokerInvestmentService,
    private readonly brokerRegistry: BrokerRegistry,
    private readonly oauthStateService: BrokerOAuthStateService,
  ) {}

  private getAuthenticatedUserId(userId?: string): string {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new UnauthorizedException(
        'Authentication header x-user-id is required',
      );
    }
    return userId.trim();
  }

  /**
   * List all broker accounts belonging to authenticated user.
   * GET /api/v1/broker-accounts
   */
  @Get()
  async getAccounts(
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerAccountResponseDto[]> {
    const authUserId = this.getAuthenticatedUserId(userId);
    const accounts = await this.brokerAccountService.getAccounts(authUserId);
    return accounts.map(mapAccountToSafeResponse);
  }

  /**
   * Create a new broker account.
   * POST /api/v1/broker-accounts
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAccount(
    @Body() body: unknown,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerAccountResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);

    const parseResult = createBrokerAccountSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((issue) => issue.message)
        .join('; ');
      throw new BadRequestException(errorMessage || 'Invalid request body');
    }

    const { profileId, broker, accountName, clientId } = parseResult.data;

    const account = await this.brokerAccountService.createAccount({
      userId: authUserId,
      profileId,
      broker,
      accountName,
      clientId,
    });

    return mapAccountToSafeResponse(account);
  }

  /**
   * Start Upstox OAuth flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/upstox
   */
  @Get(':id/connect/upstox')
  async startUpstoxConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.UPSTOX) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not UPSTOX`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.UPSTOX);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete Upstox OAuth flow: validates and consumes single-use state,
   * exchanges code for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/upstox/callback
   */
  @Get(':id/connect/upstox/callback')
  async completeUpstoxConnect(
    @Param('id') id: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    if (!code || typeof code !== 'string' || !code.trim()) {
      throw new BadRequestException('Authorization code is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.UPSTOX) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not UPSTOX`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.UPSTOX);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: code.trim(),
      redirectUri,
    });

    // Verify profile using Upstox adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Start Dhan OAuth/consent flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/dhan
   */
  @Get(':id/connect/dhan')
  async startDhanConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.DHAN) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not DHAN`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.DHAN);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete Dhan OAuth/consent flow: validates and consumes single-use state,
   * exchanges code / tokenId for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/dhan/callback
   */
  @Get(':id/connect/dhan/callback')
  async completeDhanConnect(
    @Param('id') id: string,
    @Query('code') code?: string,
    @Query('tokenId') tokenId?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    const tokenCode = code?.trim() || tokenId?.trim();
    if (!tokenCode) {
      throw new BadRequestException('Authorization code / tokenId is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.DHAN) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not DHAN`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.DHAN);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: tokenCode,
      redirectUri,
    });

    // Verify profile using Dhan adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Start FYERS OAuth flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/fyers
   */
  @Get(':id/connect/fyers')
  async startFyersConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.FYERS) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not FYERS`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.FYERS);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete FYERS OAuth flow: validates and consumes single-use state,
   * exchanges code for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/fyers/callback
   */
  @Get(':id/connect/fyers/callback')
  async completeFyersConnect(
    @Param('id') id: string,
    @Query('code') code?: string,
    @Query('auth_code') authCode?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    const tokenCode = code?.trim() || authCode?.trim();
    if (!tokenCode) {
      throw new BadRequestException('Authorization code is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.FYERS) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not FYERS`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.FYERS);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: tokenCode,
      redirectUri,
    });

    // Verify profile using FYERS adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Start Zerodha Kite OAuth flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/zerodha
   */
  @Get(':id/connect/zerodha')
  async startZerodhaConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.ZERODHA) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not ZERODHA`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.ZERODHA);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete Zerodha Kite OAuth flow: validates and consumes single-use state,
   * exchanges request_token/code for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/zerodha/callback
   */
  @Get(':id/connect/zerodha/callback')
  async completeZerodhaConnect(
    @Param('id') id: string,
    @Query('request_token') requestToken?: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    const tokenCode = requestToken?.trim() || code?.trim();
    if (!tokenCode) {
      throw new BadRequestException('Request token / authorization code is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.ZERODHA) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not ZERODHA`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.ZERODHA);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: tokenCode,
      redirectUri,
    });

    // Verify profile using Zerodha adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Start Groww OAuth flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/groww
   */
  @Get(':id/connect/groww')
  async startGrowwConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.GROWW) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not GROWW`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.GROWW);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete Groww OAuth flow: validates and consumes single-use state,
   * exchanges code for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/groww/callback
   */
  @Get(':id/connect/groww/callback')
  async completeGrowwConnect(
    @Param('id') id: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    const tokenCode = code?.trim();
    if (!tokenCode) {
      throw new BadRequestException('Authorization code is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.GROWW) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not GROWW`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.GROWW);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: tokenCode,
      redirectUri,
    });

    // Verify profile using Groww adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Start Millions by Dhan OAuth/consent flow: validates account ownership, sets connection to PENDING,
   * generates cryptographically secure state bound to user & account, and returns authorization URL.
   * GET /api/v1/broker-accounts/:id/connect/millions
   */
  @Get(':id/connect/millions')
  async startMillionsConnect(
    @Param('id') id: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<{ authorizationUrl: string }> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.MILLIONS) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not MILLIONS`,
      );
    }

    await this.brokerConnectionService.markPending(authUserId, id.trim());

    const adapter = this.brokerRegistry.getAdapter(BrokerType.MILLIONS);
    const state = this.oauthStateService.generateState(authUserId, id.trim());

    const authorizationUrl = await adapter.getAuthorizationUrl({
      state,
      redirectUri,
    });
    return { authorizationUrl };
  }

  /**
   * Complete Millions by Dhan OAuth/consent flow: validates and consumes single-use state,
   * exchanges code / tokenId for tokens, retrieves profile, securely encrypts and stores tokens,
   * and marks connection CONNECTED.
   * Never exposes or logs raw tokens.
   * GET /api/v1/broker-accounts/:id/connect/millions/callback
   */
  @Get(':id/connect/millions/callback')
  async completeMillionsConnect(
    @Param('id') id: string,
    @Query('code') code?: string,
    @Query('tokenId') tokenId?: string,
    @Query('state') state?: string,
    @Query('redirectUri') redirectUri?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    const tokenCode = code?.trim() || tokenId?.trim();
    if (!tokenCode) {
      throw new BadRequestException('Authorization code / tokenId is required');
    }

    // Require, verify, and single-use invalidate the OAuth state before token exchange
    this.oauthStateService.validateAndConsumeState(
      state,
      authUserId,
      id.trim(),
    );

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    if (account.broker !== BrokerType.MILLIONS) {
      throw new BadRequestException(
        `Account is configured for broker ${account.broker}, not MILLIONS`,
      );
    }

    const adapter = this.brokerRegistry.getAdapter(BrokerType.MILLIONS);
    const tokens = await adapter.exchangeAuthorizationCode({
      code: tokenCode,
      redirectUri,
    });

    // Verify profile using Millions adapter
    await adapter.getProfile(tokens, id.trim());

    // Persist tokens securely and mark status CONNECTED
    const connection = await this.brokerConnectionService.saveTokens(
      authUserId,
      id.trim(),
      tokens,
    );

    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Retrieves normalized holdings for the authenticated connected broker account.
   * Tokens are decrypted in memory only and never exposed.
   * GET /api/v1/broker-accounts/:id/holdings
   */
  @Get(':id/holdings')
  async getHoldings(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<NormalizedHolding[]> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    const tokens = await this.brokerConnectionService.getDecryptedTokens(
      authUserId,
      id.trim(),
    );

    const adapter = this.brokerRegistry.getAdapter(account.broker);
    return adapter.getHoldings(tokens, id.trim());
  }

  /**
   * Retrieves today's normalized trades for the authenticated connected broker account.
   * Tokens are decrypted in memory only and never exposed.
   * GET /api/v1/broker-accounts/:id/trades
   */
  @Get(':id/trades')
  async getTrades(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<NormalizedTrade[]> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    const tokens = await this.brokerConnectionService.getDecryptedTokens(
      authUserId,
      id.trim(),
    );

    const adapter = this.brokerRegistry.getAdapter(account.broker);
    return adapter.getTrades(tokens, id.trim());
  }

  /**
   * Retrieves real-time normalized quote for an instrument by ISIN and Exchange.
   * Tokens are decrypted in memory only and never exposed.
   * GET /api/v1/broker-accounts/:id/quote?isin=...&exchange=...
   */
  @Get(':id/quote')
  async getQuote(
    @Param('id') id: string,
    @Query('isin') isin?: string,
    @Query('exchange') exchangeStr?: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<NormalizedQuote> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    if (!isin || typeof isin !== 'string' || !isin.trim()) {
      throw new BadRequestException('ISIN query parameter is required');
    }

    let exchange: ExchangeListing = ExchangeListing.NSE;
    if (exchangeStr && typeof exchangeStr === 'string' && exchangeStr.trim()) {
      const normalizedExchange = exchangeStr.trim().toUpperCase();
      if (normalizedExchange === 'BSE') {
        exchange = ExchangeListing.BSE;
      } else if (normalizedExchange === 'NSE') {
        exchange = ExchangeListing.NSE;
      } else {
        throw new BadRequestException(`Unsupported exchange: ${exchangeStr}`);
      }
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );

    const tokens = await this.brokerConnectionService.getDecryptedTokens(
      authUserId,
      id.trim(),
    );

    const adapter = this.brokerRegistry.getAdapter(account.broker);
    return adapter.getQuote(tokens, isin.trim(), exchange);
  }

  /**
   * Get single broker account with ownership enforcement.
   * GET /api/v1/broker-accounts/:id
   */
  @Get(':id')
  async getAccount(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerAccountResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.getAccount(
      authUserId,
      id.trim(),
    );
    return mapAccountToSafeResponse(account);
  }

  /**
   * Get connection status metadata.
   * GET /api/v1/broker-accounts/:id/connection
   */
  @Get(':id/connection')
  async getConnection(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerConnectionResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const connection = await this.brokerConnectionService.getConnection(
      authUserId,
      id.trim(),
    );
    return mapConnectionToSafeResponse(connection);
  }

  /**
   * Soft-disconnect broker account (preserves historical data).
   * POST /api/v1/broker-accounts/:id/disconnect
   */
  @Post(':id/disconnect')
  @HttpCode(HttpStatus.OK)
  async disconnectAccount(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ): Promise<BrokerAccountResponseDto> {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.brokerAccountService.deactivate(
      authUserId,
      id.trim(),
    );
    return mapAccountToSafeResponse(account);
  }

  /**
   * Records initial IPO investment basis for an allotment under the connected account.
   * Matches primarily by ISIN and validates ownership boundaries.
   * POST /api/v1/broker-accounts/:id/investments/match
   */
  @Post(':id/investments/match')
  @HttpCode(HttpStatus.OK)
  async recordAllotmentInvestment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-user-id') userId?: string,
  ) {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const parseResult = recordAllotmentInvestmentSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((issue) => issue.message)
        .join('; ');
      throw new BadRequestException(errorMessage || 'Invalid request body');
    }

    return this.brokerInvestmentService.recordAllotmentInvestment(
      authUserId,
      id.trim(),
      parseResult.data,
    );
  }

  /**
   * Retrieves derived IPO investment summary (allotment basis, sell trades, remaining quantity, holding status).
   * GET /api/v1/broker-accounts/:id/investments/:ipoId
   */
  @Get(':id/investments/:ipoId')
  async getInvestmentSummary(
    @Param('id') id: string,
    @Param('ipoId') ipoId: string,
    @Headers('x-user-id') userId?: string,
  ) {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    if (!ipoId || typeof ipoId !== 'string' || !ipoId.trim()) {
      throw new BadRequestException('IPO ID is required');
    }

    return this.brokerInvestmentService.getDerivedInvestmentSummary(
      authUserId,
      id.trim(),
      ipoId.trim(),
    );
  }

  /**
   * Fetches live Upstox portfolio data in memory, persists holdings/trades, and returns updated investment summary.
   * POST /api/v1/broker-accounts/:id/investments/:ipoId/sync
   */
  @Post(':id/investments/:ipoId/sync')
  @HttpCode(HttpStatus.OK)
  async syncInvestment(
    @Param('id') id: string,
    @Param('ipoId') ipoId: string,
    @Headers('x-user-id') userId?: string,
  ) {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    if (!ipoId || typeof ipoId !== 'string' || !ipoId.trim()) {
      throw new BadRequestException('IPO ID is required');
    }

    return this.brokerInvestmentService.syncAndMatchInvestment(
      authUserId,
      id.trim(),
      ipoId.trim(),
    );
  }

  /**
   * Manual "Sync Now" endpoint for an authenticated connected broker account.
   * Syncs today's trades, holdings, quotes for open positions, and post-listing IPO investments.
   * POST /api/v1/broker-accounts/:id/sync
   */
  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  async syncAccountNow(
    @Param('id') id: string,
    @Headers('x-user-id') userId?: string,
  ) {
    const authUserId = this.getAuthenticatedUserId(userId);
    if (!id || typeof id !== 'string' || !id.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    return this.brokerInvestmentService.syncAccountPostListingInvestments(
      authUserId,
      id.trim(),
    );
  }
}



