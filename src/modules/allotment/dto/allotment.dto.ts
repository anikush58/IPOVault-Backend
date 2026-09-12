import { z } from 'zod';
import {
  AllotmentIdentifierType,
  AllotmentJobStatus,
  AllotmentStatus,
  CaptchaChallenge,
} from '../allotment.types';
import { isValidPan } from '../allotment.utils';

export const allotmentIdentifierTypeSchema = z.nativeEnum(
  AllotmentIdentifierType,
);

export const checkAllotmentBodySchema = z
  .object({
    ipoId: z.string().uuid({ message: 'ipoId must be a valid UUID' }),
    identifierType: allotmentIdentifierTypeSchema,
    identifierValue: z
      .string()
      .trim()
      .min(3, { message: 'identifierValue must be at least 3 characters' }),
    captchaToken: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.identifierType === AllotmentIdentifierType.PAN) {
        return isValidPan(data.identifierValue);
      }
      return true;
    },
    {
      message:
        'Invalid PAN format. PAN must be 10 characters (5 letters, 4 digits, 1 letter)',
      path: ['identifierValue'],
    },
  );

export type CheckAllotmentBodyDto = z.infer<typeof checkAllotmentBodySchema>;

export const createAllotmentJobBodySchema = z.object({
  ipoId: z.string().trim().min(1, { message: 'ipoId must not be empty' }),
  identifierType: allotmentIdentifierTypeSchema
    .optional()
    .default(AllotmentIdentifierType.PAN),
  identifierValues: z.array(z.string().trim().min(3)).optional(),
});

export type CreateAllotmentJobBodyDto = z.infer<
  typeof createAllotmentJobBodySchema
>;

export interface AllotmentCheckResponseDto {
  status: AllotmentStatus;
  sharesApplied?: number;
  sharesAllotted?: number;
  allotmentPrice?: number;
  amountApplied?: number;
  amountRefunded?: number;
  applicantName?: string;
  sourceCode: string;
  sourceTimestamp?: string;
  checkedAt: string;
  errorMessage?: string;
  captchaChallenge?: CaptchaChallenge;
}

export interface AllotmentJobItemResponseDto {
  id: string;
  maskedId: string;
  status: string;
  sharesApplied?: number | null;
  sharesAllotted?: number | null;
  errorMessage?: string | null;
  checkedAt?: Date | null;
}

export interface AllotmentJobResponseDto {
  id: string;
  ipoId: string;
  status: AllotmentJobStatus;
  totalChecks: number;
  processedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  progressMessage: string;
  createdAt: Date;
  updatedAt: Date;
  items: AllotmentJobItemResponseDto[];
}

export interface UserAllotmentSummaryMetricsDto {
  totalJobs: number;
  totalChecks: number;
  completedChecks: number;
  allottedChecks: number;
  notAllottedChecks: number;
  failedChecks: number;
  unknownChecks: number;
  observedAllotmentRate: string | null;
}

export interface UserAllotmentCapitalMetricsDto {
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
}

export interface UserPanAllotmentBreakdownDto {
  panId: string;
  alias: string;
  maskedPan: string;
  totalChecks: number;
  allottedChecks: number;
  notAllottedChecks: number;
  observedAllotmentRate: string | null;
}

export interface UserAllotmentIntelligenceResponseDto {
  data: {
    userId: string;
    summary: UserAllotmentSummaryMetricsDto;
    capital: UserAllotmentCapitalMetricsDto;
    panBreakdown: UserPanAllotmentBreakdownDto[];
    evaluatedAt: string;
  };
}

export interface JobAllotmentSummaryMetricsDto {
  totalChecks: number;
  processedChecks: number;
  allottedChecks: number;
  notAllottedChecks: number;
  failedChecks: number;
  unknownChecks: number;
  observedAllotmentRate: string | null;
}

export interface JobAllotmentCapitalMetricsDto {
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
}

export interface JobAccountAllotmentDetailDto {
  panId: string | null;
  alias: string | null;
  maskedPan: string;
  status: string;
  sharesApplied: number | null;
  sharesAllotted: number | null;
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
}

export interface JobAllotmentIntelligenceResponseDto {
  data: {
    jobId: string;
    ipoId: string;
    status: string;
    summary: JobAllotmentSummaryMetricsDto;
    capital: JobAllotmentCapitalMetricsDto;
    accounts: JobAccountAllotmentDetailDto[];
    evaluatedAt: string;
  };
}

export interface UserAllotmentHistorySummaryDto {
  totalDistinctPanIpoPairs: number;
  totalIposChecked: number;
  allottedCount: number;
  partiallyAllottedCount: number;
  notAllottedCount: number;
  failedCount: number;
  unknownCount: number;
  observedLatestResultRate: string | null;
  totalSharesApplied: number;
  totalSharesAllotted: number;
  totalLotsApplied: number;
  totalLotsAllotted: number;
  allotmentLotRatio: string | null;
}

export interface MonthlyTrendItemDto {
  month: string;
  totalDefinitiveResults: number;
  allottedCount: number;
  partiallyAllottedCount: number;
  notAllottedCount: number;
  observedLatestResultRate: string | null;
}

export interface UserPanHistoryBreakdownDto {
  panId: string;
  alias: string;
  maskedPan: string;
  totalIposChecked: number;
  allottedPairs: number;
  partiallyAllottedPairs: number;
  notAllottedPairs: number;
  observedLatestResultRate: string | null;
  indicativeAllottedValue: string | null;
}

export interface UserIpoHistoryItemDto {
  ipoId: string;
  symbol: string | null;
  companyName: string | null;
  overallOutcome: string;
  totalAccountsChecked: number;
  allottedAccounts: number;
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
  evaluatedAt: string;
}

export type IntelligenceQualityReason =
  | 'NO_OBSERVATIONS'
  | 'NO_DEFINITIVE_RESULTS'
  | 'UNKNOWN_RESULTS_PRESENT'
  | 'FAILED_RESULTS_PRESENT'
  | 'PARTIAL_LOT_DATA'
  | 'MISSING_LOT_SIZE'
  | 'INVALID_LOT_DATA'
  | 'PARTIAL_CAPITAL_DATA'
  | 'MISSING_PRICE_BAND'
  | 'BOUNDED_HISTORY';

export interface IntelligenceQualitySummaryDto {
  totalObservations: number;
  definitiveObservationCount: number;
  unknownObservationCount: number;
  failedObservationCount: number;
  observationCoveragePercentage: string | null;
  observationsWithValidLotData: number;
  observationsWithoutValidLotData: number;
  lotDataCoveragePercentage: string | null;
  observationsWithPriceBand: number;
  observationsWithoutPriceBand: number;
  capitalDataCoveragePercentage: string | null;
  boundedHistory: boolean;
  historyJobLimit: number | null;
  reasons: IntelligenceQualityReason[];
}

export interface UserAllotmentHistoryResponseDto {
  data: {
    userId: string;
    summary: UserAllotmentHistorySummaryDto;
    capital: UserAllotmentCapitalMetricsDto;
    panBreakdown: UserPanHistoryBreakdownDto[];
    ipoHistory: UserIpoHistoryItemDto[];
    monthlyTrend: MonthlyTrendItemDto[];
    quality: IntelligenceQualitySummaryDto;
    evaluatedAt: string;
  };
}

export interface IpoUserAllotmentSummaryDto {
  totalDistinctPanIpoPairs: number;
  allottedCount: number;
  partiallyAllottedCount: number;
  notAllottedCount: number;
  failedCount: number;
  unknownCount: number;
  overallOutcome: string;
  observedLatestResultRate: string | null;
  totalSharesApplied: number;
  totalSharesAllotted: number;
  totalLotsApplied: number;
  totalLotsAllotted: number;
  allotmentLotRatio: string | null;
}

export interface IpoAccountObservationDetailDto {
  panId: string | null;
  alias: string | null;
  maskedPan: string;
  status: string;
  sharesApplied: number | null;
  sharesAllotted: number | null;
  lotsApplied: number | null;
  lotsAllotted: number | null;
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
  checkedAt: string | null;
}

export interface IpoUserAllotmentIntelligenceResponseDto {
  data: {
    ipoId: string;
    symbol: string | null;
    companyName: string | null;
    priceBandHigh: string | null;
    lotSize: number | null;
    userSummary: IpoUserAllotmentSummaryDto;
    capital: JobAllotmentCapitalMetricsDto;
    accounts: IpoAccountObservationDetailDto[];
    quality: IntelligenceQualitySummaryDto;
    evaluatedAt: string;
  };
}

export interface UserPanIntelligenceDto {
  panId: string;
  alias: string;
  maskedPan: string;
  totalDistinctIposChecked: number;
  allottedCount: number;
  partiallyAllottedCount: number;
  notAllottedCount: number;
  unknownCount: number;
  failedCount: number;
  observedLatestResultRate: string | null;
  totalSharesApplied: number;
  totalSharesAllotted: number;
  totalLotsApplied: number;
  totalLotsAllotted: number;
  allotmentLotRatio: string | null;
  indicativeAppliedValue: string | null;
  indicativeAllottedValue: string | null;
  quality: IntelligenceQualitySummaryDto;
}

export interface UserPanIntelligenceResponseDto {
  data: {
    userId: string;
    pans: UserPanIntelligenceDto[];
    evaluatedAt: string;
  };
}
