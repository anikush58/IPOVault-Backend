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
    const trimmedClientId = clientId?.trim() || null;
    const trimmedAccountName = accountName?.trim() || null;

    // Fast-path: check if account already exists for (userId, profileId, broker)
    // and requires no updates (read optimization)
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

    if (
      existing &&
      existing.isActive &&
      (accountName === undefined || trimmedAccountName === existing.accountName) &&
      (clientId === undefined || trimmedClientId === existing.clientId)
    ) {
      return existing;
    }

    // Validate broker adapter exists and credentials are configured before entering transaction
    if (this.brokerRegistry) {
      const adapter = this.brokerRegistry.getAdapter(broker);
      if (typeof adapter.validateConfiguration === 'function') {
        adapter.validateConfiguration();
      }
    }

    // Atomic transaction serialized via PostgreSQL transaction-level advisory lock:
    // Ensures concurrent requests for the same (userId, broker) cannot race to create duplicates.
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Acquire transaction-scoped advisory lock for (userId, broker)
        if (typeof (tx as any).$executeRaw === 'function') {
          const lockKey = `${trimmedUserId}:${broker}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('broker_account'), hashtext(${lockKey}));`;
        }

        // Re-check by (userId, profileId, broker) inside the locked transaction
        let targetAccount = await tx.brokerAccount.findUnique({
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

        // If not found by (userId, profileId, broker), check if this user already has an account
        // for this broker with the exact same clientId (e.g. re-linking after local profile migration/restore or sync)
        if (!targetAccount && trimmedClientId) {
          targetAccount = await tx.brokerAccount.findFirst({
            where: {
              userId: trimmedUserId,
              broker,
              clientId: trimmedClientId,
            },
            include: {
              connection: {
                select: CONNECTION_SELECT,
              },
            },
          });
        }

        if (targetAccount) {
          // If metadata like accountName, clientId, or profileId changed, update it; otherwise return targetAccount
          const hasNameChange = accountName !== undefined && trimmedAccountName !== targetAccount.accountName;
          const hasClientChange = clientId !== undefined && trimmedClientId !== targetAccount.clientId;
          const hasProfileChange = targetAccount.profileId !== trimmedProfileId;

          if (hasNameChange || hasClientChange || hasProfileChange || !targetAccount.isActive) {
            return await tx.brokerAccount.update({
              where: { id: targetAccount.id },
              data: {
                ...(hasProfileChange ? { profileId: trimmedProfileId } : {}),
                accountName: hasNameChange ? trimmedAccountName : targetAccount.accountName,
                clientId: hasClientChange ? trimmedClientId : targetAccount.clientId,
                isActive: true,
              },
              include: {
                connection: {
                  select: CONNECTION_SELECT,
                },
              },
            });
          }

          return targetAccount;
        }

        // Create new account and pending connection
        return await tx.brokerAccount.create({
          data: {
            userId: trimmedUserId,
            profileId: trimmedProfileId,
            broker,
            accountName: trimmedAccountName,
            clientId: trimmedClientId,
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
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Concurrently created by a parallel request -> return the existing record
        return await this.prisma.brokerAccount.findUniqueOrThrow({
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
      }
      throw err;
    }
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
   * Enriches an existing BrokerAccount with verified profile details (UCC/clientId, accountName)
   * returned directly by the broker provider upon successful OAuth completion.
   * Strictly preserves userId and profileId mapping (never relinks ownership or changes family member).
   */
  async updateVerifiedProfile(
    userId: string,
    accountId: string,
    profile: { clientId?: string | null; accountName?: string | null },
  ) {
    const account = await this.verifyOwnership(userId, accountId);
    const updateData: { clientId?: string; accountName?: string } = {};

    const trimmedClientId = profile.clientId?.trim();
    if (trimmedClientId && (!account.clientId || account.clientId !== trimmedClientId)) {
      updateData.clientId = trimmedClientId;
    }

    const trimmedName = profile.accountName?.trim();
    if (trimmedName && !account.accountName) {
      updateData.accountName = trimmedName;
    }

    if (Object.keys(updateData).length === 0) {
      return account;
    }

    return this.prisma.brokerAccount.update({
      where: { id: account.id },
      data: updateData,
      include: {
        connection: {
          select: CONNECTION_SELECT,
        },
      },
    });
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
