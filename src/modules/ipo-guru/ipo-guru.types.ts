/**
 * IPO Guru v2 API types.
 *
 * Scoped to this module to encapsulate IPO Guru API shapes.
 */

/**
 * Subscription data shape in v2 API.
 * In v2 list response, subscription provides subscription_total or nested total.
 */
export interface IpoGuruV2Subscription {
  total?: string | number | null;
  qib?: string | number | null;
  nii?: string | number | null;
  retail?: string | number | null;
  updated_at?: string | null;
  updated_at_label?: string | null;
  [key: string]: unknown;
}

/**
 * GMP data shape in v2 API.
 * updated_at is UTC ISO-8601; updated_at_label is display timestamp.
 */
export interface IpoGuruV2Gmp {
  price?: string | number | null;
  percentage?: string | number | null;
  updated_at?: string | null;
  updated_at_label?: string | null;
  [key: string]: unknown;
}

/**
 * One IPO record as returned by GET https://www.ipoguru.in/api/v2/ipos
 */
export interface IpoGuruV2Ipo {
  // Core identity (v2 uses slug as primary identifier)
  slug?: string;
  id?: string | number;
  name?: string;
  company_name?: string;
  symbol?: string;
  isin?: string;
  logo?: string | null;
  logo_url?: string | null;

  // Type & status
  type?: string; // 'Mainboard' | 'SME'
  sub_type?: string;
  ipo_type?: string;
  issue_type?: string; // 'Fresh Issue' | 'OFS' | 'Mixed'
  sale_type?: string; // 'Fresh capital only' | 'OFS only' | 'Fresh capital cum OFS'
  status?: string; // 'Upcoming' | 'Open' | 'Closed' | 'Listed' | ...

  // Dates
  open_date?: string | null;
  close_date?: string | null;
  allotment_date?: string | null;
  refund_date?: string | null;
  listing_date?: string | null;
  anchor_date?: string | null;

  // Timeline (v2 API detail object)
  timeline?: {
    open_date?: string | null;
    close_date?: string | null;
    allotment_date?: string | null;
    refund_date?: string | null;
    credit_to_demat_date?: string | null;
    listing_date?: string | null;
  };

  // Pricing
  price_band?: string | null; // e.g. "1700-1785"
  price_band_min?: number | string | null;
  price_band_max?: number | string | null;
  price_min?: number | string | null;
  price_max?: number | string | null;
  issue_price?: number | string | null;
  listing_price?: number | string | null;
  face_value?: number | string | null; // Optional in v2 list response
  lot_size?: number | string | null;
  min_investment?: number | string | null;

  // Size (unformatted numeric value in v2)
  issue_size?: number | string | null; // e.g. 22561.57 or 500
  fresh_issue?: number | string | null;
  fresh_issue_size?: number | string | null;
  fresh_size?: number | string | null;
  ofs?: number | string | null;
  ofs_size?: number | string | null;
  ofs_issue_size?: number | string | null;

  // Exchange & registrar
  exchange?: string;
  listing_on?: string; // e.g. "BSE, NSE" | "BSE SME"
  registrar?: string | null; // Optional in v2 list response

  // Subscription (v2 list response provides subscription_total)
  subscription_total?: number | string | null;
  subscription?: IpoGuruV2Subscription;
  qib_sub?: number | string | null;
  nii_sub?: number | string | null;
  retail_sub?: number | string | null;
  employee_sub?: number | string | null;
  total_sub?: number | string | null;
  sub_updated_at?: string | null;
  sub_updated_at_label?: string | null;

  // GMP
  gmp?: IpoGuruV2Gmp | number | string | null;
  gmp_pct?: number | string | null;
  gmp_updated_at?: string | null;
  gmp_updated_at_label?: string | null;

  // Additional fields from API
  [key: string]: unknown;
}

export interface IpoGuruV2Response {
  data?: IpoGuruV2Ipo[];
  ipos?: IpoGuruV2Ipo[];
  total?: number;
  count?: number;
  success?: boolean;
  [key: string]: unknown;
}

// Backward-compatible aliases
export type IpoGuruV1Subscription = IpoGuruV2Subscription;
export type IpoGuruV1Gmp = IpoGuruV2Gmp;
export type IpoGuruV1Ipo = IpoGuruV2Ipo;
export type IpoGuruV1Response = IpoGuruV2Response;
export type IpoGuruIpo = IpoGuruV2Ipo;
export type IpoGuruResponse = IpoGuruV2Response;

export interface IpoGuruFetchResult {
  /** HTTP status code from the IPO Guru API */
  httpStatus: number;
  /** Normalised list of IPOs (empty array if none returned) */
  ipos: IpoGuruV2Ipo[];
  /** Total count as reported by the API */
  total: number;
  /** UTC timestamp when this fetch completed */
  fetchedAt: string;
  /** Top-level response keys (for debugging - no API key exposed) */
  responseKeys: string[];
}

export type IpoGuruSyncAction = 'UPDATED' | 'CREATED' | 'SKIPPED' | 'ERROR';

export interface IpoGuruSkippedField {
  field: string;
  reason: string;
}

export interface IpoGuruSyncItemDetail {
  guruName: string;
  action: IpoGuruSyncAction;
  ipoId?: string;
  companyName?: string;
  matchedBy?: 'SYMBOL' | 'NAME' | 'DISAMBIGUATED' | 'AMBIGUOUS' | 'NONE';
  reason?: string;
  updatedFields?: string[];
  skippedFields?: IpoGuruSkippedField[];
  publicationStatus?: string;
  error?: string;
}

export interface IpoGuruSyncFailure {
  identifier: string;
  error: string;
  stage?: string;
}

export interface IpoGuruSyncResult {
  totalFetched: number;
  matchedUpdated: number;
  newlyCreated: number;
  skipped: number;
  errorCount: number;
  syncedAt: string;
  items: IpoGuruSyncItemDetail[];
  // Phase 3 structured observability fields
  totalFetchedFromApi: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  failures: IpoGuruSyncFailure[];
}

// ==========================================
// IPO GURU SCHEDULE & BUDGET CONSTANTS
// ==========================================

export const IPOGURU_SCHEDULED_SLOTS = [
  '10:00',
  '13:00',
  '15:00',
  '17:30',
] as const;

export type IpoGuruSlot = (typeof IPOGURU_SCHEDULED_SLOTS)[number];

export const IPOGURU_TOTAL_DAILY_LIMIT = 10;
export const IPOGURU_AUTO_DAILY_LIMIT = 4;
export const IPOGURU_MAX_MANUAL_LIMIT = 6;
export const IPOGURU_MIN_REQUEST_INTERVAL_MS = 60_000; // 1 minute

/**
 * Persisted server-side rate limit & daily quota usage state.
 * Stored in PostgreSQL `sources.rate_limit_policy` for source 'IPOGURU'.
 */
export interface IpoGuruUsageState {
  istDate: string; // "YYYY-MM-DD"
  totalRequestsToday: number;
  autoRequestsToday: number;
  manualRequestsToday: number;
  lastRequestAt: string | null;
  lastSuccessAt: string | null;
  lastFetchStatus: string | null;
  completedSlots: string[];
}

/**
 * Public status & counter model returned to Admin Console UI.
 */
export interface IpoGuruStatusResponse {
  istDate: string;
  requestsUsedToday: number;
  requestsRemainingToday: number;
  autoRequestsUsedToday: number;
  autoRequestsTotal: number;
  manualRequestsUsedToday: number;
  manualRequestsRemaining: number;
  nextScheduledAutoSync: string;
  nextScheduledIso: string | null;
  lastSuccessfulFetch: string | null;
  lastFetchStatus: string;
  lastRequestAt: string | null;
  scheduledSlots: string[];
  completedSlots: string[];
}

/**
 * Helper to get current date, hours, minutes, and time slot string in IST (Asia/Kolkata, UTC+05:30).
 */
export function getIstNow(now = new Date()): {
  istDate: string; // "YYYY-MM-DD"
  hours: number;
  minutes: number;
  seconds: number;
  timeStr: string; // "HH:mm"
  timeMinutes: number; // hours * 60 + minutes
} {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  const y = istTime.getUTCFullYear();
  const m = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(istTime.getUTCDate()).padStart(2, '0');
  const istDate = `${y}-${m}-${d}`;
  const hours = istTime.getUTCHours();
  const minutes = istTime.getUTCMinutes();
  const seconds = istTime.getUTCSeconds();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const timeMinutes = hours * 60 + minutes;
  return { istDate, hours, minutes, seconds, timeStr, timeMinutes };
}

/**
 * Converts "HH:mm" string to total minutes from midnight.
 */
export function parseSlotToMinutes(slot: string): number {
  const [h, m] = slot.split(':').map((v) => parseInt(v, 10));
  return (h || 0) * 60 + (m || 0);
}

/**
 * Formats a slot like "10:00" or "17:30" to readable IST label like "10:00 AM IST" or "5:30 PM IST".
 */
export function formatSlotDisplay(slot: string): string {
  const [hStr, mStr] = slot.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = m === 0 ? ':00' : `:${String(m).padStart(2, '0')}`;
  return `${displayH}${displayM} ${ampm} IST`;
}

/**
 * Formats an ISO date timestamp to Indian Standard Time display string.
 */
export function formatIstDisplay(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '—';
    const formatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    return `${formatter.format(d)} IST`;
  } catch {
    return isoString;
  }
}

/**
 * Computes human-readable and ISO timestamp for next upcoming scheduled automatic sync.
 */
export function computeNextScheduledSync(
  now = new Date(),
  completedSlots: string[] = [],
): { label: string; iso: string | null } {
  const { istDate, timeMinutes } = getIstNow(now);
  const slots = IPOGURU_SCHEDULED_SLOTS;

  // Check today's upcoming uncompleted slots
  for (const slot of slots) {
    const slotMins = parseSlotToMinutes(slot);
    // If slot is strictly in the future (or current minute) and not completed yet
    if (slotMins >= timeMinutes && !completedSlots.includes(slot)) {
      return {
        label: `Today at ${formatSlotDisplay(slot)}`,
        iso: new Date(`${istDate}T${slot}:00+05:30`).toISOString(),
      };
    }
  }

  // If all today's slots have passed or completed, next is tomorrow at 10:00 AM IST
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowIst = getIstNow(tomorrow).istDate;
  return {
    label: 'Tomorrow at 10:00 AM IST',
    iso: new Date(`${tomorrowIst}T10:00:00+05:30`).toISOString(),
  };
}

