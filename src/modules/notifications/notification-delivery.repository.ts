import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationResponseDto } from './dto/notification.dto';
import {
  DeliveryChannel,
  DeliveryClaimResult,
  DeliveryRecord,
  DeliveryStatus,
} from './notification.types';

/**
 * Raw Prisma NotificationDelivery shape returned by queries.
 */
type PrismaDelivery = {
  id: string;
  notificationId: string;
  channel: string;
  status: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  processingStartedAt: Date | null;
  deliveredAt: Date | null;
  failureReason: string | null;
  providerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface DeliveryWithNotificationCandidate {
  delivery: DeliveryRecord;
  notification: NotificationResponseDto;
}

/**
 * NotificationDeliveryRepository
 *
 * Responsibilities:
 *   - Create/upsert delivery records with @@unique([notificationId, channel]) enforcement.
 *   - Look up delivery records by (notificationId, channel).
 *   - Update delivery state (status, attemptCount, timestamps, failureReason).
 *   - Atomically claim delivery attempts (Phase 29.5) to prevent concurrent adapter execution.
 *   - Atomically recover stale PROCESSING deliveries (Phase 29.6).
 *   - Bounded candidate selection for worker processing (Phase 29.6).
 *
 * Does NOT:
 *   - Generate notifications.
 *   - Evaluate preferences.
 *   - Call external providers.
 *   - Store PAN, panHash, panEncrypted, or identifierHash.
 *
 * Concurrency: The @@unique constraint on (notificationId, channel) is the
 * authoritative creation safeguard. Atomic claims via claimDelivery() are the
 * authoritative execution safeguard (Phase 29.5).
 */
@Injectable()
export class NotificationDeliveryRepository {
  private readonly logger = new Logger(NotificationDeliveryRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically transitions a delivery record from expectedStatus -> PROCESSING
   * and increments attemptCount in DB. Sets processingStartedAt timestamp for lease tracking.
   *
   * Returns 'CLAIMED' if this caller won the claim race (count === 1).
   * Returns 'NOT_CLAIMED' if another caller won or status changed (count === 0).
   */
  async claimDelivery(
    id: string,
    expectedStatus: DeliveryStatus,
  ): Promise<DeliveryClaimResult> {
    const now = new Date();
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        id,
        status: expectedStatus,
      },
      data: {
        status: DeliveryStatus.PROCESSING,
        lastAttemptAt: now,
        processingStartedAt: now,
        attemptCount: { increment: 1 },
      },
    });

    return result.count === 1 ? 'CLAIMED' : 'NOT_CLAIMED';
  }

  /**
   * Atomically finalizes a delivery record from PROCESSING -> DELIVERED or FAILED.
   * Clears processingStartedAt lease timestamp on completion/failure.
   * Prevents stale callers from overwriting state if status is no longer PROCESSING.
   *
   * Returns updated DeliveryRecord on success, or null if record was not in PROCESSING state.
   */
  async conditionalFinalizeDelivery(
    id: string,
    patch: {
      status: DeliveryStatus;
      deliveredAt?: Date | null;
      failureReason?: string | null;
      providerMessageId?: string | null;
    },
  ): Promise<DeliveryRecord | null> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        id,
        status: DeliveryStatus.PROCESSING,
      },
      data: {
        ...patch,
        processingStartedAt: null,
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findDeliveryById(id);
  }

  /**
   * Atomically recovers stale PROCESSING deliveries where processingStartedAt < staleThreshold.
   * Transitions PROCESSING -> FAILED with failureReason = 'Stale processing lease expired'.
   * Returns count of recovered records.
   */
  async recoverStaleDeliveries(staleThreshold: Date): Promise<number> {
    const result = await this.prisma.notificationDelivery.updateMany({
      where: {
        status: DeliveryStatus.PROCESSING,
        processingStartedAt: {
          lt: staleThreshold,
        },
      },
      data: {
        status: DeliveryStatus.FAILED,
        processingStartedAt: null,
        failureReason: 'Stale processing lease expired',
      },
    });

    if (result.count > 0) {
      this.logger.warn(
        `Recovered ${result.count} stale PROCESSING deliveries older than ${staleThreshold.toISOString()}`,
      );
    }

    return result.count;
  }

  /**
   * Queries bounded candidate deliveries (PENDING or non-exhausted FAILED) for worker execution.
   * Excludes exhausted FAILED deliveries (attemptCount >= maxAttempts) at the database query level
   * to prevent candidate batch starvation.
   * Uses bounded query (take: limit) ordered by createdAt ASC to maintain fairness.
   * Returns candidates with their parent Notification DTOs.
   */
  async findEligibleDeliveries(
    limit: number,
    maxAttempts: number = 5,
  ): Promise<DeliveryWithNotificationCandidate[]> {
    const records = await this.prisma.notificationDelivery.findMany({
      where: {
        OR: [
          { status: DeliveryStatus.PENDING },
          {
            status: DeliveryStatus.FAILED,
            attemptCount: { lt: maxAttempts },
          },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
      include: {
        notification: true,
      },
    });

    return records.map((raw) => ({
      delivery: this.mapToRecord(raw),
      notification: {
        id: raw.notification.id,
        type: raw.notification.type as any,
        title: raw.notification.title,
        message: raw.notification.message,
        relatedEntityType: raw.notification.relatedEntityType,
        relatedEntityId: raw.notification.relatedEntityId,
        metadata: (raw.notification.metadata as Record<string, unknown>) ?? null,
        deduplicationKey: raw.notification.deduplicationKey,
        readAt: raw.notification.readAt ? raw.notification.readAt.toISOString() : null,
        createdAt: raw.notification.createdAt.toISOString(),
      },
    }));
  }

  /**
   * Creates a PENDING delivery record for (notificationId, channel).
   * If a record already exists (P2002 or upsert conflict), the existing record is returned.
   * This ensures idempotent creation under concurrent orchestration calls.
   */
  async createDelivery(
    notificationId: string,
    channel: DeliveryChannel,
  ): Promise<DeliveryRecord> {
    try {
      const record = await this.prisma.notificationDelivery.upsert({
        where: {
          notificationId_channel: {
            notificationId,
            channel,
          },
        },
        create: {
          notificationId,
          channel,
          status: DeliveryStatus.PENDING,
          attemptCount: 0,
        },
        update: {}, // No-op if already exists — preserves current state
      });

      this.logger.debug(
        `Delivery record created/found: notificationId=${notificationId} channel=${channel} status=${record.status}`,
      );

      return this.mapToRecord(record);
    } catch (err: unknown) {
      // Narrow P2002 handling for concurrent creation — fallback to findUnique
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(
          `Delivery record P2002 conflict suppressed: notificationId=${notificationId} channel=${channel}`,
        );
        const existing = await this.findDelivery(notificationId, channel);
        if (existing) {
          return existing;
        }
      }
      throw err;
    }
  }

  /**
   * Retrieves a delivery record by (notificationId, channel).
   * Returns null if not found.
   */
  async findDelivery(
    notificationId: string,
    channel: DeliveryChannel,
  ): Promise<DeliveryRecord | null> {
    const record = await this.prisma.notificationDelivery.findUnique({
      where: {
        notificationId_channel: {
          notificationId,
          channel,
        },
      },
    });

    return record ? this.mapToRecord(record) : null;
  }

  /**
   * Finds a delivery record by ID (used for state transitions).
   */
  async findDeliveryById(id: string): Promise<DeliveryRecord | null> {
    const record = await this.prisma.notificationDelivery.findUnique({
      where: { id },
    });
    return record ? this.mapToRecord(record) : null;
  }

  /**
   * Updates specific fields on a delivery record (explicit patch, not full replace).
   * Caller is responsible for enforcing valid state transitions before calling.
   */
  async updateDelivery(
    id: string,
    patch: {
      status?: DeliveryStatus;
      attemptCount?: number;
      lastAttemptAt?: Date;
      processingStartedAt?: Date | null;
      deliveredAt?: Date | null;
      failureReason?: string | null;
      providerMessageId?: string | null;
    },
  ): Promise<DeliveryRecord> {
    const updated = await this.prisma.notificationDelivery.update({
      where: { id },
      data: patch,
    });
    return this.mapToRecord(updated);
  }

  /**
   * Efficiently computes database-level operational stats using count/groupBy/aggregate queries.
   * Avoids loading full table rows or N+1 queries.
   */
  async getAggregateOperationalStats(params: {
    maxAttempts: number;
    staleThreshold: Date;
    now: Date;
  }): Promise<{
    totalDeliveries: number;
    pendingCount: number;
    processingCount: number;
    deliveredCount: number;
    failedCount: number;
    exhaustedFailedCount: number;
    retryableFailedCount: number;
    staleProcessingCount: number;
    oldestPendingDeliveryAgeMs: number | null;
    oldestRetryableFailedDeliveryAgeMs: number | null;
    oldestProcessingDeliveryAgeMs: number | null;
  }> {
    const { maxAttempts, staleThreshold, now } = params;

    const [
      totalDeliveries,
      statusGroup,
      exhaustedFailedCount,
      retryableFailedCount,
      staleProcessingCount,
      oldestPending,
      oldestRetryableFailed,
      oldestProcessing,
    ] = await Promise.all([
      this.prisma.notificationDelivery.count(),
      this.prisma.notificationDelivery.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: DeliveryStatus.FAILED,
          attemptCount: { gte: maxAttempts },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: DeliveryStatus.FAILED,
          attemptCount: { lt: maxAttempts },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: DeliveryStatus.PROCESSING,
          processingStartedAt: { lt: staleThreshold },
        },
      }),
      this.prisma.notificationDelivery.findFirst({
        where: { status: DeliveryStatus.PENDING },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.notificationDelivery.findFirst({
        where: {
          status: DeliveryStatus.FAILED,
          attemptCount: { lt: maxAttempts },
        },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.notificationDelivery.findFirst({
        where: { status: DeliveryStatus.PROCESSING },
        orderBy: { processingStartedAt: 'asc' },
        select: { processingStartedAt: true, createdAt: true },
      }),
    ]);

    const statusCountsMap: Record<string, number> = {};
    statusGroup.forEach((g) => {
      statusCountsMap[g.status] = g._count.id;
    });

    const nowMs = now.getTime();

    const oldestPendingDeliveryAgeMs = oldestPending
      ? Math.max(0, nowMs - oldestPending.createdAt.getTime())
      : null;

    const oldestRetryableFailedDeliveryAgeMs = oldestRetryableFailed
      ? Math.max(0, nowMs - oldestRetryableFailed.createdAt.getTime())
      : null;

    const oldestProcessingTime = oldestProcessing
      ? (oldestProcessing.processingStartedAt ?? oldestProcessing.createdAt).getTime()
      : null;

    const oldestProcessingDeliveryAgeMs = oldestProcessingTime
      ? Math.max(0, nowMs - oldestProcessingTime)
      : null;

    return {
      totalDeliveries,
      pendingCount: statusCountsMap[DeliveryStatus.PENDING] || 0,
      processingCount: statusCountsMap[DeliveryStatus.PROCESSING] || 0,
      deliveredCount: statusCountsMap[DeliveryStatus.DELIVERED] || 0,
      failedCount: statusCountsMap[DeliveryStatus.FAILED] || 0,
      exhaustedFailedCount,
      retryableFailedCount,
      staleProcessingCount,
      oldestPendingDeliveryAgeMs,
      oldestRetryableFailedDeliveryAgeMs,
      oldestProcessingDeliveryAgeMs,
    };
  }

  /**
   * Efficiently computes database-level recent health stats for a time window (e.g. 24h).
   */
  async getRecentHealthStats(params: {
    windowStart: Date;
    maxAttempts: number;
  }): Promise<{
    deliveriesCreated: number;
    delivered: number;
    failed: number;
    exhausted: number;
    retryAttempts: number;
  }> {
    const { windowStart, maxAttempts } = params;

    const [
      deliveriesCreated,
      delivered,
      failed,
      exhausted,
      attemptAgg,
    ] = await Promise.all([
      this.prisma.notificationDelivery.count({
        where: { createdAt: { gte: windowStart } },
      }),
      this.prisma.notificationDelivery.count({
        where: { deliveredAt: { gte: windowStart } },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: DeliveryStatus.FAILED,
          updatedAt: { gte: windowStart },
        },
      }),
      this.prisma.notificationDelivery.count({
        where: {
          status: DeliveryStatus.FAILED,
          attemptCount: { gte: maxAttempts },
          updatedAt: { gte: windowStart },
        },
      }),
      this.prisma.notificationDelivery.aggregate({
        where: { lastAttemptAt: { gte: windowStart } },
        _sum: { attemptCount: true },
      }),
    ]);

    return {
      deliveriesCreated,
      delivered,
      failed,
      exhausted,
      retryAttempts: attemptAgg._sum?.attemptCount || 0,
    };
  }

  private mapToRecord(raw: PrismaDelivery): DeliveryRecord {
    return {
      id: raw.id,
      notificationId: raw.notificationId,
      channel: raw.channel as DeliveryChannel,
      status: raw.status as DeliveryStatus,
      attemptCount: raw.attemptCount,
      lastAttemptAt: raw.lastAttemptAt ? raw.lastAttemptAt.toISOString() : null,
      processingStartedAt: raw.processingStartedAt ? raw.processingStartedAt.toISOString() : null,
      deliveredAt: raw.deliveredAt ? raw.deliveredAt.toISOString() : null,
      failureReason: raw.failureReason,
      providerMessageId: raw.providerMessageId,
      createdAt: raw.createdAt.toISOString(),
      updatedAt: raw.updatedAt.toISOString(),
    };
  }
}
