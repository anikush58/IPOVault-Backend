import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SourceIdentitySyncService } from './source-identity-sync.service';
import { KfinIdentityDiscoveryAdapter } from './kfin-identity-discovery.adapter';
import { MufgIdentityDiscoveryAdapter } from './mufg-identity-discovery.adapter';
import { IRegistrarIdentityDiscoveryAdapter, RegistrarSourceIdentitySyncSummary } from './registrar-identity-discovery.types';

export interface RegistrarIdentitySyncSchedulerConfig {
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
}

export interface RegistrarSyncCycleResult {
  cycleId: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  results: Record<string, {
    success: boolean;
    summary?: RegistrarSourceIdentitySyncSummary;
    error?: string;
  }>;
}

@Injectable()
export class RegistrarIdentitySyncSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    RegistrarIdentitySyncSchedulerService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly syncService: SourceIdentitySyncService,
    private readonly kfinDiscoveryAdapter: KfinIdentityDiscoveryAdapter,
    private readonly mufgDiscoveryAdapter: MufgIdentityDiscoveryAdapter,
  ) {}

  public getConfig(): RegistrarIdentitySyncSchedulerConfig {
    const enabled =
      process.env.REGISTRAR_IDENTITY_SYNC_ENABLED !== 'false';
    const intervalMs = Number(
      process.env.REGISTRAR_IDENTITY_SYNC_INTERVAL_MS || 21_600_000, // 6 hours
    );
    const initialDelayMs = Number(
      process.env.REGISTRAR_IDENTITY_SYNC_INITIAL_DELAY_MS || 10_000, // 10s after startup
    );

    return {
      enabled,
      intervalMs: isNaN(intervalMs) || intervalMs < 1000 ? 21_600_000 : intervalMs,
      initialDelayMs: isNaN(initialDelayMs) || initialDelayMs < 0 ? 10_000 : initialDelayMs,
    };
  }

  onModuleInit(): void {
    if (this.timer !== null || this.initialTimer !== null) {
      this.logger.warn(
        'Registrar identity sync scheduler initialization skipped: timers already registered',
      );
      return;
    }

    const config = this.getConfig();

    if (!config.enabled) {
      this.logger.log(
        'Registrar identity sync scheduler is disabled by configuration (REGISTRAR_IDENTITY_SYNC_ENABLED=false)',
      );
      return;
    }

    this.logger.log(
      `Starting Registrar Identity Sync scheduler (interval: ${config.intervalMs}ms, initial delay: ${config.initialDelayMs}ms)...`,
    );

    if (config.initialDelayMs > 0) {
      this.initialTimer = setTimeout(() => {
        this.initialTimer = null;
        this.tick().catch((err: unknown) => {
          this.logger.error(
            `Unhandled error during initial registrar identity sync tick: ${(err as Error)?.message || err}`,
            (err as Error)?.stack,
          );
        });
      }, config.initialDelayMs);
    } else {
      void this.tick();
    }

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(
          `Unhandled error during registrar identity sync tick: ${(err as Error)?.message || err}`,
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
      this.logger.log('Registrar Identity Sync scheduler stopped (timer handles cleared)');
    }
  }

  /**
   * Executes a synchronized identity discovery cycle across registered registrar discovery adapters.
   * Safe, non-blocking, and prevents overlapping executions.
   */
  async tick(): Promise<RegistrarSyncCycleResult | null> {
    if (this.isProcessing) {
      this.logger.warn(
        'Registrar identity sync tick skipped: previous sync cycle is still running',
      );
      return null;
    }

    this.isProcessing = true;
    const cycleId = randomUUID();
    const startedAt = new Date();
    this.logger.log(`[${cycleId}] Starting scheduled registrar identity discovery cycle...`);

    const adapters: IRegistrarIdentityDiscoveryAdapter[] = [
      this.kfinDiscoveryAdapter,
      this.mufgDiscoveryAdapter,
    ];

    const results: RegistrarSyncCycleResult['results'] = {};

    try {
      for (const adapter of adapters) {
        const adapterCode = adapter.registrarCode;
        try {
          this.logger.log(`[${cycleId}] Running identity sync for registrar '${adapterCode}'...`);
          const summary = await this.syncService.syncRegistrarIdentities(adapter);
          results[adapterCode] = {
            success: true,
            summary,
          };
          this.logger.log(
            `[${cycleId}] Identity sync completed for '${adapterCode}': ` +
              `total=${summary.totalDiscovered}, new=${summary.discoveredCount}, ` +
              `changed=${summary.changedCount}, noChange=${summary.noChangeCount}, unresolved=${summary.unresolvedCount}`,
          );
        } catch (adapterErr: unknown) {
          const errMsg = adapterErr instanceof Error ? adapterErr.message : String(adapterErr);
          this.logger.error(
            `[${cycleId}] Identity sync failed for '${adapterCode}' (contained): ${errMsg}`,
            adapterErr instanceof Error ? adapterErr.stack : undefined,
          );
          results[adapterCode] = {
            success: false,
            error: errMsg,
          };
        }
      }

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      this.logger.log(
        `[${cycleId}] Scheduled registrar identity discovery cycle completed in ${durationMs}ms`,
      );

      return {
        cycleId,
        startedAt,
        completedAt,
        durationMs,
        results,
      };
    } finally {
      this.isProcessing = false;
    }
  }
}
