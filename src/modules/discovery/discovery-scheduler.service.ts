import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Env } from '../../config/env';
import { NseDiscoveryFlow } from './nse-discovery.flow';
import { SebiDiscoveryFlow } from './adapters/sebi/sebi-discovery.flow';

export interface DiscoverySchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
}

export type SchedulerSourceOutcome = 'SUCCESS' | 'FAILED' | 'SKIPPED';
export type SchedulerCycleStatus =
  'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'SKIPPED_OVERLAP' | 'DISABLED';

export type DiscoverySchedulerStatus =
  'HEALTHY' | 'DEGRADED' | 'STALE' | 'FAILED' | 'DISABLED' | 'STARTING';

export interface DiscoverySchedulerCycleResult {
  cycleId: string;
  status: SchedulerCycleStatus;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  sources: {
    nse: {
      status: SchedulerSourceOutcome;
      durationMs?: number;
      recordsProcessed?: number;
      error?: string;
    };
    sebi: {
      status: SchedulerSourceOutcome;
      durationMs?: number;
      totalDiscovered?: number;
      canonicalCreated?: number;
      error?: string;
    };
  };
}

export interface DiscoverySchedulerHealth {
  enabled: boolean;
  status: DiscoverySchedulerStatus;
  intervalMs: number;
  staleThresholdMs: number;
  running: boolean;
  lastCycle: {
    cycleId: string;
    status: SchedulerCycleStatus;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  } | null;
  sources: {
    nse: {
      status: SchedulerSourceOutcome;
      durationMs?: number;
      recordsProcessed?: number;
      error?: string;
    };
    sebi: {
      status: SchedulerSourceOutcome;
      durationMs?: number;
      totalDiscovered?: number;
      canonicalCreated?: number;
      error?: string;
    };
  };
  consecutiveFailureCount: number;
  overlapSkipCount: number;
}

@Injectable()
export class DiscoverySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DiscoverySchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastCycle: DiscoverySchedulerCycleResult | null = null;
  private consecutiveFailureCount = 0;
  private overlapSkipCount = 0;

  constructor(
    private readonly configService: ConfigService<Env, true>,
    private readonly nseFlow: NseDiscoveryFlow,
    private readonly sebiFlow: SebiDiscoveryFlow,
  ) {}

  getConfig(): DiscoverySchedulerConfig {
    const enabled =
      this.configService.get('DISCOVERY_SCHEDULER_ENABLED', {
        infer: true,
      }) ?? false;
    const rawInterval = this.configService.get(
      'DISCOVERY_SCHEDULER_INTERVAL_MS',
      { infer: true },
    );
    const rawDelay = this.configService.get(
      'DISCOVERY_SCHEDULER_INITIAL_DELAY_MS',
      { infer: true },
    );

    const intervalMs =
      typeof rawInterval === 'number' && rawInterval >= 1000
        ? rawInterval
        : 21_600_000;

    const initialDelayMs =
      typeof rawDelay === 'number' && rawDelay >= 0 ? rawDelay : 0;

    return {
      enabled: Boolean(enabled),
      intervalMs,
      initialDelayMs,
    };
  }

  isRunningCycle(): boolean {
    return this.isRunning;
  }

  getHealth(now: Date = new Date()): DiscoverySchedulerHealth {
    const config = this.getConfig();
    const staleThresholdMs = Math.round(config.intervalMs * 1.5);

    let status: DiscoverySchedulerStatus = 'HEALTHY';

    if (!config.enabled) {
      status = 'DISABLED';
    } else if (!this.lastCycle) {
      status = 'STARTING';
    } else {
      const ageMs = now.getTime() - this.lastCycle.completedAt.getTime();
      if (ageMs > staleThresholdMs) {
        status = 'STALE';
      } else if (
        this.consecutiveFailureCount >= 2 ||
        this.lastCycle.status === 'FAILED'
      ) {
        status = 'FAILED';
      } else if (
        this.lastCycle.status === 'PARTIAL_SUCCESS' ||
        this.consecutiveFailureCount === 1 ||
        this.overlapSkipCount > 0
      ) {
        status = 'DEGRADED';
      } else {
        status = 'HEALTHY';
      }
    }

    return {
      enabled: config.enabled,
      status,
      intervalMs: config.intervalMs,
      staleThresholdMs,
      running: this.isRunning,
      lastCycle: this.lastCycle
        ? {
            cycleId: this.lastCycle.cycleId,
            status: this.lastCycle.status,
            startedAt: this.lastCycle.startedAt.toISOString(),
            completedAt: this.lastCycle.completedAt.toISOString(),
            durationMs: this.lastCycle.durationMs,
          }
        : null,
      sources: this.lastCycle
        ? this.lastCycle.sources
        : {
            nse: { status: 'SKIPPED' },
            sebi: { status: 'SKIPPED' },
          },
      consecutiveFailureCount: this.consecutiveFailureCount,
      overlapSkipCount: this.overlapSkipCount,
    };
  }

  onModuleInit(): void {
    if (this.timer !== null || this.initialTimer !== null) {
      this.logger.warn(
        'Discovery scheduler initialization skipped: timers already registered',
      );
      return;
    }

    const config = this.getConfig();

    if (!config.enabled) {
      this.logger.log(
        'Discovery scheduler is disabled by configuration (DISCOVERY_SCHEDULER_ENABLED=false)',
      );
      return;
    }

    this.logger.log(
      `Starting discovery scheduler (interval: ${config.intervalMs}ms, initial delay: ${config.initialDelayMs}ms)...`,
    );

    if (config.initialDelayMs > 0) {
      this.initialTimer = setTimeout(() => {
        this.initialTimer = null;
        this.tick().catch((err: unknown) => {
          this.logger.error(
            `Unhandled error during initial discovery scheduler tick: ${(err as Error)?.message || err}`,
            (err as Error)?.stack,
          );
        });
      }, config.initialDelayMs);
    }

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(
          `Unhandled error during discovery scheduler tick: ${(err as Error)?.message || err}`,
          (err as Error)?.stack,
        );
      });
    }, config.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Discovery scheduler stopped (timer handles cleared)');
    }
  }

  async tick(): Promise<DiscoverySchedulerCycleResult> {
    const config = this.getConfig();
    if (!config.enabled) {
      this.logger.log(
        'Discovery scheduler tick skipped: scheduler is disabled',
      );
      return {
        cycleId: randomUUID(),
        status: 'DISABLED',
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        sources: {
          nse: { status: 'SKIPPED' },
          sebi: { status: 'SKIPPED' },
        },
      };
    }

    if (this.isRunning) {
      this.overlapSkipCount++;
      this.logger.warn(
        `Discovery scheduler tick skipped: previous cycle is still running (skip count=${this.overlapSkipCount})`,
      );
      return {
        cycleId: randomUUID(),
        status: 'SKIPPED_OVERLAP',
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
        sources: {
          nse: { status: 'SKIPPED' },
          sebi: { status: 'SKIPPED' },
        },
      };
    }

    this.isRunning = true;
    try {
      return await this.executeCycle();
    } finally {
      this.isRunning = false;
    }
  }

  private async executeCycle(): Promise<DiscoverySchedulerCycleResult> {
    const cycleId = randomUUID();
    const startedAt = new Date();
    this.logger.log(`[${cycleId}] Scheduled discovery cycle starting...`);

    let nseStatus: SchedulerSourceOutcome = 'SKIPPED';
    let nseDurationMs = 0;
    let nseRecordsProcessed = 0;
    let nseError: string | undefined = undefined;

    let sebiStatus: SchedulerSourceOutcome = 'SKIPPED';
    let sebiDurationMs = 0;
    let sebiTotalDiscovered = 0;
    let sebiCanonicalCreated = 0;
    let sebiError: string | undefined = undefined;

    // 1. Execute NSE Discovery
    const nseStart = Date.now();
    try {
      this.logger.log(`[${cycleId}] Source starting: NSE`);
      const nseResults = await this.nseFlow.ingestLive();
      nseDurationMs = Date.now() - nseStart;
      nseStatus = 'SUCCESS';
      nseRecordsProcessed = nseResults.length;
      this.logger.log(
        `[${cycleId}] Source completed: NSE (outcome=SUCCESS, processed=${nseRecordsProcessed}, duration=${nseDurationMs}ms)`,
      );
    } catch (err: unknown) {
      nseDurationMs = Date.now() - nseStart;
      nseStatus = 'FAILED';
      nseError = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[${cycleId}] Source failed: NSE (outcome=FAILED, duration=${nseDurationMs}ms, error=${nseError})`,
      );
    }

    // 2. Execute SEBI Discovery
    const sebiStart = Date.now();
    try {
      this.logger.log(`[${cycleId}] Source starting: SEBI`);
      const sebiResult = await this.sebiFlow.run(
        1,
        1,
        undefined,
        true,
        true,
        500,
      );
      sebiDurationMs = Date.now() - sebiStart;
      sebiStatus = 'SUCCESS';
      sebiTotalDiscovered = sebiResult.totalDiscovered;
      sebiCanonicalCreated = sebiResult.canonicalCreatedCount;
      this.logger.log(
        `[${cycleId}] Source completed: SEBI (outcome=SUCCESS, totalDiscovered=${sebiTotalDiscovered}, canonicalCreated=${sebiCanonicalCreated}, duration=${sebiDurationMs}ms)`,
      );
    } catch (err: unknown) {
      sebiDurationMs = Date.now() - sebiStart;
      sebiStatus = 'FAILED';
      sebiError = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[${cycleId}] Source failed: SEBI (outcome=FAILED, duration=${sebiDurationMs}ms, error=${sebiError})`,
      );
    }

    const completedAt = new Date();
    const cycleDurationMs = completedAt.getTime() - startedAt.getTime();

    let cycleStatus: SchedulerCycleStatus = 'SUCCESS';
    if (nseStatus === 'FAILED' && sebiStatus === 'FAILED') {
      cycleStatus = 'FAILED';
    } else if (nseStatus === 'FAILED' || sebiStatus === 'FAILED') {
      cycleStatus = 'PARTIAL_SUCCESS';
    }

    const cycleResult: DiscoverySchedulerCycleResult = {
      cycleId,
      status: cycleStatus,
      startedAt,
      completedAt,
      durationMs: cycleDurationMs,
      sources: {
        nse: {
          status: nseStatus,
          durationMs: nseDurationMs,
          recordsProcessed: nseRecordsProcessed,
          ...(nseError ? { error: nseError } : {}),
        },
        sebi: {
          status: sebiStatus,
          durationMs: sebiDurationMs,
          totalDiscovered: sebiTotalDiscovered,
          canonicalCreated: sebiCanonicalCreated,
          ...(sebiError ? { error: sebiError } : {}),
        },
      },
    };

    this.lastCycle = cycleResult;
    if (cycleStatus === 'SUCCESS') {
      this.consecutiveFailureCount = 0;
    } else {
      this.consecutiveFailureCount++;
    }

    this.logger.log(
      `[${cycleId}] Scheduled discovery cycle completed (status=${cycleStatus}, duration=${cycleDurationMs}ms)`,
    );

    return cycleResult;
  }
}
