import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import { BrokerInvestmentService } from './broker-investment.service';

/**
 * Returns true if given date is a weekday (Monday - Friday) in Indian Standard Time (IST).
 */
export function isTradingDay(date: Date = new Date()): boolean {
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const day = istTime.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day >= 1 && day <= 5;
}

/**
 * Returns true if the given date is within the ~3:41 PM IST post-market closing sync window (15:41 - 16:11 IST).
 */
export function isPostListingSyncWindow(date: Date = new Date()): boolean {
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  return (hours === 15 && minutes >= 41) || (hours === 16 && minutes <= 11);
}

export function getIstDateString(date: Date = new Date()): string {
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return istTime.toISOString().slice(0, 10);
}

export interface BrokerSyncSchedulerHealth {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  lastRunDate: string | null;
  lastRunResult: {
    timestamp: Date;
    processedCount: number;
    successCount: number;
    failureCount: number;
  } | null;
}

@Injectable()
export class BrokerSyncSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BrokerSyncSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastRunDate: string | null = null;
  private lastRunResult: {
    timestamp: Date;
    processedCount: number;
    successCount: number;
    failureCount: number;
  } | null = null;

  constructor(
    private readonly investmentService: BrokerInvestmentService,
    @Optional() private readonly configService?: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.configService?.get('BROKER_SYNC_SCHEDULER_ENABLED', {
        infer: true,
      }) ?? false;

    if (!enabled) {
      this.logger.log('Broker sync scheduler is disabled by configuration');
      return;
    }

    const intervalMs =
      this.configService?.get('BROKER_SYNC_SCHEDULER_INTERVAL_MS', {
        infer: true,
      }) ?? 60_000;

    this.logger.log(
      `Starting Broker sync scheduler (interval: ${intervalMs}ms, window: ~15:41 IST on trading days)`,
    );

    this.timer = setInterval(() => {
      this.handleScheduledTick().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Unhandled error during broker sync tick: ${msg}`);
      });
    }, intervalMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Periodic tick handler: verifies trading day, 3:41 PM IST window, and single-execution-per-day guard.
   */
  async handleScheduledTick(now: Date = new Date()): Promise<boolean> {
    if (this.isRunning) {
      this.logger.debug('Broker sync tick skipped: previous cycle still running');
      return false;
    }

    if (!isTradingDay(now)) {
      return false;
    }

    if (!isPostListingSyncWindow(now)) {
      return false;
    }

    const todayStr = getIstDateString(now);
    if (this.lastRunDate === todayStr) {
      return false;
    }

    return this.executeSyncCycle(now);
  }

  /**
   * Executes the post-listing sync across all connected Upstox accounts.
   */
  async executeSyncCycle(now: Date = new Date()): Promise<boolean> {
    this.isRunning = true;
    const todayStr = getIstDateString(now);

    try {
      this.logger.log('Initiating automatic 3:41 PM IST post-listing investment sync for connected accounts');
      const result = await this.investmentService.syncAllConnectedUpstoxAccounts();

      this.lastRunDate = todayStr;
      this.lastRunResult = {
        timestamp: new Date(),
        processedCount: result.processedCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
      };

      this.logger.log(
        `Automatic post-listing sync completed: ${result.successCount}/${result.processedCount} succeeded, ${result.failureCount} failed`,
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error in post-listing sync cycle: ${msg}`);
      return false;
    } finally {
      this.isRunning = false;
    }
  }

  getHealthStatus(): BrokerSyncSchedulerHealth {
    const enabled =
      this.configService?.get('BROKER_SYNC_SCHEDULER_ENABLED', {
        infer: true,
      }) ?? false;
    const intervalMs =
      this.configService?.get('BROKER_SYNC_SCHEDULER_INTERVAL_MS', {
        infer: true,
      }) ?? 60_000;

    return {
      enabled,
      running: this.isRunning,
      intervalMs,
      lastRunDate: this.lastRunDate,
      lastRunResult: this.lastRunResult,
    };
  }
}
