import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExchangeListing,
  IpoStatus,
  LifecycleEventType,
  MarketSegment,
  OfferCategoryType,
  ParticipantRole,
  Prisma,
  PublicationStatus,
  SyncItemAction,
  SyncTriggerType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Env } from '../../config/env';
import { AdminValidationService } from '../admin/admin-validation.service';
import { EnrichmentOrchestratorService } from '../enrichment/enrichment-orchestrator.service';
import {
  IpoFieldDiff,
  IpoGuruFetchResult,
  IpoGuruSkippedField,
  IpoGuruStatusResponse,
  IpoGuruSyncItemDetail,
  IpoGuruSyncResult,
  IpoGuruUsageState,
  IpoGuruV1Ipo,
  IpoGuruV1Response,
  IpoGuruV2Ipo,
  IpoGuruV2Response,
  IPOGURU_AUTO_DAILY_LIMIT,
  IPOGURU_MAX_MANUAL_LIMIT,
  IPOGURU_MIN_REQUEST_INTERVAL_MS,
  IPOGURU_SCHEDULED_SLOTS,
  IPOGURU_TOTAL_DAILY_LIMIT,
  computeNextScheduledSync,
  formatIstDisplay,
  getIstNow,
  parseSlotToMinutes,
} from './ipo-guru.types';
import {
  backfillSingleIpoProvenance,
  backfillAllIposProvenance,
} from './ipo-guru-provenance.backfill';
import {
  backfillSingleIpoRefundInitiation,
  backfillAllRefundInitiations,
  BackfillRefundOptions,
} from './ipo-guru-refund.backfill';

/**
 * IPO Guru v2 Service
 *
 * Automatic and manual fetch and transactional sync to canonical IPOVault database.
 * Rate limits: 10 requests/day, 1 request/minute.
 * Schedule: exactly 4 automatic requests/day (10:00, 13:00, 15:00, 17:30 IST).
 */
@Injectable()
export class IpoGuruService {
  private readonly logger = new Logger(IpoGuruService.name);
  private readonly BASE_URL = 'https://www.ipoguru.in/api/v2';
  private readonly validationService: AdminValidationService;
  private lastFetchResult: { result: IpoGuruFetchResult; fetchedAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly enrichmentOrchestrator?: EnrichmentOrchestratorService,
    @Optional()
    adminValidationService?: AdminValidationService,
  ) {
    this.validationService = adminValidationService ?? new AdminValidationService();
  }

  public clearCache(): void {
    this.lastFetchResult = null;
  }

  public getLastFetchResult(): { result: IpoGuruFetchResult; fetchedAt: number } | null {
    return this.lastFetchResult;
  }

  /**
   * Evaluates whether an openDate is on or before the current calendar day in IST.
   */
  public isOpeningDayOrPastIST(openDate: Date, now: Date = new Date()): boolean {
    const istFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
    const openDayStr = istFmt.format(openDate);
    const nowDayStr = istFmt.format(now);
    return openDayStr <= nowDayStr;
  }

  /**
   * Retrieves or initializes persistent daily usage state from PostgreSQL `sources.rate_limit_policy`.
   * Automatically resets counter at the start of each IST calendar day.
   */
  async getPersistedUsageState(now = new Date()): Promise<IpoGuruUsageState> {
    const { istDate } = getIstNow(now);

    const source = await this.prisma.source.upsert({
      where: { code: 'IPOGURU' },
      update: {},
      create: {
        code: 'IPOGURU',
        name: 'IPO Guru v2',
        sourceType: 'SECONDARY',
        baseUrl: this.BASE_URL,
        priority: 50,
      },
    });

    const rawPolicy = source.rateLimitPolicy as Record<string, unknown> | null;
    let state: IpoGuruUsageState;

    if (rawPolicy && rawPolicy.istDate === istDate) {
      state = {
        istDate,
        totalRequestsToday: Number(rawPolicy.totalRequestsToday) || 0,
        autoRequestsToday: Number(rawPolicy.autoRequestsToday) || 0,
        manualRequestsToday: Number(rawPolicy.manualRequestsToday) || 0,
        lastRequestAt: (rawPolicy.lastRequestAt as string) || null,
        lastSuccessAt: (rawPolicy.lastSuccessAt as string) || null,
        lastFetchStatus: (rawPolicy.lastFetchStatus as string) || null,
        completedSlots: Array.isArray(rawPolicy.completedSlots)
          ? (rawPolicy.completedSlots as string[])
          : [],
      };
    } else {
      // IST day rollover or initial state
      state = {
        istDate,
        totalRequestsToday: 0,
        autoRequestsToday: 0,
        manualRequestsToday: 0,
        lastRequestAt: (rawPolicy?.lastRequestAt as string) || null,
        lastSuccessAt: (rawPolicy?.lastSuccessAt as string) || null,
        lastFetchStatus: (rawPolicy?.lastFetchStatus as string) || 'IDLE',
        completedSlots: [],
      };

      await this.prisma.source.update({
        where: { id: source.id },
        data: { rateLimitPolicy: state as unknown as Prisma.InputJsonValue },
      });
    }

    return state;
  }

  /**
   * Calculates comprehensive operational status and remaining budget metrics for Console UI.
   */
  async getStatus(now = new Date()): Promise<IpoGuruStatusResponse> {
    const state = await this.getPersistedUsageState(now);
    const { timeMinutes } = getIstNow(now);

    const remainingAutoSlots = IPOGURU_SCHEDULED_SLOTS.filter(
      (slot) =>
        !state.completedSlots.includes(slot) &&
        parseSlotToMinutes(slot) >= timeMinutes,
    ).length;

    const manualAllowed = Math.max(
      0,
      IPOGURU_TOTAL_DAILY_LIMIT - state.totalRequestsToday - remainingAutoSlots,
    );
    const manualRequestsRemaining = Math.max(
      0,
      Math.min(
        IPOGURU_MAX_MANUAL_LIMIT - state.manualRequestsToday,
        manualAllowed,
      ),
    );

    const nextScheduled = computeNextScheduledSync(now, state.completedSlots);

    return {
      istDate: state.istDate,
      requestsUsedToday: state.totalRequestsToday,
      requestsRemainingToday: Math.max(
        0,
        IPOGURU_TOTAL_DAILY_LIMIT - state.totalRequestsToday,
      ),
      autoRequestsUsedToday: state.autoRequestsToday,
      autoRequestsTotal: IPOGURU_AUTO_DAILY_LIMIT,
      manualRequestsUsedToday: state.manualRequestsToday,
      manualRequestsRemaining,
      nextScheduledAutoSync: nextScheduled.label,
      nextScheduledIso: nextScheduled.iso,
      lastSuccessfulFetch: formatIstDisplay(state.lastSuccessAt),
      lastFetchStatus: state.lastFetchStatus || 'IDLE',
      lastRequestAt: state.lastRequestAt,
      scheduledSlots: [...IPOGURU_SCHEDULED_SLOTS],
      completedSlots: state.completedSlots,
    };
  }

  /**
   * Validates budget and rate limit guards before an outbound API call is dispatched.
   */
  async checkBudgetAndRateLimit(
    mode: 'AUTO' | 'MANUAL',
    slot?: string,
    now = new Date(),
  ): Promise<{ allowed: boolean; reason?: string }> {
    const state = await this.getPersistedUsageState(now);

    // 1. Rate-limit: 1 request/minute
    if (state.lastRequestAt) {
      const elapsedMs =
        now.getTime() - new Date(state.lastRequestAt).getTime();
      if (elapsedMs < IPOGURU_MIN_REQUEST_INTERVAL_MS) {
        return {
          allowed: false,
          reason: 'Rate limit: Please wait at least 1 minute between IPO Guru requests.',
        };
      }
    }

    // 2. Hard daily limit: 10 requests/day
    if (state.totalRequestsToday >= IPOGURU_TOTAL_DAILY_LIMIT) {
      return {
        allowed: false,
        reason: `Daily IPO Guru quota limit reached (${state.totalRequestsToday}/${IPOGURU_TOTAL_DAILY_LIMIT} requests used today).`,
      };
    }

    // 3. Mode-specific budget enforcement
    if (mode === 'AUTO') {
      if (state.autoRequestsToday >= IPOGURU_AUTO_DAILY_LIMIT) {
        return {
          allowed: false,
          reason: `Daily automatic IPO Guru quota reached (${state.autoRequestsToday}/${IPOGURU_AUTO_DAILY_LIMIT} slots used today).`,
        };
      }
      if (slot && state.completedSlots.includes(slot)) {
        return {
          allowed: false,
          reason: `Automatic sync slot ${slot} IST has already been completed today.`,
        };
      }
    } else {
      // MANUAL MODE
      const { timeMinutes } = getIstNow(now);
      const remainingAutoSlots = IPOGURU_SCHEDULED_SLOTS.filter(
        (s) =>
          !state.completedSlots.includes(s) &&
          parseSlotToMinutes(s) >= timeMinutes,
      ).length;

      const maxManualAllowed = Math.max(
        0,
        IPOGURU_TOTAL_DAILY_LIMIT - state.totalRequestsToday - remainingAutoSlots,
      );
      const manualRemaining = Math.min(
        maxManualAllowed,
        IPOGURU_MAX_MANUAL_LIMIT - state.manualRequestsToday,
      );

      if (manualRemaining <= 0) {
        return {
          allowed: false,
          reason:
            'Manual request blocked: Remaining quota is reserved for scheduled automatic syncs (4 slots/day).',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Persists outbound request execution count and timestamp to DB.
   */
  async recordRequestExecution(
    mode: 'AUTO' | 'MANUAL',
    slot?: string,
    httpStatus?: number,
    errorMsg?: string,
    now = new Date(),
  ): Promise<IpoGuruUsageState> {
    const state = await this.getPersistedUsageState(now);
    state.totalRequestsToday += 1;

    if (mode === 'AUTO') {
      state.autoRequestsToday += 1;
      if (slot && !state.completedSlots.includes(slot)) {
        state.completedSlots.push(slot);
      }
    } else {
      state.manualRequestsToday += 1;
    }

    state.lastRequestAt = now.toISOString();

    if (httpStatus === 200) {
      state.lastSuccessAt = now.toISOString();
      state.lastFetchStatus = 'HTTP 200 (Success)';
    } else if (errorMsg) {
      state.lastFetchStatus =
        httpStatus && httpStatus > 0
          ? `HTTP ${httpStatus}: ${errorMsg.substring(0, 80)}`
          : `ERROR: ${errorMsg.substring(0, 80)}`;
    } else if (httpStatus && httpStatus > 0) {
      state.lastFetchStatus = `HTTP ${httpStatus}`;
    }

    await this.prisma.source.update({
      where: { code: 'IPOGURU' },
      data: {
        rateLimitPolicy: state as unknown as Prisma.InputJsonValue,
        lastCheckedAt: now,
        ...(httpStatus === 200 ? { lastSuccessAt: now } : {}),
      },
    });

    return state;
  }

  /**
   * Fetch IPO data from IPO Guru v2 API with budget enforcement and persistence.
   *
   * The API key is read from IPOGURU_API_KEY environment variable and sent
   * as an X-API-KEY header. It is never included in the returned result.
   */
  async fetchIpos(
    mode: 'AUTO' | 'MANUAL' = 'MANUAL',
    slot?: string,
    params?: { months?: number; status?: string; type?: string; limit?: number },
  ): Promise<IpoGuruFetchResult> {
    const apiKey = this.configService.get('IPOGURU_API_KEY' as keyof Env, {
      infer: true,
    }) as string | undefined;

    if (!apiKey) {
      this.logger.error(
        'IPOGURU_API_KEY is not configured — cannot fetch IPO Guru data.',
      );
      throw new Error(
        'IPOGURU_API_KEY is not configured in the backend environment.',
      );
    }

    // Strictly protect scheduled auto quota: AUTO requests must be slotted scheduled runs.
    // Incidental unslotted AUTO calls are strictly cache-only and never trigger live network fetches or increment quota.
    if (
      mode === 'AUTO' &&
      (!slot || !(IPOGURU_SCHEDULED_SLOTS as readonly string[]).includes(slot))
    ) {
      const CACHE_TTL_MS = 5 * 60 * 1000;
      const isFresh =
        this.lastFetchResult &&
        Date.now() - this.lastFetchResult.fetchedAt < CACHE_TTL_MS;

      if (isFresh && this.lastFetchResult) {
        this.logger.debug(
          `IPO Guru AUTO fetch (unslotted): serving cached response (${this.lastFetchResult.result.ipos.length} IPOs) to protect scheduled auto quota`,
        );
        return this.lastFetchResult.result;
      }
      this.logger.debug(
        'IPO Guru AUTO fetch (unslotted): cache is cold or expired, returning empty response without making live external API request',
      );
      return {
        httpStatus: 200,
        ipos: [],
        total: 0,
        fetchedAt: new Date().toISOString(),
        responseKeys: ['cache_cold_skipped'],
      };
    }

    // Check budget guard
    const guard = await this.checkBudgetAndRateLimit(mode, slot);
    if (!guard.allowed) {
      this.logger.warn(`IPO Guru ${mode} fetch blocked: ${guard.reason}`);
      throw new BadRequestException({
        message: guard.reason,
        mode,
        slot,
      });
    }

    // Resolve base URL and ensure automatic migration away from retired /api/v1
    const configuredBase = this.configService.get(
      'IPOGURU_BASE_URL' as keyof Env,
      { infer: true },
    ) as string | undefined;
    let base = configuredBase?.trim() || this.BASE_URL;
    if (base.includes('/api/v1')) {
      this.logger.warn(
        `Configured IPOGURU_BASE_URL points to retired v1 (${base}). Automatically migrating to /api/v2.`,
      );
      base = base.replace(/\/api\/v1\/?$/, '/api/v2').replace('/api/v1', '/api/v2');
    }

    // Build URL with optional parameters (months, status, type, limit)
    const queryParams = new URLSearchParams();
    if (params?.months !== undefined) {
      queryParams.set('months', String(params.months));
    }
    if (params?.status) {
      queryParams.set('status', params.status);
    }
    if (params?.type) {
      queryParams.set('type', params.type);
    }
    if (params?.limit !== undefined) {
      queryParams.set('limit', String(params.limit));
    }
    const queryStr = queryParams.toString();
    const url = queryStr ? `${base}/ipos?${queryStr}` : `${base}/ipos`;
    this.logger.log(`IPO Guru v2 ${mode} fetch: GET ${url}`);

    let httpStatus = 0;
    let rawBody: IpoGuruV2Response = {};
    let fetchError: string | undefined;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'IPOVault-AdminConsole/1.0',
        },
        signal: AbortSignal.timeout(15000),
      });

      httpStatus = response.status;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let errJson: Record<string, unknown> | null = null;
        try {
          errJson = JSON.parse(errText) as Record<string, unknown>;
        } catch {}

        if (
          httpStatus === 403 &&
          (errJson?.error === 'v1_retired' ||
            errText.includes('v1_retired') ||
            errText.includes('API v1 was deprecated'))
        ) {
          fetchError =
            'IPO Guru API v1 was retired on 30 September 2026. Calls must use API v2 (https://www.ipoguru.in/api/v2).';
        } else {
          fetchError = `HTTP ${httpStatus} — ${errText.substring(0, 200)}`;
        }
        this.logger.error(`IPO Guru API error: ${fetchError}`);
      } else {
        rawBody = (await response.json()) as IpoGuruV2Response;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      fetchError = msg;
      this.logger.error(`IPO Guru network/parse error: ${msg}`);
      // Record failed execution since request was dispatched
      await this.recordRequestExecution(mode, slot, httpStatus, fetchError);
      throw new Error(`IPO Guru API request failed: ${msg}`);
    }

    // Record request execution (consumes daily quota)
    await this.recordRequestExecution(mode, slot, httpStatus, fetchError);

    if (httpStatus !== 200 && httpStatus !== 0) {
      return {
        httpStatus,
        ipos: [],
        total: 0,
        fetchedAt: new Date().toISOString(),
        responseKeys: [],
      };
    }

    const ipos: IpoGuruV1Ipo[] = this.extractIpos(rawBody);
    const total =
      rawBody.count ??
      rawBody.total ??
      (Array.isArray(ipos) ? ipos.length : 0);

    const responseKeys = Object.keys(rawBody).filter(
      (k) => !['token', 'key', 'api_key', 'secret'].includes(k),
    );

    this.logger.log(
      `IPO Guru v2 ${mode} fetch complete: ${ipos.length} IPOs returned (HTTP ${httpStatus})`,
    );

    const fetchResult: IpoGuruFetchResult = {
      httpStatus,
      ipos,
      total: Number(total) || ipos.length,
      fetchedAt: new Date().toISOString(),
      responseKeys,
    };

    this.lastFetchResult = { result: fetchResult, fetchedAt: Date.now() };

    return fetchResult;
  }

  /**
   * Synchronizes IPO Guru v2 records into the canonical IPOVault database.
   * Transactional per IPO record.
   */
  async syncIpos(
    mode: 'AUTO' | 'MANUAL' = 'MANUAL',
    slot?: string,
    providedIpos?: IpoGuruV2Ipo[],
    fetchParams?: { months?: number; status?: string; type?: string; limit?: number },
  ): Promise<IpoGuruSyncResult> {
    const startedAt = new Date();
    let rawIpos: IpoGuruV2Ipo[];
    if (providedIpos && Array.isArray(providedIpos)) {
      rawIpos = providedIpos;
    } else {
      const defaultMonths = Number(
        this.configService.get('IPOGURU_DEFAULT_MONTHS' as keyof Env, {
          infer: true,
        }),
      );
      const effectiveMonths = !isNaN(defaultMonths) ? defaultMonths : 0;
      const fetchResult = await this.fetchIpos(
        mode,
        slot,
        fetchParams ?? { months: effectiveMonths },
      );
      rawIpos = fetchResult.ipos;
    }
    const syncedAt = new Date().toISOString();

    const summary: IpoGuruSyncResult = {
      totalFetched: rawIpos.length,
      matchedUpdated: 0,
      newlyCreated: 0,
      skipped: 0,
      errorCount: 0,
      syncedAt,
      items: [],
      totalFetchedFromApi: rawIpos.length,
      insertedCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      failures: [],
    };

    if (rawIpos.length === 0) {
      try {
        const completedAt = new Date();
        const syncRun = await this.prisma.ipoSyncRun.create({
          data: {
            source: 'IPOGURU',
            trigger: mode === 'AUTO' ? SyncTriggerType.AUTO : SyncTriggerType.MANUAL,
            slot: slot || null,
            startedAt,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            totalFetched: 0,
            insertedCount: 0,
            updatedCount: 0,
            unchangedCount: 0,
            failedCount: 0,
            status: 'SUCCESS',
          },
        });
        summary.runId = syncRun.id;
      } catch (logErr: unknown) {
        this.logger.error(
          `Failed to persist empty IPO sync run: ${logErr instanceof Error ? logErr.message : String(logErr)}`,
        );
      }
      return summary;
    }

    // Ensure IPOGURU and ADMIN sources exist for authoritative lineage and admin console visibility
    const sourceId = await this.ensureIpoGuruSource();
    const adminSourceId = await this.ensureAdminSource();

    // Load existing canonical IPOs with companies and source identities for matching
    const existingIpos = await this.prisma.ipo.findMany({
      include: {
        company: true,
        sourceIdentities: {
          include: {
            source: true,
          },
        },
        lifecycleEvents: true,
        allotmentConfig: true,
      },
    });

    for (const rawItem of rawIpos) {
      const guruName = (rawItem.name || rawItem.company_name || '').trim();
      if (!guruName) {
        summary.skipped++;
        summary.unchangedCount++;
        summary.items.push({
          guruName: 'Unknown',
          action: 'SKIPPED',
          reason: 'Record has empty company name',
          updatedFields: [],
          skippedFields: [{ field: 'all', reason: 'Record has empty company name' }],
        });
        this.logger.warn('[IPO Guru Sync] "Unknown" (SKIPPED): Record has empty company name');
        continue;
      }

      try {
        const itemResult = await this.syncSingleIpo(rawItem, sourceId, existingIpos, adminSourceId);
        summary.items.push(itemResult);

        const updatedSummary =
          itemResult.updatedFields && itemResult.updatedFields.length > 0
            ? `Updated [${itemResult.updatedFields.join(', ')}]`
            : 'Updated [none]';
        const skippedSummary =
          itemResult.skippedFields && itemResult.skippedFields.length > 0
            ? `Skipped [${itemResult.skippedFields.map((s) => `${s.field} (${s.reason})`).join(', ')}]`
            : 'Skipped [none]';

        if (itemResult.action === 'SKIPPED') {
          this.logger.warn(
            `[IPO Guru Sync] "${guruName}" (SKIPPED): ${itemResult.reason || 'Skipped'}`,
          );
        } else {
          this.logger.log(
            `[IPO Guru Sync] "${guruName}" (${itemResult.action}): ${updatedSummary} | ${skippedSummary}`,
          );
        }
        if (itemResult.action === 'UPDATED') {
          summary.matchedUpdated++;
          if (itemResult.updatedFields && itemResult.updatedFields.length > 0) {
            summary.updatedCount++;
            const targetStatus = itemResult.targetStatus;
            const isActive = targetStatus === IpoStatus.UPCOMING || targetStatus === IpoStatus.OPEN;
            if (itemResult.ipoId && this.enrichmentOrchestrator && isActive) {
              this.enrichmentOrchestrator.enqueueIpoEnrichment(itemResult.ipoId);
            }
          } else {
            summary.unchangedCount++;
          }
        } else if (itemResult.action === 'CREATED') {
          summary.newlyCreated++;
          summary.insertedCount++;
          if (itemResult.ipoId) {
            const extId = (rawItem.slug || (rawItem.id ? String(rawItem.id) : guruName)).trim();
            const createdPubStatus =
              (itemResult.publicationStatus as PublicationStatus) ||
              PublicationStatus.DRAFT;
            const createdCompanyId = itemResult.companyId || itemResult.ipoId;
            const createdStatus = (itemResult.targetStatus as IpoStatus) || IpoStatus.UPCOMING;
            const createdEvents: any[] = [];
            const cOpen = this.parseDate(rawItem.open_date || rawItem.timeline?.open_date);
            const cClose = this.parseDate(rawItem.close_date || rawItem.timeline?.close_date);
            const cAllot = this.parseDate(rawItem.allotment_date || rawItem.timeline?.allotment_date);
            const rawRefund = typeof rawItem.refunds_date === 'string' ? rawItem.refunds_date : typeof rawItem.timeline?.refund_date === 'string' ? rawItem.timeline.refund_date : undefined;
            const cRefund = this.parseDate(rawRefund);
            const cListing = this.parseDate(rawItem.listing_date || rawItem.timeline?.listing_date);
            if (cOpen) createdEvents.push({ eventType: LifecycleEventType.OPEN, eventDate: cOpen });
            if (cClose) createdEvents.push({ eventType: LifecycleEventType.CLOSE, eventDate: cClose });
            if (cAllot) createdEvents.push({ eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: cAllot });
            if (cRefund) createdEvents.push({ eventType: LifecycleEventType.REFUND_INITIATION, eventDate: cRefund });
            if (cListing) createdEvents.push({ eventType: LifecycleEventType.LISTING, eventDate: cListing });

            existingIpos.push({
              id: itemResult.ipoId,
              companyId: createdCompanyId,
              marketSegment: MarketSegment.MAINBOARD,
              exchange: ExchangeListing.BOTH,
              status: createdStatus,
              publicationStatus: createdPubStatus,
              symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
              company: { id: createdCompanyId, legalName: guruName, displayName: guruName } as any,
              sourceIdentities: [
                { sourceId, externalId: extId, symbol: rawItem.symbol || null, source: { code: 'IPOGURU' } },
                { sourceId: adminSourceId, externalId: itemResult.ipoId, symbol: rawItem.symbol || null, source: { code: 'ADMIN' } },
              ] as any,
              lifecycleEvents: createdEvents,
              allotmentConfig: (rawItem.registrar || cAllot)
                ? ({
                    registrar: rawItem.registrar ? rawItem.registrar.trim() : undefined,
                    expectedAllotmentDate: cAllot || undefined,
                  } as any)
                : null,
            } as any);
            const isActive = createdStatus === IpoStatus.UPCOMING || createdStatus === IpoStatus.OPEN;
            if (this.enrichmentOrchestrator && isActive) {
              this.enrichmentOrchestrator.enqueueIpoEnrichment(itemResult.ipoId);
            }
          }
        } else if (itemResult.action === 'SKIPPED') {
          summary.skipped++;
          summary.unchangedCount++;
        } else if (itemResult.action === 'ERROR') {
          summary.errorCount++;
          summary.failedCount++;
          summary.failures.push({
            identifier: guruName,
            error: itemResult.error || itemResult.reason || 'Unknown error',
            stage: 'PERSISTENCE',
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error syncing IPO '${guruName}': ${errMsg}`);
        summary.errorCount++;
        summary.failedCount++;
        summary.failures.push({
          identifier: guruName,
          error: errMsg,
          stage: 'PERSISTENCE',
        });
        summary.items.push({
          guruName,
          action: 'ERROR',
          error: errMsg,
          externalSlug: (rawItem.slug || (rawItem.id ? String(rawItem.id) : guruName)).trim(),
        });
      }
    }

    this.logger.log(
      `[IPO Guru Sync Summary] totalFetchedFromApi=${summary.totalFetchedFromApi}, insertedCount=${summary.insertedCount}, updatedCount=${summary.updatedCount}, unchangedCount=${summary.unchangedCount}, failedCount=${summary.failedCount}` +
        (summary.failures.length > 0
          ? ` | Failures: [${summary.failures.map((f) => `${f.identifier}: ${f.error}`).join('; ')}]`
          : ''),
    );

    this.logger.log(
      `IPO Guru sync finished: ${summary.matchedUpdated} updated, ${summary.newlyCreated} created, ${summary.skipped} skipped, ${summary.errorCount} errors`,
    );

    // Persist Sync Activity Run & Log Items
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const runStatus =
      summary.failedCount === 0
        ? 'SUCCESS'
        : summary.insertedCount > 0 || summary.updatedCount > 0
          ? 'PARTIAL_FAILURE'
          : 'FAILED';

    const itemsToPersist: Array<{
      ipoId?: string | null;
      guruName: string;
      externalSlug?: string | null;
      action: 'ADDED' | 'UPDATED' | 'FAILED';
      changes?: IpoFieldDiff[] | null;
      errorReason?: string | null;
    }> = [];

    for (const item of summary.items) {
      if (item.action === 'CREATED') {
        itemsToPersist.push({
          ipoId: item.ipoId,
          guruName: item.guruName,
          externalSlug: item.externalSlug,
          action: 'ADDED',
          changes: item.diffs && item.diffs.length > 0 ? item.diffs : null,
          errorReason: null,
        });
      } else if (item.action === 'UPDATED' && item.updatedFields && item.updatedFields.length > 0) {
        itemsToPersist.push({
          ipoId: item.ipoId,
          guruName: item.guruName,
          externalSlug: item.externalSlug,
          action: 'UPDATED',
          changes: item.diffs && item.diffs.length > 0 ? item.diffs : null,
          errorReason: null,
        });
      } else if (item.action === 'ERROR') {
        itemsToPersist.push({
          ipoId: item.ipoId,
          guruName: item.guruName,
          externalSlug: item.externalSlug,
          action: 'FAILED',
          changes: null,
          errorReason: item.error || item.reason || 'Unknown error',
        });
      }
    }

    try {
      const syncRun = await this.prisma.ipoSyncRun.create({
        data: {
          source: 'IPOGURU',
          trigger: mode === 'AUTO' ? SyncTriggerType.AUTO : SyncTriggerType.MANUAL,
          slot: slot || null,
          startedAt,
          completedAt,
          durationMs,
          totalFetched: summary.totalFetchedFromApi,
          insertedCount: summary.insertedCount,
          updatedCount: summary.updatedCount,
          unchangedCount: summary.unchangedCount,
          failedCount: summary.failedCount,
          status: runStatus,
          errorMessage:
            summary.failures.length > 0
              ? summary.failures.map((f) => `${f.identifier}: ${f.error}`).join('; ')
              : null,
          items: {
            createMany: {
              data: itemsToPersist.map((item) => ({
                ipoId: item.ipoId || null,
                ipoName: item.guruName,
                externalSlug: item.externalSlug || null,
                action:
                  item.action === 'ADDED'
                    ? SyncItemAction.ADDED
                    : item.action === 'UPDATED'
                      ? SyncItemAction.UPDATED
                      : SyncItemAction.FAILED,
                changes:
                  item.changes && item.changes.length > 0
                    ? (item.changes as unknown as Prisma.InputJsonValue)
                    : Prisma.DbNull,
                errorReason: item.errorReason || null,
              })),
            },
          },
        },
      });
      summary.runId = syncRun.id;

      // Prune sync runs older than 30 days
      const retentionCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await this.prisma.ipoSyncRun.deleteMany({
        where: { startedAt: { lt: retentionCutoff } },
      });
    } catch (logErr: unknown) {
      const logErrMsg = logErr instanceof Error ? logErr.message : String(logErr);
      this.logger.error(`Failed to persist IPO sync run activity log: ${logErrMsg}`);
    }

    return summary;
  }

  /**
   * Evaluates publication eligibility for an IPO based on canonical IPOVault quality criteria:
   * 1. Reliable, verified company identity (non-empty, non-placeholder, >= 2 characters).
   * 2. No contradictory timeline dates (open <= close <= listing, etc.).
   * 3. Valid price bands (non-negative, low <= high).
   * 4. Positive lot size if provided (> 0).
   * 5. Non-negative issue sizes (issueSize >= 0, freshIssueSize >= 0, ofsSize >= 0).
   *
   * NOTE: Missing lifecycle dates (openDate, closeDate, etc.) alone DO NOT block publication.
   * Newly announced IPOs without officially announced dates can be safely published as UPCOMING.
   */
  public evaluatePublicationEligibility(params: {
    companyName: string;
    priceBandLow?: number | null;
    priceBandHigh?: number | null;
    lotSize?: number | null;
    issueSize?: number | null;
    freshIssueSize?: number | null;
    ofsSize?: number | null;
    openDate?: Date | null;
    closeDate?: Date | null;
    allotmentDate?: Date | null;
    listingDate?: Date | null;
  }): { eligible: boolean; blockers: string[] } {
    const blockers: string[] = [];
    const trimmedName = (params.companyName || '').trim();

    // 1. Reliable Company Identity Verification
    const placeholders = ['TBD', 'TBA', 'N/A', 'NA', 'UNKNOWN', 'NULL', 'UNDEFINED', 'PENDING'];
    if (!trimmedName || trimmedName.length < 2) {
      blockers.push('Company identity is missing or too short (must be at least 2 characters)');
    } else if (placeholders.includes(trimmedName.toUpperCase())) {
      blockers.push(`Company identity "${trimmedName}" is an unverified placeholder`);
    }

    // 2. Timeline Chronology & Contradictory Dates
    const { openDate, closeDate, allotmentDate, listingDate } = params;
    if (openDate && closeDate && openDate > closeDate) {
      blockers.push(
        `Open date (${openDate.toISOString().slice(0, 10)}) cannot be after close date (${closeDate.toISOString().slice(0, 10)})`,
      );
    }
    if (closeDate && listingDate && closeDate > listingDate) {
      blockers.push(
        `Close date (${closeDate.toISOString().slice(0, 10)}) cannot be after listing date (${listingDate.toISOString().slice(0, 10)})`,
      );
    }
    if (openDate && listingDate && openDate > listingDate) {
      blockers.push(
        `Open date (${openDate.toISOString().slice(0, 10)}) cannot be after listing date (${listingDate.toISOString().slice(0, 10)})`,
      );
    }
    if (openDate && allotmentDate && openDate > allotmentDate) {
      blockers.push(
        `Open date (${openDate.toISOString().slice(0, 10)}) cannot be after allotment date (${allotmentDate.toISOString().slice(0, 10)})`,
      );
    }
    if (allotmentDate && listingDate && allotmentDate > listingDate) {
      blockers.push(
        `Allotment date (${allotmentDate.toISOString().slice(0, 10)}) cannot be after listing date (${listingDate.toISOString().slice(0, 10)})`,
      );
    }

    // 3. Reused Canonical Validation Gate (Price Band, Lot Size, Issue Sizes)
    const validationReport = this.validationService.validateIpo({
      legalName: trimmedName || 'Placeholder',
      displayName: trimmedName || 'Placeholder',
      priceBandLow: params.priceBandLow,
      priceBandHigh: params.priceBandHigh,
      lotSize: params.lotSize,
      issueSize: params.issueSize,
      freshIssueSize: params.freshIssueSize,
      ofsSize: params.ofsSize,
      openDate: params.openDate,
      closeDate: params.closeDate,
      listingDate: params.listingDate,
      allotmentDate: params.allotmentDate,
    });

    for (const err of validationReport.errors) {
      if (err.code !== 'MISSING_LIFECYCLE_DATES' && err.code !== 'MISSING_LEGAL_NAME') {
        blockers.push(err.message);
      }
    }

    return {
      eligible: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Syncs a single IPO Guru item in an isolated database transaction.
   */
  private async syncSingleIpo(
    rawItem: IpoGuruV1Ipo,
    sourceId: string,
    existingIpos: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>>,
    adminSourceId?: string,
  ): Promise<IpoGuruSyncItemDetail> {
    const guruName = (rawItem.name || rawItem.company_name || '').trim();
    let match = this.matchIpo(rawItem, existingIpos);

    // If ambiguous (multiple candidates matched), attempt deterministic disambiguation:
    if (
      match.matchedBy === 'AMBIGUOUS' &&
      match.ambiguousCandidateObjects &&
      match.ambiguousCandidateObjects.length > 0
    ) {
      const rawExtId = rawItem.slug
        ? String(rawItem.slug).trim()
        : rawItem.id
        ? String(rawItem.id).trim()
        : null;
      const resolved = this.resolveCandidates(
        match.ambiguousCandidateObjects,
        rawExtId,
      );
      if (resolved) {
        this.logger.log(
          `[IPO Guru Match] Disambiguated candidate for "${guruName}": selected "${resolved.company?.displayName || resolved.company?.legalName || resolved.id}" (status: ${resolved.status}, pub: ${resolved.publicationStatus}) out of [${match.ambiguousCandidates?.join(', ')}]`,
        );
        match = {
          matchedIpo: resolved,
          matchedBy: 'DISAMBIGUATED',
        };
      }
    }

    // If still ambiguous (unresolvable identical candidates), safely skip without modifying the database.
    if (match.matchedBy === 'AMBIGUOUS') {
      const candidatesStr = match.ambiguousCandidates && match.ambiguousCandidates.length > 0
        ? match.ambiguousCandidates.join(', ')
        : 'multiple candidates';
      return {
        guruName,
        action: 'SKIPPED',
        matchedBy: 'AMBIGUOUS',
        reason: `AMBIGUOUS_MATCH: Multiple existing records matched: [${candidatesStr}]`,
        updatedFields: [],
        skippedFields: [{ field: 'all', reason: `Multiple candidate matches found: [${candidatesStr}]` }],
      };
    }

    return await this.prisma.$transaction(
      async (tx) => {
        const updatedFields: string[] = [];
        const skippedFields: IpoGuruSkippedField[] = [];
        const diffs: IpoFieldDiff[] = [];

        // Parsed fields
        const rawLogo = (rawItem.logo || (rawItem as any).logo_url || '').trim();
        const marketSegment = this.parseMarketSegment(rawItem.type || rawItem.sub_type || rawItem.ipo_type);
        const status = this.parseStatus(
          rawItem.status,
          (rawItem as Record<string, unknown>).is_listed as boolean | undefined,
        );
        const exchange = this.parseExchange(rawItem.listing_on, rawItem.exchange);
        const priceBand = this.parsePriceBand(
          rawItem.price_band,
          rawItem.price_band_min,
          rawItem.price_band_max,
          rawItem.price_min,
          rawItem.price_max,
        );
        const lotSize = this.parseInt(rawItem.lot_size);
        const faceValue = this.parseDecimal(rawItem.face_value);
        const issueSize = this.parseIssueSize(rawItem.issue_size);
        const freshIssueSize = this.parseIssueSize(rawItem.fresh_issue_size || rawItem.fresh_size);
        const ofsSize = this.parseIssueSize(rawItem.ofs_size || rawItem.ofs_issue_size);
        const listingPrice = this.parseDecimal(rawItem.listing_price);

      // Parsed dates
      const openDate = this.parseDate(rawItem.open_date || rawItem.timeline?.open_date);
      const closeDate = this.parseDate(rawItem.close_date || rawItem.timeline?.close_date);
      const allotmentDate = this.parseDate(rawItem.allotment_date || rawItem.timeline?.allotment_date);
      const refundDate = this.parseDate(rawItem.refund_date || rawItem.timeline?.refund_date);
      const listingDate = this.parseDate(rawItem.listing_date || rawItem.timeline?.listing_date);

      // Validate publication eligibility using canonical IPOVault quality criteria
      const pubEligibility = this.evaluatePublicationEligibility({
        companyName: guruName,
        priceBandLow: priceBand.low ? Number(priceBand.low) : null,
        priceBandHigh: priceBand.high ? Number(priceBand.high) : null,
        lotSize: lotSize,
        issueSize: issueSize ? Number(issueSize) : null,
        freshIssueSize: freshIssueSize ? Number(freshIssueSize) : null,
        ofsSize: ofsSize ? Number(ofsSize) : null,
        openDate,
        closeDate,
        listingDate,
        allotmentDate,
      });

      if (priceBand.wasInverted) {
        pubEligibility.eligible = false;
        pubEligibility.blockers.push('Inverted price band range in source payload (low > high)');
      }

      let ipoId: string;
      let companyId: string;
      let action: 'UPDATED' | 'CREATED';
      let publicationStatusResult: PublicationStatus;
      let targetStatusResult: IpoStatus;

      if (match.matchedIpo) {
        // --- 1. UPDATE EXISTING IPO ---
        action = 'UPDATED';
        const existingIpo = match.matchedIpo;
        ipoId = existingIpo.id;
        companyId = existingIpo.companyId;

        skippedFields.push({
          field: 'companyName',
          reason: 'Canonical company identity is authoritative',
        });

        const updateData: Prisma.IpoUpdateInput = {};

        if (rawLogo) {
          if (!existingIpo.company?.logoUrl) {
            await tx.company.update({
              where: { id: companyId },
              data: { logoUrl: rawLogo },
            });
            updatedFields.push('logoUrl');
            diffs.push({ field: 'logoUrl', before: null, after: rawLogo });
          } else {
            skippedFields.push({ field: 'logoUrl', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'logoUrl', reason: 'Not provided in payload' });
        }

        if (marketSegment) {
          if (marketSegment !== existingIpo.marketSegment) {
            updateData.marketSegment = marketSegment;
            updatedFields.push('marketSegment');
            diffs.push({ field: 'marketSegment', before: existingIpo.marketSegment, after: marketSegment });
          } else {
            skippedFields.push({ field: 'marketSegment', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'marketSegment', reason: 'Not provided in payload' });
        }

        // Check if existing record is under manual review or admin-managed
        const isAwaitingManualReview = existingIpo.sourceIdentities?.some(
          (si: any) =>
            si.source?.code === 'ADMIN' ||
            si.source?.code === 'MANUAL' ||
            si.source?.name?.toLowerCase().includes('admin') ||
            si.source?.name?.toLowerCase().includes('manual') ||
            si.sourceId === 'ADMIN' ||
            si.sourceId === 'MANUAL' ||
            (adminSourceId && si.sourceId === adminSourceId),
        );

        publicationStatusResult = existingIpo.publicationStatus;

        if (existingIpo.publicationStatus === PublicationStatus.DRAFT) {
          const effectiveName = existingIpo.company?.legalName || guruName;
          const effectivePubEligibility = this.evaluatePublicationEligibility({
            companyName: effectiveName,
            priceBandLow:
              priceBand.low != null
                ? Number(priceBand.low)
                : existingIpo.priceBandLow
                  ? Number(existingIpo.priceBandLow)
                  : null,
            priceBandHigh:
              priceBand.high != null
                ? Number(priceBand.high)
                : existingIpo.priceBandHigh
                  ? Number(existingIpo.priceBandHigh)
                  : null,
            lotSize: lotSize != null ? lotSize : existingIpo.lotSize,
            issueSize:
              issueSize != null
                ? Number(issueSize)
                : existingIpo.issueSize
                  ? Number(existingIpo.issueSize)
                  : null,
            freshIssueSize:
              freshIssueSize != null
                ? Number(freshIssueSize)
                : existingIpo.freshIssueSize
                  ? Number(existingIpo.freshIssueSize)
                  : null,
            ofsSize:
              ofsSize != null
                ? Number(ofsSize)
                : existingIpo.ofsSize
                  ? Number(existingIpo.ofsSize)
                  : null,
            openDate,
            closeDate,
            listingDate,
            allotmentDate,
          });

          if (priceBand.wasInverted) {
            effectivePubEligibility.eligible = false;
            effectivePubEligibility.blockers.push('Inverted price band range in source payload (low > high)');
          }

          if (isAwaitingManualReview) {
            skippedFields.push({
              field: 'publicationStatus',
              reason: 'Preserving DRAFT (awaiting manual review / admin-managed)',
            });
            this.logger.debug(
              `Preserving DRAFT status for IPO "${existingIpo.company?.displayName || ipoId}": awaiting manual review / admin-managed.`,
            );
          } else if (!effectivePubEligibility.eligible) {
            skippedFields.push({
              field: 'publicationStatus',
              reason: `Preserving DRAFT (quality criteria not met: ${effectivePubEligibility.blockers.join(', ')})`,
            });
            this.logger.warn(
              `Preserving DRAFT status for IPO "${existingIpo.company?.displayName || ipoId}": publication criteria not met (${effectivePubEligibility.blockers.join(', ')}).`,
            );
          } else {
            updateData.publicationStatus = PublicationStatus.PUBLISHED;
            updatedFields.push('publicationStatus');
            diffs.push({
              field: 'publicationStatus',
              before: existingIpo.publicationStatus,
              after: PublicationStatus.PUBLISHED,
            });
            publicationStatusResult = PublicationStatus.PUBLISHED;
          }
        } else {
          skippedFields.push({ field: 'publicationStatus', reason: 'Already PUBLISHED' });
        }
        // Monotonic Status Protection: Never allow IPO Guru to downgrade active or terminal lifecycle statuses
        const protectedStatuses = new Set<IpoStatus>([
          IpoStatus.ALLOTMENT_COMPLETED,
          IpoStatus.LISTING_PENDING,
          IpoStatus.LISTED,
          IpoStatus.WITHDRAWN,
          IpoStatus.CANCELLED,
        ]);

        if (protectedStatuses.has(existingIpo.status)) {
          skippedFields.push({
            field: 'status',
            reason: `Monotonic guard: IPO is in protected ${existingIpo.status} status`,
          });
        } else if (existingIpo.status === IpoStatus.DRAFT) {
          const derivedStatus =
            status ||
            (openDate
              ? this.isOpeningDayOrPastIST(openDate)
                ? IpoStatus.OPEN
                : IpoStatus.UPCOMING
              : IpoStatus.UPCOMING);
          updateData.status = derivedStatus;
          updatedFields.push('status');
          diffs.push({ field: 'status', before: existingIpo.status, after: derivedStatus });
        } else {
          // NOTE: Canonical active IPO lifecycle status is authoritative and MUST NEVER be overwritten by IPO Guru.
          skippedFields.push({
            field: 'status',
            reason: 'Canonical lifecycle status is authoritative',
          });
        }

        if (exchange) {
          if (exchange !== existingIpo.exchange) {
            updateData.exchange = exchange;
            updatedFields.push('exchange');
            diffs.push({ field: 'exchange', before: existingIpo.exchange, after: exchange });
          } else {
            skippedFields.push({ field: 'exchange', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'exchange', reason: 'Not provided in payload' });
        }

        if (priceBand.low != null) {
          if (!existingIpo.priceBandLow || !existingIpo.priceBandLow.equals(priceBand.low)) {
            updateData.priceBandLow = priceBand.low;
            updatedFields.push('priceBandLow');
            diffs.push({
              field: 'priceBandLow',
              before: existingIpo.priceBandLow ? Number(existingIpo.priceBandLow) : null,
              after: Number(priceBand.low),
            });
          } else {
            skippedFields.push({ field: 'priceBandLow', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'priceBandLow', reason: 'Not provided in payload' });
        }

        if (priceBand.high != null) {
          if (!existingIpo.priceBandHigh || !existingIpo.priceBandHigh.equals(priceBand.high)) {
            updateData.priceBandHigh = priceBand.high;
            updatedFields.push('priceBandHigh');
            diffs.push({
              field: 'priceBandHigh',
              before: existingIpo.priceBandHigh ? Number(existingIpo.priceBandHigh) : null,
              after: Number(priceBand.high),
            });
          } else {
            skippedFields.push({ field: 'priceBandHigh', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'priceBandHigh', reason: 'Not provided in payload' });
        }

        if (lotSize != null) {
          if (lotSize !== existingIpo.lotSize) {
            updateData.lotSize = lotSize;
            updatedFields.push('lotSize');
            diffs.push({ field: 'lotSize', before: existingIpo.lotSize, after: lotSize });
          } else {
            skippedFields.push({ field: 'lotSize', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'lotSize', reason: 'Not provided in payload' });
        }

        if (faceValue != null) {
          if (!existingIpo.faceValue || !existingIpo.faceValue.equals(faceValue)) {
            updateData.faceValue = faceValue;
            updatedFields.push('faceValue');
            diffs.push({
              field: 'faceValue',
              before: existingIpo.faceValue ? Number(existingIpo.faceValue) : null,
              after: Number(faceValue),
            });
          } else {
            skippedFields.push({ field: 'faceValue', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'faceValue', reason: 'Not provided in payload' });
        }

        if (issueSize != null) {
          if (!existingIpo.issueSize || !existingIpo.issueSize.equals(issueSize)) {
            updateData.issueSize = issueSize;
            updatedFields.push('issueSize');
            diffs.push({
              field: 'issueSize',
              before: existingIpo.issueSize ? Number(existingIpo.issueSize) : null,
              after: Number(issueSize),
            });
          } else {
            skippedFields.push({ field: 'issueSize', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'issueSize', reason: 'Not provided in payload' });
        }

        if (freshIssueSize != null) {
          if (!existingIpo.freshIssueSize || !existingIpo.freshIssueSize.equals(freshIssueSize)) {
            updateData.freshIssueSize = freshIssueSize;
            updatedFields.push('freshIssueSize');
            diffs.push({
              field: 'freshIssueSize',
              before: existingIpo.freshIssueSize ? Number(existingIpo.freshIssueSize) : null,
              after: Number(freshIssueSize),
            });
          } else {
            skippedFields.push({ field: 'freshIssueSize', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'freshIssueSize', reason: 'Not provided in payload' });
        }

        if (ofsSize != null) {
          if (!existingIpo.ofsSize || !existingIpo.ofsSize.equals(ofsSize)) {
            updateData.ofsSize = ofsSize;
            updatedFields.push('ofsSize');
            diffs.push({
              field: 'ofsSize',
              before: existingIpo.ofsSize ? Number(existingIpo.ofsSize) : null,
              after: Number(ofsSize),
            });
          } else {
            skippedFields.push({ field: 'ofsSize', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'ofsSize', reason: 'Not provided in payload' });
        }

        // Listing price sync rule:
        // - If canonical IPO status is LISTED (or transitioned to LISTED), allow IPO Guru's listing price to update listingPrice.
        // - If canonical IPO status is anything other than LISTED, do NOT update listingPrice.
        // - Never overwrite an existing valid listing price with null/undefined/missing IPO Guru data.
        const isListed =
          existingIpo.status === IpoStatus.LISTED ||
          updateData.status === IpoStatus.LISTED;

        if (!isListed) {
          skippedFields.push({ field: 'listingPrice', reason: 'IPO status is not LISTED' });
        } else if (listingPrice == null || listingPrice.lessThanOrEqualTo(0)) {
          skippedFields.push({ field: 'listingPrice', reason: 'Not provided in payload' });
        } else if (existingIpo.listingPrice && existingIpo.listingPrice.equals(listingPrice)) {
          skippedFields.push({ field: 'listingPrice', reason: 'Value unchanged' });
        } else {
          updateData.listingPrice = listingPrice;
          const effIssuePrice = existingIpo.priceBandHigh
            ? Number(existingIpo.priceBandHigh)
            : existingIpo.priceBandLow
            ? Number(existingIpo.priceBandLow)
            : priceBand.high
            ? Number(priceBand.high)
            : priceBand.low
            ? Number(priceBand.low)
            : null;
          if (effIssuePrice && effIssuePrice > 0) {
            const numListingPrice = Number(listingPrice);
            const gain = Number((((numListingPrice - effIssuePrice) / effIssuePrice) * 100).toFixed(2));
            updateData.listingGainPct = new Prisma.Decimal(gain);
            updateData.profitPercentage = new Prisma.Decimal(gain);
            const lot = existingIpo.lotSize || lotSize || 1;
            const profit = Number(((numListingPrice - effIssuePrice) * lot).toFixed(2));
            updateData.profitAmount = new Prisma.Decimal(profit);
          }
          updatedFields.push('listingPrice');
          diffs.push({
            field: 'listingPrice',
            before: existingIpo.listingPrice ? Number(existingIpo.listingPrice) : null,
            after: Number(listingPrice),
          });
        }

        const cleanSymbol = rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null;
        if (cleanSymbol) {
          const hasMatchingSymbol =
            (existingIpo.symbol && existingIpo.symbol.toUpperCase() === cleanSymbol) ||
            existingIpo.sourceIdentities?.some(
              (si: any) =>
                (si.sourceId === sourceId || si.source?.code === 'IPOGURU') &&
                si.symbol &&
                si.symbol.toUpperCase() === cleanSymbol,
            );
          if (!hasMatchingSymbol) {
            updatedFields.push('sourceIdentitySymbol');
            diffs.push({
              field: 'symbol',
              before: existingIpo.symbol || null,
              after: cleanSymbol,
            });
          } else {
            skippedFields.push({ field: 'symbol', reason: 'Value unchanged' });
          }
        } else {
          skippedFields.push({ field: 'symbol', reason: 'Not provided in payload' });
        }
        skippedFields.push({
          field: 'isin',
          reason: rawItem.isin ? 'Canonical ISIN is preserved on IPO record' : 'Not provided in payload',
        });

        targetStatusResult = (updateData.status as IpoStatus) || existingIpo.status;
        if (Object.keys(updateData).length > 0) {
          await tx.ipo.update({
            where: { id: ipoId },
            data: updateData,
          });
        }
      } else {
        // --- 2. CREATE NEW COMPANY & IPO ---
        action = 'CREATED';
        const company = await tx.company.create({
          data: {
            legalName: guruName,
            displayName: guruName,
            logoUrl: rawLogo || null,
          },
        });
        companyId = company.id;
        if (rawLogo) updatedFields.push('logoUrl');

        const initialStatus =
          status ||
          (openDate
            ? this.isOpeningDayOrPastIST(openDate)
              ? IpoStatus.OPEN
              : IpoStatus.UPCOMING
            : IpoStatus.UPCOMING);
        targetStatusResult = initialStatus;

        if (!pubEligibility.eligible) {
          this.logger.warn(
            `IPO "${guruName}" created as DRAFT: publication criteria not met (${pubEligibility.blockers.join(', ')}).`,
          );
          publicationStatusResult = PublicationStatus.DRAFT;
        } else {
          publicationStatusResult = PublicationStatus.PUBLISHED;
        }

        let createListingGainPct: Prisma.Decimal | null = null;
        let createProfitAmount: Prisma.Decimal | null = null;
        let createProfitPercentage: Prisma.Decimal | null = null;
        const validCreateListingPrice =
          initialStatus === IpoStatus.LISTED &&
          listingPrice &&
          listingPrice.greaterThan(0)
            ? listingPrice
            : null;

        if (validCreateListingPrice) {
          const effIssuePrice = priceBand.high
            ? Number(priceBand.high)
            : priceBand.low
            ? Number(priceBand.low)
            : null;
          if (effIssuePrice && effIssuePrice > 0) {
            const numListingPrice = Number(validCreateListingPrice);
            const gain = Number((((numListingPrice - effIssuePrice) / effIssuePrice) * 100).toFixed(2));
            createListingGainPct = new Prisma.Decimal(gain);
            createProfitPercentage = new Prisma.Decimal(gain);
            const lot = lotSize || 1;
            const profit = Number(((numListingPrice - effIssuePrice) * lot).toFixed(2));
            createProfitAmount = new Prisma.Decimal(profit);
          }
        }

        const newIpo = await tx.ipo.create({
          data: {
            companyId: company.id,
            marketSegment: marketSegment || MarketSegment.MAINBOARD,
            exchange: exchange || ExchangeListing.BOTH,
            status: initialStatus,
            publicationStatus: publicationStatusResult,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
            isin: rawItem.isin ? rawItem.isin.trim().toUpperCase() : null,
            priceBandLow: priceBand.low,
            priceBandHigh: priceBand.high,
            lotSize: lotSize,
            faceValue: faceValue,
            issueSize: issueSize,
            freshIssueSize: freshIssueSize,
            ofsSize: ofsSize,
            listingPrice: validCreateListingPrice,
            listingGainPct: createListingGainPct,
            profitAmount: createProfitAmount,
            profitPercentage: createProfitPercentage,
          },
        });
        ipoId = newIpo.id;
        updatedFields.push('company', 'ipo');
        if (rawItem.symbol) updatedFields.push('sourceIdentitySymbol');

        diffs.push({ field: 'status', before: null, after: targetStatusResult });
        diffs.push({ field: 'publicationStatus', before: null, after: publicationStatusResult });
        if (priceBand.low != null || priceBand.high != null) {
          diffs.push({
            field: 'priceBand',
            before: null,
            after: `${priceBand.low ?? '—'} - ${priceBand.high ?? '—'}`,
          });
        }
        if (lotSize != null) {
          diffs.push({ field: 'lotSize', before: null, after: lotSize });
        }
        if (openDate) {
          diffs.push({ field: 'openDate', before: null, after: openDate.toISOString().slice(0, 10) });
        }
        if (closeDate) {
          diffs.push({ field: 'closeDate', before: null, after: closeDate.toISOString().slice(0, 10) });
        }
        if (listingDate) {
          diffs.push({ field: 'listingDate', before: null, after: listingDate.toISOString().slice(0, 10) });
        }
        if (rawItem.registrar) {
          diffs.push({ field: 'registrar', before: null, after: rawItem.registrar.trim() });
        }

        if (!priceBand.low) skippedFields.push({ field: 'priceBandLow', reason: 'Not provided in payload' });
        if (!priceBand.high) skippedFields.push({ field: 'priceBandHigh', reason: 'Not provided in payload' });
        if (lotSize == null) skippedFields.push({ field: 'lotSize', reason: 'Not provided in payload' });
        if (faceValue == null) skippedFields.push({ field: 'faceValue', reason: 'Not provided in payload' });
        if (issueSize == null) skippedFields.push({ field: 'issueSize', reason: 'Not provided in payload' });
        if (freshIssueSize == null) skippedFields.push({ field: 'freshIssueSize', reason: 'Not provided in payload' });
        if (ofsSize == null) skippedFields.push({ field: 'ofsSize', reason: 'Not provided in payload' });
        if (initialStatus !== IpoStatus.LISTED) {
          skippedFields.push({ field: 'listingPrice', reason: 'IPO status is not LISTED' });
        } else if (listingPrice == null) {
          skippedFields.push({ field: 'listingPrice', reason: 'Not provided in payload' });
        }
        if (!rawItem.symbol) skippedFields.push({ field: 'symbol', reason: 'Not provided in payload' });
        if (!rawItem.isin) skippedFields.push({ field: 'isin', reason: 'Not provided in payload' });
      }

      // Link SourceIdentity for IPOGURU (v2 uses slug as identifier)
      const externalId = (rawItem.slug || (rawItem.id ? String(rawItem.id) : guruName)).trim();

      // Safely link IPOGURU SourceIdentity (preventing P2002 on source_id + external_id)
      const existingBySourceAndExt = await tx.ipoSourceIdentity.findFirst({
        where: { sourceId, externalId },
      });
      const existingByIpoAndSource = await tx.ipoSourceIdentity.findUnique({
        where: { ipoId_sourceId: { ipoId, sourceId } },
      });

      if (existingBySourceAndExt && existingBySourceAndExt.ipoId !== ipoId) {
        if (existingByIpoAndSource) {
          await tx.ipoSourceIdentity.delete({
            where: { id: existingBySourceAndExt.id },
          });
          await tx.ipoSourceIdentity.update({
            where: { id: existingByIpoAndSource.id },
            data: {
              externalId,
              symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : undefined,
            },
          });
        } else {
          await tx.ipoSourceIdentity.update({
            where: { id: existingBySourceAndExt.id },
            data: {
              ipoId,
              symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : undefined,
            },
          });
        }
      } else {
        await tx.ipoSourceIdentity.upsert({
          where: {
            ipoId_sourceId: {
              ipoId,
              sourceId,
            },
          },
          update: {
            externalId,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : undefined,
          },
          create: {
            ipoId,
            sourceId,
            externalId,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
          },
        });
      }

      // Link ADMIN SourceIdentity so the IPO is immediately recognized in Manual IPO Manager
      if (adminSourceId) {
        await tx.ipoSourceIdentity.upsert({
          where: {
            ipoId_sourceId: {
              ipoId,
              sourceId: adminSourceId,
            },
          },
          update: {
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : undefined,
          },
          create: {
            ipoId,
            sourceId: adminSourceId,
            externalId: ipoId,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
          },
        });
      }

      if (openDate) {
        const existingOpen = (match.matchedIpo as any)?.lifecycleEvents?.find((e: any) => e.eventType === 'OPEN');
        const isDateChanged = action === 'CREATED' || !existingOpen || !existingOpen.eventDate || new Date(existingOpen.eventDate).getTime() !== openDate.getTime();
        if (isDateChanged) {
          await tx.ipoLifecycleEvent.upsert({
            where: { ipoId_eventType: { ipoId, eventType: 'OPEN' } },
            update: { eventDate: openDate, sourceId },
            create: { ipoId, eventType: 'OPEN', eventDate: openDate, sourceId },
          });
          updatedFields.push('openDate');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'openDate',
              before: existingOpen?.eventDate ? new Date(existingOpen.eventDate).toISOString().slice(0, 10) : null,
              after: openDate.toISOString().slice(0, 10),
            });
          }
        } else {
          skippedFields.push({ field: 'openDate', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'openDate', reason: 'Not provided in payload' });
      }

      if (closeDate) {
        const existingClose = (match.matchedIpo as any)?.lifecycleEvents?.find((e: any) => e.eventType === 'CLOSE');
        const isDateChanged = action === 'CREATED' || !existingClose || !existingClose.eventDate || new Date(existingClose.eventDate).getTime() !== closeDate.getTime();
        if (isDateChanged) {
          await tx.ipoLifecycleEvent.upsert({
            where: { ipoId_eventType: { ipoId, eventType: 'CLOSE' } },
            update: { eventDate: closeDate, sourceId },
            create: { ipoId, eventType: 'CLOSE', eventDate: closeDate, sourceId },
          });
          updatedFields.push('closeDate');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'closeDate',
              before: existingClose?.eventDate ? new Date(existingClose.eventDate).toISOString().slice(0, 10) : null,
              after: closeDate.toISOString().slice(0, 10),
            });
          }
        } else {
          skippedFields.push({ field: 'closeDate', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'closeDate', reason: 'Not provided in payload' });
      }

      if (allotmentDate) {
        const existingAllotment = (match.matchedIpo as any)?.lifecycleEvents?.find((e: any) => e.eventType === 'BASIS_OF_ALLOTMENT');
        const isDateChanged = action === 'CREATED' || !existingAllotment || !existingAllotment.eventDate || new Date(existingAllotment.eventDate).getTime() !== allotmentDate.getTime();
        if (isDateChanged) {
          await tx.ipoLifecycleEvent.upsert({
            where: { ipoId_eventType: { ipoId, eventType: 'BASIS_OF_ALLOTMENT' } },
            update: { eventDate: allotmentDate, sourceId },
            create: { ipoId, eventType: 'BASIS_OF_ALLOTMENT', eventDate: allotmentDate, sourceId },
          });
          updatedFields.push('allotmentDate');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'allotmentDate',
              before: existingAllotment?.eventDate ? new Date(existingAllotment.eventDate).toISOString().slice(0, 10) : null,
              after: allotmentDate.toISOString().slice(0, 10),
            });
          }
        } else {
          skippedFields.push({ field: 'allotmentDate', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'allotmentDate', reason: 'Not provided in payload' });
      }

      if (refundDate) {
        const existingRefund = (match.matchedIpo as any)?.lifecycleEvents?.find((e: any) => e.eventType === 'REFUND_INITIATION');
        const isDateChanged = action === 'CREATED' || !existingRefund || !existingRefund.eventDate || new Date(existingRefund.eventDate).getTime() !== refundDate.getTime();
        if (isDateChanged) {
          await tx.ipoLifecycleEvent.upsert({
            where: { ipoId_eventType: { ipoId, eventType: 'REFUND_INITIATION' } },
            update: { eventDate: refundDate, sourceId },
            create: { ipoId, eventType: 'REFUND_INITIATION', eventDate: refundDate, sourceId },
          });
          updatedFields.push('refundDate');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'refundDate',
              before: existingRefund?.eventDate ? new Date(existingRefund.eventDate).toISOString().slice(0, 10) : null,
              after: refundDate.toISOString().slice(0, 10),
            });
          }
        } else {
          skippedFields.push({ field: 'refundDate', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'refundDate', reason: 'Not provided in payload' });
      }

      if (listingDate) {
        const existingListing = (match.matchedIpo as any)?.lifecycleEvents?.find((e: any) => e.eventType === 'LISTING');
        const isDateChanged = action === 'CREATED' || !existingListing || !existingListing.eventDate || new Date(existingListing.eventDate).getTime() !== listingDate.getTime();
        if (isDateChanged) {
          await tx.ipoLifecycleEvent.upsert({
            where: { ipoId_eventType: { ipoId, eventType: 'LISTING' } },
            update: { eventDate: listingDate, sourceId },
            create: { ipoId, eventType: 'LISTING', eventDate: listingDate, sourceId },
          });
          updatedFields.push('listingDate');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'listingDate',
              before: existingListing?.eventDate ? new Date(existingListing.eventDate).toISOString().slice(0, 10) : null,
              after: listingDate.toISOString().slice(0, 10),
            });
          }
        } else {
          skippedFields.push({ field: 'listingDate', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'listingDate', reason: 'Not provided in payload' });
      }

      // --- 4. ALLOTMENT CONFIG & REGISTRAR PARTICIPANT ---
      const registrar = (rawItem.registrar || '').trim();
      if (registrar) {
        const existingCfg = (match.matchedIpo as any)?.allotmentConfig;
        const hasVerifiedCode = Boolean(existingCfg?.registrarIpoCode?.trim());
        const isRegistrarChanged =
          action === 'CREATED' ||
          !existingCfg ||
          (!hasVerifiedCode && existingCfg.registrar !== registrar) ||
          (allotmentDate && (!existingCfg.expectedAllotmentDate || new Date(existingCfg.expectedAllotmentDate).getTime() !== allotmentDate.getTime()));

        if (isRegistrarChanged) {
          const preservedCode = existingCfg?.registrarIpoCode?.trim() || undefined;
          const registrarToSet = hasVerifiedCode && existingCfg.registrar ? existingCfg.registrar : registrar;

          await tx.ipoAllotmentConfig.upsert({
            where: { ipoId },
            update: {
              registrar: registrarToSet,
              expectedAllotmentDate: allotmentDate || undefined,
              enabled: true,
              ...(preservedCode ? { registrarIpoCode: preservedCode } : {}),
            },
            create: {
              ipoId,
              registrar,
              expectedAllotmentDate: allotmentDate,
              enabled: true,
            },
          });

          // Ensure registrar participant exists
          const existingParticipant = await tx.ipoParticipant.findFirst({
            where: { ipoId, role: ParticipantRole.REGISTRAR },
          });
          if (existingParticipant) {
            if (existingParticipant.name !== registrar) {
              await tx.ipoParticipant.update({
                where: { id: existingParticipant.id },
                data: { name: registrar },
              });
            }
          } else {
            await tx.ipoParticipant.create({
              data: {
                ipoId,
                role: ParticipantRole.REGISTRAR,
                name: registrar,
              },
            });
          }
          updatedFields.push('registrar');
          if (action === 'UPDATED') {
            diffs.push({
              field: 'registrar',
              before: existingCfg?.registrar || null,
              after: registrar,
            });
          }
        } else {
          skippedFields.push({ field: 'registrar', reason: 'Value unchanged' });
        }
      } else {
        skippedFields.push({ field: 'registrar', reason: 'Not provided in payload' });
      }

      // --- 5. GMP OBSERVATION ---
      const gmpObj = rawItem.gmp && typeof rawItem.gmp === 'object' ? rawItem.gmp : null;
      const gmpAmount = this.parseDecimal(gmpObj ? gmpObj.price : rawItem.gmp);
      const gmpPercentage = this.parseDecimal(gmpObj ? gmpObj.percentage : rawItem.gmp_pct);
      const gmpObservedAt = this.parseTimestamp(
        (gmpObj ? (gmpObj.updated_at || gmpObj.updated_at_label) : (rawItem.gmp_updated_at || rawItem.gmp_updated_at_label)) as string | null,
      );

      if (gmpAmount != null) {
        const existingGmp = await tx.gmpObservation.findFirst({
          where: {
            ipoId,
            observedAt: gmpObservedAt,
            gmpAmount,
          },
        });
        if (!existingGmp) {
          await tx.gmpObservation.create({
            data: {
              ipoId,
              gmpAmount,
              gmpPercentage,
              observedAt: gmpObservedAt,
              sourceId,
            },
          });
          updatedFields.push('gmpObservation');
        } else {
          skippedFields.push({ field: 'gmpObservation', reason: 'Observation at timestamp already exists' });
        }
      } else {
        skippedFields.push({ field: 'gmpObservation', reason: 'Not provided in payload' });
      }

      // --- 6. SUBSCRIPTION OBSERVATIONS ---
      const sub = rawItem.subscription || {};
      const subObservedAt = this.parseTimestamp(
        (sub.updated_at || sub.updated_at_label || rawItem.sub_updated_at || rawItem.sub_updated_at_label) as string | null,
      );

      const subCategories: Array<{ cat: OfferCategoryType; val: unknown }> = [
        { cat: OfferCategoryType.QIB, val: sub.qib != null ? sub.qib : rawItem.qib_sub },
        { cat: OfferCategoryType.NII, val: sub.nii != null ? sub.nii : rawItem.nii_sub },
        { cat: OfferCategoryType.RETAIL, val: sub.retail != null ? sub.retail : rawItem.retail_sub },
        { cat: OfferCategoryType.OTHER, val: sub.other != null ? sub.other : rawItem.other_sub },
      ];

      for (const { cat, val } of subCategories) {
        const multiple = this.parseDecimal(val);
        if (multiple != null) {
          const existingSub = await tx.subscriptionObservation.findFirst({
            where: {
              ipoId,
              category: cat,
              observedAt: subObservedAt,
            },
          });
          if (!existingSub) {
            await tx.subscriptionObservation.create({
              data: {
                ipoId,
                category: cat,
                subscriptionMultiple: multiple,
                observedAt: subObservedAt,
                sourceId,
              },
            });
            updatedFields.push(`subscription_${cat}`);
          } else {
            skippedFields.push({ field: `subscription_${cat}`, reason: 'Observation at timestamp already exists' });
          }
        } else {
          skippedFields.push({ field: `subscription_${cat}`, reason: 'Not provided in payload' });
        }
      }

      // --- 7. FIELD PROVENANCE ---
      const sourceRef = externalId
        ? `https://www.ipoguru.in/api/v2/ipos/${externalId}`
        : 'https://www.ipoguru.in/api/v2';

      if (action === 'CREATED' || updatedFields.length > 0) {
        await this.recordIpoGuruFieldProvenances(
          tx,
          ipoId,
          companyId,
          sourceId,
          sourceRef,
          {
            legalName: guruName || null,
            displayName: guruName || null,
            marketSegment: marketSegment || null,
            exchange: exchange || null,
            status: action === 'CREATED' ? (status || IpoStatus.UPCOMING) : null,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
            isin: rawItem.isin ? rawItem.isin.trim().toUpperCase() : null,
            priceBandLow: priceBand.low,
            priceBandHigh: priceBand.high,
            lotSize: lotSize,
            faceValue: faceValue,
            issueSize: issueSize,
            freshIssueSize: freshIssueSize,
            ofsSize: ofsSize,
            listingPrice:
              (action === 'CREATED' && (status || IpoStatus.UPCOMING) === IpoStatus.LISTED) ||
              (action === 'UPDATED' && match.matchedIpo?.status === IpoStatus.LISTED)
                ? listingPrice
                : null,
            openDate: openDate || null,
            closeDate: closeDate || null,
            allotmentDate: allotmentDate || null,
            refundDate: refundDate || null,
            listingDate: listingDate || null,
            registrarName: registrar || null,
          },
        );
      }

      // Update matched entry in existingIpos in memory so subsequent records in the batch see up-to-date state
      if (action === 'UPDATED' && match.matchedIpo) {
        const existingEntry = match.matchedIpo as any;
        if (publicationStatusResult) {
          existingEntry.publicationStatus = publicationStatusResult;
        }
        if (targetStatusResult) {
          existingEntry.status = targetStatusResult;
        }
        if (rawItem.symbol) {
          existingEntry.symbol = rawItem.symbol.trim().toUpperCase();
        }
        existingEntry.lifecycleEvents = existingEntry.lifecycleEvents || [];
        const upsertMemEvent = (eventType: LifecycleEventType, date: Date | null) => {
          if (!date) return;
          const idx = existingEntry.lifecycleEvents.findIndex((ev: any) => ev.eventType === eventType);
          if (idx >= 0) {
            existingEntry.lifecycleEvents[idx].eventDate = date;
          } else {
            existingEntry.lifecycleEvents.push({ eventType, eventDate: date });
          }
        };
        upsertMemEvent(LifecycleEventType.OPEN, openDate);
        upsertMemEvent(LifecycleEventType.CLOSE, closeDate);
        upsertMemEvent(LifecycleEventType.BASIS_OF_ALLOTMENT, allotmentDate);
        upsertMemEvent(LifecycleEventType.REFUND_INITIATION, refundDate);
        upsertMemEvent(LifecycleEventType.LISTING, listingDate);

        if (registrar || allotmentDate) {
          existingEntry.allotmentConfig = existingEntry.allotmentConfig || {};
          if (registrar) {
            existingEntry.allotmentConfig.registrar = registrar;
          }
          if (allotmentDate) {
            existingEntry.allotmentConfig.expectedAllotmentDate = allotmentDate;
          }
        }
      }

      return {
        guruName,
        action,
        ipoId,
        companyId,
        targetStatus: targetStatusResult,
        companyName: match.matchedIpo ? match.matchedIpo.company.displayName : guruName,
        externalSlug: (rawItem.slug || (rawItem.id ? String(rawItem.id) : guruName)).trim(),
        matchedBy: match.matchedBy,
        updatedFields,
        diffs,
        skippedFields,
        publicationStatus: publicationStatusResult,
      };
    }, { timeout: 20000, maxWait: 10000 });
  }

  /**
   * Deterministically matches an IPO Guru record to an existing canonical IPO.
   * If multiple existing records match, returns 'AMBIGUOUS' so the caller can safely skip.
   */
  public matchIpo(
    rawItem: IpoGuruV1Ipo,
    existingIpos: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>>,
  ): {
    matchedIpo: Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }> | null;
    matchedBy: 'SYMBOL' | 'NAME' | 'DISAMBIGUATED' | 'AMBIGUOUS' | 'NONE';
    ambiguousCandidates?: string[];
    ambiguousCandidateObjects?: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>>;
  } {
    const rawSymbol = rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null;
    const rawName = (rawItem.name || rawItem.company_name || '').trim();
    const rawNormName = this.normalizeCompanyName(rawName);
    const rawExternalId = rawItem.slug ? String(rawItem.slug).trim() : rawItem.id ? String(rawItem.id).trim() : null;

    // 0. Match by externalId / slug in SourceIdentities
    if (rawExternalId) {
      const idMatches: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>> = [];
      for (const ipo of existingIpos) {
        if (
          ipo.sourceIdentities.some(
            (sid) => sid.externalId && sid.externalId.toLowerCase() === rawExternalId.toLowerCase(),
          )
        ) {
          idMatches.push(ipo);
        }
      }

      if (idMatches.length === 1) {
        return { matchedIpo: idMatches[0], matchedBy: 'SYMBOL' };
      } else if (idMatches.length > 1) {
        return {
          matchedIpo: null,
          matchedBy: 'AMBIGUOUS',
          ambiguousCandidates: idMatches.map((m) => `${m.company.displayName} (ID: ${m.id})`),
          ambiguousCandidateObjects: idMatches,
        };
      }
    }

    // 1. Match by Symbol
    if (rawSymbol) {
      const symbolMatches: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>> = [];
      for (const ipo of existingIpos) {
        if (
          (ipo.symbol && ipo.symbol.toUpperCase() === rawSymbol) ||
          (ipo.nseSymbol && ipo.nseSymbol.toUpperCase() === rawSymbol) ||
          (ipo.bseSymbol && ipo.bseSymbol.toUpperCase() === rawSymbol) ||
          ipo.sourceIdentities.some((sid) => sid.symbol && sid.symbol.toUpperCase() === rawSymbol)
        ) {
          symbolMatches.push(ipo);
        }
      }

      if (symbolMatches.length === 1) {
        return { matchedIpo: symbolMatches[0], matchedBy: 'SYMBOL' };
      } else if (symbolMatches.length > 1) {
        return {
          matchedIpo: null,
          matchedBy: 'AMBIGUOUS',
          ambiguousCandidates: symbolMatches.map((m) => `${m.company.displayName} (ID: ${m.id})`),
          ambiguousCandidateObjects: symbolMatches,
        };
      }
    }

    // 2. Match by exact normalized legal/display name
    if (rawNormName) {
      let nameMatches: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>> = [];
      for (const ipo of existingIpos) {
        const legalNorm = ipo.company?.legalName ? this.normalizeCompanyName(ipo.company.legalName) : '';
        const displayNorm = ipo.company?.displayName ? this.normalizeCompanyName(ipo.company.displayName) : '';
        if (legalNorm === rawNormName || displayNorm === rawNormName) {
          nameMatches.push(ipo);
        }
      }

      // Date-proximity guard: if rawItem has open or listing dates and candidates have dates, filter out those >180 days apart
      const rawDate = this.parseDate(
        rawItem.open_date || rawItem.timeline?.open_date || rawItem.listing_date || rawItem.timeline?.listing_date,
      );
      if (rawDate && nameMatches.length > 0) {
        const MAX_DIFF_MS = 180 * 24 * 60 * 60 * 1000;
        nameMatches = nameMatches.filter((cand) => {
          const candEvents = (cand as any).lifecycleEvents as Array<{ eventType: string; eventDate: Date }> | undefined;
          if (!candEvents || candEvents.length === 0) return true;
          const candDates = candEvents
            .filter((e) => (e.eventType === 'OPEN' || e.eventType === 'LISTING') && e.eventDate)
            .map((e) => new Date(e.eventDate).getTime());
          if (candDates.length === 0) return true;
          return candDates.some((cd) => Math.abs(cd - rawDate.getTime()) <= MAX_DIFF_MS);
        });
      }

      if (nameMatches.length === 1) {
        return { matchedIpo: nameMatches[0], matchedBy: 'NAME' };
      } else if (nameMatches.length > 1) {
        return {
          matchedIpo: null,
          matchedBy: 'AMBIGUOUS',
          ambiguousCandidates: nameMatches.map((m) => `${m.company?.displayName || m.company?.legalName || m.id} (ID: ${m.id})`),
          ambiguousCandidateObjects: nameMatches,
        };
      }
    }

    return { matchedIpo: null, matchedBy: 'NONE' };
  }

  /**
   * Deterministically disambiguates multiple candidate matches:
   * 1. Candidate already linked to IPOGURU source with matching externalId/slug
   * 2. Candidate with publicationStatus === PUBLISHED (over DRAFT)
   * 3. Candidate with active operational status (not DRAFT)
   * 4. Most recently updated candidate
   */
  public resolveCandidates(
    candidates: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>>,
    rawExternalId?: string | null,
  ): Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }> | null {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Priority 1: Check if candidate already has an IPOGURU source identity matching rawExternalId
    if (rawExternalId) {
      const ipoGuruMatch = candidates.find((c) =>
        c.sourceIdentities.some(
          (sid: any) =>
            (sid.source?.code === 'IPOGURU' || sid.sourceId === 'IPOGURU') &&
            sid.externalId &&
            sid.externalId.toLowerCase() === rawExternalId.toLowerCase(),
        ),
      );
      if (ipoGuruMatch) return ipoGuruMatch;
    }

    // Priority 2: Publication Status - prefer PUBLISHED over DRAFT
    const published = candidates.filter((c) => c.publicationStatus === PublicationStatus.PUBLISHED);
    const drafts = candidates.filter((c) => c.publicationStatus === PublicationStatus.DRAFT);
    if (published.length === 1 && drafts.length > 0) {
      return published[0];
    }
    const pool1 = published.length > 0 ? published : candidates;

    // Priority 3: Operational Status - prefer active operational status over DRAFT
    const active = pool1.filter((c) => c.status && c.status !== IpoStatus.DRAFT);
    const draftStatus = pool1.filter((c) => c.status === IpoStatus.DRAFT);
    if (active.length === 1 && draftStatus.length > 0) {
      return active[0];
    }
    const pool2 = active.length > 0 ? active : pool1;

    // Priority 4: If candidates have differing updatedAt timestamps, prefer the more recently updated record
    const withDates = pool2.filter((c) => c.updatedAt != null);
    if (withDates.length >= 2) {
      const sorted = [...withDates].sort((a, b) => {
        const aTime = new Date(a.updatedAt).getTime();
        const bTime = new Date(b.updatedAt).getTime();
        return bTime - aTime;
      });
      const topTime = new Date(sorted[0].updatedAt).getTime();
      const secondTime = new Date(sorted[1].updatedAt).getTime();
      if (topTime > secondTime) {
        return sorted[0];
      }
    }

    return null;
  }

  /**
   * Normalizes company name for deterministic comparison.
   */
  public normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(limited|ltd|pvt|private|sme|ipo|ncds?|ncd|invit|reit|trust|addendum|drhp|rhp|udrhp)\b/gi, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async ensureIpoGuruSource(): Promise<string> {
    const source = await this.prisma.source.upsert({
      where: { code: 'IPOGURU' },
      update: {
        baseUrl: this.BASE_URL,
        name: 'IPO Guru v2',
      },
      create: {
        code: 'IPOGURU',
        name: 'IPO Guru v2',
        sourceType: 'SECONDARY',
        baseUrl: this.BASE_URL,
        priority: 50,
      },
    });
    return source.id;
  }

  private async ensureAdminSource(): Promise<string> {
    const source = await this.prisma.source.upsert({
      where: { code: 'ADMIN' },
      update: {},
      create: {
        code: 'ADMIN',
        name: 'Admin Manual Review',
        sourceType: 'OFFICIAL_FILING',
        priority: 1,
      },
    });
    return source.id;
  }

  private parseDate(dateStr?: string | null): Date | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const clean = dateStr.trim();
    if (!clean || clean === 'null' || clean === '—' || clean === '-') return null;
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  }

  private parseTimestamp(tsStr?: string | null): Date {
    if (!tsStr || typeof tsStr !== 'string') return new Date();
    const clean = tsStr.trim();
    try {
      const normalized = clean.replace(/IST$/i, '+05:30').replace(/,\s*/, ' ');
      const d = new Date(normalized);
      if (!isNaN(d.getTime())) return d;
    } catch {
      // ignore
    }
    const direct = new Date(clean);
    return isNaN(direct.getTime()) ? new Date() : direct;
  }

  private parseDecimal(val?: unknown): Prisma.Decimal | null {
    if (val == null || val === '') return null;
    if (typeof val === 'number') return isNaN(val) ? null : new Prisma.Decimal(val);
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : new Prisma.Decimal(num);
  }

  private parseInt(val?: unknown): number | null {
    if (val == null || val === '') return null;
    const cleaned = String(val).replace(/[^0-9-]/g, '');
    if (!cleaned) return null;
    const n = parseInt(cleaned, 10);
    return isNaN(n) ? null : n;
  }

  private parseIssueSize(val?: unknown): Prisma.Decimal | null {
    if (val == null || val === '') return null;
    const cleaned = String(val).replace(/₹|,|\s|Cr/gi, '').trim();
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : new Prisma.Decimal(num);
  }

  public parsePriceBand(
    priceBandStr?: string | null,
    lo?: unknown,
    hi?: unknown,
    priceMin?: unknown,
    priceMax?: unknown,
  ): { low: Prisma.Decimal | null; high: Prisma.Decimal | null; wasInverted: boolean } {
    let low: Prisma.Decimal | null = null;
    let high: Prisma.Decimal | null = null;

    if (priceBandStr && typeof priceBandStr === 'string' && priceBandStr.trim()) {
      const clean = priceBandStr.replace(/₹|,/g, '').trim();
      if (clean.includes('-')) {
        const [lowPart, highPart] = clean.split('-');
        low = this.parseDecimal(lowPart);
        high = this.parseDecimal(highPart);
      } else {
        const single = this.parseDecimal(clean);
        low = single;
        high = single;
      }
    } else {
      low = this.parseDecimal(lo) ?? this.parseDecimal(priceMin);
      high = this.parseDecimal(hi) ?? this.parseDecimal(priceMax);
    }

    let wasInverted = false;
    // Defensive normalization: if low > high, swap them to prevent database check constraint violations
    if (low != null && high != null && low.greaterThan(high)) {
      wasInverted = true;
      const temp = low;
      low = high;
      high = temp;
    }

    return { low, high, wasInverted };
  }

  private parseMarketSegment(typeStr?: string | null): MarketSegment {
    if (!typeStr) return MarketSegment.MAINBOARD;
    const lower = typeStr.toLowerCase();
    if (lower.includes('sme')) return MarketSegment.SME;
    return MarketSegment.MAINBOARD;
  }

  private parseExchange(listingOn?: string | null, exchange?: string | null): ExchangeListing {
    const combined = `${listingOn || ''} ${exchange || ''}`.toUpperCase();
    if (combined.includes('BSE') && combined.includes('NSE')) return ExchangeListing.BOTH;
    if (combined.includes('BSE')) return ExchangeListing.BSE;
    if (combined.includes('NSE')) return ExchangeListing.NSE;
    return ExchangeListing.BOTH;
  }

  private parseStatus(statusStr?: string | null, isListed?: boolean): IpoStatus | null {
    if (isListed === true) return IpoStatus.LISTED;
    if (!statusStr) return null;
    const upper = statusStr.trim().toUpperCase();
    if (upper === 'UPCOMING' || upper === 'ANNOUNCED') return IpoStatus.UPCOMING;
    if (upper === 'OPEN') return IpoStatus.OPEN;
    if (upper === 'CLOSED') return IpoStatus.CLOSED;
    if (upper === 'LISTED') return IpoStatus.LISTED;
    return null;
  }

  /**
   * Extract IPO array from various API envelope shapes.
   */
  private extractIpos(body: IpoGuruV1Response): IpoGuruV1Ipo[] {
    if (Array.isArray(body)) {
      return body as IpoGuruV1Ipo[];
    }
    if (Array.isArray(body.data)) {
      return body.data;
    }
    if (Array.isArray(body.ipos)) {
      return body.ipos;
    }
    for (const key of Object.keys(body)) {
      if (Array.isArray((body as Record<string, unknown>)[key])) {
        return (body as Record<string, unknown>)[key] as IpoGuruV1Ipo[];
      }
    }
    return [];
  }

  /**
   * Records field-level provenance for fields populated by IPOGuru sync.
   */
  private async recordIpoGuruFieldProvenances(
    tx: Prisma.TransactionClient,
    ipoId: string,
    companyId: string,
    sourceId: string,
    sourceReference: string,
    fields: {
      legalName?: string | null;
      displayName?: string | null;
      marketSegment?: string | null;
      exchange?: string | null;
      status?: string | null;
      symbol?: string | null;
      isin?: string | null;
      priceBandLow?: number | Prisma.Decimal | null;
      priceBandHigh?: number | Prisma.Decimal | null;
      lotSize?: number | null;
      faceValue?: number | Prisma.Decimal | null;
      issueSize?: number | Prisma.Decimal | null;
      freshIssueSize?: number | Prisma.Decimal | null;
      ofsSize?: number | Prisma.Decimal | null;
      listingPrice?: number | Prisma.Decimal | null;
      openDate?: Date | null;
      closeDate?: Date | null;
      allotmentDate?: Date | null;
      refundDate?: Date | null;
      listingDate?: Date | null;
      registrarName?: string | null;
    },
  ) {
    const now = new Date();
    const records: Array<{
      entityType: 'IPO' | 'COMPANY';
      entityId: string;
      fieldName: string;
      value: string;
    }> = [];

    if (fields.legalName) {
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.legal_name', value: fields.legalName });
    }
    if (fields.displayName) {
      records.push({ entityType: 'COMPANY', entityId: companyId, fieldName: 'company.display_name', value: fields.displayName });
    }
    if (fields.marketSegment) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'market_segment', value: fields.marketSegment });
    }
    if (fields.exchange) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'exchange', value: fields.exchange });
    }
    if (fields.status) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'status', value: fields.status });
    }
    if (fields.symbol) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'symbol', value: fields.symbol });
    }
    if (fields.isin) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'isin', value: fields.isin });
    }
    if (fields.priceBandLow != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'price_band_low', value: String(fields.priceBandLow) });
    }
    if (fields.priceBandHigh != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'price_band_high', value: String(fields.priceBandHigh) });
    }
    if (fields.lotSize != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'lot_size', value: String(fields.lotSize) });
    }
    if (fields.faceValue != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'face_value', value: String(fields.faceValue) });
    }
    if (fields.issueSize != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'issue_size', value: String(fields.issueSize) });
    }
    if (fields.freshIssueSize != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'fresh_issue_size', value: String(fields.freshIssueSize) });
    }
    if (fields.ofsSize != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'ofs_size', value: String(fields.ofsSize) });
    }
    if (fields.listingPrice != null) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'listing_price', value: String(fields.listingPrice) });
    }
    if (fields.openDate) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'open_date', value: fields.openDate.toISOString().slice(0, 10) });
    }
    if (fields.closeDate) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'close_date', value: fields.closeDate.toISOString().slice(0, 10) });
    }
    if (fields.allotmentDate) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'allotment_date', value: fields.allotmentDate.toISOString().slice(0, 10) });
    }
    if (fields.refundDate) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'refund_date', value: fields.refundDate.toISOString().slice(0, 10) });
    }
    if (fields.listingDate) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'listing_date', value: fields.listingDate.toISOString().slice(0, 10) });
    }
    if (fields.registrarName) {
      records.push({ entityType: 'IPO', entityId: ipoId, fieldName: 'registrar_name', value: fields.registrarName });
    }

    if (records.length === 0) return;

    if (typeof (tx.fieldProvenance as any).createMany === 'function') {
      await (tx.fieldProvenance as any).createMany({
        data: records.map((r) => ({
          entityType: r.entityType,
          entityId: r.entityId,
          fieldName: r.fieldName,
          value: r.value,
          sourceId,
          sourceReference,
          retrievedAt: now,
          confidence: new Prisma.Decimal(1.0),
        })),
        skipDuplicates: true,
      });
    } else {
      for (const r of records) {
        await tx.fieldProvenance.create({
          data: {
            entityType: r.entityType,
            entityId: r.entityId,
            fieldName: r.fieldName,
            value: r.value,
            sourceId,
            sourceReference,
            retrievedAt: now,
            confidence: new Prisma.Decimal(1.0),
          },
        });
      }
    }
  }

  /**
   * Safe, field-level additive IPOGuru provenance backfill preview (dry run).
   */
  async previewProvenanceBackfill(ipoId?: string) {
    if (ipoId) {
      return backfillSingleIpoProvenance(this.prisma, ipoId, { dryRun: true });
    }
    return backfillAllIposProvenance(this.prisma, { dryRun: true, includeDetails: true });
  }

  /**
   * Safe, field-level additive IPOGuru provenance backfill apply (writes to DB with audit log).
   */
  async applyProvenanceBackfill(ipoId?: string, adminUser: string = 'admin') {
    const startTime = Date.now();
    this.logger.log(
      `[AUDIT] Backfill IPOGuru Provenance STARTED: adminUser='${adminUser}', scope='${ipoId ? 'SINGLE' : 'ALL'}', ipoId='${ipoId || 'ALL'}'`,
    );

    let result;
    if (ipoId) {
      result = await backfillSingleIpoProvenance(this.prisma, ipoId, { dryRun: false });
    } else {
      result = await backfillAllIposProvenance(this.prisma, { dryRun: false, includeDetails: true });
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `[AUDIT] Backfill IPOGuru Provenance COMPLETED in ${durationMs}ms: adminUser='${adminUser}', scope='${ipoId ? 'SINGLE' : 'ALL'}', added=${result.added}, preserved=${result.preserved}, skipped=${result.skipped}`,
    );

    return result;
  }

  /**
   * Safe preview (dry-run) of canonical Refund Initiation Date backfill.
   */
  async previewRefundBackfill(ipoId?: string, options: BackfillRefundOptions = {}) {
    const apiKey = this.configService.get('IPOGURU_API_KEY' as keyof Env, { infer: true }) as string | undefined;
    const opts = { ...options, dryRun: true, apiKey: options.apiKey || apiKey };
    if (ipoId) {
      return backfillSingleIpoRefundInitiation(this.prisma, ipoId, opts);
    }
    return backfillAllRefundInitiations(this.prisma, opts);
  }

  /**
   * Safe apply of canonical Refund Initiation Date backfill (writes to DB with audit log).
   */
  async applyRefundBackfill(ipoId?: string, adminUser: string = 'admin', options: BackfillRefundOptions = {}) {
    const apiKey = this.configService.get('IPOGURU_API_KEY' as keyof Env, { infer: true }) as string | undefined;
    const startTime = Date.now();
    this.logger.log(
      `[AUDIT] Backfill Refund Initiation Date STARTED: adminUser='${adminUser}', scope='${ipoId ? 'SINGLE' : 'ALL'}', ipoId='${ipoId || 'ALL'}'`,
    );

    const opts = { ...options, dryRun: false, apiKey: options.apiKey || apiKey };
    let result;
    if (ipoId) {
      result = await backfillSingleIpoRefundInitiation(this.prisma, ipoId, opts);
    } else {
      result = await backfillAllRefundInitiations(this.prisma, opts);
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `[AUDIT] Backfill Refund Initiation Date COMPLETED in ${durationMs}ms: adminUser='${adminUser}', scope='${ipoId ? 'SINGLE' : 'ALL'}'`,
    );

    return result;
  }
}
