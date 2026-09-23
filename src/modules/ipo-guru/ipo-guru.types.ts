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
  listing_date?: string | null;
  anchor_date?: string | null;

  // Pricing
  price_band?: string | null; // e.g. "1700-1785"
  price_band_min?: number | string | null;
  price_band_max?: number | string | null;
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

export interface IpoGuruSyncItemDetail {
  guruName: string;
  action: IpoGuruSyncAction;
  ipoId?: string;
  companyName?: string;
  matchedBy?: 'SYMBOL' | 'NAME' | 'AMBIGUOUS' | 'NONE';
  reason?: string;
  updatedFields?: string[];
  error?: string;
}

export interface IpoGuruSyncResult {
  totalFetched: number;
  matchedUpdated: number;
  newlyCreated: number;
  skipped: number;
  errorCount: number;
  syncedAt: string;
  items: IpoGuruSyncItemDetail[];
}
