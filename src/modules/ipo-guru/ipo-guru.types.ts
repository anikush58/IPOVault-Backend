/**
 * IPO Guru v1 API types.
 *
 * All types are scoped to this module so v1 can be replaced with v2
 * without touching the rest of IPOVault.
 */

/** One IPO record as returned by GET https://www.ipoguru.in/api/v1/ipos */
export interface IpoGuruV1Ipo {
  // Core identity
  id?: string | number;
  name?: string;
  company_name?: string;
  symbol?: string;
  isin?: string;

  // Type & status
  ipo_type?: string; // 'Mainboard' | 'SME' | ...
  issue_type?: string; // 'Fresh Issue' | 'OFS' | 'Mixed'
  status?: string; // 'Upcoming' | 'Open' | 'Closed' | 'Listed' | ...

  // Dates
  open_date?: string | null;
  close_date?: string | null;
  allotment_date?: string | null;
  listing_date?: string | null;
  anchor_date?: string | null;

  // Pricing
  price_band_min?: number | string | null;
  price_band_max?: number | string | null;
  issue_price?: number | string | null;
  lot_size?: number | null;
  min_investment?: number | null;

  // Size
  issue_size?: number | string | null; // in crore
  fresh_issue?: number | string | null;
  ofs?: number | string | null;

  // Exchange & registrar
  exchange?: string;
  registrar?: string;

  // Subscription (x multiples)
  qib_sub?: number | null;
  nii_sub?: number | null;
  retail_sub?: number | null;
  employee_sub?: number | null;
  total_sub?: number | null;
  sub_updated_at?: string | null;

  // GMP
  gmp?: number | null;
  gmp_pct?: number | null;
  gmp_updated_at?: string | null;

  // Additional fields from API
  [key: string]: unknown;
}

export interface IpoGuruV1Response {
  data?: IpoGuruV1Ipo[];
  ipos?: IpoGuruV1Ipo[];
  total?: number;
  count?: number;
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
