import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { IpoStatus, LifecycleEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from '../allotment/registrar.resolver';
import { NotificationOrchestratorService } from '../notifications/notification-orchestrator.service';
import {
  AllotmentIdentifierType,
  CheckAllotmentRequest,
} from '../allotment/allotment.types';

export interface TimelineSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * Status hierarchy ranks to strictly enforce monotonic forward progression.
 */
export const IPO_STATUS_ORDER: Record<IpoStatus, number> = {
  DRAFT: 0,
  UPCOMING: 10,
  OPEN: 20,
  CLOSING_TODAY: 25,
  CLOSED: 30,
  ALLOTMENT_PENDING: 35,
  ALLOTMENT_COMPLETED: 40,
  LISTING_PENDING: 45,
  LISTED: 50,
  WITHDRAWN: 99,
  CANCELLED: 99,
};

export const PROTECTED_TIMELINE_STATUSES = new Set<IpoStatus>([
  IpoStatus.WITHDRAWN,
  IpoStatus.CANCELLED,
]);

/**
 * Calculates current time components in Asia/Kolkata (IST = UTC+05:30).
 */
export function getNowInIST(now: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || '00';

  const year = parseInt(getPart('year'), 10);
  const month = parseInt(getPart('month'), 10);
  const day = parseInt(getPart('day'), 10);
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const second = parseInt(getPart('second'), 10);
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hour, minute, second, dateStr };
}

/**
 * Constructs a Date object representing the given dateStr (YYYY-MM-DD) at target IST time.
 */
export function createISTDateTime(
  dateStr: string,
  hours: number,
  minutes: number = 0,
  seconds: number = 0,
): Date {
  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  const s = String(seconds).padStart(2, '0');
  return new Date(`${dateStr}T${h}:${m}:${s}+05:30`);
}

@Injectable()
export class IpoTimelineSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IpoTimelineSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: RegistrarResolver,
    @Optional()
    private readonly notificationOrchestrator?: NotificationOrchestratorService,
  ) {}

  public getConfig(): TimelineSchedulerConfig {
    const enabled =
      process.env.IPO_TIMELINE_SCHEDULER_ENABLED !== 'false';
    const intervalMs = Number(
      process.env.IPO_TIMELINE_SCHEDULER_INTERVAL_MS || 60000,
    );
    return { enabled, intervalMs };
  }

  onModuleInit(): void {
    if (this.timer !== null) {
      this.logger.warn(
        'Timeline scheduler initialization skipped: interval already registered',
      );
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      this.logger.log(
        'IPO Timeline scheduler is disabled by configuration (IPO_TIMELINE_SCHEDULER_ENABLED=false)',
      );
      return;
    }

    this.logger.log(
      `Starting IPO Timeline scheduler (interval: ${config.intervalMs}ms)...`,
    );

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(
          `Unhandled error during timeline scheduler tick: ${(err as Error)?.message || err}`,
          (err as Error)?.stack,
        );
      });
    }, config.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('IPO Timeline scheduler stopped (timer handle cleared)');
    }
  }

  /**
   * Safe entrypoint for executing a single timeline synchronization cycle.
   */
  async tick(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug(
        'Timeline scheduler tick skipped: previous iteration still active',
      );
      return;
    }

    this.isProcessing = true;
    try {
      await this.processTimelineTransitions();
    } catch (err: unknown) {
      this.logger.error(
        `Timeline scheduler tick failure (contained): ${(err as Error).message}`,
        (err as Error).stack,
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Main evaluation loop for checking date thresholds and registrar allotment signals in IST.
   */
  public async processTimelineTransitions(
    now: Date = new Date(),
  ): Promise<{
    openedCount: number;
    closedCount: number;
    allotmentAwaitedCount: number;
    allotmentConfirmedCount: number;
    listedCount: number;
  }> {
    const summary = {
      openedCount: 0,
      closedCount: 0,
      allotmentAwaitedCount: 0,
      allotmentConfirmedCount: 0,
      listedCount: 0,
    };

    const ipos = await this.prisma.ipo.findMany({
      where: {
        status: {
          notIn: [
            IpoStatus.WITHDRAWN,
            IpoStatus.CANCELLED,
            IpoStatus.LISTED,
            IpoStatus.DRAFT,
          ],
        },
      },
      include: {
        company: true,
        lifecycleEvents: true,
        allotmentConfig: true,
      },
    });

    if (ipos.length === 0) {
      return summary;
    }

    for (const ipo of ipos) {
      if (PROTECTED_TIMELINE_STATUSES.has(ipo.status)) {
        continue;
      }

      const eventsMap = new Map<LifecycleEventType, string>();
      for (const ev of ipo.lifecycleEvents ?? []) {
        eventsMap.set(ev.eventType, ev.eventDate.toISOString().slice(0, 10));
      }

      const openDateStr = eventsMap.get(LifecycleEventType.OPEN);
      const closeDateStr = eventsMap.get(LifecycleEventType.CLOSE);
      const allotmentDateStr =
        eventsMap.get(LifecycleEventType.BASIS_OF_ALLOTMENT) ||
        (ipo.allotmentConfig?.expectedAllotmentDate
          ? ipo.allotmentConfig.expectedAllotmentDate.toISOString().slice(0, 10)
          : undefined);
      const listingDateStr = eventsMap.get(LifecycleEventType.LISTING);

      // =========================================================================
      // 1. UPCOMING -> OPEN (at openDate 09:00:00 IST)
      // =========================================================================
      if (ipo.status === IpoStatus.UPCOMING && openDateStr) {
        const openThreshold = createISTDateTime(openDateStr, 9, 0, 0);
        if (now >= openThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: { id: ipo.id, status: IpoStatus.UPCOMING },
            data: { status: IpoStatus.OPEN },
          });
          if (updated.count > 0) {
            summary.openedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) UPCOMING -> OPEN`,
            );
          }
        }
      }

      // =========================================================================
      // 2. OPEN / CLOSING_TODAY -> CLOSED (at closeDate 17:00:00 IST)
      // =========================================================================
      if (
        (ipo.status === IpoStatus.OPEN ||
          ipo.status === IpoStatus.CLOSING_TODAY) &&
        closeDateStr
      ) {
        const closeThreshold = createISTDateTime(closeDateStr, 17, 0, 0);
        if (now >= closeThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: { in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY] },
            },
            data: { status: IpoStatus.CLOSED },
          });
          if (updated.count > 0) {
            summary.closedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) ${ipo.status} -> CLOSED`,
            );
          }
        }
      }

      // =========================================================================
      // 2b. CLOSED -> ALLOTMENT_PENDING (Allotment Awaited at 12:00 AM / 00:00:00 IST of day following closeDate)
      // =========================================================================
      if (ipo.status === IpoStatus.CLOSED && closeDateStr) {
        const [y, m, d] = closeDateStr.split('-').map(Number);
        const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1));
        const nextDayStr = nextDayUtc.toISOString().slice(0, 10);
        const awaitedThreshold = createISTDateTime(nextDayStr, 0, 0, 0);

        if (now >= awaitedThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: IpoStatus.CLOSED,
            },
            data: { status: IpoStatus.ALLOTMENT_PENDING },
          });
          if (updated.count > 0) {
            summary.allotmentAwaitedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) CLOSED -> ALLOTMENT_PENDING (Allotment Awaited)`,
            );
          }
        }
      }

      // =========================================================================
      // 3. CLOSED / ALLOTMENT_PENDING -> ALLOTMENT_COMPLETED (only on actual result confirmation)
      // =========================================================================
      if (
        (ipo.status === IpoStatus.CLOSED ||
          ipo.status === IpoStatus.ALLOTMENT_PENDING) &&
        (allotmentDateStr || closeDateStr)
      ) {
        // Date anchor threshold: either allotment date or closing date has arrived in IST
        const checkAnchorDate = allotmentDateStr || closeDateStr!;
        const anchorThreshold = createISTDateTime(checkAnchorDate, 0, 0, 0);

        if (now >= anchorThreshold) {
          const isConfirmed =
            await this.confirmActualAllotmentAvailability(ipo);

          if (isConfirmed) {
            const updatePayload: Prisma.IpoUpdateManyMutationInput = {
              status: IpoStatus.ALLOTMENT_COMPLETED,
            };

            // Preserve first detection timestamp; never overwrite if already present
            if (!ipo.allotmentResultAvailableAt) {
              updatePayload.allotmentResultAvailableAt = now;
            }

            const updated = await this.prisma.ipo.updateMany({
              where: {
                id: ipo.id,
                status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
              },
              data: updatePayload,
            });

            if (updated.count > 0) {
              summary.allotmentConfirmedCount += updated.count;
              this.logger.log(
                `[Timeline] Confirmed allotment results live for IPO '${ipo.company.displayName}' (${ipo.id}). Transitioned to ALLOTMENT_COMPLETED`,
              );
              if (this.notificationOrchestrator) {
                this.notificationOrchestrator
                  .processAllotmentOutEvent(ipo.id)
                  .catch((notifErr: unknown) => {
                    this.logger.error(
                      `Failed to orchestrate allotment out notification for IPO ${ipo.id} (isolated): ${(notifErr as Error)?.message || notifErr}`,
                    );
                  });
              }
            }
          }
        }
      }

      // =========================================================================
      // 4. ALLOTMENT_COMPLETED / LISTING_PENDING -> LISTED (at listingDate 10:00:00 IST)
      // =========================================================================
      if (
        (ipo.status === IpoStatus.ALLOTMENT_COMPLETED ||
          ipo.status === IpoStatus.LISTING_PENDING) &&
        listingDateStr
      ) {
        const listingThreshold = createISTDateTime(listingDateStr, 10, 0, 0);
        if (now >= listingThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: {
                in: [
                  IpoStatus.ALLOTMENT_COMPLETED,
                  IpoStatus.LISTING_PENDING,
                ],
              },
            },
            data: { status: IpoStatus.LISTED },
          });
          if (updated.count > 0) {
            summary.listedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) -> LISTED`,
            );
          }
        }
      }
    }

    return summary;
  }

  /**
   * Confirms actual allotment-result availability from the registrar's official lookup service.
   * Leverages the registrar adapter's authoritative active-issue resolution mechanism (KFin React bundle,
   * MUFG GetDetails XML, or Maashitla companies endpoint) without sending any fake applicant identifiers.
   */
  public async confirmActualAllotmentAvailability(
    ipo: Prisma.IpoGetPayload<{
      include: {
        company: true;
        lifecycleEvents: true;
        allotmentConfig: true;
      };
    }>,
  ): Promise<boolean> {
    try {
      const resolved = await this.resolver.resolveAdapter(ipo.id);
      if (!resolved || !resolved.adapter) {
        return false;
      }

      const { adapter, registrarIpoCode } = resolved;

      if (typeof adapter.resolveRegistrarIpoCode === 'function') {
        const checkRequest: CheckAllotmentRequest = {
          ipoId: ipo.id,
          registrarIpoCode,
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: '', // No fake applicant PAN or identifier sent
          companyName: ipo.company.displayName,
          companyLegalName: ipo.company.legalName,
          symbol: ipo.symbol || undefined,
        };

        const result = await adapter.resolveRegistrarIpoCode(checkRequest);

        // A valid resolved string code (non-empty and not a UUID fallback) indicates
        // that the IPO is actively published and available in the registrar's allotment dataset.
        if (
          typeof result === 'string' &&
          result.trim().length > 0 &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            result.trim(),
          )
        ) {
          return true;
        }

        return false;
      }

      return false;
    } catch (err: unknown) {
      this.logger.debug(
        `Registrar allotment availability check failed for IPO ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return false;
    }
  }
}
