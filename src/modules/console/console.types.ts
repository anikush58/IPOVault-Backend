export interface ConsoleDashboardSummaryDto {
  ipoCounts: {
    total: number;
    upcoming: number;
    open: number;
    closed: number;
    listingSoon: number;
    withdrawn: number;
    cancelled: number;
  };
  marketBreakdown: {
    mainboard: number;
    sme: number;
  };
  exchangeBreakdown: {
    nse: number;
    bse: number;
    both: number;
  };
  dataQuality: {
    totalEvaluated: number;
    complete: number;
    partial: number;
    insufficientData: number;
    unavailable: number;
    needsReview: number;
  };
  sourceHealth: {
    totalSources: number;
    activeSources: number;
    healthyCount: number;
    degradedCount: number;
  };
  notifications: {
    totalDeliveries: number;
    deliveredCount: number;
    failedCount: number;
    pendingCount: number;
    processingCount: number;
    deliverySuccessRatePercentage: number;
  };
  allotment: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    processingJobs: number;
    totalObservations: number;
    positiveAllotments: number;
  };
}

export interface ConsoleIpoListQueryDto {
  q?: string;
  status?: string;
  marketSegment?: string;
  exchange?: string;
  page?: number;
  limit?: number;
}

export interface ConsoleSourceHealthItemDto {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  isActive: boolean;
  totalRecords: number;
  lastObservationAt?: string;
  healthState: 'HEALTHY' | 'DEGRADED' | 'INACTIVE';
}

export interface ConsoleSourceHealthResponseDto {
  sources: ConsoleSourceHealthItemDto[];
  totalSources: number;
  activeSources: number;
}

export interface ConsoleDataQualitySummaryDto {
  evaluatedCount: number;
  statusBreakdown: {
    COMPLETE: number;
    PARTIAL: number;
    INSUFFICIENT_DATA: number;
    UNAVAILABLE: number;
    NEEDS_REVIEW: number;
  };
  averageCompletenessPercentage: number;
  overallQualityGateStatus: string;
}
