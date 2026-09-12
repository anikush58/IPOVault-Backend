import { AllotmentResultStatus, Prisma } from '@prisma/client';
import { decimalToString } from '../ipos/ipo.mapper';
import {
  IntelligenceQualityReason,
  IntelligenceQualitySummaryDto,
  IpoAccountObservationDetailDto,
  IpoUserAllotmentIntelligenceResponseDto,
  JobAccountAllotmentDetailDto,
  JobAllotmentIntelligenceResponseDto,
  MonthlyTrendItemDto,
  UserAllotmentHistoryResponseDto,
  UserAllotmentIntelligenceResponseDto,
  UserIpoHistoryItemDto,
  UserPanAllotmentBreakdownDto,
  UserPanHistoryBreakdownDto,
  UserPanIntelligenceDto,
  UserPanIntelligenceResponseDto,
} from './dto/allotment.dto';

export type DerivedStatusCategory =
  | 'ALLOTTED'
  | 'NOT_ALLOTTED'
  | 'FAILED'
  | 'UNKNOWN';

export function categorizeAllotmentStatus(
  status: AllotmentResultStatus | string,
): DerivedStatusCategory {
  switch (status) {
    case AllotmentResultStatus.ALLOTTED:
    case AllotmentResultStatus.PARTIALLY_ALLOTTED:
    case 'ALLOTTED':
    case 'PARTIALLY_ALLOTTED':
      return 'ALLOTTED';

    case AllotmentResultStatus.NOT_ALLOTTED:
    case 'NOT_ALLOTTED':
      return 'NOT_ALLOTTED';

    case AllotmentResultStatus.SOURCE_UNAVAILABLE:
    case AllotmentResultStatus.SOURCE_RESPONSE_INVALID:
    case AllotmentResultStatus.CAPTCHA_REQUIRED:
    case AllotmentResultStatus.RATE_LIMITED:
    case AllotmentResultStatus.CONFLICTING_RESULTS:
    case AllotmentResultStatus.TEMPORARY_ERROR:
    case 'SOURCE_UNAVAILABLE':
    case 'SOURCE_RESPONSE_INVALID':
    case 'CAPTCHA_REQUIRED':
    case 'RATE_LIMITED':
    case 'CONFLICTING_RESULTS':
    case 'TEMPORARY_ERROR':
      return 'FAILED';

    case AllotmentResultStatus.NOT_YET_AVAILABLE:
    case AllotmentResultStatus.APPLICATION_NOT_FOUND:
    case AllotmentResultStatus.INVALID_IDENTIFIER:
    case AllotmentResultStatus.IPO_NOT_FOUND:
    case AllotmentResultStatus.REGISTRAR_UNRESOLVED:
    case AllotmentResultStatus.REGISTRAR_UNSUPPORTED:
    case AllotmentResultStatus.UNSUPPORTED_IDENTIFIER:
    case AllotmentResultStatus.UNKNOWN:
    case 'NOT_YET_AVAILABLE':
    case 'APPLICATION_NOT_FOUND':
    case 'INVALID_IDENTIFIER':
    case 'IPO_NOT_FOUND':
    case 'REGISTRAR_UNRESOLVED':
    case 'REGISTRAR_UNSUPPORTED':
    case 'UNSUPPORTED_IDENTIFIER':
    case 'UNKNOWN':
    default:
      return 'UNKNOWN';
  }
}

export function calculateObservedAllotmentRate(
  allotted: number,
  notAllotted: number,
): string | null {
  const denominator = allotted + notAllotted;
  if (denominator <= 0) {
    return null;
  }
  const rate = (allotted / denominator) * 100;
  return rate.toFixed(2);
}

export function calculateIndicativeValue(
  shares: number | null | undefined,
  price: Prisma.Decimal | number | string | null | undefined,
): string | null {
  if (shares === null || shares === undefined || shares <= 0) {
    return null;
  }
  if (price === null || price === undefined) {
    return null;
  }
  const priceDec =
    price instanceof Prisma.Decimal ? price : new Prisma.Decimal(price);
  if (priceDec.lte(0)) {
    return null;
  }
  return decimalToString(priceDec.mul(shares));
}

export function addIndicativeValues(
  val1: string | null,
  val2: string | null,
): string | null {
  if (val1 === null && val2 === null) return null;
  const d1 = val1 !== null ? new Prisma.Decimal(val1) : new Prisma.Decimal(0);
  const d2 = val2 !== null ? new Prisma.Decimal(val2) : new Prisma.Decimal(0);
  return decimalToString(d1.plus(d2));
}

export type JobItemWithAllotment = {
  id: string;
  identifierHash: string;
  maskedId: string;
  status: AllotmentResultStatus;
  sharesApplied: number | null;
  sharesAllotted: number | null;
  checkedAt: Date | null;
};

export type JobWithItems = {
  id: string;
  userId: string | null;
  ipoId: string;
  status: string;
  totalChecks: number;
  processedChecks: number;
  successfulChecks: number;
  failedChecks: number;
  items: JobItemWithAllotment[];
};

export type SavedPanEntity = {
  id: string;
  userId: string;
  panMasked: string;
  panHash: string;
  name: string | null;
};

export type IpoCanonicalPrice = {
  id: string;
  priceBandHigh: Prisma.Decimal | null;
};

export function aggregateUserIntelligence(params: {
  userId: string;
  jobs: JobWithItems[];
  savedPans: SavedPanEntity[];
  ipoPriceMap: Map<string, Prisma.Decimal | null>;
  evaluatedAt?: Date;
}): UserAllotmentIntelligenceResponseDto {
  const { userId, jobs, savedPans, ipoPriceMap, evaluatedAt = new Date() } = params;

  let totalChecks = 0;
  let completedChecks = 0;
  let allottedChecks = 0;
  let notAllottedChecks = 0;
  let failedChecks = 0;
  let unknownChecks = 0;

  let totalAppliedDec: Prisma.Decimal | null = null;
  let totalAllottedDec: Prisma.Decimal | null = null;

  // Build lookup for saved PANs by panHash
  const panMap = new Map<string, SavedPanEntity>();
  for (const sp of savedPans) {
    panMap.set(sp.panHash, sp);
  }

  // Track per-PAN stats
  const panStats = new Map<
    string,
    {
      panId: string;
      alias: string;
      maskedPan: string;
      totalChecks: number;
      allottedChecks: number;
      notAllottedChecks: number;
    }
  >();

  for (const sp of savedPans) {
    panStats.set(sp.id, {
      panId: sp.id,
      alias: sp.name || sp.panMasked,
      maskedPan: sp.panMasked,
      totalChecks: 0,
      allottedChecks: 0,
      notAllottedChecks: 0,
    });
  }

  for (const job of jobs) {
    const ipoPrice = ipoPriceMap.get(job.ipoId) ?? null;

    for (const item of job.items) {
      totalChecks++;
      const category = categorizeAllotmentStatus(item.status);

      if (category === 'ALLOTTED') {
        allottedChecks++;
        completedChecks++;
      } else if (category === 'NOT_ALLOTTED') {
        notAllottedChecks++;
        completedChecks++;
      } else if (category === 'FAILED') {
        failedChecks++;
      } else {
        unknownChecks++;
      }

      // Accumulate capital indicative values
      if (item.sharesApplied && ipoPrice && ipoPrice.gt(0)) {
        const itemApplied = ipoPrice.mul(item.sharesApplied);
        totalAppliedDec = totalAppliedDec ? totalAppliedDec.plus(itemApplied) : itemApplied;
      }

      if (item.sharesAllotted && ipoPrice && ipoPrice.gt(0)) {
        const itemAllotted = ipoPrice.mul(item.sharesAllotted);
        totalAllottedDec = totalAllottedDec ? totalAllottedDec.plus(itemAllotted) : itemAllotted;
      }

      // Find matching saved PAN by hash
      const matchingPan = panMap.get(item.identifierHash);
      if (matchingPan) {
        const pStat = panStats.get(matchingPan.id);
        if (pStat) {
          pStat.totalChecks++;
          if (category === 'ALLOTTED') {
            pStat.allottedChecks++;
          } else if (category === 'NOT_ALLOTTED') {
            pStat.notAllottedChecks++;
          }
        }
      }
    }
  }

  const observedAllotmentRate = calculateObservedAllotmentRate(
    allottedChecks,
    notAllottedChecks,
  );

  const panBreakdown: UserPanAllotmentBreakdownDto[] = Array.from(
    panStats.values(),
  ).map((p) => ({
    panId: p.panId,
    alias: p.alias,
    maskedPan: p.maskedPan,
    totalChecks: p.totalChecks,
    allottedChecks: p.allottedChecks,
    notAllottedChecks: p.notAllottedChecks,
    observedAllotmentRate: calculateObservedAllotmentRate(
      p.allottedChecks,
      p.notAllottedChecks,
    ),
  }));

  return {
    data: {
      userId,
      summary: {
        totalJobs: jobs.length,
        totalChecks,
        completedChecks,
        allottedChecks,
        notAllottedChecks,
        failedChecks,
        unknownChecks,
        observedAllotmentRate,
      },
      capital: {
        indicativeAppliedValue: decimalToString(totalAppliedDec),
        indicativeAllottedValue: decimalToString(totalAllottedDec),
      },
      panBreakdown,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}

export function aggregateJobIntelligence(params: {
  job: JobWithItems;
  savedPans: SavedPanEntity[];
  ipoPrice: Prisma.Decimal | null;
  evaluatedAt?: Date;
}): JobAllotmentIntelligenceResponseDto {
  const { job, savedPans, ipoPrice, evaluatedAt = new Date() } = params;

  let processedChecks = 0;
  let allottedChecks = 0;
  let notAllottedChecks = 0;
  let failedChecks = 0;
  let unknownChecks = 0;

  let totalAppliedDec: Prisma.Decimal | null = null;
  let totalAllottedDec: Prisma.Decimal | null = null;

  const panMap = new Map<string, SavedPanEntity>();
  for (const sp of savedPans) {
    panMap.set(sp.panHash, sp);
  }

  const accounts: JobAccountAllotmentDetailDto[] = [];

  for (const item of job.items) {
    const category = categorizeAllotmentStatus(item.status);

    if (category === 'ALLOTTED') {
      allottedChecks++;
      processedChecks++;
    } else if (category === 'NOT_ALLOTTED') {
      notAllottedChecks++;
      processedChecks++;
    } else if (category === 'FAILED') {
      failedChecks++;
    } else {
      unknownChecks++;
      processedChecks++;
    }

    const itemAppliedVal = calculateIndicativeValue(item.sharesApplied, ipoPrice);
    const itemAllottedVal = calculateIndicativeValue(item.sharesAllotted, ipoPrice);

    if (itemAppliedVal !== null) {
      const dec = new Prisma.Decimal(itemAppliedVal);
      totalAppliedDec = totalAppliedDec ? totalAppliedDec.plus(dec) : dec;
    }

    if (itemAllottedVal !== null) {
      const dec = new Prisma.Decimal(itemAllottedVal);
      totalAllottedDec = totalAllottedDec ? totalAllottedDec.plus(dec) : dec;
    }

    const savedPan = panMap.get(item.identifierHash);

    accounts.push({
      panId: savedPan ? savedPan.id : null,
      alias: savedPan ? savedPan.name || savedPan.panMasked : null,
      maskedPan: item.maskedId,
      status: item.status,
      sharesApplied: item.sharesApplied,
      sharesAllotted: item.sharesAllotted,
      indicativeAppliedValue: itemAppliedVal,
      indicativeAllottedValue: itemAllottedVal,
    });
  }

  const observedAllotmentRate = calculateObservedAllotmentRate(
    allottedChecks,
    notAllottedChecks,
  );

  return {
    data: {
      jobId: job.id,
      ipoId: job.ipoId,
      status: job.status,
      summary: {
        totalChecks: job.totalChecks,
        processedChecks,
        allottedChecks,
        notAllottedChecks,
        failedChecks,
        unknownChecks,
        observedAllotmentRate,
      },
      capital: {
        indicativeAppliedValue: decimalToString(totalAppliedDec),
        indicativeAllottedValue: decimalToString(totalAllottedDec),
      },
      accounts,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}

export function getStatusPriority(status: AllotmentResultStatus | string): number {
  if (
    status === AllotmentResultStatus.ALLOTTED ||
    status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
    status === 'ALLOTTED' ||
    status === 'PARTIALLY_ALLOTTED' ||
    status === AllotmentResultStatus.NOT_ALLOTTED ||
    status === 'NOT_ALLOTTED'
  ) {
    return 1; // DEFINITIVE
  }

  const category = categorizeAllotmentStatus(status);
  if (category === 'UNKNOWN') {
    return 2; // NON-DEFINITIVE / INFORMATIONAL
  }

  return 3; // FAILED
}

export function calculateLotCount(
  shares: number | null | undefined,
  lotSize: number | null | undefined,
): number | null {
  if (shares === null || shares === undefined || shares <= 0) {
    return null;
  }
  if (lotSize === null || lotSize === undefined || lotSize <= 0) {
    return null;
  }
  if (shares % lotSize !== 0) {
    return null;
  }
  return shares / lotSize;
}

export function calculateLotRatio(
  totalLotsAllotted: number,
  totalLotsApplied: number,
): string | null {
  if (totalLotsApplied <= 0) {
    return null;
  }
  const ratio = (totalLotsAllotted / totalLotsApplied) * 100;
  return ratio.toFixed(2);
}

export function calculateQualitySummary(params: {
  observations: DeduplicatedObservation[];
  ipoMap?: Map<
    string,
    {
      priceBandHigh: Prisma.Decimal | null;
      lotSize: number | null;
    }
  >;
  singleIpo?: {
    priceBandHigh: Prisma.Decimal | null;
    lotSize: number | null;
  };
  historyJobLimit?: number | null;
}): IntelligenceQualitySummaryDto {
  const { observations, ipoMap, singleIpo, historyJobLimit = 100 } = params;

  const totalObservations = observations.length;
  let definitiveObservationCount = 0;
  let unknownObservationCount = 0;
  let failedObservationCount = 0;

  let observationsWithValidLotData = 0;
  let observationsWithPriceBand = 0;

  let hasMissingLotSize = false;
  let hasInvalidLotData = false;
  let hasMissingPriceBand = false;

  for (const obs of observations) {
    if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
      definitiveObservationCount++;
    } else if (
      obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
      obs.status === 'PARTIALLY_ALLOTTED'
    ) {
      definitiveObservationCount++;
    } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
      definitiveObservationCount++;
    } else {
      const category = categorizeAllotmentStatus(obs.status);
      if (category === 'FAILED') {
        failedObservationCount++;
      } else {
        unknownObservationCount++;
      }
    }

    const lotSize = singleIpo ? singleIpo.lotSize : ipoMap?.get(obs.ipoId)?.lotSize ?? null;
    const priceHigh = singleIpo ? singleIpo.priceBandHigh : ipoMap?.get(obs.ipoId)?.priceBandHigh ?? null;

    if (priceHigh && priceHigh.gt(0)) {
      observationsWithPriceBand++;
    } else {
      hasMissingPriceBand = true;
    }

    if (!lotSize || lotSize <= 0) {
      hasMissingLotSize = true;
    }

    const appLots = calculateLotCount(obs.sharesApplied, lotSize);
    if (appLots !== null) {
      observationsWithValidLotData++;
    } else if (obs.sharesApplied && obs.sharesApplied > 0) {
      hasInvalidLotData = true;
    }
  }

  const observationCoveragePercentage =
    totalObservations > 0
      ? ((definitiveObservationCount / totalObservations) * 100).toFixed(2)
      : null;

  const lotDataCoveragePercentage =
    totalObservations > 0
      ? ((observationsWithValidLotData / totalObservations) * 100).toFixed(2)
      : null;

  const capitalDataCoveragePercentage =
    totalObservations > 0
      ? ((observationsWithPriceBand / totalObservations) * 100).toFixed(2)
      : null;

  const observationsWithoutValidLotData = totalObservations - observationsWithValidLotData;
  const observationsWithoutPriceBand = totalObservations - observationsWithPriceBand;

  const reasons: IntelligenceQualityReason[] = [];

  if (totalObservations === 0) {
    reasons.push('NO_OBSERVATIONS');
  } else {
    if (definitiveObservationCount === 0) {
      reasons.push('NO_DEFINITIVE_RESULTS');
    }
    if (unknownObservationCount > 0) {
      reasons.push('UNKNOWN_RESULTS_PRESENT');
    }
    if (failedObservationCount > 0) {
      reasons.push('FAILED_RESULTS_PRESENT');
    }
    if (observationsWithValidLotData < totalObservations) {
      reasons.push('PARTIAL_LOT_DATA');
    }
    if (hasMissingLotSize) {
      reasons.push('MISSING_LOT_SIZE');
    }
    if (hasInvalidLotData) {
      reasons.push('INVALID_LOT_DATA');
    }
    if (observationsWithPriceBand < totalObservations) {
      reasons.push('PARTIAL_CAPITAL_DATA');
    }
    if (hasMissingPriceBand) {
      reasons.push('MISSING_PRICE_BAND');
    }
  }

  reasons.push('BOUNDED_HISTORY');

  return {
    totalObservations,
    definitiveObservationCount,
    unknownObservationCount,
    failedObservationCount,
    observationCoveragePercentage,
    observationsWithValidLotData,
    observationsWithoutValidLotData,
    lotDataCoveragePercentage,
    observationsWithPriceBand,
    observationsWithoutPriceBand,
    capitalDataCoveragePercentage,
    boundedHistory: true,
    historyJobLimit,
    reasons,
  };
}

export type DeduplicatedObservation = {
  ipoId: string;
  identifierHash: string;
  maskedId: string;
  status: AllotmentResultStatus | string;
  sharesApplied: number | null;
  sharesAllotted: number | null;
  checkedAt: Date | null;
  jobCreatedAt: Date;
};

export type DeduplicatedObservationMap = Map<string, DeduplicatedObservation>;

export function deduplicateObservations(jobs: JobWithItems[]): DeduplicatedObservationMap {
  const map: DeduplicatedObservationMap = new Map();

  for (const job of jobs) {
    const jobCreatedAt = (job as any).createdAt ? new Date((job as any).createdAt) : new Date(0);

    for (const item of job.items) {
      const key = `${job.ipoId}:${item.identifierHash}`;
      const existing = map.get(key);

      const itemCheckedAt = item.checkedAt ? new Date(item.checkedAt) : null;
      const candidate: DeduplicatedObservation = {
        ipoId: job.ipoId,
        identifierHash: item.identifierHash,
        maskedId: item.maskedId,
        status: item.status,
        sharesApplied: item.sharesApplied,
        sharesAllotted: item.sharesAllotted,
        checkedAt: itemCheckedAt,
        jobCreatedAt,
      };

      if (!existing) {
        map.set(key, candidate);
        continue;
      }

      const existingPriority = getStatusPriority(existing.status);
      const candidatePriority = getStatusPriority(candidate.status);

      let replace = false;
      if (candidatePriority < existingPriority) {
        replace = true;
      } else if (candidatePriority === existingPriority) {
        const existingTime = existing.checkedAt
          ? existing.checkedAt.getTime()
          : existing.jobCreatedAt.getTime();
        const candidateTime = candidate.checkedAt
          ? candidate.checkedAt.getTime()
          : candidate.jobCreatedAt.getTime();

        if (candidateTime > existingTime) {
          replace = true;
        } else if (candidateTime === existingTime) {
          if (candidate.jobCreatedAt.getTime() >= existing.jobCreatedAt.getTime()) {
            replace = true;
          }
        }
      }

      if (replace) {
        map.set(key, candidate);
      }
    }
  }

  return map;
}

export function aggregateUserHistoryIntelligence(params: {
  userId: string;
  jobs: JobWithItems[];
  savedPans: SavedPanEntity[];
  ipoMap: Map<
    string,
    {
      symbol: string | null;
      companyName: string | null;
      priceBandHigh: Prisma.Decimal | null;
      lotSize: number | null;
    }
  >;
  evaluatedAt?: Date;
}): UserAllotmentHistoryResponseDto {
  const { userId, jobs, savedPans, ipoMap, evaluatedAt = new Date() } = params;

  const dedupMap = deduplicateObservations(jobs);
  const observations = Array.from(dedupMap.values());

  const distinctIpoIds = new Set<string>();
  let allottedCount = 0;
  let partiallyAllottedCount = 0;
  let notAllottedCount = 0;
  let failedCount = 0;
  let unknownCount = 0;

  let totalSharesApplied = 0;
  let totalSharesAllotted = 0;
  let totalLotsApplied = 0;
  let totalLotsAllotted = 0;

  let totalAppliedDec: Prisma.Decimal | null = null;
  let totalAllottedDec: Prisma.Decimal | null = null;

  const panMap = new Map<string, SavedPanEntity>();
  for (const sp of savedPans) {
    panMap.set(sp.panHash, sp);
  }

  const panStats = new Map<
    string,
    {
      panId: string;
      alias: string;
      maskedPan: string;
      ipoIds: Set<string>;
      allottedPairs: number;
      partiallyAllottedPairs: number;
      notAllottedPairs: number;
      totalAllottedDec: Prisma.Decimal | null;
    }
  >();

  for (const sp of savedPans) {
    panStats.set(sp.id, {
      panId: sp.id,
      alias: sp.name || sp.panMasked,
      maskedPan: sp.panMasked,
      ipoIds: new Set<string>(),
      allottedPairs: 0,
      partiallyAllottedPairs: 0,
      notAllottedPairs: 0,
      totalAllottedDec: null,
    });
  }

  const ipoStats = new Map<
    string,
    {
      ipoId: string;
      symbol: string | null;
      companyName: string | null;
      totalAccounts: number;
      allottedAccounts: number;
      partiallyAllottedAccounts: number;
      notAllottedAccounts: number;
      appliedDec: Prisma.Decimal | null;
      allottedDec: Prisma.Decimal | null;
      latestEvaluatedAt: Date;
    }
  >();

  const monthlyStats = new Map<
    string,
    {
      month: string;
      allottedCount: number;
      partiallyAllottedCount: number;
      notAllottedCount: number;
    }
  >();

  for (const obs of observations) {
    distinctIpoIds.add(obs.ipoId);

    const ipoMeta = ipoMap.get(obs.ipoId);
    const priceHigh = ipoMeta?.priceBandHigh ?? null;
    const lotSize = ipoMeta?.lotSize ?? null;

    if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
      allottedCount++;
    } else if (
      obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
      obs.status === 'PARTIALLY_ALLOTTED'
    ) {
      partiallyAllottedCount++;
    } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
      notAllottedCount++;
    } else {
      const category = categorizeAllotmentStatus(obs.status);
      if (category === 'FAILED') {
        failedCount++;
      } else {
        unknownCount++;
      }
    }

    if (obs.sharesApplied && obs.sharesApplied > 0) {
      totalSharesApplied += obs.sharesApplied;
    }

    if (obs.sharesAllotted && obs.sharesAllotted > 0) {
      totalSharesAllotted += obs.sharesAllotted;
    }

    const appLots = calculateLotCount(obs.sharesApplied, lotSize);
    if (appLots !== null) {
      totalLotsApplied += appLots;
    }

    const allLots = calculateLotCount(obs.sharesAllotted, lotSize);
    if (allLots !== null) {
      totalLotsAllotted += allLots;
    }

    const appliedValStr = calculateIndicativeValue(obs.sharesApplied, priceHigh);
    const allottedValStr = calculateIndicativeValue(obs.sharesAllotted, priceHigh);

    if (appliedValStr !== null) {
      const dec = new Prisma.Decimal(appliedValStr);
      totalAppliedDec = totalAppliedDec ? totalAppliedDec.plus(dec) : dec;
    }

    if (allottedValStr !== null) {
      const dec = new Prisma.Decimal(allottedValStr);
      totalAllottedDec = totalAllottedDec ? totalAllottedDec.plus(dec) : dec;
    }

    const matchingPan = panMap.get(obs.identifierHash);
    if (matchingPan) {
      const pStat = panStats.get(matchingPan.id);
      if (pStat) {
        pStat.ipoIds.add(obs.ipoId);
        if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
          pStat.allottedPairs++;
        } else if (
          obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
          obs.status === 'PARTIALLY_ALLOTTED'
        ) {
          pStat.partiallyAllottedPairs++;
        } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
          pStat.notAllottedPairs++;
        }

        if (allottedValStr !== null) {
          const dec = new Prisma.Decimal(allottedValStr);
          pStat.totalAllottedDec = pStat.totalAllottedDec
            ? pStat.totalAllottedDec.plus(dec)
            : dec;
        }
      }
    }

    let iStat = ipoStats.get(obs.ipoId);
    if (!iStat) {
      iStat = {
        ipoId: obs.ipoId,
        symbol: ipoMeta?.symbol ?? null,
        companyName: ipoMeta?.companyName ?? null,
        totalAccounts: 0,
        allottedAccounts: 0,
        partiallyAllottedAccounts: 0,
        notAllottedAccounts: 0,
        appliedDec: null,
        allottedDec: null,
        latestEvaluatedAt: obs.checkedAt || obs.jobCreatedAt,
      };
      ipoStats.set(obs.ipoId, iStat);
    }

    iStat.totalAccounts++;
    if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
      iStat.allottedAccounts++;
    } else if (
      obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
      obs.status === 'PARTIALLY_ALLOTTED'
    ) {
      iStat.partiallyAllottedAccounts++;
    } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
      iStat.notAllottedAccounts++;
    }

    if (appliedValStr !== null) {
      const dec = new Prisma.Decimal(appliedValStr);
      iStat.appliedDec = iStat.appliedDec ? iStat.appliedDec.plus(dec) : dec;
    }
    if (allottedValStr !== null) {
      const dec = new Prisma.Decimal(allottedValStr);
      iStat.allottedDec = iStat.allottedDec ? iStat.allottedDec.plus(dec) : dec;
    }

    const obsDate = obs.checkedAt || obs.jobCreatedAt;
    if (obsDate > iStat.latestEvaluatedAt) {
      iStat.latestEvaluatedAt = obsDate;
    }

    if (obsDate) {
      const year = obsDate.getUTCFullYear();
      const monthNum = String(obsDate.getUTCMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${monthNum}`;

      let mStat = monthlyStats.get(monthKey);
      if (!mStat) {
        mStat = {
          month: monthKey,
          allottedCount: 0,
          partiallyAllottedCount: 0,
          notAllottedCount: 0,
        };
        monthlyStats.set(monthKey, mStat);
      }

      if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
        mStat.allottedCount++;
      } else if (
        obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
        obs.status === 'PARTIALLY_ALLOTTED'
      ) {
        mStat.partiallyAllottedCount++;
      } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
        mStat.notAllottedCount++;
      }
    }
  }

  const observedLatestResultRate = calculateObservedAllotmentRate(
    allottedCount + partiallyAllottedCount,
    notAllottedCount,
  );

  const panBreakdown: UserPanHistoryBreakdownDto[] = Array.from(panStats.values()).map(
    (p) => ({
      panId: p.panId,
      alias: p.alias,
      maskedPan: p.maskedPan,
      totalIposChecked: p.ipoIds.size,
      allottedPairs: p.allottedPairs,
      partiallyAllottedPairs: p.partiallyAllottedPairs,
      notAllottedPairs: p.notAllottedPairs,
      observedLatestResultRate: calculateObservedAllotmentRate(
        p.allottedPairs + p.partiallyAllottedPairs,
        p.notAllottedPairs,
      ),
      indicativeAllottedValue: decimalToString(p.totalAllottedDec),
    }),
  );

  const ipoHistory: UserIpoHistoryItemDto[] = Array.from(ipoStats.values()).map((i) => {
    let overallOutcome = 'UNKNOWN';
    if (i.allottedAccounts > 0 && i.notAllottedAccounts === 0 && i.partiallyAllottedAccounts === 0) {
      overallOutcome = 'ALLOTTED';
    } else if (i.allottedAccounts > 0 || i.partiallyAllottedAccounts > 0) {
      overallOutcome = 'PARTIALLY_ALLOTTED';
    } else if (i.notAllottedAccounts > 0) {
      overallOutcome = 'NOT_ALLOTTED';
    }

    return {
      ipoId: i.ipoId,
      symbol: i.symbol,
      companyName: i.companyName,
      overallOutcome,
      totalAccountsChecked: i.totalAccounts,
      allottedAccounts: i.allottedAccounts + i.partiallyAllottedAccounts,
      indicativeAppliedValue: decimalToString(i.appliedDec),
      indicativeAllottedValue: decimalToString(i.allottedDec),
      evaluatedAt: i.latestEvaluatedAt.toISOString(),
    };
  });

  const monthlyTrend: MonthlyTrendItemDto[] = Array.from(monthlyStats.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => {
      const totalDefinitiveResults = m.allottedCount + m.partiallyAllottedCount + m.notAllottedCount;
      return {
        month: m.month,
        totalDefinitiveResults,
        allottedCount: m.allottedCount,
        partiallyAllottedCount: m.partiallyAllottedCount,
        notAllottedCount: m.notAllottedCount,
        observedLatestResultRate: calculateObservedAllotmentRate(
          m.allottedCount + m.partiallyAllottedCount,
          m.notAllottedCount,
        ),
      };
    });

  const quality = calculateQualitySummary({
    observations,
    ipoMap,
    historyJobLimit: 100,
  });

  return {
    data: {
      userId,
      summary: {
        totalDistinctPanIpoPairs: observations.length,
        totalIposChecked: distinctIpoIds.size,
        allottedCount,
        partiallyAllottedCount,
        notAllottedCount,
        failedCount,
        unknownCount,
        observedLatestResultRate,
        totalSharesApplied,
        totalSharesAllotted,
        totalLotsApplied,
        totalLotsAllotted,
        allotmentLotRatio: calculateLotRatio(totalLotsAllotted, totalLotsApplied),
      },
      capital: {
        indicativeAppliedValue: decimalToString(totalAppliedDec),
        indicativeAllottedValue: decimalToString(totalAllottedDec),
      },
      panBreakdown,
      ipoHistory,
      monthlyTrend,
      quality,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}

export function aggregateIpoIntelligence(params: {
  ipo: {
    id: string;
    symbol: string | null;
    companyName: string | null;
    priceBandHigh: Prisma.Decimal | null;
    lotSize: number | null;
  };
  jobs: JobWithItems[];
  savedPans: SavedPanEntity[];
  evaluatedAt?: Date;
}): IpoUserAllotmentIntelligenceResponseDto {
  const { ipo, jobs, savedPans, evaluatedAt = new Date() } = params;

  const dedupMap = deduplicateObservations(jobs);
  const observations = Array.from(dedupMap.values()).filter(
    (obs) => obs.ipoId === ipo.id,
  );

  let allottedCount = 0;
  let partiallyAllottedCount = 0;
  let notAllottedCount = 0;
  let failedCount = 0;
  let unknownCount = 0;

  let totalSharesApplied = 0;
  let totalSharesAllotted = 0;
  let totalLotsApplied = 0;
  let totalLotsAllotted = 0;

  let totalAppliedDec: Prisma.Decimal | null = null;
  let totalAllottedDec: Prisma.Decimal | null = null;

  const panMap = new Map<string, SavedPanEntity>();
  for (const sp of savedPans) {
    panMap.set(sp.panHash, sp);
  }

  const accounts: IpoAccountObservationDetailDto[] = [];

  for (const obs of observations) {
    if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
      allottedCount++;
    } else if (
      obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
      obs.status === 'PARTIALLY_ALLOTTED'
    ) {
      partiallyAllottedCount++;
    } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
      notAllottedCount++;
    } else {
      const category = categorizeAllotmentStatus(obs.status);
      if (category === 'FAILED') {
        failedCount++;
      } else {
        unknownCount++;
      }
    }

    const sharesApp = obs.sharesApplied ?? null;
    const sharesAll = obs.sharesAllotted ?? null;

    if (sharesApp && sharesApp > 0) {
      totalSharesApplied += sharesApp;
    }

    if (sharesAll && sharesAll > 0) {
      totalSharesAllotted += sharesAll;
    }

    const appLots = calculateLotCount(sharesApp, ipo.lotSize);
    if (appLots !== null) {
      totalLotsApplied += appLots;
    }

    const allLots = calculateLotCount(sharesAll, ipo.lotSize);
    if (allLots !== null) {
      totalLotsAllotted += allLots;
    }

    const appliedValStr = calculateIndicativeValue(sharesApp, ipo.priceBandHigh);
    const allottedValStr = calculateIndicativeValue(sharesAll, ipo.priceBandHigh);

    if (appliedValStr !== null) {
      const dec = new Prisma.Decimal(appliedValStr);
      totalAppliedDec = totalAppliedDec ? totalAppliedDec.plus(dec) : dec;
    }

    if (allottedValStr !== null) {
      const dec = new Prisma.Decimal(allottedValStr);
      totalAllottedDec = totalAllottedDec ? totalAllottedDec.plus(dec) : dec;
    }

    const savedPan = panMap.get(obs.identifierHash);

    accounts.push({
      panId: savedPan ? savedPan.id : null,
      alias: savedPan ? savedPan.name || savedPan.panMasked : null,
      maskedPan: obs.maskedId,
      status: String(obs.status),
      sharesApplied: sharesApp,
      sharesAllotted: sharesAll,
      lotsApplied: appLots,
      lotsAllotted: allLots,
      indicativeAppliedValue: appliedValStr,
      indicativeAllottedValue: allottedValStr,
      checkedAt: obs.checkedAt ? obs.checkedAt.toISOString() : null,
    });
  }

  let overallOutcome = 'UNKNOWN';
  if (allottedCount > 0 && notAllottedCount === 0 && partiallyAllottedCount === 0) {
    overallOutcome = 'ALLOTTED';
  } else if (allottedCount > 0 || partiallyAllottedCount > 0) {
    overallOutcome = 'PARTIALLY_ALLOTTED';
  } else if (notAllottedCount > 0) {
    overallOutcome = 'NOT_ALLOTTED';
  }

  const observedLatestResultRate = calculateObservedAllotmentRate(
    allottedCount + partiallyAllottedCount,
    notAllottedCount,
  );

  const quality = calculateQualitySummary({
    observations,
    singleIpo: ipo,
    historyJobLimit: 50,
  });

  return {
    data: {
      ipoId: ipo.id,
      symbol: ipo.symbol,
      companyName: ipo.companyName,
      priceBandHigh: decimalToString(ipo.priceBandHigh),
      lotSize: ipo.lotSize,
      userSummary: {
        totalDistinctPanIpoPairs: observations.length,
        allottedCount,
        partiallyAllottedCount,
        notAllottedCount,
        failedCount,
        unknownCount,
        overallOutcome,
        observedLatestResultRate,
        totalSharesApplied,
        totalSharesAllotted,
        totalLotsApplied,
        totalLotsAllotted,
        allotmentLotRatio: calculateLotRatio(totalLotsAllotted, totalLotsApplied),
      },
      capital: {
        indicativeAppliedValue: decimalToString(totalAppliedDec),
        indicativeAllottedValue: decimalToString(totalAllottedDec),
      },
      accounts,
      quality,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}

export function aggregatePanIntelligence(params: {
  userId: string;
  jobs: JobWithItems[];
  savedPans: SavedPanEntity[];
  ipoMap: Map<
    string,
    {
      symbol: string | null;
      companyName: string | null;
      priceBandHigh: Prisma.Decimal | null;
      lotSize: number | null;
    }
  >;
  evaluatedAt?: Date;
}): UserPanIntelligenceResponseDto {
  const { userId, jobs, savedPans, ipoMap, evaluatedAt = new Date() } = params;

  const dedupMap = deduplicateObservations(jobs);
  const observations = Array.from(dedupMap.values());

  const panObsMap = new Map<string, DeduplicatedObservation[]>();
  for (const obs of observations) {
    let list = panObsMap.get(obs.identifierHash);
    if (!list) {
      list = [];
      panObsMap.set(obs.identifierHash, list);
    }
    list.push(obs);
  }

  const panDtos: UserPanIntelligenceDto[] = savedPans.map((sp) => {
    const obsList = panObsMap.get(sp.panHash) || [];

    const distinctIpoIds = new Set<string>();
    let allottedCount = 0;
    let partiallyAllottedCount = 0;
    let notAllottedCount = 0;
    let failedCount = 0;
    let unknownCount = 0;

    let totalSharesApplied = 0;
    let totalSharesAllotted = 0;
    let totalLotsApplied = 0;
    let totalLotsAllotted = 0;

    let totalAppliedDec: Prisma.Decimal | null = null;
    let totalAllottedDec: Prisma.Decimal | null = null;

    for (const obs of obsList) {
      distinctIpoIds.add(obs.ipoId);
      const ipoMeta = ipoMap.get(obs.ipoId);
      const priceHigh = ipoMeta?.priceBandHigh ?? null;
      const lotSize = ipoMeta?.lotSize ?? null;

      if (obs.status === AllotmentResultStatus.ALLOTTED || obs.status === 'ALLOTTED') {
        allottedCount++;
      } else if (
        obs.status === AllotmentResultStatus.PARTIALLY_ALLOTTED ||
        obs.status === 'PARTIALLY_ALLOTTED'
      ) {
        partiallyAllottedCount++;
      } else if (obs.status === AllotmentResultStatus.NOT_ALLOTTED || obs.status === 'NOT_ALLOTTED') {
        notAllottedCount++;
      } else {
        const category = categorizeAllotmentStatus(obs.status);
        if (category === 'FAILED') {
          failedCount++;
        } else {
          unknownCount++;
        }
      }

      if (obs.sharesApplied && obs.sharesApplied > 0) {
        totalSharesApplied += obs.sharesApplied;
      }
      if (obs.sharesAllotted && obs.sharesAllotted > 0) {
        totalSharesAllotted += obs.sharesAllotted;
      }

      const appLots = calculateLotCount(obs.sharesApplied, lotSize);
      if (appLots !== null) {
        totalLotsApplied += appLots;
      }
      const allLots = calculateLotCount(obs.sharesAllotted, lotSize);
      if (allLots !== null) {
        totalLotsAllotted += allLots;
      }

      const appliedValStr = calculateIndicativeValue(obs.sharesApplied, priceHigh);
      const allottedValStr = calculateIndicativeValue(obs.sharesAllotted, priceHigh);

      if (appliedValStr !== null) {
        const dec = new Prisma.Decimal(appliedValStr);
        totalAppliedDec = totalAppliedDec ? totalAppliedDec.plus(dec) : dec;
      }
      if (allottedValStr !== null) {
        const dec = new Prisma.Decimal(allottedValStr);
        totalAllottedDec = totalAllottedDec ? totalAllottedDec.plus(dec) : dec;
      }
    }

    const panQuality = calculateQualitySummary({
      observations: obsList,
      ipoMap,
      historyJobLimit: 100,
    });

    return {
      panId: sp.id,
      alias: sp.name || sp.panMasked,
      maskedPan: sp.panMasked,
      totalDistinctIposChecked: distinctIpoIds.size,
      allottedCount,
      partiallyAllottedCount,
      notAllottedCount,
      unknownCount,
      failedCount,
      observedLatestResultRate: calculateObservedAllotmentRate(
        allottedCount + partiallyAllottedCount,
        notAllottedCount,
      ),
      totalSharesApplied,
      totalSharesAllotted,
      totalLotsApplied,
      totalLotsAllotted,
      allotmentLotRatio: calculateLotRatio(totalLotsAllotted, totalLotsApplied),
      indicativeAppliedValue: decimalToString(totalAppliedDec),
      indicativeAllottedValue: decimalToString(totalAllottedDec),
      quality: panQuality,
    };
  });

  return {
    data: {
      userId,
      pans: panDtos,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}
