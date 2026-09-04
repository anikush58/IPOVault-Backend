import { Prisma, SourceType } from '@prisma/client';

import { DiscoveredIpoAttributes } from './discovery.types';

export const CanonicalDimension = {
  SHARES: 'SHARES',
  INR: 'INR',
} as const;

export type CanonicalDimension =
  (typeof CanonicalDimension)[keyof typeof CanonicalDimension];

export const IssueStructureField = {
  ISSUE_SIZE: 'issue_size',
  FRESH_ISSUE_SIZE: 'fresh_issue_size',
  OFS_SIZE: 'ofs_size',
  ISSUE_SHARE_COUNT: 'issue_share_count',
  FRESH_ISSUE_SHARE_COUNT: 'fresh_issue_share_count',
  OFS_SHARE_COUNT: 'ofs_share_count',
} as const;

export type IssueStructureField =
  (typeof IssueStructureField)[keyof typeof IssueStructureField];

export const ISSUE_STRUCTURE_DIMENSION = {
  issue_size: CanonicalDimension.INR,
  fresh_issue_size: CanonicalDimension.INR,
  ofs_size: CanonicalDimension.INR,
  issue_share_count: CanonicalDimension.SHARES,
  fresh_issue_share_count: CanonicalDimension.SHARES,
  ofs_share_count: CanonicalDimension.SHARES,
} as const satisfies Record<IssueStructureField, CanonicalDimension>;

export const ISSUE_STRUCTURE_PRISMA_FIELD = {
  issue_size: 'issueSize',
  fresh_issue_size: 'freshIssueSize',
  ofs_size: 'ofsSize',
  issue_share_count: 'issueShareCount',
  fresh_issue_share_count: 'freshIssueShareCount',
  ofs_share_count: 'ofsShareCount',
} as const satisfies Record<IssueStructureField, keyof IssueStructureValues>;

export type IssueStructureFact = {
  field: IssueStructureField;
  dimension: CanonicalDimension;
  value: string;
};

export type IssueStructureValues = {
  issueSize: Prisma.Decimal | null;
  freshIssueSize: Prisma.Decimal | null;
  ofsSize: Prisma.Decimal | null;
  issueShareCount: Prisma.Decimal | null;
  freshIssueShareCount: Prisma.Decimal | null;
  ofsShareCount: Prisma.Decimal | null;
};

export type IssueStructureIgnoreReason =
  'dimension' | 'not-allowed' | 'lower-authority';

export type IssueStructureDecision =
  | { field: IssueStructureField; action: 'apply'; value: string }
  | {
      field: IssueStructureField;
      action: 'observe';
      reason: IssueStructureIgnoreReason;
      value: string;
    };

const ISSUE_STRUCTURE_RANK: Partial<Record<SourceType, number>> = {
  OFFICIAL_FILING: 1,
  EXCHANGE: 2,
};

export function emptyIssueStructure(): IssueStructureValues {
  return {
    issueSize: null,
    freshIssueSize: null,
    ofsSize: null,
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
  };
}

export function issueStructureFactMatchesField(
  fact: IssueStructureFact,
): boolean {
  return ISSUE_STRUCTURE_DIMENSION[fact.field] === fact.dimension;
}

export function canWriteIssueStructure(sourceType: SourceType): boolean {
  return ISSUE_STRUCTURE_RANK[sourceType] !== undefined;
}

export function issueStructureAuthorityRank(
  sourceType: SourceType,
): number | null {
  return ISSUE_STRUCTURE_RANK[sourceType] ?? null;
}

export function factsFromDiscoveredIpo(
  ipo: DiscoveredIpoAttributes,
): IssueStructureFact[] {
  const facts: Array<[IssueStructureField, CanonicalDimension, string | null]> =
    [
      [IssueStructureField.ISSUE_SIZE, CanonicalDimension.INR, ipo.issueSize],
      [
        IssueStructureField.FRESH_ISSUE_SIZE,
        CanonicalDimension.INR,
        ipo.freshIssueSize,
      ],
      [IssueStructureField.OFS_SIZE, CanonicalDimension.INR, ipo.ofsSize],
      [
        IssueStructureField.ISSUE_SHARE_COUNT,
        CanonicalDimension.SHARES,
        ipo.issueShareCount,
      ],
      [
        IssueStructureField.FRESH_ISSUE_SHARE_COUNT,
        CanonicalDimension.SHARES,
        ipo.freshIssueShareCount,
      ],
      [
        IssueStructureField.OFS_SHARE_COUNT,
        CanonicalDimension.SHARES,
        ipo.ofsShareCount,
      ],
    ];

  return facts.flatMap(([field, dimension, value]) =>
    value === null ? [] : [{ field, dimension, value }],
  );
}

export function hasIssueShareCountMismatch(
  values: IssueStructureValues,
): boolean {
  const { issueShareCount, freshIssueShareCount, ofsShareCount } = values;
  if (
    issueShareCount === null ||
    freshIssueShareCount === null ||
    ofsShareCount === null
  ) {
    return false;
  }

  return !freshIssueShareCount.plus(ofsShareCount).eq(issueShareCount);
}

export function applyIssueStructureFacts(input: {
  current: IssueStructureValues;
  facts: IssueStructureFact[];
  incomingSourceType: SourceType;
  currentAuthority: Partial<Record<IssueStructureField, SourceType>>;
}): {
  next: IssueStructureValues;
  decisions: IssueStructureDecision[];
  shareCountMismatch: boolean;
} {
  const next: IssueStructureValues = { ...input.current };
  const decisions: IssueStructureDecision[] = [];

  for (const fact of input.facts) {
    const decision = decideIssueStructureFact({
      fact,
      currentValue: next[ISSUE_STRUCTURE_PRISMA_FIELD[fact.field]],
      incomingSourceType: input.incomingSourceType,
      currentSourceType: input.currentAuthority[fact.field] ?? null,
    });

    if (decision) {
      decisions.push(decision);
      if (decision.action === 'apply') {
        next[ISSUE_STRUCTURE_PRISMA_FIELD[fact.field]] = new Prisma.Decimal(
          decision.value,
        );
      }
    }
  }

  return {
    next,
    decisions,
    shareCountMismatch: hasIssueShareCountMismatch(next),
  };
}

function decideIssueStructureFact(input: {
  fact: IssueStructureFact;
  currentValue: Prisma.Decimal | null;
  incomingSourceType: SourceType;
  currentSourceType: SourceType | null;
}): IssueStructureDecision | null {
  const { fact } = input;

  if (!issueStructureFactMatchesField(fact)) {
    return {
      field: fact.field,
      action: 'observe',
      reason: 'dimension',
      value: fact.value,
    };
  }

  if (!canWriteIssueStructure(input.incomingSourceType)) {
    return {
      field: fact.field,
      action: 'observe',
      reason: 'not-allowed',
      value: fact.value,
    };
  }

  if (
    input.currentValue !== null &&
    input.currentSourceType &&
    isLowerIssueStructureAuthority(
      input.incomingSourceType,
      input.currentSourceType,
    )
  ) {
    return {
      field: fact.field,
      action: 'observe',
      reason: 'lower-authority',
      value: fact.value,
    };
  }

  return {
    field: fact.field,
    action: 'apply',
    value: fact.value,
  };
}

function isLowerIssueStructureAuthority(
  incoming: SourceType,
  current: SourceType,
): boolean {
  const incomingRank = issueStructureAuthorityRank(incoming);
  const currentRank = issueStructureAuthorityRank(current);

  if (incomingRank === null || currentRank === null) {
    return incomingRank === null;
  }

  return incomingRank > currentRank;
}
