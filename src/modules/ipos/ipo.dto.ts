import { z } from 'zod';

import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from '../../common/pagination/pagination';

const emptyToUndefined = (value: unknown) =>
  value === '' || value === undefined ? undefined : value;

export const ipoStatusSchema = z.enum([
  'DRAFT',
  'UPCOMING',
  'OPEN',
  'CLOSED',
  'ALLOTMENT_PENDING',
  'ALLOTMENT_COMPLETED',
  'LISTING_PENDING',
  'LISTED',
  'WITHDRAWN',
  'CANCELLED',
]);

export const marketSegmentSchema = z.enum(['MAINBOARD', 'SME']);

export const exchangeSchema = z.enum(['NSE', 'BSE', 'BOTH']);

export const ipoSortFieldSchema = z.enum([
  'createdAt',
  'updatedAt',
  'companyName',
  'legalName',
  'symbol',
  'status',
  'issueSize',
  'priceBandLow',
  'price',
  'lotSize',
]);

export const sortOrderSchema = z.enum(['asc', 'desc']);

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid ISO date string (expected YYYY-MM-DD)');

export const ipoListQuerySchema = z
  .object({
    q: z.preprocess(emptyToUndefined, z.string().optional()),
    status: z.preprocess(emptyToUndefined, ipoStatusSchema.optional()),
    marketSegment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
    exchange: z.preprocess(emptyToUndefined, exchangeSchema.optional()),
    symbol: z.preprocess(emptyToUndefined, z.string().optional()),

    priceMin: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),
    priceMax: z.preprocess(emptyToUndefined, z.coerce.number().min(0).optional()),

    lotSizeMin: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).optional(),
    ),
    lotSizeMax: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).optional(),
    ),

    issueSizeMin: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).optional(),
    ),
    issueSizeMax: z.preprocess(
      emptyToUndefined,
      z.coerce.number().min(0).optional(),
    ),

    openDateFrom: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    openDateTo: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    closeDateFrom: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    closeDateTo: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    listingDateFrom: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    listingDateTo: z.preprocess(emptyToUndefined, dateStringSchema.optional()),

    sort: z.preprocess(emptyToUndefined, ipoSortFieldSchema.optional()),
    order: z.preprocess(emptyToUndefined, sortOrderSchema.optional()),

    page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  })
  .refine(
    (data) =>
      data.priceMin === undefined ||
      data.priceMax === undefined ||
      data.priceMin <= data.priceMax,
    {
      message: 'priceMin cannot be greater than priceMax',
      path: ['priceMin'],
    },
  )
  .refine(
    (data) =>
      data.lotSizeMin === undefined ||
      data.lotSizeMax === undefined ||
      data.lotSizeMin <= data.lotSizeMax,
    {
      message: 'lotSizeMin cannot be greater than lotSizeMax',
      path: ['lotSizeMin'],
    },
  )
  .refine(
    (data) =>
      data.issueSizeMin === undefined ||
      data.issueSizeMax === undefined ||
      data.issueSizeMin <= data.issueSizeMax,
    {
      message: 'issueSizeMin cannot be greater than issueSizeMax',
      path: ['issueSizeMin'],
    },
  )
  .refine(
    (data) =>
      !data.openDateFrom ||
      !data.openDateTo ||
      data.openDateFrom <= data.openDateTo,
    {
      message: 'openDateFrom cannot be after openDateTo',
      path: ['openDateFrom'],
    },
  )
  .refine(
    (data) =>
      !data.closeDateFrom ||
      !data.closeDateTo ||
      data.closeDateFrom <= data.closeDateTo,
    {
      message: 'closeDateFrom cannot be after closeDateTo',
      path: ['closeDateFrom'],
    },
  )
  .refine(
    (data) =>
      !data.listingDateFrom ||
      !data.listingDateTo ||
      data.listingDateFrom <= data.listingDateTo,
    {
      message: 'listingDateFrom cannot be after listingDateTo',
      path: ['listingDateFrom'],
    },
  );
export const ipoCompareQuerySchema = z
  .object({
    ids: z.preprocess(
      (value: unknown): string[] => {
        if (typeof value === 'string') {
          return value
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        if (Array.isArray(value)) {
          return value
            .flatMap((item) =>
              typeof item === 'string' ? item.split(',') : [],
            )
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
        return [];
      },
      z.array(z.string().uuid('Invalid UUID')),
    ),
  })
  .refine((data) => data.ids.length >= 2, {
    message: 'Comparison requires at least 2 IPO IDs',
    path: ['ids'],
  })
  .refine((data) => data.ids.length <= 5, {
    message: 'Comparison supports a maximum of 5 IPO IDs',
    path: ['ids'],
  })
  .refine((data) => new Set(data.ids).size === data.ids.length, {
    message: 'Duplicate IPO IDs are not allowed in comparison',
    path: ['ids'],
  });

export const ipoIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const ipoChangesQuerySchema = z.object({
  field: z.preprocess(emptyToUndefined, z.string().optional()),
  source: z.preprocess(emptyToUndefined, z.string().optional()),
});

export const ipoLineageQuerySchema = z.object({
  field: z.preprocess(emptyToUndefined, z.string().optional()),
  source: z.preprocess(emptyToUndefined, z.string().optional()),
});

export const refreshIpoSchema = z.object({
  source: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : undefined),
    z.string().min(1),
  ),
});

/**
 * Request body for POST /ipos/:id/smart-refresh.
 * Single endpoint that orchestrates Plan -> Execute -> Verify -> Result.
 */
export const smartRefreshIpoSchema = z.object({
  source: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : undefined),
    z.string().min(1),
  ),
});
export type SmartRefreshIpoDto = z.infer<typeof smartRefreshIpoSchema>;

/**
 * Request body for POST /ipos/:id/refresh-verification.
 * Callers supply the Phase 14 execution outcome so the verifier can evaluate
 * whether the requested IPO was actually observed without re-running the refresh.
 */
export const verifyRefreshSchema = z.object({
  source: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : undefined),
    z.string().min(1),
  ),
  /**
   * Exact execution status from RefreshExecutionResult.status.
   * Replaces the former boolean `refreshCompleted` — allows the verifier
   * to distinguish COMPLETED / SKIPPED / BLOCKED / FAILED semantics.
   */
  executionStatus: z.preprocess(
    (v) => (typeof v === 'string' ? v : undefined),
    z.enum(['COMPLETED', 'SKIPPED', 'BLOCKED', 'FAILED']),
  ),
  refreshStartedAt: z.preprocess(
    (v) => (typeof v === 'string' ? new Date(v) : v),
    z.date(),
  ),
  refreshCompletedAt: z.preprocess(
    (v) => (typeof v === 'string' ? new Date(v) : v),
    z.date(),
  ),
});

export type IpoListQuery = z.infer<typeof ipoListQuerySchema>;
export type IpoCompareQuery = z.infer<typeof ipoCompareQuerySchema>;
export type IpoIdParam = z.infer<typeof ipoIdParamSchema>;
export type RefreshIpoDto = z.infer<typeof refreshIpoSchema>;
export type VerifyRefreshDto = z.infer<typeof verifyRefreshSchema>;

export type CompareIpoItemDto = {
  id: string;
  companyName: string;
  legalName: string;
  symbol: string | null;
  cin: string | null;
  status: z.infer<typeof ipoStatusSchema>;
  marketSegment: z.infer<typeof marketSegmentSchema>;
  exchange: z.infer<typeof exchangeSchema>;
  issueSize: string | null;
  freshIssueSize: string | null;
  ofsSize: string | null;
  issueShareCount: string | null;
  freshIssueShareCount: string | null;
  ofsShareCount: string | null;
  priceBandLow: string | null;
  priceBandHigh: string | null;
  lotSize: number | null;
  minimumLots: number | null;
  faceValue: string | null;
  openDate: string | null;
  closeDate: string | null;
  listingDate: string | null;
};

export type IpoCompareResponseDto = {
  data: {
    ipos: CompareIpoItemDto[];
  };
};

export type IssueCompositionEnum =
  | 'FRESH_ONLY'
  | 'OFS_ONLY'
  | 'FRESH_AND_OFS'
  | 'UNKNOWN';

export type IpoAnalyticsMetricsDto = {
  freshIssuePercentage: string | null;
  ofsPercentage: string | null;
  freshIssueSharePercentage: string | null;
  ofsSharePercentage: string | null;
  priceBandSpread: string | null;
  priceBandSpreadPercentage: string | null;
  minimumApplicationAmount: string | null;
  issueComposition: IssueCompositionEnum;
  daysToOpen: number | null;
  daysToClose: number | null;
  daysToListing: number | null;
};

export type IpoAnalyticsResponseDto = {
  data: {
    ipoId: string;
    metrics: IpoAnalyticsMetricsDto;
    evaluatedAt: string;
  };
};

export type CompanySummaryDto = {
  id: string;
  legalName: string;
  displayName: string;
  cin: string | null;
  website: string | null;
  industry: string | null;
  sector: string | null;
};

export type IpoLifecycleDto = {
  drhpDate: string | null;
  rhpDate: string | null;
  anchorDate: string | null;
  openDate: string | null;
  closeDate: string | null;
  basisOfAllotmentDate: string | null;
  refundInitiationDate: string | null;
  dematCreditDate: string | null;
  listingDate: string | null;
};

/**
 * Consumer-facing IPO Data Readiness Status.
 * - READY: Canonical data is complete, fresh, and safe for production consumption.
 * - READY_WITH_WARNINGS: Canonical data is usable for display with minor non-blocking warnings.
 * - NEEDS_REVIEW: Important quality, freshness, or source conflict concern requires review.
 * - INCOMPLETE: Critical required terms or lifecycle data are missing/invalid.
 */
export type DataReadinessStatus =
  | 'READY'
  | 'READY_WITH_WARNINGS'
  | 'NEEDS_REVIEW'
  | 'INCOMPLETE';

/**
 * Consumer-facing data-readiness summary attached to GET /api/v1/ipos/:id.
 * Allows mobile and API consumers to make deterministic display decisions
 * without analyzing complex internal provenance, freshness, or quality gate structures.
 */
export type IpoDataReadinessDto = {
  /** Overall readiness status derived from Quality Gate assessment */
  status: DataReadinessStatus;
  /** High-level boolean flag: true if status is READY or READY_WITH_WARNINGS, false if NEEDS_REVIEW or INCOMPLETE */
  isReady: boolean;
  /** Human-readable deterministic summary message safe for mobile display */
  summary: string;
  /** Total number of missing or unknown fields */
  missingFieldCount: number;
  /** Total number of stale field observations */
  staleFieldCount: number;
  /** Total number of unresolved cross-source field conflicts */
  conflictFieldCount: number;
  /** Informational flag: true if discovery refresh is recommended by Freshness Intelligence */
  refreshRecommended: boolean;
};

export type IpoResponseDto = {
  id: string;
  company: CompanySummaryDto;
  marketSegment: z.infer<typeof marketSegmentSchema>;
  exchange: z.infer<typeof exchangeSchema>;
  status: z.infer<typeof ipoStatusSchema>;
  symbol: string | null;
  issueSize: string | null;
  freshIssueSize: string | null;
  ofsSize: string | null;
  faceValue: string | null;
  priceBandLow: string | null;
  priceBandHigh: string | null;
  lotSize: number | null;
  minimumLots: number | null;
  lifecycle: IpoLifecycleDto;
  dataReadiness?: IpoDataReadinessDto;
  createdAt: string;
  updatedAt: string;
};

export type IpoLifecycleEventDetailDto = {
  id: string;
  eventType: string;
  eventDate: string;
  sourceId: string | null;
  sourceReference: string | null;
  createdAt: string;
};

export type IpoTimelineResponseDto = {
  ipoId: string;
  events: IpoLifecycleEventDetailDto[];
};

export type IpoSourceIdentityDto = {
  id: string;
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceType: string;
  externalId: string | null;
  symbol: string | null;
  createdAt: string;
};

export type IpoSourcesResponseDto = {
  ipoId: string;
  sources: IpoSourceIdentityDto[];
};

export type IpoChangesQuery = z.infer<typeof ipoChangesQuerySchema>;

export type IpoChangeSourceSummaryDto = {
  id: string;
  code: string;
  name: string;
  sourceType: string;
};

export type IpoChangeEventDetailDto = {
  id: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changeType: string;
  source: IpoChangeSourceSummaryDto | null;
  sourceReference: string | null;
  detectedAt: string;
  createdAt: string;
};

export type IpoChangesResponseDto = {
  ipoId: string;
  changes: IpoChangeEventDetailDto[];
};

export type IpoLineageQuery = z.infer<typeof ipoLineageQuerySchema>;

export type IpoSourceSummaryDto = {
  code: string;
  name: string;
  sourceType: string;
};

export type IpoFieldObservationDto = {
  source: IpoSourceSummaryDto;
  observedValue: string;
  observedAt: string;
  sourceReference: string | null;
};

export type IpoFieldLineageDto = {
  fieldName: string;
  canonicalValue: string | null;
  source: IpoSourceSummaryDto | null;
  observedValue: string | null;
  observedAt: string | null;
  observations: IpoFieldObservationDto[];
};

export type IpoLineageResponseDto = {
  ipoId: string;
  fields: IpoFieldLineageDto[];
};
