import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { BrokerConnectionStatus, BrokerType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { BrokerRegistry } from './broker.registry';

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly brokerRegistry?: BrokerRegistry,
  ) {}

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
   * Creates a new BrokerAccount (validating server credentials first) or reuses an existing
   * account for the (userId, profileId, broker) tuple idempotently.
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
      include: {
        connection: {
          select: CONNECTION_SELECT,
        },
      },
    });

    if (existing) {
      // If metadata like accountName or clientId changed, update it; otherwise return existing
      const newAccountName = accountName?.trim() || null;
      const newClientId = clientId?.trim() || null;

      const hasNameChange = accountName !== undefined && newAccountName !== existing.accountName;
      const hasClientChange = clientId !== undefined && newClientId !== existing.clientId;

      if (hasNameChange || hasClientChange) {
        return this.prisma.brokerAccount.update({
          where: { id: existing.id },
          data: {
            accountName: hasNameChange ? newAccountName : existing.accountName,
            clientId: hasClientChange ? newClientId : existing.clientId,
            isActive: true,
          },
          include: {
            connection: {
              select: CONNECTION_SELECT,
            },
          },
        });
      }

      return existing;
    }

    // Validate broker adapter exists and credentials are configured before inserting into DB
    if (this.brokerRegistry) {
      const adapter = this.brokerRegistry.getAdapter(broker);
      if (typeof adapter.validateConfiguration === 'function') {
        adapter.validateConfiguration();
      }
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
