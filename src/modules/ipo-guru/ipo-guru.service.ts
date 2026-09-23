import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExchangeListing,
  IpoStatus,
  MarketSegment,
  OfferCategoryType,
  ParticipantRole,
  Prisma,
  PublicationStatus,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { Env } from '../../config/env';
import {
  IpoGuruFetchResult,
  IpoGuruStatusResponse,
  IpoGuruSyncItemDetail,
  IpoGuruSyncResult,
  IpoGuruUsageState,
  IpoGuruV1Ipo,
  IpoGuruV1Response,
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

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

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
    } else if (httpStatus && httpStatus > 0) {
      state.lastFetchStatus = `HTTP ${httpStatus}`;
    } else if (errorMsg) {
      state.lastFetchStatus = `ERROR: ${errorMsg.substring(0, 50)}`;
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

    const url = `${this.BASE_URL}/ipos`;
    this.logger.log(`IPO Guru v2 ${mode} fetch: GET ${url}`);

    let httpStatus = 0;
    let rawBody: IpoGuruV1Response = {};
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
      });

      httpStatus = response.status;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        fetchError = `HTTP ${httpStatus} — ${errText.substring(0, 200)}`;
        this.logger.error(`IPO Guru API error: ${fetchError}`);
      } else {
        rawBody = (await response.json()) as IpoGuruV1Response;
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

    return {
      httpStatus,
      ipos,
      total: Number(total) || ipos.length,
      fetchedAt: new Date().toISOString(),
      responseKeys,
    };
  }

  /**
   * Synchronizes IPO Guru v2 records into the canonical IPOVault database.
   * Transactional per IPO record.
   */
  async syncIpos(
    mode: 'AUTO' | 'MANUAL' = 'MANUAL',
    slot?: string,
  ): Promise<IpoGuruSyncResult> {
    const fetchResult = await this.fetchIpos(mode, slot);
    const rawIpos = fetchResult.ipos;
    const syncedAt = new Date().toISOString();

    const summary: IpoGuruSyncResult = {
      totalFetched: rawIpos.length,
      matchedUpdated: 0,
      newlyCreated: 0,
      skipped: 0,
      errorCount: 0,
      syncedAt,
      items: [],
    };

    if (rawIpos.length === 0) {
      return summary;
    }

    // Ensure IPOGURU source exists
    const sourceId = await this.ensureIpoGuruSource();

    // Load existing canonical IPOs with companies and source identities for matching
    const existingIpos = await this.prisma.ipo.findMany({
      include: {
        company: true,
        sourceIdentities: true,
      },
    });

    for (const rawItem of rawIpos) {
      const guruName = (rawItem.name || rawItem.company_name || '').trim();
      if (!guruName) {
        summary.skipped++;
        summary.items.push({
          guruName: 'Unknown',
          action: 'SKIPPED',
          reason: 'Record has empty company name',
        });
        continue;
      }

      try {
        const itemResult = await this.syncSingleIpo(rawItem, sourceId, existingIpos);
        summary.items.push(itemResult);
        if (itemResult.action === 'UPDATED') summary.matchedUpdated++;
        else if (itemResult.action === 'CREATED') summary.newlyCreated++;
        else if (itemResult.action === 'SKIPPED') summary.skipped++;
        else if (itemResult.action === 'ERROR') summary.errorCount++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error syncing IPO '${guruName}': ${errMsg}`);
        summary.errorCount++;
        summary.items.push({
          guruName,
          action: 'ERROR',
          error: errMsg,
        });
      }
    }

    this.logger.log(
      `IPO Guru sync finished: ${summary.matchedUpdated} updated, ${summary.newlyCreated} created, ${summary.skipped} skipped, ${summary.errorCount} errors`,
    );

    return summary;
  }

  /**
   * Syncs a single IPO Guru item in an isolated database transaction.
   */
  private async syncSingleIpo(
    rawItem: IpoGuruV1Ipo,
    sourceId: string,
    existingIpos: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>>,
  ): Promise<IpoGuruSyncItemDetail> {
    const guruName = (rawItem.name || rawItem.company_name || '').trim();
    const match = this.matchIpo(rawItem, existingIpos);

    // If ambiguous (multiple candidates matched), NEVER select an arbitrary candidate.
    // Safely skip the record without modifying the database.
    if (match.matchedBy === 'AMBIGUOUS') {
      const candidatesStr = match.ambiguousCandidates && match.ambiguousCandidates.length > 0
        ? match.ambiguousCandidates.join(', ')
        : 'multiple candidates';
      return {
        guruName,
        action: 'SKIPPED',
        matchedBy: 'AMBIGUOUS',
        reason: `AMBIGUOUS_MATCH: Multiple existing records matched: [${candidatesStr}]`,
      };
    }

    return await this.prisma.$transaction(async (tx) => {
      const updatedFields: string[] = [];

      // Parsed fields
      const marketSegment = this.parseMarketSegment(rawItem.type || rawItem.sub_type || rawItem.ipo_type);
      const status = this.parseStatus(rawItem.status);
      const exchange = this.parseExchange(rawItem.listing_on, rawItem.exchange);
      const priceBand = this.parsePriceBand(rawItem.price_band, rawItem.price_band_min, rawItem.price_band_max);
      const lotSize = this.parseInt(rawItem.lot_size);
      const faceValue = this.parseDecimal(rawItem.face_value);
      const issueSize = this.parseIssueSize(rawItem.issue_size);
      const freshIssueSize = this.parseIssueSize(rawItem.fresh_issue_size || rawItem.fresh_size);
      const ofsSize = this.parseIssueSize(rawItem.ofs_size || rawItem.ofs_issue_size);
      const listingPrice = this.parseDecimal(rawItem.listing_price);

      let ipoId: string;
      let action: 'UPDATED' | 'CREATED';

      if (match.matchedIpo) {
        // --- 1. UPDATE EXISTING IPO ---
        action = 'UPDATED';
        const existingIpo = match.matchedIpo;
        ipoId = existingIpo.id;

        const updateData: Prisma.IpoUpdateInput = {};
        if (marketSegment && marketSegment !== existingIpo.marketSegment) {
          updateData.marketSegment = marketSegment;
          updatedFields.push('marketSegment');
        }
        if (status && status !== existingIpo.status) {
          updateData.status = status;
          updatedFields.push('status');
        }
        if (exchange && exchange !== existingIpo.exchange) {
          updateData.exchange = exchange;
          updatedFields.push('exchange');
        }
        if (priceBand.low != null && (!existingIpo.priceBandLow || !existingIpo.priceBandLow.equals(priceBand.low))) {
          updateData.priceBandLow = priceBand.low;
          updatedFields.push('priceBandLow');
        }
        if (priceBand.high != null && (!existingIpo.priceBandHigh || !existingIpo.priceBandHigh.equals(priceBand.high))) {
          updateData.priceBandHigh = priceBand.high;
          updatedFields.push('priceBandHigh');
        }
        if (lotSize != null && lotSize !== existingIpo.lotSize) {
          updateData.lotSize = lotSize;
          updatedFields.push('lotSize');
        }
        if (faceValue != null && (!existingIpo.faceValue || !existingIpo.faceValue.equals(faceValue))) {
          updateData.faceValue = faceValue;
          updatedFields.push('faceValue');
        }
        if (issueSize != null && (!existingIpo.issueSize || !existingIpo.issueSize.equals(issueSize))) {
          updateData.issueSize = issueSize;
          updatedFields.push('issueSize');
        }
        if (freshIssueSize != null && (!existingIpo.freshIssueSize || !existingIpo.freshIssueSize.equals(freshIssueSize))) {
          updateData.freshIssueSize = freshIssueSize;
          updatedFields.push('freshIssueSize');
        }
        if (ofsSize != null && (!existingIpo.ofsSize || !existingIpo.ofsSize.equals(ofsSize))) {
          updateData.ofsSize = ofsSize;
          updatedFields.push('ofsSize');
        }
        if (listingPrice != null && (!existingIpo.listingPrice || !existingIpo.listingPrice.equals(listingPrice))) {
          updateData.listingPrice = listingPrice;
          updatedFields.push('listingPrice');
        }

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
          },
        });

        const newIpo = await tx.ipo.create({
          data: {
            companyId: company.id,
            marketSegment: marketSegment || MarketSegment.MAINBOARD,
            exchange: exchange || ExchangeListing.BOTH,
            status: status || IpoStatus.UPCOMING,
            publicationStatus: PublicationStatus.DRAFT,
            symbol: rawItem.symbol ? rawItem.symbol.trim().toUpperCase() : null,
            isin: rawItem.isin ? rawItem.isin.trim().toUpperCase() : null,
            priceBandLow: priceBand.low,
            priceBandHigh: priceBand.high,
            lotSize: lotSize,
            faceValue: faceValue,
            issueSize: issueSize,
            freshIssueSize: freshIssueSize,
            ofsSize: ofsSize,
            listingPrice: listingPrice,
          },
        });
        ipoId = newIpo.id;
        updatedFields.push('company', 'ipo');
      }

      // Link SourceIdentity for IPOGURU (v2 uses slug as identifier)
      const externalId = (rawItem.slug || (rawItem.id ? String(rawItem.id) : guruName)).trim();
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

      // --- 3. LIFECYCLE EVENTS ---
      const openDate = this.parseDate(rawItem.open_date);
      if (openDate) {
        await tx.ipoLifecycleEvent.upsert({
          where: { ipoId_eventType: { ipoId, eventType: 'OPEN' } },
          update: { eventDate: openDate, sourceId },
          create: { ipoId, eventType: 'OPEN', eventDate: openDate, sourceId },
        });
        updatedFields.push('openDate');
      }

      const closeDate = this.parseDate(rawItem.close_date);
      if (closeDate) {
        await tx.ipoLifecycleEvent.upsert({
          where: { ipoId_eventType: { ipoId, eventType: 'CLOSE' } },
          update: { eventDate: closeDate, sourceId },
          create: { ipoId, eventType: 'CLOSE', eventDate: closeDate, sourceId },
        });
        updatedFields.push('closeDate');
      }

      const allotmentDate = this.parseDate(rawItem.allotment_date);
      if (allotmentDate) {
        await tx.ipoLifecycleEvent.upsert({
          where: { ipoId_eventType: { ipoId, eventType: 'BASIS_OF_ALLOTMENT' } },
          update: { eventDate: allotmentDate, sourceId },
          create: { ipoId, eventType: 'BASIS_OF_ALLOTMENT', eventDate: allotmentDate, sourceId },
        });
        updatedFields.push('allotmentDate');
      }

      const listingDate = this.parseDate(rawItem.listing_date);
      if (listingDate) {
        await tx.ipoLifecycleEvent.upsert({
          where: { ipoId_eventType: { ipoId, eventType: 'LISTING' } },
          update: { eventDate: listingDate, sourceId },
          create: { ipoId, eventType: 'LISTING', eventDate: listingDate, sourceId },
        });
        updatedFields.push('listingDate');
      }

      // --- 4. ALLOTMENT CONFIG & REGISTRAR PARTICIPANT ---
      const registrar = (rawItem.registrar || '').trim();
      if (registrar) {
        await tx.ipoAllotmentConfig.upsert({
          where: { ipoId },
          update: {
            registrar,
            expectedAllotmentDate: allotmentDate || undefined,
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
          await tx.ipoParticipant.update({
            where: { id: existingParticipant.id },
            data: { name: registrar },
          });
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
        }
      }

      // --- 6. SUBSCRIPTION OBSERVATIONS ---
      const sub = rawItem.subscription || {};
      const subObservedAt = this.parseTimestamp(
        (sub.updated_at || sub.updated_at_label || rawItem.sub_updated_at || rawItem.sub_updated_at_label) as string | null,
      );

      const totalMultiple = rawItem.subscription_total != null
        ? rawItem.subscription_total
        : (sub.total != null ? sub.total : rawItem.total_sub);

      const subCategories: Array<{ cat: OfferCategoryType; val: unknown }> = [
        { cat: OfferCategoryType.QIB, val: sub.qib != null ? sub.qib : rawItem.qib_sub },
        { cat: OfferCategoryType.NII, val: sub.nii != null ? sub.nii : rawItem.nii_sub },
        { cat: OfferCategoryType.RETAIL, val: sub.retail != null ? sub.retail : rawItem.retail_sub },
        { cat: OfferCategoryType.OTHER, val: totalMultiple },
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
          }
        }
      }

      return {
        guruName,
        action,
        ipoId,
        companyName: match.matchedIpo ? match.matchedIpo.company.displayName : guruName,
        matchedBy: match.matchedBy,
        updatedFields,
      };
    });
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
    matchedBy: 'SYMBOL' | 'NAME' | 'AMBIGUOUS' | 'NONE';
    ambiguousCandidates?: string[];
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
        };
      }
    }

    // 2. Match by exact normalized legal/display name
    if (rawNormName) {
      const nameMatches: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>> = [];
      for (const ipo of existingIpos) {
        const legalNorm = this.normalizeCompanyName(ipo.company.legalName);
        const displayNorm = this.normalizeCompanyName(ipo.company.displayName);
        if (legalNorm === rawNormName || displayNorm === rawNormName) {
          nameMatches.push(ipo);
        }
      }

      if (nameMatches.length === 1) {
        return { matchedIpo: nameMatches[0], matchedBy: 'NAME' };
      } else if (nameMatches.length > 1) {
        return {
          matchedIpo: null,
          matchedBy: 'AMBIGUOUS',
          ambiguousCandidates: nameMatches.map((m) => `${m.company.displayName} (ID: ${m.id})`),
        };
      }

      // 3. Match by token containment if normalized name length >= 4
      if (rawNormName.length >= 4) {
        const tokenMatches: Array<Prisma.IpoGetPayload<{ include: { company: true; sourceIdentities: true } }>> = [];
        for (const ipo of existingIpos) {
          const legalNorm = this.normalizeCompanyName(ipo.company.legalName);
          const displayNorm = this.normalizeCompanyName(ipo.company.displayName);
          if (
            (legalNorm.length >= 4 && (legalNorm.includes(rawNormName) || rawNormName.includes(legalNorm))) ||
            (displayNorm.length >= 4 && (displayNorm.includes(rawNormName) || rawNormName.includes(displayNorm)))
          ) {
            tokenMatches.push(ipo);
          }
        }

        if (tokenMatches.length === 1) {
          return { matchedIpo: tokenMatches[0], matchedBy: 'NAME' };
        } else if (tokenMatches.length > 1) {
          return {
            matchedIpo: null,
            matchedBy: 'AMBIGUOUS',
            ambiguousCandidates: tokenMatches.map((m) => `${m.company.displayName} (ID: ${m.id})`),
          };
        }
      }
    }

    return { matchedIpo: null, matchedBy: 'NONE' };
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

  private parsePriceBand(
    priceBandStr?: string | null,
    lo?: unknown,
    hi?: unknown,
  ): { low: Prisma.Decimal | null; high: Prisma.Decimal | null } {
    if (priceBandStr && typeof priceBandStr === 'string' && priceBandStr.trim()) {
      const clean = priceBandStr.replace(/₹|,/g, '').trim();
      if (clean.includes('-')) {
        const [lowPart, highPart] = clean.split('-');
        return {
          low: this.parseDecimal(lowPart),
          high: this.parseDecimal(highPart),
        };
      }
      const single = this.parseDecimal(clean);
      return { low: single, high: single };
    }
    return {
      low: this.parseDecimal(lo),
      high: this.parseDecimal(hi),
    };
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

  private parseStatus(statusStr?: string | null): IpoStatus | null {
    if (!statusStr) return null;
    const upper = statusStr.trim().toUpperCase();
    if (upper === 'UPCOMING') return IpoStatus.UPCOMING;
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
}
