import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrokerConnectionStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BrokerAccountService } from './broker-account.service';

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
}
