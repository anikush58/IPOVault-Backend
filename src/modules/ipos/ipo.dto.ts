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

export const ipoListQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, ipoStatusSchema.optional()),
  marketSegment: z.preprocess(emptyToUndefined, marketSegmentSchema.optional()),
  exchange: z.preprocess(emptyToUndefined, exchangeSchema.optional()),
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export const ipoIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type IpoListQuery = z.infer<typeof ipoListQuerySchema>;
export type IpoIdParam = z.infer<typeof ipoIdParamSchema>;

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
