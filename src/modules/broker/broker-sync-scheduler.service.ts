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
 * Canonical Indian Stock Market (NSE/BSE) Trading Holidays.
 */
export const INDIAN_MARKET_HOLIDAYS = new Set<string>([
  // 2024
  '2024-01-22', // Ram Temple Consecration
  '2024-01-26', // Republic Day
  '2024-03-08', // Mahashivratri
  '2024-03-25', // Holi
  '2024-03-29', // Good Friday
  '2024-04-11', // Id-Ul-Fitr
  '2024-04-17', // Ram Navami
  '2024-05-01', // Maharashtra Day
  '2024-05-20', // General Parliamentary Elections (Mumbai)
  '2024-06-17', // Bakri Id
  '2024-07-17', // Muharram
  '2024-08-15', // Independence Day
  '2024-10-02', // Mahatma Gandhi Jayanti
  '2024-11-01', // Diwali Laxmi Pujan
  '2024-11-15', // Gurunanak Jayanti
  '2024-11-20', // Maharashtra Assembly Elections
  '2024-12-25', // Christmas

  // 2025
  '2025-01-26', // Republic Day
  '2025-02-26', // Mahashivratri
  '2025-03-14', // Holi
  '2025-03-31', // Id-Ul-Fitr
  '2025-04-10', // Mahavir Jayanti
  '2025-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2025-04-18', // Good Friday
  '2025-05-01', // Maharashtra Day
  '2025-06-07', // Bakri Id
  '2025-08-15', // Independence Day
  '2025-08-27', // Ganesh Chaturthi
  '2025-10-02', // Mahatma Gandhi Jayanti / Dussehra
  '2025-10-21', // Diwali Laxmi Pujan
  '2025-10-22', // Diwali Balipratipada
  '2025-11-05', // Prakash Gurpurb Sri Guru Nanak Dev
  '2025-12-25', // Christmas

  // 2026
  '2026-01-26', // Republic Day
  '2026-03-03', // Holi
  '2026-03-17', // Mahashivratri
  '2026-03-20', // Id-Ul-Fitr
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-05-28', // Bakri Id
  '2026-06-26', // Muharram
  '2026-08-15', // Independence Day
  '2026-09-14', // Ganesh Chaturthi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra
  '2026-11-08', // Diwali Laxmi Pujan
  '2026-11-10', // Diwali Balipratipada
  '2026-11-24', // Gurunanak Jayanti
  '2026-12-25', // Christmas

  // 2027
  '2027-01-26', // Republic Day
  '2027-03-08', // Id-Ul-Fitr
  '2027-03-22', // Holi
  '2027-03-26', // Good Friday
  '2027-04-14', // Dr. Ambedkar Jayanti
  '2027-05-01', // Maharashtra Day
  '2027-05-18', // Bakri Id
  '2027-07-16', // Muharram
  '2027-08-15', // Independence Day
  '2027-10-02', // Mahatma Gandhi Jayanti
  '2027-10-10', // Dussehra
  '2027-10-29', // Diwali Laxmi Pujan
  '2027-11-14', // Gurunanak Jayanti
  '2027-12-25', // Christmas
]);

export function isIndianMarketHoliday(dateStr: string): boolean {
  return INDIAN_MARKET_HOLIDAYS.has(dateStr);
}

/**
 * Returns true if given date is an active trading day (Monday - Friday and not a market holiday) in IST.
 */
export function isTradingDay(date: Date = new Date()): boolean {
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const day = istTime.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day < 1 || day > 5) {
    return false;
  }
  const dateStr = istTime.toISOString().slice(0, 10);
  return !isIndianMarketHoliday(dateStr);
}

/**
 * 5 Scheduled IST Broker LTP Sync Windows on Indian Trading Days:
 * - 09:30 AM IST (09:30 - 09:50 IST)
 * - 11:00 AM IST (11:00 - 11:20 IST)
 * - 01:00 PM IST (13:00 - 13:20 IST)
 * - 02:30 PM IST (14:30 - 14:50 IST)
 * - 03:45 PM IST (15:45 - 16:15 IST)
 */
export interface ScheduledSyncWindow {
  id: '09:30' | '11:00' | '13:00' | '14:30' | '15:45';
  label: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export const SCHEDULED_SYNC_WINDOWS: ScheduledSyncWindow[] = [
  { id: '09:30', label: '09:30 AM IST', startHour: 9, startMinute: 30, endHour: 9, endMinute: 50 },
  { id: '11:00', label: '11:00 AM IST', startHour: 11, startMinute: 0, endHour: 11, endMinute: 20 },
  { id: '13:00', label: '01:00 PM IST', startHour: 13, startMinute: 0, endHour: 13, endMinute: 20 },
  { id: '14:30', label: '02:30 PM IST', startHour: 14, startMinute: 30, endHour: 14, endMinute: 50 },
  { id: '15:45', label: '03:45 PM IST', startHour: 15, startMinute: 45, endHour: 16, endMinute: 15 },
];

/**
 * Returns the active ScheduledSyncWindow if the given date falls within one of the 5 IST execution windows, or null otherwise.
 */
export function getActiveSyncWindow(date: Date = new Date()): ScheduledSyncWindow | null {
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  for (const win of SCHEDULED_SYNC_WINDOWS) {
    const startTotal = win.startHour * 60 + win.startMinute;
    const endTotal = win.endHour * 60 + win.endMinute;
    if (totalMinutes >= startTotal && totalMinutes <= endTotal) {
      return win;
    }
  }

  return null;
}

/**
 * Returns true if the given date is within any of the 5 scheduled IST sync windows.
 */
export function isPostListingSyncWindow(date: Date = new Date()): boolean {
  return getActiveSyncWindow(date) !== null;
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
  lastRunKey: string | null;
  executedWindowsToday: string[];
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
  private lastRunKey: string | null = null;
  private readonly executedWindowKeys = new Set<string>();
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
      `Starting Broker sync scheduler (interval: ${intervalMs}ms, 5 IST windows: 09:30, 11:00, 13:00, 14:30, 15:45 on trading days)`,
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
   * Periodic tick handler: verifies trading day, active IST window, and per-window idempotency.
   */
  async handleScheduledTick(now: Date = new Date()): Promise<boolean> {
    if (this.isRunning) {
      this.logger.debug('Broker sync tick skipped: previous cycle still running');
      return false;
    }

    if (!isTradingDay(now)) {
      return false;
    }

    const activeWindow = getActiveSyncWindow(now);
    if (!activeWindow) {
      return false;
    }

    const todayStr = getIstDateString(now);
    const executionKey = `${todayStr}_${activeWindow.id}`;
    if (this.executedWindowKeys.has(executionKey)) {
      return false;
    }

    return this.executeSyncCycle(now, activeWindow, executionKey);
  }

  /**
   * Executes the post-listing sync across all connected broker accounts for the given window.
   */
  async executeSyncCycle(
    now: Date = new Date(),
    activeWindow: ScheduledSyncWindow = {
      id: '15:45',
      label: '03:45 PM IST',
      startHour: 15,
      startMinute: 45,
      endHour: 16,
      endMinute: 15,
    },
    executionKey?: string,
  ): Promise<boolean> {
    this.isRunning = true;
    const todayStr = getIstDateString(now);
    const key = executionKey || `${todayStr}_${activeWindow.id}`;

    try {
      this.logger.log(
        `Initiating automatic ${activeWindow.label} broker LTP sync for connected accounts`,
      );
      const result = await this.investmentService.syncAllConnectedUpstoxAccounts();

      this.executedWindowKeys.add(key);
      this.lastRunDate = todayStr;
      this.lastRunKey = key;
      this.lastRunResult = {
        timestamp: new Date(),
        processedCount: result.processedCount,
        successCount: result.successCount,
        failureCount: result.failureCount,
      };

      this.logger.log(
        `Automatic ${activeWindow.label} sync completed: ${result.successCount}/${result.processedCount} succeeded, ${result.failureCount} failed`,
      );
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error in ${activeWindow.label} sync cycle: ${msg}`);
      return false;
    } finally {
      this.isRunning = false;
    }
  }

  getHealthStatus(date: Date = new Date()): BrokerSyncSchedulerHealth {
    const enabled =
      this.configService?.get('BROKER_SYNC_SCHEDULER_ENABLED', {
        infer: true,
      }) ?? false;
    const intervalMs =
      this.configService?.get('BROKER_SYNC_SCHEDULER_INTERVAL_MS', {
        infer: true,
      }) ?? 60_000;

    const todayStr = getIstDateString(date);
    const executedWindowsToday = Array.from(this.executedWindowKeys)
      .filter((k) => k.startsWith(todayStr))
      .map((k) => k.split('_')[1]);

    return {
      enabled,
      running: this.isRunning,
      intervalMs,
      lastRunDate: this.lastRunDate,
      lastRunKey: this.lastRunKey,
      executedWindowsToday,
      lastRunResult: this.lastRunResult,
    };
  }
}
