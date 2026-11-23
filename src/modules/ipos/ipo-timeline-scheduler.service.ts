import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  IpoStatus,
  LifecycleEventType,
  ParticipantRole,
  Prisma,
  PublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  inspectStoredRegistrarMetadata,
  reconcileStoredRegistrarMetadata,
  RegistrarMetadataIpoRecord,
  RegistrarResolver,
  StoredRegistrarMetadata,
} from '../allotment/registrar.resolver';
import { RegistrarAdapterRegistry } from '../allotment/adapters/registrar-adapter.registry';
import { NotificationOrchestratorService } from '../notifications/notification-orchestrator.service';
import { IpoGuruService } from '../ipo-guru/ipo-guru.service';
import { AllotmentJobService } from '../allotment/allotment-job.service';
import {
  AllotmentIdentifierType,
  CheckAllotmentRequest,
  sanitizeRegistrarIpoCode,
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

export const BACKFILL_MAX_AGE_DAYS = 30;
export const BACKFILL_MAX_ATTEMPTS = 5;
export const BACKFILL_BASE_COOLDOWN_MS = 5 * 60 * 1000;
export const BACKFILL_MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AllotmentBackfillRetryEntry {
  attempts: number;
  lastAttemptAt: number;
  nextEligibleAt: number;
}

export interface AllotmentAvailabilityCheckOptions {
  skipForceRefresh?: boolean;
}

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

  // In-memory throttling maps for 5-min allotment polling, bounded backfill retries, and listing price checks
  private readonly lastAllotmentPollingAt = new Map<string, number>();
  private readonly lastListingPriceCheckAt = new Map<string, number>();
  private readonly backfillRetryState = new Map<
    string,
    AllotmentBackfillRetryEntry
  >();
  private backfillStateLoaded = false;
  private readonly backfillStateStoragePath: string;
  private readonly ownsTempBackfillStateFile: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: RegistrarResolver,
    @Optional()
    private readonly notificationOrchestrator?: NotificationOrchestratorService,
    @Optional()
    private readonly ipoGuruService?: IpoGuruService,
    @Optional()
    private readonly allotmentJobService?: AllotmentJobService,
    @Optional()
    private readonly registry?: RegistrarAdapterRegistry,
  ) {
    const explicitStatePath = process.env.ALLOTMENT_BACKFILL_STATE_PATH?.trim();
    const isTestEnv = process.env.NODE_ENV === 'test';
    if (explicitStatePath) {
      this.backfillStateStoragePath = explicitStatePath;
      this.ownsTempBackfillStateFile = false;
    } else if (isTestEnv) {
      this.backfillStateStoragePath = path.join(
        os.tmpdir(),
        'ipovault-test-registries',
        `timeline-backfill-${crypto.randomUUID()}.json`,
      );
      this.ownsTempBackfillStateFile = true;
    } else {
      const storageDir =
        process.env.REGISTRAR_REGISTRY_DIR ||
        path.join(process.cwd(), 'data', 'registries');
      this.backfillStateStoragePath = path.join(
        storageDir,
        'allotment-backfill-retry-state.json',
      );
      this.ownsTempBackfillStateFile = false;
    }
  }

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
    if (this.ownsTempBackfillStateFile) {
      try {
        if (fs.existsSync(this.backfillStateStoragePath)) {
          fs.unlinkSync(this.backfillStateStoragePath);
        }
      } catch {
        // Non-fatal test cleanup
      }
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
    closingTodayCount: number;
    closedCount: number;
    allotmentAwaitedCount: number;
    allotmentConfirmedCount: number;
    listedCount: number;
    listingPriceCount: number;
  }> {
    const summary = {
      openedCount: 0,
      closingTodayCount: 0,
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
        sourceIdentities: {
          include: {
            source: true,
          },
        },
        participants: {
          where: {
            role: ParticipantRole.REGISTRAR,
          },
        },
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
      // 0. DRAFT -> UPCOMING / OPEN (when dates exist on published IPO)
      // =========================================================================
      if (
        currentStatus === IpoStatus.DRAFT &&
        openDateStr &&
        ipo.publicationStatus === PublicationStatus.PUBLISHED
      ) {
        const openThreshold = createISTDateTime(openDateStr, 0, 0, 0);
        const closeDayStart = closeDateStr
          ? createISTDateTime(closeDateStr, 0, 0, 0)
          : null;
        if (now < openThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: { id: ipo.id, status: IpoStatus.DRAFT },
            data: { status: IpoStatus.UPCOMING },
          });
          if (updated.count > 0) {
            currentStatus = IpoStatus.UPCOMING;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) DRAFT -> UPCOMING`,
            );
          }
        } else if (!closeDayStart || now < closeDayStart) {
          const updated = await this.prisma.ipo.updateMany({
            where: { id: ipo.id, status: IpoStatus.DRAFT },
            data: { status: IpoStatus.OPEN },
          });
          if (updated.count > 0) {
            currentStatus = IpoStatus.OPEN;
            summary.openedCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) DRAFT -> OPEN (LIVE_NOW)`,
            );
          }
        }
      }

      // =========================================================================
      // 1. UPCOMING -> OPEN / LIVE_NOW (at opening date 12:00 AM / 00:00:00 IST)
      // =========================================================================
      if (currentStatus === IpoStatus.UPCOMING && openDateStr) {
        const openThreshold = createISTDateTime(openDateStr, 0, 0, 0);
        const closeDayStart = closeDateStr
          ? createISTDateTime(closeDateStr, 0, 0, 0)
          : null;

        if (now >= openThreshold && (!closeDayStart || now < closeDayStart)) {
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
      // 2. OPEN / UPCOMING -> CLOSING_TODAY (from 00:00:00 to 17:00:00 IST on closing date)
      // =========================================================================
      if (
        (currentStatus === IpoStatus.OPEN || currentStatus === IpoStatus.UPCOMING) &&
        closeDateStr
      ) {
        const closeDayStart = createISTDateTime(closeDateStr, 0, 0, 0);
        const closeThreshold = createISTDateTime(closeDateStr, 17, 0, 0);

        if (now >= closeDayStart && now < closeThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: { in: [IpoStatus.OPEN, IpoStatus.UPCOMING] },
            },
            data: { status: IpoStatus.CLOSING_TODAY },
          });
          if (updated.count > 0) {
            currentStatus = IpoStatus.CLOSING_TODAY;
            summary.closingTodayCount += updated.count;
            this.logger.log(
              `[Timeline] Transitioned IPO '${ipo.company.displayName}' (${ipo.id}) -> CLOSING_TODAY`,
            );
          }
        }
      }

      // =========================================================================
      // 3. CLOSING_TODAY / OPEN / UPCOMING -> CLOSED (at closing date 5:00 PM / 17:00:00 IST)
      // =========================================================================
      if (
        (currentStatus === IpoStatus.OPEN ||
          currentStatus === IpoStatus.CLOSING_TODAY ||
          currentStatus === IpoStatus.UPCOMING) &&
        closeDateStr
      ) {
        const closeThreshold = createISTDateTime(closeDateStr, 17, 0, 0);
        if (now >= closeThreshold) {
          const updated = await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: {
                in: [
                  IpoStatus.OPEN,
                  IpoStatus.CLOSING_TODAY,
                  IpoStatus.UPCOMING,
                ],
              },
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
      // 4. CLOSED -> ALLOTMENT_PENDING / ALLOTMENT_AWAITED (at allotment date 12:00 AM / 00:00:00 IST)
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
      // 5. Allotment Polling (from 12:00 AM / 00:00:00 IST on allotment date, every 5 mins)
      // -> ALLOTMENT_COMPLETED / ALLOTMENT_OUT when found
      // =========================================================================
      if (
        currentStatus === IpoStatus.CLOSED ||
        currentStatus === IpoStatus.ALLOTMENT_PENDING
      ) {
        let pollingStartThreshold: Date | null = null;
        if (allotmentDateStr) {
          pollingStartThreshold = createISTDateTime(allotmentDateStr, 0, 0, 0);
        } else if (closeDateStr) {
          pollingStartThreshold = createISTDateTime(closeDateStr, 20, 0, 0);
        }

        if (pollingStartThreshold && now >= pollingStartThreshold) {
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

                  // EVENT A: IPO Allotment Out notification (exactly once)
                  if (this.notificationOrchestrator) {
                    this.notificationOrchestrator
                      .processAllotmentOutEvent(ipo.id)
                      .catch((notifErr: unknown) => {
                        this.logger.error(
                          `Failed to orchestrate allotment out notification for IPO ${ipo.id} (isolated): ${(notifErr as Error)?.message || notifErr}`,
                        );
                      });
                  }

                  // AUTOMATIC USER ALLOTMENT CHECKS & EVENT B
                  this.triggerAutomaticUserAllotmentChecks(ipo.id)
                    .catch((checkErr: unknown) => {
                      this.logger.error(
                        `Failed to trigger automatic user allotment checks for IPO ${ipo.id} (isolated): ${(checkErr as Error)?.message || checkErr}`,
                      );
                    });
                }
              }
            }
          }
        }

      // =========================================================================
      // 6. ALLOTMENT_COMPLETED / LISTING_PENDING -> LISTED (at listing date 10:00:00 IST)
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
                in: [IpoStatus.ALLOTMENT_COMPLETED, IpoStatus.LISTING_PENDING],
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
      // 7. Listing Price Detection & Persistence (when LISTED and listingPrice is null)
      // =========================================================================
      if (currentStatus === IpoStatus.LISTED && ipo.listingPrice == null) {
        const persisted = await this.checkAndPersistListingPrice(ipo, now);
        if (persisted) {
          summary.listingPriceCount++;
        }
      }

      // =========================================================================
      // 8. Late Allotment Identity & Timestamp Backfill for Listed / Completed IPOs
      // =========================================================================
      if (
        (currentStatus === IpoStatus.ALLOTMENT_COMPLETED ||
          currentStatus === IpoStatus.LISTING_PENDING ||
          currentStatus === IpoStatus.LISTED) &&
        ipo.allotmentConfig?.enabled !== false &&
        Boolean(ipo.allotmentConfig?.registrar) &&
        (!ipo.allotmentResultAvailableAt ||
          !this.extractValidRegistrarCode(
            ipo.allotmentConfig?.registrarIpoCode,
          )) &&
        this.isWithinAllotmentBackfillWindow(
          ipo,
          currentStatus,
          listingDateStr,
          allotmentDateStr,
          closeDateStr,
          now,
        ) &&
        this.canAttemptBackfill(ipo.id, now.getTime())
      ) {
        try {
          const confirmed = await this.confirmActualAllotmentAvailability(ipo, {
            skipForceRefresh: true,
          });
          if (confirmed) {
            this.clearBackfillRetryState(ipo.id, now.getTime());
            this.lastAllotmentPollingAt.delete(ipo.id);
            if (!ipo.allotmentResultAvailableAt) {
              const backfilled = await this.prisma.ipo.updateMany({
                where: {
                  id: ipo.id,
                  allotmentResultAvailableAt: null,
                },
                data: { allotmentResultAvailableAt: now },
              });
              if (backfilled?.count > 0) {
                this.logger.log(
                  `[Timeline] Backfilled allotmentResultAvailableAt for ${currentStatus} IPO '${ipo.company.displayName}' (${ipo.id})`,
                );
              }
            }
          } else {
            this.recordBackfillFailure(ipo.id, now.getTime());
          }
        } catch (backfillErr: unknown) {
          this.recordBackfillFailure(ipo.id, now.getTime());
          this.logger.debug(
            `Late allotment backfill failed for IPO ${ipo.id}: ${(backfillErr as Error)?.message || backfillErr}`,
          );
        }
      }
    }

    return summary;
  }

  /**
   * Alias for checkAndPersistListingPrice: scopes checks to listed IPOs within 14 days of listing.
   */
  public async checkAndApplyListingPrice(
    ipo: Prisma.IpoGetPayload<{
      include: {
        company: true;
        lifecycleEvents: true;
        allotmentConfig: true;
      };
    }>,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.checkAndPersistListingPrice(ipo, now);
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

      // If IPO already has a valid listing price stored, use it directly without querying external providers
      if (ipo.listingPrice && Number(ipo.listingPrice) > 0) {
        return false;
      }

      // Stop scanning historical listed IPOs indefinitely.
      // Only check IPOs whose listingDate is within the last 14 days (and still missing listingPrice).
      const listingEvent = ipo.lifecycleEvents?.find(
        (e) => e.eventType === LifecycleEventType.LISTING,
      );
      if (!listingEvent?.eventDate) {
        return false;
      }
      const listingDateTime = new Date(listingEvent.eventDate).getTime();
      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const elapsedMs = now.getTime() - listingDateTime;
      // Allow window from listing day (with 1 day buffer for timezone offsets) up to 14 days post-listing
      if (elapsedMs < -86_400_000 || elapsedMs > fourteenDaysMs) {
        return false;
      }

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

  private parseDateOnlyUtcMs(dateStr?: string): number | null {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return null;
    }
    const [year, month, day] = dateStr.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }

  /**
   * Restricts late backfill to IPOs whose listing date is within the last 30 days
   * (or recent post-allotment IPOs without a listing date yet), preventing indefinite
   * polling of historical LISTED IPOs.
   */
  private isWithinAllotmentBackfillWindow(
    ipo: { createdAt?: Date | null },
    currentStatus: IpoStatus,
    listingDateStr: string | undefined,
    allotmentDateStr: string | undefined,
    closeDateStr: string | undefined,
    now: Date,
  ): boolean {
    const currentIstDayMs = this.parseDateOnlyUtcMs(getNowInIST(now).dateStr);
    const listingDayMs = this.parseDateOnlyUtcMs(listingDateStr);

    if (listingDayMs !== null && currentIstDayMs !== null) {
      return (
        (currentIstDayMs - listingDayMs) / 86_400_000 <= BACKFILL_MAX_AGE_DAYS
      );
    }

    const fallbackDayMs = this.parseDateOnlyUtcMs(
      allotmentDateStr || closeDateStr,
    );
    if (fallbackDayMs !== null && currentIstDayMs !== null) {
      return (
        (currentIstDayMs - fallbackDayMs) / 86_400_000 <= BACKFILL_MAX_AGE_DAYS
      );
    }

    if (ipo.createdAt instanceof Date) {
      return (
        now.getTime() - ipo.createdAt.getTime() <=
        BACKFILL_MAX_AGE_DAYS * 86_400_000
      );
    }

    // Never auto-poll LISTED IPOs that lack any recent date signal; preserve recent pre-listing stages.
    return currentStatus !== IpoStatus.LISTED;
  }

  private extractValidRegistrarCode(
    ...candidates: Array<string | null | undefined>
  ): string | null {
    for (const candidate of candidates) {
      const sanitized = sanitizeRegistrarIpoCode(candidate);
      if (sanitized) {
        return sanitized;
      }
    }
    return null;
  }

  private loadBackfillRetryState(): void {
    if (this.backfillStateLoaded) {
      return;
    }
    this.backfillStateLoaded = true;
    try {
      if (!fs.existsSync(this.backfillStateStoragePath)) {
        return;
      }
      const raw = JSON.parse(
        fs.readFileSync(this.backfillStateStoragePath, 'utf-8'),
      ) as { entries?: Record<string, AllotmentBackfillRetryEntry> };
      if (!raw?.entries || typeof raw.entries !== 'object') {
        return;
      }
      for (const [ipoId, entry] of Object.entries(raw.entries)) {
        if (
          entry &&
          typeof entry.attempts === 'number' &&
          Number.isFinite(entry.attempts) &&
          entry.attempts > 0 &&
          typeof entry.lastAttemptAt === 'number' &&
          Number.isFinite(entry.lastAttemptAt) &&
          typeof entry.nextEligibleAt === 'number' &&
          Number.isFinite(entry.nextEligibleAt)
        ) {
          this.backfillRetryState.set(ipoId, entry);
        }
      }
    } catch (err: unknown) {
      this.logger.debug(
        `Unable to load allotment backfill retry state from ${this.backfillStateStoragePath}: ${(err as Error)?.message || err}`,
      );
    }
  }

  private saveBackfillRetryState(nowMs: number): void {
    const retentionCutoffMs = nowMs - (BACKFILL_MAX_AGE_DAYS + 1) * 86_400_000;
    for (const [ipoId, entry] of this.backfillRetryState.entries()) {
      if (entry.lastAttemptAt < retentionCutoffMs) {
        this.backfillRetryState.delete(ipoId);
      }
    }

    try {
      const dir = path.dirname(this.backfillStateStoragePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        version: 1,
        updatedAt: new Date(nowMs).toISOString(),
        entries: Object.fromEntries(this.backfillRetryState.entries()),
      };
      const tmpPath = `${this.backfillStateStoragePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmpPath, this.backfillStateStoragePath);
    } catch (err: unknown) {
      this.logger.debug(
        `Unable to persist allotment backfill retry state to ${this.backfillStateStoragePath}: ${(err as Error)?.message || err}`,
      );
    }
  }

  private canAttemptBackfill(ipoId: string, nowMs: number): boolean {
    this.loadBackfillRetryState();
    const entry = this.backfillRetryState.get(ipoId);
    if (!entry) {
      return true;
    }
    if (entry.attempts >= BACKFILL_MAX_ATTEMPTS) {
      return false;
    }
    return nowMs >= entry.nextEligibleAt;
  }

  private recordBackfillFailure(ipoId: string, nowMs: number): void {
    this.loadBackfillRetryState();
    const prev = this.backfillRetryState.get(ipoId);
    const attempts = (prev?.attempts ?? 0) + 1;
    const delayMs = Math.min(
      BACKFILL_MAX_COOLDOWN_MS,
      BACKFILL_BASE_COOLDOWN_MS * Math.pow(3, attempts - 1),
    );
    this.backfillRetryState.set(ipoId, {
      attempts,
      lastAttemptAt: nowMs,
      nextEligibleAt: nowMs + delayMs,
    });
    this.saveBackfillRetryState(nowMs);
    if (attempts >= BACKFILL_MAX_ATTEMPTS) {
      this.logger.debug(
        `[Timeline] Allotment backfill reached max attempts (${BACKFILL_MAX_ATTEMPTS}) for IPO ${ipoId}; automatic polling paused`,
      );
    }
  }

  private clearBackfillRetryState(ipoId: string, nowMs: number): void {
    this.loadBackfillRetryState();
    if (this.backfillRetryState.delete(ipoId)) {
      this.saveBackfillRetryState(nowMs);
    }
  }

  private async persistDiscoveredCode(
    ipo: RegistrarMetadataIpoRecord,
    adapterCode: string | undefined,
    discoveredCode: string,
    precomputedMetadata?: StoredRegistrarMetadata,
  ): Promise<boolean> {
    const cleanDiscoveredCode = sanitizeRegistrarIpoCode(discoveredCode);
    if (!cleanDiscoveredCode) {
      return false;
    }

    const storedMetadata =
      precomputedMetadata ??
      (await inspectStoredRegistrarMetadata(
        ipo,
        this.prisma,
        this.registry,
        this.logger,
      ));
    const reconciledRegistrar = reconcileStoredRegistrarMetadata(
      storedMetadata,
      adapterCode,
      this.registry,
    );

    if (!reconciledRegistrar) {
      this.logger.warn(
        `Rejected persisting discovered registrar code '${cleanDiscoveredCode}' for IPO ${ipo.id}: conflicting, disabled, unknown, or unresolved registrar metadata`,
      );
      return false;
    }

    const existingConfigCode = this.extractValidRegistrarCode(
      ipo.allotmentConfig?.registrarIpoCode,
    );

    if (!existingConfigCode || existingConfigCode !== cleanDiscoveredCode) {
      try {
        const registrarToPersist = adapterCode?.trim() || reconciledRegistrar;
        if (
          registrarToPersist &&
          typeof this.resolver.persistDiscoveredRegistrarIdentity === 'function'
        ) {
          await this.resolver.persistDiscoveredRegistrarIdentity(
            ipo.id,
            registrarToPersist,
            cleanDiscoveredCode,
          );
        }
        if (this.prisma?.ipoAllotmentConfig?.updateMany) {
          await this.prisma.ipoAllotmentConfig.updateMany({
            where: { ipoId: ipo.id },
            data: { registrarIpoCode: cleanDiscoveredCode },
          });
        }
      } catch (persistErr: unknown) {
        this.logger.debug(
          `Failed to persist discovered registrar code '${cleanDiscoveredCode}' for IPO ${ipo.id}: ${(persistErr as Error)?.message || persistErr}`,
        );
      }
    }

    return true;
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
    }> &
      Pick<RegistrarMetadataIpoRecord, 'sourceIdentities' | 'participants'>,
    options: AllotmentAvailabilityCheckOptions = {},
  ): Promise<boolean> {
    try {
      if (ipo.allotmentConfig?.enabled === false) {
        return false;
      }

      const storedMetadata = await inspectStoredRegistrarMetadata(
        ipo,
        this.prisma,
        this.registry,
        this.logger,
      );
      if (
        storedMetadata.disabledByConfig ||
        storedMetadata.lookupFailed ||
        storedMetadata.hasUnrecognizedEntry ||
        storedMetadata.recognizedCodes.size > 1
      ) {
        this.logger.warn(
          `Rejected allotment availability check for IPO ${ipo.id}: conflicting, disabled, unknown, or unreadable registrar metadata`,
        );
        return false;
      }

      const probeOptions = {
        requireLiveActiveList: true,
        skipIdentityPersistence: true,
        ...(options.skipForceRefresh ? { skipForceRefresh: true } : {}),
      };
      const resolved = await this.resolver.resolveAdapter(
        ipo.id,
        undefined,
        probeOptions,
      );
      if (!resolved || !resolved.adapter) {
        return false;
      }

      const { adapter, registrarIpoCode } = resolved;
      const reconciledBeforeProbe = reconcileStoredRegistrarMetadata(
        storedMetadata,
        adapter.code,
        this.registry,
      );
      if (!reconciledBeforeProbe) {
        this.logger.warn(
          `Rejected allotment availability probe for IPO ${ipo.id}: resolved adapter '${adapter.code}' conflicts with or cannot be reconciled against stored registrar metadata`,
        );
        return false;
      }

      const sanitizedCode = sanitizeRegistrarIpoCode(registrarIpoCode);

      if (typeof adapter.resolveRegistrarIpoCode === 'function') {
        const checkRequest: CheckAllotmentRequest = {
          ipoId: ipo.id,
          registrarIpoCode: sanitizedCode,
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: '', // No fake applicant PAN or identifier sent
          companyName: ipo.company.displayName,
          companyLegalName: ipo.company.legalName,
          symbol: ipo.symbol || undefined,
          requireLiveActiveList: true,
          ...(options.skipForceRefresh ? { skipForceRefresh: true } : {}),
        };

        const result = await adapter.resolveRegistrarIpoCode(checkRequest);

        // A valid resolved string code (non-empty and not a UUID fallback) indicates
        // that the IPO is actively published and available in the registrar's allotment dataset.
        const discoveredCode =
          typeof result === 'string'
            ? this.extractValidRegistrarCode(result)
            : null;
        if (discoveredCode) {
          return await this.persistDiscoveredCode(
            ipo,
            adapter.code,
            discoveredCode,
            storedMetadata,
          );
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
        OR: [
          {
            status: {
              in: [IpoStatus.ALLOTMENT_PENDING, IpoStatus.CLOSED],
            },
          },
          {
            status: {
              in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY],
            },
            lifecycleEvents: {
              some: {
                eventType: {
                  in: [
                    LifecycleEventType.CLOSE,
                    LifecycleEventType.BASIS_OF_ALLOTMENT,
                  ],
                },
                eventDate: {
                  lte: now,
                },
              },
            },
          },
        ],
        status: {
          notIn: [IpoStatus.WITHDRAWN, IpoStatus.CANCELLED],
        },
      },
      include: {
        company: true,
        lifecycleEvents: true,
        allotmentConfig: true,
        sourceIdentities: {
          include: {
            source: true,
          },
        },
        participants: {
          where: {
            role: ParticipantRole.REGISTRAR,
          },
        },
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
            status: {
              in: [
                IpoStatus.CLOSED,
                IpoStatus.ALLOTMENT_PENDING,
                IpoStatus.OPEN,
                IpoStatus.CLOSING_TODAY,
              ],
            },
          },
          data: updatePayload,
        });

        if (updated.count > 0) {
          totalUpdated += updated.count;
          this.lastAllotmentPollingAt.delete(ipo.id);
          this.logger.log(
            `[Manual Allotment Check] Confirmed allotment results live for IPO '${ipo.company.displayName}' (${ipo.id}). Transitioned to ALLOTMENT_COMPLETED (ALLOTMENT_OUT)`,
          );

          // EVENT A: IPO Allotment Out notification
          if (this.notificationOrchestrator) {
            this.notificationOrchestrator
              .processAllotmentOutEvent(ipo.id)
              .catch((notifErr: unknown) => {
                this.logger.error(
                  `Failed to orchestrate allotment out notification for IPO ${ipo.id} (isolated): ${(notifErr as Error)?.message || notifErr}`,
                );
              });
          }

          // AUTOMATIC USER ALLOTMENT CHECKS & EVENT B
          this.triggerAutomaticUserAllotmentChecks(ipo.id)
            .catch((checkErr: unknown) => {
              this.logger.error(
                `Failed to trigger automatic user allotment checks for IPO ${ipo.id} (isolated): ${(checkErr as Error)?.message || checkErr}`,
              );
            });
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

  /**
   * Automatically discovers users with applications or saved PANs for an IPO
   * and queues background allotment checks for each user upon ALLOTMENT_OUT.
   *
   * Idempotent & Duplicate protected: Checks for recent jobs in last 24h.
   * Failure isolated: Errors log diagnostics without failing caller.
   */
  public async triggerAutomaticUserAllotmentChecks(ipoId: string): Promise<number> {
    if (!this.allotmentJobService) {
      this.logger.debug(
        `triggerAutomaticUserAllotmentChecks: AllotmentJobService not available, skipping automatic checks for ${ipoId}`,
      );
      return 0;
    }

    try {
      // Find eligible users who have saved PANs or investments/applications
      const [savedPanUsers, investmentUsers] = await Promise.all([
        this.prisma.userSavedPan.findMany({
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.ipoInvestment.findMany({
          where: { ipoId },
          select: { brokerAccount: { select: { userId: true } } },
        }),
      ]);

      const targetUserIds = new Set<string>();
      for (const sp of savedPanUsers) {
        if (sp.userId && sp.userId.trim()) {
          targetUserIds.add(sp.userId.trim());
        }
      }
      for (const inv of investmentUsers) {
        if (inv.brokerAccount?.userId && inv.brokerAccount.userId.trim()) {
          targetUserIds.add(inv.brokerAccount.userId.trim());
        }
      }

      if (targetUserIds.size === 0) {
        this.logger.debug(
          `triggerAutomaticUserAllotmentChecks: No eligible users found for IPO ${ipoId}`,
        );
        return 0;
      }

      let queuedCount = 0;
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      for (const userId of targetUserIds) {
        // Idempotency: Check if an allotment job for this user and IPO already exists in last 24h
        const existingJob = await this.prisma.allotmentCheckJob.findFirst({
          where: {
            ipoId,
            userId,
            createdAt: { gte: oneDayAgo },
          },
        });

        if (existingJob) {
          continue;
        }

        // Create and kick off the allotment check job in the background
        try {
          await this.allotmentJobService.createJob(
            { ipoId, identifierType: AllotmentIdentifierType.PAN },
            userId,
          );
          queuedCount++;
          this.logger.log(
            `[Auto Allotment Check] Queued automated allotment check for user ${userId} on IPO ${ipoId}`,
          );
        } catch (jobErr: unknown) {
          // If user has no saved PANs or job fails for one user, isolate failure
          this.logger.debug(
            `Automated allotment check could not be queued for user ${userId} on IPO ${ipoId}: ${(jobErr as Error)?.message || jobErr}`,
          );
        }
      }

      return queuedCount;
    } catch (err: unknown) {
      this.logger.error(
        `Failed to trigger automated user allotment checks for IPO ${ipoId} (isolated): ${(err as Error)?.message || err}`,
        (err as Error)?.stack,
      );
      return 0;
    }
  }
}
