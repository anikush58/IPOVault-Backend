import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { IpoStatus, LifecycleEventType, Prisma, PublicationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from '../allotment/registrar.resolver';
import { NotificationOrchestratorService } from '../notifications/notification-orchestrator.service';
import { IpoGuruService } from '../ipo-guru/ipo-guru.service';
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

  // In-memory throttling maps for 5-min allotment polling and listing price checks
  private readonly lastAllotmentPollingAt = new Map<string, number>();
  private readonly lastListingPriceCheckAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: RegistrarResolver,
    @Optional()
    private readonly notificationOrchestrator?: NotificationOrchestratorService,
    @Optional()
    private readonly ipoGuruService?: IpoGuruService,
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
    listingPriceCount: number;
  }> {
    const summary = {
      openedCount: 0,
      closedCount: 0,
      allotmentAwaitedCount: 0,
      allotmentConfirmedCount: 0,
      listedCount: 0,
      listingPriceCount: 0,
    };

    const ipos = await this.prisma.ipo.findMany({
      where: {
        publicationStatus: PublicationStatus.PUBLISHED,
        status: {
          notIn: [
            IpoStatus.WITHDRAWN,
            IpoStatus.CANCELLED,
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

      let currentStatus = ipo.status;

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
      // 1. UPCOMING -> OPEN / LIVE_NOW (at opening date 12:00 AM / 00:00:00 IST)
      // =========================================================================
      if (currentStatus === IpoStatus.UPCOMING && openDateStr) {
        const openThreshold = createISTDateTime(openDateStr, 0, 0, 0);
        if (now >= openThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: { id: ipo.id, status: IpoStatus.UPCOMING },
            data: { status: IpoStatus.OPEN },
          });
          if (updated.count > 0) {
            currentStatus = IpoStatus.OPEN;
            summary.openedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) UPCOMING -> OPEN (LIVE_NOW)`,
            );
          }
        }
      }

      // =========================================================================
      // 2. OPEN / CLOSING_TODAY -> CLOSED (at closing date 5:00 PM / 17:00:00 IST)
      // =========================================================================
      if (
        (currentStatus === IpoStatus.OPEN ||
          currentStatus === IpoStatus.CLOSING_TODAY) &&
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
            currentStatus = IpoStatus.CLOSED;
            summary.closedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) -> CLOSED`,
            );
          }
        }
      }

      // =========================================================================
      // 3. CLOSED -> ALLOTMENT_PENDING / ALLOTMENT_AWAITED (at allotment date 12:00 AM / 00:00:00 IST)
      // =========================================================================
      if (currentStatus === IpoStatus.CLOSED) {
        let awaitedThreshold: Date | null = null;
        if (allotmentDateStr) {
          awaitedThreshold = createISTDateTime(allotmentDateStr, 0, 0, 0);
        } else if (closeDateStr) {
          const [y, m, d] = closeDateStr.split('-').map(Number);
          const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1));
          const nextDayStr = nextDayUtc.toISOString().slice(0, 10);
          awaitedThreshold = createISTDateTime(nextDayStr, 0, 0, 0);
        }

        if (awaitedThreshold && now >= awaitedThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: IpoStatus.CLOSED,
            },
            data: { status: IpoStatus.ALLOTMENT_PENDING },
          });
          if (updated.count > 0) {
            currentStatus = IpoStatus.ALLOTMENT_PENDING;
            summary.allotmentAwaitedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) CLOSED -> ALLOTMENT_PENDING (Allotment Awaited)`,
            );
          }
        }
      }

      // =========================================================================
      // 4. Allotment Polling (around 9:00 PM / 21:00:00 IST on allotment date, every 5 mins)
      // -> ALLOTMENT_COMPLETED / ALLOTMENT_OUT when found
      // =========================================================================
      if (
        currentStatus === IpoStatus.CLOSED ||
        currentStatus === IpoStatus.ALLOTMENT_PENDING
      ) {
        const pollingDate = allotmentDateStr || closeDateStr;
        if (pollingDate) {
          const pollingStartThreshold = createISTDateTime(pollingDate, 21, 0, 0);

          if (now >= pollingStartThreshold) {
            // Check 5-minute per-IPO polling throttle (300,000 ms)
            const lastPoll = this.lastAllotmentPollingAt.get(ipo.id) ?? 0;
            const elapsed = now.getTime() - lastPoll;

            if (elapsed >= 300_000 || lastPoll === 0) {
              this.lastAllotmentPollingAt.set(ipo.id, now.getTime());

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
                    status: {
                      in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING],
                    },
                  },
                  data: updatePayload,
                });

                if (updated.count > 0) {
                  currentStatus = IpoStatus.ALLOTMENT_COMPLETED;
                  summary.allotmentConfirmedCount += updated.count;
                  this.lastAllotmentPollingAt.delete(ipo.id); // Stop polling immediately

                  this.logger.log(
                    `[Timeline] Confirmed allotment results live for IPO '${ipo.company.displayName}' (${ipo.id}). Transitioned to ALLOTMENT_COMPLETED (ALLOTMENT_OUT)`,
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
        }
      }

      // =========================================================================
      // 5. ALLOTMENT_COMPLETED / LISTING_PENDING -> LISTED (at listing date 10:00:00 IST)
      // =========================================================================
      if (
        (currentStatus === IpoStatus.ALLOTMENT_COMPLETED ||
          currentStatus === IpoStatus.LISTING_PENDING) &&
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
            currentStatus = IpoStatus.LISTED;
            summary.listedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) -> LISTED`,
            );
          }
        }
      }

      // =========================================================================
      // 6. Listing Price Detection & Persistence (when LISTED and listingPrice is null)
      // =========================================================================
      if (currentStatus === IpoStatus.LISTED && ipo.listingPrice == null) {
        const persisted = await this.checkAndPersistListingPrice(ipo, now);
        if (persisted) {
          summary.listingPriceCount++;
        }
      }
    }

    return summary;
  }

  /**
   * Checks and persists listing price and calculates listing gain / profit metrics.
   * Never overwrites an existing valid listing price.
   */
  public async checkAndPersistListingPrice(
    ipo: Prisma.IpoGetPayload<{
      include: {
        company: true;
        lifecycleEvents: true;
        allotmentConfig: true;
      };
    }>,
    now: Date = new Date(),
  ): Promise<boolean> {
    try {
      // Throttle listing price checks to at most once per 60 seconds per IPO
      const lastCheck = this.lastListingPriceCheckAt.get(ipo.id) ?? 0;
      if (now.getTime() - lastCheck < 60_000 && lastCheck > 0) {
        return false;
      }
      this.lastListingPriceCheckAt.set(ipo.id, now.getTime());

      // If IPO Guru service is available, query/sync IPO data
      let detectedListingPrice: number | null = null;

      if (this.ipoGuruService) {
        try {
          const fetchResult = await this.ipoGuruService.fetchIpos('AUTO');
          const guruIpos = fetchResult?.ipos || [];
          const matched = guruIpos.find((g) => {
            const gName = (g.name || g.company_name || '').toLowerCase().trim();
            const compName = (ipo.company.displayName || '').toLowerCase().trim();
            const legalName = (ipo.company.legalName || '').toLowerCase().trim();
            return (
              (gName.length > 0 && (gName === compName || gName === legalName)) ||
              (ipo.symbol && g.symbol && g.symbol.toUpperCase() === ipo.symbol.toUpperCase())
            );
          });

          if (matched && matched.listing_price) {
            const parsed = parseFloat(String(matched.listing_price).replace(/[^0-9.]/g, ''));
            if (!isNaN(parsed) && parsed > 0) {
              detectedListingPrice = parsed;
            }
          }
        } catch (guruErr: unknown) {
          this.logger.debug(
            `Listing price lookup from IPO Guru for ${ipo.id} (contained): ${(guruErr as Error)?.message || guruErr}`,
          );
        }
      }

      if (detectedListingPrice !== null && detectedListingPrice > 0) {
        const issuePrice = ipo.priceBandHigh
          ? Number(ipo.priceBandHigh)
          : ipo.priceBandLow
          ? Number(ipo.priceBandLow)
          : null;

        let listingGainPct: Prisma.Decimal | null = null;
        let profitAmount: Prisma.Decimal | null = null;
        let profitPercentage: Prisma.Decimal | null = null;

        if (issuePrice && issuePrice > 0) {
          const gain = Number(
            (((detectedListingPrice - issuePrice) / issuePrice) * 100).toFixed(2),
          );
          listingGainPct = new Prisma.Decimal(gain);
          profitPercentage = listingGainPct;

          const lot = ipo.lotSize || 1;
          const profit = Number(
            ((detectedListingPrice - issuePrice) * lot).toFixed(2),
          );
          profitAmount = new Prisma.Decimal(profit);
        }

        await this.prisma.ipo.update({
          where: { id: ipo.id },
          data: {
            listingPrice: new Prisma.Decimal(detectedListingPrice),
            listingGainPct,
            profitAmount,
            profitPercentage,
          },
        });

        this.lastListingPriceCheckAt.delete(ipo.id);
        this.logger.log(
          `[Timeline] Persisted listing price ₹${detectedListingPrice} for IPO '${ipo.company.displayName}' (${ipo.id})`,
        );
        return true;
      }

      return false;
    } catch (err: unknown) {
      this.logger.debug(
        `Listing price detection failed for IPO ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return false;
    }
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

  /**
   * Manually checks all IPOs in ALLOTMENT_PENDING / CLOSED status with registrar lookup
   * and automatically transitions confirmed IPOs to ALLOTMENT_COMPLETED (Allotment Out).
   */
  public async checkAllotmentForAwaitedIpos(
    now: Date = new Date(),
  ): Promise<{
    totalChecked: number;
    totalUpdated: number;
    results: Array<{
      id: string;
      displayName: string;
      allotmentOut: boolean;
    }>;
  }> {
    const awaitedIpos = await this.prisma.ipo.findMany({
      where: {
        status: {
          in: [IpoStatus.ALLOTMENT_PENDING, IpoStatus.CLOSED],
        },
      },
      include: {
        company: true,
        lifecycleEvents: true,
        allotmentConfig: true,
      },
    });

    const results: Array<{
      id: string;
      displayName: string;
      allotmentOut: boolean;
    }> = [];
    let totalUpdated = 0;

    for (const ipo of awaitedIpos) {
      const isConfirmed = await this.confirmActualAllotmentAvailability(ipo);
      if (isConfirmed) {
        const updatePayload: Prisma.IpoUpdateManyMutationInput = {
          status: IpoStatus.ALLOTMENT_COMPLETED,
        };
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
          totalUpdated += updated.count;
          this.lastAllotmentPollingAt.delete(ipo.id);
          this.logger.log(
            `[Manual Allotment Check] Confirmed allotment results live for IPO '${ipo.company.displayName}' (${ipo.id}). Transitioned to ALLOTMENT_COMPLETED (ALLOTMENT_OUT)`,
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
        results.push({
          id: ipo.id,
          displayName: ipo.company.displayName,
          allotmentOut: true,
        });
      } else {
        results.push({
          id: ipo.id,
          displayName: ipo.company.displayName,
          allotmentOut: false,
        });
      }
    }

    return {
      totalChecked: awaitedIpos.length,
      totalUpdated,
      results,
    };
  }
}

