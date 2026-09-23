import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';
import {
  AllotmentObservationContext,
  IpoNotificationContext,
  NotificationEventGenerator,
} from './notification-event.generator';
import { NotificationRepository } from './notification.repository';

export interface OrchestrationResult {
  evaluatedCount: number;
  createdCount: number;
  suppressedCount: number;
}

@Injectable()
export class NotificationOrchestratorService {
  private readonly logger = new Logger(NotificationOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: NotificationRepository,
    private readonly generator: NotificationEventGenerator,
    private readonly qualityGateService: DiscoveryQualityGateService,
  ) {}

  /**
   * Evaluates IPO lifecycle events (OPEN, CLOSE, LISTING) and generates user-scoped notifications.
   * Failure isolated: errors log diagnostics without throwing.
   */
  async processLifecycleEvents(options?: {
    ipoId?: string;
    userId?: string;
    targetUserIds?: string[];
  }): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const events = await this.prisma.ipoLifecycleEvent.findMany({
        where: options?.ipoId ? { ipoId: options.ipoId } : {},
        include: {
          ipo: {
            include: { company: true },
          },
        },
      });

      if (events.length === 0) {
        return result;
      }

      const targetUsers = await this.resolveTargetUserIds(options);
      if (targetUsers.length === 0) {
        this.logger.debug('No target users found for lifecycle notification evaluation');
        return result;
      }

      const evalDate = new Date();

      for (const event of events) {
        const ipoContext: IpoNotificationContext = {
          id: event.ipo.id,
          companyName: event.ipo.company.displayName || event.ipo.company.legalName,
          symbol: event.ipo.symbol,
          status: event.ipo.status,
          lotSize: event.ipo.lotSize,
          priceBandHigh: event.ipo.priceBandHigh ? Number(event.ipo.priceBandHigh) : null,
        };

        for (const userId of targetUsers) {
          result.evaluatedCount++;
          const input = this.generator.generateLifecycleNotification(
            userId,
            ipoContext,
            event,
            evalDate,
          );

          if (!input) {
            continue;
          }

          const created = await this.repository.createNotification(input);
          if (created) {
            result.createdCount++;
            this.logger.log(
              `Generated ${input.type} notification for user ${userId} (IPO ${ipoContext.id})`,
            );
          } else {
            result.suppressedCount++;
          }
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Lifecycle notification orchestration failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return result;
  }

  /**
   * Evaluates IPO data change events (IpoChangeEvent) and generates user-scoped notifications.
   * Failure isolated: errors log diagnostics without throwing.
   */
  async processChangeEvents(options?: {
    ipoId?: string;
    userId?: string;
    targetUserIds?: string[];
    limit?: number;
  }): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const changeEvents = await this.prisma.ipoChangeEvent.findMany({
        where: options?.ipoId ? { ipoId: options.ipoId } : {},
        orderBy: { detectedAt: 'desc' },
        take: options?.limit || 50,
        include: {
          ipo: {
            include: { company: true },
          },
        },
      });

      if (changeEvents.length === 0) {
        return result;
      }

      const targetUsers = await this.resolveTargetUserIds(options);
      if (targetUsers.length === 0) {
        return result;
      }

      for (const changeEvent of changeEvents) {
        const ipoContext: IpoNotificationContext = {
          id: changeEvent.ipo.id,
          companyName:
            changeEvent.ipo.company.displayName || changeEvent.ipo.company.legalName,
          symbol: changeEvent.ipo.symbol,
        };

        for (const userId of targetUsers) {
          result.evaluatedCount++;
          const input = this.generator.generateDataChangeNotification(
            userId,
            ipoContext,
            changeEvent,
          );

          const created = await this.repository.createNotification(input);
          if (created) {
            result.createdCount++;
            this.logger.log(
              `Generated IPO_DATA_CHANGED notification for user ${userId} (changeEvent ${changeEvent.id})`,
            );
          } else {
            result.suppressedCount++;
          }
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Data change notification orchestration failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return result;
  }

  /**
   * Evaluates IPO Quality Gate state via DiscoveryQualityGateService and generates quality warning notifications.
   * Triggers ONLY for NEEDS_REVIEW or INCOMPLETE states.
   * Failure isolated: errors log diagnostics without throwing.
   */
  async processQualityGate(options: {
    ipoId: string;
    userId?: string;
    targetUserIds?: string[];
  }): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const report = await this.qualityGateService.evaluateQualityGate(
        this.prisma,
        options.ipoId,
      );

      // Notify ONLY for actionable quality conditions: NEEDS_REVIEW or INCOMPLETE
      if (report.status !== 'NEEDS_REVIEW' && report.status !== 'INCOMPLETE') {
        this.logger.debug(
          `Quality gate status for IPO ${options.ipoId} is ${report.status} (no notification required)`,
        );
        return result;
      }

      const ipo = await this.prisma.ipo.findUnique({
        where: { id: options.ipoId },
        include: { company: true },
      });

      if (!ipo) {
        return result;
      }

      const ipoContext: IpoNotificationContext = {
        id: ipo.id,
        companyName: ipo.company.displayName || ipo.company.legalName,
        symbol: ipo.symbol,
      };

      const primaryReason =
        report.blockers[0]?.message ||
        report.warnings[0]?.message ||
        `IPO data status is ${report.status}`;

      const targetUsers = await this.resolveTargetUserIds(options);
      if (targetUsers.length === 0) {
        return result;
      }

      for (const userId of targetUsers) {
        result.evaluatedCount++;
        const input = this.generator.generateQualityWarningNotification(
          userId,
          ipoContext,
          report.status,
          primaryReason,
        );

        const created = await this.repository.createNotification(input);
        if (created) {
          result.createdCount++;
          this.logger.log(
            `Generated IPO_DATA_QUALITY_WARNING notification for user ${userId} (IPO ${ipo.id})`,
          );
        } else {
          result.suppressedCount++;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Quality gate notification orchestration failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return result;
  }

  /**
   * Evaluates a definitive allotment observation (AllotmentCheckJobItem) for job owner user.
   * Triggers ONLY for ALLOTTED, PARTIALLY_ALLOTTED, NOT_ALLOTTED. Excludes UNKNOWN, FAILED, and transient statuses.
   * Failure isolated: errors log diagnostics without throwing.
   */
  async processAllotmentObservation(
    jobItemId: string,
  ): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const item = await this.prisma.allotmentCheckJobItem.findUnique({
        where: { id: jobItemId },
        include: {
          job: {
            include: {
              ipo: {
                include: { company: true },
              },
            },
          },
        },
      });

      if (!item || !item.job) {
        return result;
      }

      const userId = item.job.userId;
      if (!userId || userId.trim() === '') {
        this.logger.debug(
          `Allotment job item ${jobItemId} has no associated userId (anonymous check, skipping notification)`,
        );
        return result;
      }

      result.evaluatedCount++;

      const ipoContext: IpoNotificationContext = {
        id: item.job.ipo.id,
        companyName:
          item.job.ipo.company.displayName || item.job.ipo.company.legalName,
        symbol: item.job.ipo.symbol,
      };

      const obsContext: AllotmentObservationContext = {
        id: item.id,
        jobId: item.job.id,
        ipoId: item.job.ipo.id,
        status: item.status,
        sharesApplied: item.sharesApplied,
        sharesAllotted: item.sharesAllotted,
        maskedId: item.maskedId,
      };

      const input = this.generator.generateAllotmentResultNotification(
        userId,
        ipoContext,
        obsContext,
      );

      if (!input) {
        // Non-definitive status (e.g. UNKNOWN, FAILED, RATE_LIMITED) -> excluded
        this.logger.debug(
          `Allotment status ${item.status} for item ${jobItemId} is not definitive (skipping notification)`,
        );
        return result;
      }

      const created = await this.repository.createNotification(input);
      if (created) {
        result.createdCount++;
        this.logger.log(
          `Generated ALLOTTED_RESULT_AVAILABLE notification for user ${userId} (jobItem ${jobItemId})`,
        );
      } else {
        result.suppressedCount++;
      }
    } catch (err: unknown) {
      this.logger.error(
        `Allotment observation notification orchestration failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return result;
  }

  /**
   * Evaluates all items within an AllotmentCheckJob.
   */
  async processAllotmentJob(jobId: string): Promise<OrchestrationResult> {
    const totalResult: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const job = await this.prisma.allotmentCheckJob.findUnique({
        where: { id: jobId },
        include: { items: true },
      });

      if (!job || job.items.length === 0) {
        return totalResult;
      }

      for (const item of job.items) {
        const itemRes = await this.processAllotmentObservation(item.id);
        totalResult.evaluatedCount += itemRes.evaluatedCount;
        totalResult.createdCount += itemRes.createdCount;
        totalResult.suppressedCount += itemRes.suppressedCount;
      }
    } catch (err: unknown) {
      this.logger.error(
        `Allotment job notification orchestration failure: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return totalResult;
  }

  /**
   * Evaluates and triggers system push notification when an IPO's allotment result
   * is first detected as available (ALLOTMENT_OUT / ALLOTMENT_COMPLETED).
   *
   * Targeted delivery: Only users with an active application/investment relationship
   * (IpoInvestment, AllotmentCheckJob, or saved PAN with check log) receive this notification.
   *
   * Restart & duplicate safe: Uses persistent PostgreSQL unique constraint on (userId, deduplicationKey).
   * Failure isolated: errors log diagnostics without throwing.
   */
  async processAllotmentOutEvent(ipoId: string): Promise<OrchestrationResult> {
    const result: OrchestrationResult = {
      evaluatedCount: 0,
      createdCount: 0,
      suppressedCount: 0,
    };

    try {
      const ipo = await this.prisma.ipo.findUnique({
        where: { id: ipoId },
        include: { company: true },
      });

      if (!ipo) {
        this.logger.warn(`processAllotmentOutEvent: IPO ${ipoId} not found`);
        return result;
      }

      // Safety check: Only trigger when actual availability has been detected or status is completed
      if (!ipo.allotmentResultAvailableAt && ipo.status !== 'ALLOTMENT_COMPLETED') {
        this.logger.debug(
          `processAllotmentOutEvent: Skipped for IPO ${ipoId} (allotment not yet confirmed available)`,
        );
        return result;
      }

      // Query eligible users with relevant investments or applications for this IPO
      const [investments, checkJobs, checkLogs] = await Promise.all([
        this.prisma.ipoInvestment.findMany({
          where: { ipoId },
          select: { brokerAccount: { select: { userId: true } } },
        }),
        this.prisma.allotmentCheckJob.findMany({
          where: { ipoId, userId: { not: null } },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.allotmentCheckLog.findMany({
          where: { ipoId },
          select: { identifierHash: true },
          distinct: ['identifierHash'],
        }),
      ]);

      let panLogUsers: { userId: string }[] = [];
      const hashes = checkLogs
        .map((l) => l.identifierHash)
        .filter((h): h is string => Boolean(h));

      if (hashes.length > 0) {
        panLogUsers = await this.prisma.userSavedPan.findMany({
          where: { panHash: { in: hashes } },
          select: { userId: true },
          distinct: ['userId'],
        });
      }

      const eligibleUserIds = new Set<string>();
      for (const inv of investments) {
        if (inv.brokerAccount?.userId) {
          eligibleUserIds.add(inv.brokerAccount.userId);
        }
      }
      for (const job of checkJobs) {
        if (job.userId) {
          eligibleUserIds.add(job.userId);
        }
      }
      for (const pan of panLogUsers) {
        if (pan.userId) {
          eligibleUserIds.add(pan.userId);
        }
      }

      if (eligibleUserIds.size === 0) {
        this.logger.debug(
          `processAllotmentOutEvent: No eligible investment/application users found for IPO ${ipoId}`,
        );
        return result;
      }

      const ipoContext: IpoNotificationContext = {
        id: ipo.id,
        companyName: ipo.company.displayName || ipo.company.legalName,
        symbol: ipo.symbol,
        status: ipo.status,
        lotSize: ipo.lotSize,
        priceBandHigh: ipo.priceBandHigh ? Number(ipo.priceBandHigh) : null,
      };

      for (const userId of eligibleUserIds) {
        result.evaluatedCount++;
        const input = this.generator.generateAllotmentOutNotification(
          userId,
          ipoContext,
        );

        const created = await this.repository.createNotification(input);
        if (created) {
          result.createdCount++;
          this.logger.log(
            `Generated Allotment Out notification for user ${userId} (IPO ${ipo.id})`,
          );
        } else {
          result.suppressedCount++;
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        `Allotment out notification orchestration failure for IPO ${ipoId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }

    return result;
  }

  /**
   * Resolves target user IDs for system-wide events (lifecycle, change, quality warnings).
   */
  private async resolveTargetUserIds(options?: {
    userId?: string;
    targetUserIds?: string[];
  }): Promise<string[]> {
    if (options?.userId && options.userId.trim() !== '') {
      return [options.userId.trim()];
    }

    if (options?.targetUserIds && options.targetUserIds.length > 0) {
      return options.targetUserIds.map((u) => u.trim()).filter((u) => u !== '');
    }

    // Query active system users from UserSavedPan and AllotmentCheckJob
    const [savedPanUsers, jobUsers] = await Promise.all([
      this.prisma.userSavedPan.findMany({
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.allotmentCheckJob.findMany({
        where: { userId: { not: null } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ]);

    const userSet = new Set<string>();
    for (const u of savedPanUsers) {
      if (u.userId) userSet.add(u.userId);
    }
    for (const j of jobUsers) {
      if (j.userId) userSet.add(j.userId);
    }

    return Array.from(userSet);
  }
}
