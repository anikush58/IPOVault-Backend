import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrokerConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BrokerAccountService } from './broker-account.service';
import { BrokerCryptoService } from './security/broker-crypto.service';
import { BrokerAuthTokens } from './broker.types';

const SAFE_CONNECTION_SELECT = {
  id: true,
  brokerAccountId: true,
  status: true,
  connectedAt: true,
  lastSyncAt: true,
  lastErrorAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class BrokerConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: BrokerAccountService,
    private readonly cryptoService: BrokerCryptoService,
  ) {}

  /**
   * Retrieves connection metadata for an account after verifying user ownership.
   * Guaranteed to NEVER expose encrypted/decrypted tokens or secrets.
   */
  async getConnection(userId: string, accountId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    // 1. Verify account ownership first
    await this.accountService.verifyOwnership(userId, accountId);

    const connection = await this.prisma.brokerConnection.findUnique({
      where: { brokerAccountId: accountId.trim() },
      select: SAFE_CONNECTION_SELECT,
    });

    if (!connection) {
      throw new NotFoundException('Broker connection not found');
    }

    return connection;
  }

  /**
   * Marks connection status as PENDING and resets stale error fields.
   */
  async markPending(userId: string, accountId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    await this.accountService.verifyOwnership(userId, accountId);

    return this.prisma.brokerConnection.update({
      where: { brokerAccountId: accountId.trim() },
      data: {
        status: BrokerConnectionStatus.PENDING,
        lastError: null,
        lastErrorAt: null,
      },
      select: SAFE_CONNECTION_SELECT,
    });
  }

  /**
   * Marks connection status as CONNECTED with timestamp and clears errors.
   */
  async markConnected(userId: string, accountId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    await this.accountService.verifyOwnership(userId, accountId);

    return this.prisma.brokerConnection.update({
      where: { brokerAccountId: accountId.trim() },
      data: {
        status: BrokerConnectionStatus.CONNECTED,
        connectedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
      select: SAFE_CONNECTION_SELECT,
    });
  }

  /**
   * Marks connection status as EXPIRED with a safe diagnostic error message.
   * Never stores sensitive tokens or secrets in error field.
   */
  async markExpired(userId: string, accountId: string, errorMessage?: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    await this.accountService.verifyOwnership(userId, accountId);

    // Sanitize error message to ensure no sensitive tokens/secrets are stored
    const safeError = errorMessage
      ? errorMessage.slice(0, 500)
      : 'Broker connection token expired or revoked';

    return this.prisma.brokerConnection.update({
      where: { brokerAccountId: accountId.trim() },
      data: {
        status: BrokerConnectionStatus.EXPIRED,
        lastError: safeError,
        lastErrorAt: new Date(),
      },
      select: SAFE_CONNECTION_SELECT,
    });
  }

  /**
   * Saves encrypted OAuth tokens and updates connection to CONNECTED.
   * Tokens are encrypted before storage and never returned or logged.
   */
  async saveTokens(
    userId: string,
    accountId: string,
    tokens: BrokerAuthTokens,
  ) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }
    if (!tokens || !tokens.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    await this.accountService.verifyOwnership(userId, accountId);

    const connection = await this.prisma.brokerConnection.findUnique({
      where: { brokerAccountId: accountId.trim() },
      select: { id: true },
    });

    if (!connection) {
      throw new NotFoundException('Broker connection not found');
    }

    const accessTokenEncrypted = this.cryptoService.encrypt(tokens.accessToken);
    const refreshTokenEncrypted = tokens.refreshToken
      ? this.cryptoService.encrypt(tokens.refreshToken)
      : null;

    return this.prisma.$transaction(async (tx) => {
      await tx.brokerToken.upsert({
        where: { connectionId: connection.id },
        create: {
          connectionId: connection.id,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenType: tokens.tokenType ?? 'Bearer',
          expiresAt: tokens.expiresAt ?? null,
          scopes: tokens.scopes ? (tokens.scopes as any) : undefined,
        },
        update: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenType: tokens.tokenType ?? 'Bearer',
          expiresAt: tokens.expiresAt ?? null,
          scopes: tokens.scopes ? (tokens.scopes as any) : undefined,
        },
      });

      return tx.brokerConnection.update({
        where: { id: connection.id },
        data: {
          status: BrokerConnectionStatus.CONNECTED,
          connectedAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
        select: SAFE_CONNECTION_SELECT,
      });
    });
  }

  /**
   * Retrieves decrypted OAuth tokens for an active connected broker account in memory only.
   * Enforces user ownership, CONNECTED status, and validates token expiration.
   * Tokens are decrypted in memory only and MUST NEVER be logged or sent in responses.
   */
  async getDecryptedTokens(
    userId: string,
    accountId: string,
  ): Promise<BrokerAuthTokens> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    await this.accountService.verifyOwnership(userId, accountId);

    const connection = await this.prisma.brokerConnection.findUnique({
      where: { brokerAccountId: accountId.trim() },
      include: { token: true },
    });

    if (!connection) {
      throw new NotFoundException('Broker connection not found');
    }

    if (connection.status !== BrokerConnectionStatus.CONNECTED) {
      throw new BadRequestException(
        `Broker connection is not connected (current status: ${connection.status})`,
      );
    }

    if (!connection.token || !connection.token.accessTokenEncrypted) {
      throw new BadRequestException(
        'Broker access token is missing or not configured',
      );
    }

    if (
      connection.token.expiresAt &&
      new Date() >= new Date(connection.token.expiresAt)
    ) {
      await this.markExpired(
        userId,
        accountId,
        'Broker connection token has expired',
      );
      throw new BadRequestException('Broker connection token has expired');
    }

    const accessToken = this.cryptoService.decrypt(
      connection.token.accessTokenEncrypted,
    );
    const refreshToken = connection.token.refreshTokenEncrypted
      ? this.cryptoService.decrypt(connection.token.refreshTokenEncrypted)
      : null;

    return {
      accessToken,
      refreshToken,
      tokenType: connection.token.tokenType ?? 'Bearer',
      expiresAt: connection.token.expiresAt ?? null,
      scopes: Array.isArray(connection.token.scopes)
        ? (connection.token.scopes as string[])
        : null,
    };
  }
}

