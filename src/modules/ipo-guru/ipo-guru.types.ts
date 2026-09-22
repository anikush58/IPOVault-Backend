/**
 * IPO Guru v1 API types.
 *
 * All types are scoped to this module so v1 can be replaced with v2
 * without touching the rest of IPOVault.
 */

/**
 * One IPO record as returned by GET https://www.ipoguru.in/api/v1/ipos
 */
export interface IpoGuruV1Subscription {
  qib?: string | number | null;
  nii?: string | number | null;
  retail?: string | number | null;
  total?: string | number | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface IpoGuruV1Gmp {
  price?: string | number | null;
  percentage?: string | number | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface IpoGuruV1Ipo {
  // Core identity
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
  face_value?: number | string | null;
  lot_size?: number | string | null;
  min_investment?: number | string | null;

  // Size
  issue_size?: number | string | null; // in crore e.g. "₹22561.57 Cr"
  fresh_issue?: number | string | null;
  ofs?: number | string | null;

  // Exchange & registrar
  exchange?: string;
  listing_on?: string; // e.g. "BSE, NSE" | "BSE SME"
  registrar?: string;

  // Subscription (nested object or flat fields)
  subscription?: IpoGuruV1Subscription;
  qib_sub?: number | string | null;
  nii_sub?: number | string | null;
  retail_sub?: number | string | null;
  employee_sub?: number | string | null;
  total_sub?: number | string | null;
  sub_updated_at?: string | null;

  // GMP (nested object or flat fields)
  gmp?: IpoGuruV1Gmp | number | string | null;
  gmp_pct?: number | string | null;
  gmp_updated_at?: string | null;

  // Additional fields from API
  [key: string]: unknown;
}

export interface IpoGuruV1Response {
  data?: IpoGuruV1Ipo[];
  ipos?: IpoGuruV1Ipo[];
  total?: number;
  count?: number;
  success?: boolean;
  [key: string]: unknown;
}

export interface IpoGuruFetchResult {
  /** HTTP status code from the IPO Guru API */
  httpStatus: number;
  /** Normalised list of IPOs (empty array if none returned) */
  ipos: IpoGuruV1Ipo[];
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
