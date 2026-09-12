import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { NotificationDeliveryWorkerService } from './notification-delivery-worker.service';

/**
 * NotificationDeliverySchedulerService
 *
 * Responsibilities:
 *   - Smallest internal scheduler ticker inside the modular monolith for Phase 29.6.
 *   - Triggers NotificationDeliveryWorkerService.processBatch() at a configurable interval.
 *   - Environment-driven enabling/disabling and cadence control.
 *   - Non-overlapping execution guard (handled via workerService.processBatch()).
 *   - Scheduler failure isolation — ticks never throw or crash the process.
 *
 * Does NOT:
 *   - Rely on external schedulers or external message queues (BullMQ/Redis/RabbitMQ).
 *   - Expose public HTTP endpoints for worker execution.
 *   - Process business domain logic directly.
 */
@Injectable()
export class NotificationDeliverySchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDeliverySchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly workerService: NotificationDeliveryWorkerService,
  ) {}

  onModuleInit(): void {
    if (this.timer !== null) {
      this.logger.warn('Scheduler initialization skipped: interval already registered');
      return;
    }

    const config = this.workerService.getConfig();

    if (!config.enabled) {
      this.logger.log('Notification delivery scheduler is disabled by configuration (NOTIFICATION_WORKER_ENABLED=false)');
      return;
    }

    this.logger.log(
      `Starting notification delivery scheduler (interval: ${config.intervalMs}ms)...`,
    );

    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.logger.error(
          `Unhandled error during scheduler tick: ${(err as Error)?.message || err}`,
          (err as Error)?.stack,
        );
      });
    }, config.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('Notification delivery scheduler stopped (timer handle cleared)');
    }
  }

  /**
   * Triggers a single worker batch iteration safely.
   */
  async tick(): Promise<void> {
    try {
      await this.workerService.processBatch();
    } catch (err: unknown) {
      this.logger.error(
        `Scheduler tick execution failure (contained): ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
