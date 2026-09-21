import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrokerConnectionStatus, BrokerType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface CreateBrokerAccountInput {
  userId: string;
  profileId: string;
  broker: BrokerType;
  accountName?: string;
  clientId?: string;
}

const CONNECTION_SELECT = {
  id: true,
  status: true,
  connectedAt: true,
  lastSyncAt: true,
  lastErrorAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class BrokerAccountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reusable ownership check ensuring account exists and belongs to the specified userId.
   */
  async verifyOwnership(userId: string, accountId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new BadRequestException('Account ID is required');
    }

    const account = await this.prisma.brokerAccount.findFirst({
      where: {
        id: accountId.trim(),
        userId: userId.trim(),
      },
      include: {
        connection: {
          select: CONNECTION_SELECT,
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Broker account not found');
    }

    return account;
  }

  /**
   * Creates a new BrokerAccount and initializes its BrokerConnection as PENDING atomically.
   */
  async createAccount(input: CreateBrokerAccountInput) {
    const { userId, profileId, broker, accountName, clientId } = input;

    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('userId is required');
    }
    if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
      throw new BadRequestException('profileId is required');
    }
    if (!broker || !Object.values(BrokerType).includes(broker)) {
      throw new BadRequestException(
        `Valid broker type is required (${Object.values(BrokerType).join(', ')})`,
      );
    }

    const trimmedUserId = userId.trim();
    const trimmedProfileId = profileId.trim();

    // Check if account already exists for (userId, profileId, broker)
    const existing = await this.prisma.brokerAccount.findUnique({
      where: {
        userId_profileId_broker: {
          userId: trimmedUserId,
          profileId: trimmedProfileId,
          broker,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Broker account for ${broker} already exists on profile ${trimmedProfileId}`,
      );
    }

    // Atomic transaction: create account and pending connection
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.brokerAccount.create({
        data: {
          userId: trimmedUserId,
          profileId: trimmedProfileId,
          broker,
          accountName: accountName?.trim() || null,
          clientId: clientId?.trim() || null,
          isActive: true,
          connection: {
            create: {
              status: BrokerConnectionStatus.PENDING,
            },
          },
        },
        include: {
          connection: {
            select: CONNECTION_SELECT,
          },
        },
      });

      return account;
    });
  }

  /**
   * Retrieves all BrokerAccounts belonging to the authenticated userId.
   */
  async getAccounts(userId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }

    return this.prisma.brokerAccount.findMany({
      where: {
        userId: userId.trim(),
      },
      include: {
        connection: {
          select: CONNECTION_SELECT,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Retrieves a single BrokerAccount enforcing strict userId ownership.
   */
  async getAccount(userId: string, accountId: string) {
    return this.verifyOwnership(userId, accountId);
  }

  /**
   * Retrieves all BrokerAccounts for a specific profile, enforcing both userId and profileId.
   */
  async getProfileAccounts(userId: string, profileId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
      throw new BadRequestException('Profile ID is required');
    }

    return this.prisma.brokerAccount.findMany({
      where: {
        userId: userId.trim(),
        profileId: profileId.trim(),
      },
      include: {
        connection: {
          select: CONNECTION_SELECT,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Deactivates a BrokerAccount (soft state change) and sets its connection status to DISCONNECTED.
   * Preserves all historical records (holdings, trades, investments).
   */
  async deactivate(userId: string, accountId: string) {
    // 1. Verify ownership first
    const account = await this.verifyOwnership(userId, accountId);

    // 2. Perform atomic soft deactivation
    return this.prisma.$transaction(async (tx) => {
      await tx.brokerAccount.update({
        where: { id: account.id },
        data: {
          isActive: false,
        },
      });

      await tx.brokerConnection.updateMany({
        where: { brokerAccountId: account.id },
        data: {
          status: BrokerConnectionStatus.DISCONNECTED,
        },
      });

      const finalAccount = await tx.brokerAccount.findUnique({
        where: { id: account.id },
        include: {
          connection: {
            select: CONNECTION_SELECT,
          },
        },
      });

      if (!finalAccount) {
        throw new NotFoundException('Broker account not found');
      }

      return finalAccount;
    });
  }
}
