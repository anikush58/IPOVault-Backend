import { Prisma } from '@prisma/client';

import {
  IpoAnalyticsMetricsDto,
  IpoAnalyticsResponseDto,
  IssueCompositionEnum,
} from './ipo.dto';
import { IpoWithRelations } from './ipo.types';
import { decimalToString } from './ipo.mapper';

export function dateDiffInDays(eventDate: Date, refDate: Date): number {
  const eventUTC = Date.UTC(
    eventDate.getUTCFullYear(),
    eventDate.getUTCMonth(),
    eventDate.getUTCDate(),
  );
  const refUTC = Date.UTC(
    refDate.getUTCFullYear(),
    refDate.getUTCMonth(),
    refDate.getUTCDate(),
  );
  return Math.round((eventUTC - refUTC) / (1000 * 60 * 60 * 24));
}

export function deriveIssueComposition(ipo: {
  issueSize: Prisma.Decimal | null;
  freshIssueSize: Prisma.Decimal | null;
  ofsSize: Prisma.Decimal | null;
  issueShareCount: Prisma.Decimal | null;
  freshIssueShareCount: Prisma.Decimal | null;
  ofsShareCount: Prisma.Decimal | null;
}): IssueCompositionEnum {
  const hasFreshSize = ipo.freshIssueSize !== null && ipo.freshIssueSize.gt(0);
  const hasOfsSize = ipo.ofsSize !== null && ipo.ofsSize.gt(0);
  const hasFreshShares =
    ipo.freshIssueShareCount !== null && ipo.freshIssueShareCount.gt(0);
  const hasOfsShares =
    ipo.ofsShareCount !== null && ipo.ofsShareCount.gt(0);

  const isFresh = hasFreshSize || hasFreshShares;
  const isOfs = hasOfsSize || hasOfsShares;

  if (isFresh && isOfs) {
    return 'FRESH_AND_OFS';
  }

  const zeroOfsSize = ipo.ofsSize !== null && ipo.ofsSize.eq(0);
  const zeroOfsShares = ipo.ofsShareCount !== null && ipo.ofsShareCount.eq(0);
  const freshEqualsTotal =
    hasFreshSize &&
    ipo.issueSize !== null &&
    ipo.freshIssueSize!.eq(ipo.issueSize);

  if (
    isFresh &&
    (zeroOfsSize ||
      zeroOfsShares ||
      freshEqualsTotal ||
      (!hasOfsSize && !hasOfsShares && ipo.issueSize !== null))
  ) {
    return 'FRESH_ONLY';
  }

  const zeroFreshSize =
    ipo.freshIssueSize !== null && ipo.freshIssueSize.eq(0);
  const zeroFreshShares =
    ipo.freshIssueShareCount !== null && ipo.freshIssueShareCount.eq(0);
  const ofsEqualsTotal =
    hasOfsSize && ipo.issueSize !== null && ipo.ofsSize!.eq(ipo.issueSize);

  if (
    isOfs &&
    (zeroFreshSize ||
      zeroFreshShares ||
      ofsEqualsTotal ||
      (!hasFreshSize && !hasFreshShares && ipo.issueSize !== null))
  ) {
    return 'OFS_ONLY';
  }

  return 'UNKNOWN';
}

export function calculateIpoAnalytics(
  ipo: IpoWithRelations,
  evaluatedAt: Date = new Date(),
): IpoAnalyticsResponseDto {
  // A. Issue Structure Percentages
  let freshIssuePercentage: string | null = null;
  if (
    ipo.issueSize !== null &&
    ipo.issueSize.gt(0) &&
    ipo.freshIssueSize !== null
  ) {
    freshIssuePercentage = decimalToString(
      ipo.freshIssueSize.div(ipo.issueSize).mul(100),
    );
  }

  let ofsPercentage: string | null = null;
  if (
    ipo.issueSize !== null &&
    ipo.issueSize.gt(0) &&
    ipo.ofsSize !== null
  ) {
    ofsPercentage = decimalToString(
      ipo.ofsSize.div(ipo.issueSize).mul(100),
    );
  }

  let freshIssueSharePercentage: string | null = null;
  if (
    ipo.issueShareCount !== null &&
    ipo.issueShareCount.gt(0) &&
    ipo.freshIssueShareCount !== null
  ) {
    freshIssueSharePercentage = decimalToString(
      ipo.freshIssueShareCount.div(ipo.issueShareCount).mul(100),
    );
  }

  let ofsSharePercentage: string | null = null;
  if (
    ipo.issueShareCount !== null &&
    ipo.issueShareCount.gt(0) &&
    ipo.ofsShareCount !== null
  ) {
    ofsSharePercentage = decimalToString(
      ipo.ofsShareCount.div(ipo.issueShareCount).mul(100),
    );
  }

  // B. Price / Issue Value
  let priceBandSpread: string | null = null;
  let priceBandSpreadPercentage: string | null = null;
  if (
    ipo.priceBandLow !== null &&
    ipo.priceBandHigh !== null &&
    ipo.priceBandLow.gt(0)
  ) {
    const diff = ipo.priceBandHigh.minus(ipo.priceBandLow);
    priceBandSpread = decimalToString(diff);
    priceBandSpreadPercentage = decimalToString(
      diff.div(ipo.priceBandLow).mul(100),
    );
  }

  // C. Application Size
  let minimumApplicationAmount: string | null = null;
  if (
    ipo.priceBandHigh !== null &&
    ipo.priceBandHigh.gt(0) &&
    ipo.lotSize !== null &&
    ipo.lotSize > 0 &&
    ipo.minimumLots !== null &&
    ipo.minimumLots > 0
  ) {
    const totalAmount = ipo.priceBandHigh
      .mul(ipo.lotSize)
      .mul(ipo.minimumLots);
    minimumApplicationAmount = decimalToString(totalAmount);
  }

  // D. Issue Composition
  const issueComposition = deriveIssueComposition(ipo);

  // E. Lifecycle Date Differences
  let daysToOpen: number | null = null;
  let daysToClose: number | null = null;
  let daysToListing: number | null = null;

  for (const event of ipo.lifecycleEvents ?? []) {
    if (event.eventType === 'OPEN') {
      daysToOpen = dateDiffInDays(event.eventDate, evaluatedAt);
    } else if (event.eventType === 'CLOSE') {
      daysToClose = dateDiffInDays(event.eventDate, evaluatedAt);
    } else if (event.eventType === 'LISTING') {
      daysToListing = dateDiffInDays(event.eventDate, evaluatedAt);
    }
  }

  const metrics: IpoAnalyticsMetricsDto = {
    freshIssuePercentage,
    ofsPercentage,
    freshIssueSharePercentage,
    ofsSharePercentage,
    priceBandSpread,
    priceBandSpreadPercentage,
    minimumApplicationAmount,
    issueComposition,
    daysToOpen,
    daysToClose,
    daysToListing,
  };

  return {
    data: {
      ipoId: ipo.id,
      metrics,
      evaluatedAt: evaluatedAt.toISOString(),
    },
  };
}
