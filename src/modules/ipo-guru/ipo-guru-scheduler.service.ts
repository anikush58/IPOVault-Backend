import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import { IpoGuruService } from './ipo-guru.service';
import {
  IPOGURU_SCHEDULED_SLOTS,
  getIstNow,
  parseSlotToMinutes,
} from './ipo-guru.types';

export interface IpoGuruSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * Background Scheduler for Automatic IPO Guru v2 Synchronization.
 *
 * Runs scheduled automatic syncs at exactly:
 * - 10:00 AM IST (10:00)
 * - 1:00 PM IST (13:00)
 * - 3:00 PM IST (15:00)
 * - 5:30 PM IST (17:30)
 *
 * Enforces failure isolation, restart idempotency, and strict IST timekeeping.
 */
@Injectable()
export class IpoGuruSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpoGuruSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly ipoGuruService: IpoGuruService,
  ) {}

  public getConfig(): IpoGuruSchedulerConfig {
    const enabled =
      this.configService.get('IPOGURU_SCHEDULER_ENABLED' as keyof Env, {
        infer: true,
      }) !== false;
    const intervalMs = Number(
      this.configService.get('IPOGURU_SCHEDULER_INTERVAL_MS' as keyof Env, {
        infer: true,
      }) || 15000,
    );
    return { enabled, intervalMs };
  }

  onModuleInit(): void {
    if (this.timer !== null) {
      this.logger.warn(
        'IPO Guru scheduler initialization skipped: interval already registered',
      );
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      this.logger.log(
        'IPO Guru scheduler is disabled by configuration (IPOGURU_SCHEDULER_ENABLED=false)',
      );
      return;
    }

    this.logger.log(
      `Starting IPO Guru automatic sync scheduler (interval: ${config.intervalMs}ms, scheduled slots: ${IPOGURU_SCHEDULED_SLOTS.join(', ')} IST)...`,
    );

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(
          `Unhandled error during IPO Guru scheduler tick: ${(err as Error)?.message || err}`,
          (err as Error)?.stack,
        );
      });
    }, config.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('IPO Guru scheduler stopped (timer handle cleared)');
    }
  }

  /**
   * Safe entrypoint for checking scheduled slots and executing automatic sync if due.
   */
  async tick(now = new Date()): Promise<{ triggered: boolean; slot?: string; reason?: string }> {
    if (this.isProcessing) {
      this.logger.debug('IPO Guru scheduler tick skipped: prior cycle still in-progress');
      return { triggered: false, reason: 'OVERLAP_SKIP' };
    }

    this.isProcessing = true;

    try {
      const { istDate, timeMinutes, timeStr } = getIstNow(now);
      const state = await this.ipoGuruService.getPersistedUsageState(now);

      // Check daily quota limit
      if (state.totalRequestsToday >= 10) {
        this.logger.debug('IPO Guru scheduler tick skipped: daily total quota (10/10) reached');
        return { triggered: false, reason: 'DAILY_TOTAL_LIMIT_REACHED' };
      }

      if (state.autoRequestsToday >= 4) {
        this.logger.debug('IPO Guru scheduler tick skipped: daily auto quota (4/4) reached');
        return { triggered: false, reason: 'DAILY_AUTO_LIMIT_REACHED' };
      }

      // Check 1-minute rate-limit window
      if (state.lastRequestAt) {
        const elapsedMs = now.getTime() - new Date(state.lastRequestAt).getTime();
        if (elapsedMs < 60000) {
          this.logger.debug('IPO Guru scheduler tick skipped: 1-minute rate-limit active');
          return { triggered: false, reason: 'RATE_LIMIT_WAIT' };
        }
      }

      // Find due scheduled slot
      const dueSlot = this.findDueSlot(timeMinutes, state.completedSlots);
      if (!dueSlot) {
        return { triggered: false, reason: 'NO_DUE_SLOT' };
      }

      this.logger.log(
        `IPO Guru scheduled automatic sync triggered for slot '${dueSlot}' IST (current IST: ${timeStr}, date: ${istDate})`,
      );

      const result = await this.ipoGuruService.syncIpos('AUTO', dueSlot);
      this.logger.log(
        `IPO Guru automatic sync for '${dueSlot}' completed: ${result.matchedUpdated} updated, ${result.newlyCreated} created, ${result.skipped} skipped`,
      );

      return { triggered: true, slot: dueSlot };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`IPO Guru scheduler execution error (contained): ${msg}`);
      return { triggered: false, reason: `ERROR: ${msg}` };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Determines if current IST time falls within the 15-minute trigger window for an uncompleted scheduled slot.
   */
  public findDueSlot(currentMinutes: number, completedSlots: string[]): string | null {
    for (const slot of IPOGURU_SCHEDULED_SLOTS) {
      if (completedSlots.includes(slot)) {
        continue;
      }
      const slotMins = parseSlotToMinutes(slot);
      const diff = currentMinutes - slotMins;
      // Trigger window: between slot time (0 mins) and +15 minutes
      if (diff >= 0 && diff < 15) {
        return slot;
      }
    }
    return null;
  }
}
