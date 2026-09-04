import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import {
  CanonicalDimension,
  IssueStructureFact,
  IssueStructureField,
  applyIssueStructureFacts,
  emptyIssueStructure,
  factsFromDiscoveredIpo,
  hasIssueShareCountMismatch,
  issueStructureFactMatchesField,
} from './issue-structure';
import { normalizeDiscoveredIpo } from './normalize';

type FactFixture = Record<string, IssueStructureFact>;

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', 'issue-structure-facts.json'),
    'utf8',
  ),
) as FactFixture;

describe('issue-structure contract', () => {
  it('tags discovered INR and share fields with the matching dimension', () => {
    const discovered = normalizeDiscoveredIpo({
      company: { legalName: 'Example Limited' },
      ipo: {
        issueSize: 12_500_000_000,
        freshIssueSize: 10_000_000_000,
        ofsSize: 2_500_000_000,
        issueShareCount: 18_520_085,
        freshIssueShareCount: 10_000_000,
        ofsShareCount: 8_520_085,
      },
      source: {},
    });

    expect(factsFromDiscoveredIpo(discovered.ipo)).toEqual([
      fixtures.inrTotal,
      fixtures.inrFresh,
      fixtures.inrOfs,
      fixtures.sharesTotal,
      fixtures.sharesFresh,
      fixtures.sharesOfs,
    ]);
  });

  it('does not treat NSE list-feed issueSizeShares as a canonical share fact', () => {
    const discovered = normalizeDiscoveredIpo({
      company: { legalName: 'Deepa Jewellers Limited' },
      ipo: {
        issueSize: null,
        issueSizeShares: 18_520_085,
        freshIssueSize: null,
        ofsSize: null,
      },
      source: {},
    });

    expect(discovered.ipo.issueSize).toBeNull();
    expect(discovered.ipo.issueShareCount).toBeNull();
    expect(factsFromDiscoveredIpo(discovered.ipo)).toEqual([]);
  });

  it('ignores a fact whose dimension does not match the target field', () => {
    const applied = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: [fixtures.sharesMislabeledAsInr, fixtures.inrMislabeledAsShares],
      incomingSourceType: 'EXCHANGE',
      currentAuthority: {},
    });

    expect(issueStructureFactMatchesField(fixtures.sharesMislabeledAsInr)).toBe(
      false,
    );
    expect(issueStructureFactMatchesField(fixtures.inrMislabeledAsShares)).toBe(
      false,
    );
    expect(applied.next.issueSize).toBeNull();
    expect(applied.next.issueShareCount).toBeNull();
    expect(applied.decisions).toEqual([
      {
        field: IssueStructureField.ISSUE_SIZE,
        action: 'observe',
        reason: 'dimension',
        value: '18520085',
      },
      {
        field: IssueStructureField.ISSUE_SHARE_COUNT,
        action: 'observe',
        reason: 'dimension',
        value: '12500000000.00',
      },
    ]);
  });

  it('keeps an existing value when a later observation omits the field', () => {
    const seeded = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: [fixtures.inrTotal],
      incomingSourceType: 'EXCHANGE',
      currentAuthority: {},
    });

    const omitted = applyIssueStructureFacts({
      current: seeded.next,
      facts: [],
      incomingSourceType: 'EXCHANGE',
      currentAuthority: { issue_size: 'EXCHANGE' },
    });

    expect(omitted.next.issueSize?.toFixed(2)).toBe('12500000000.00');
    expect(omitted.decisions).toEqual([]);
  });

  it('does not let a lower-authority source overwrite a higher-authority value', () => {
    const filing = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: [fixtures.inrTotal, fixtures.sharesTotal],
      incomingSourceType: 'OFFICIAL_FILING',
      currentAuthority: {},
    });

    const secondary = applyIssueStructureFacts({
      current: filing.next,
      facts: [
        {
          field: IssueStructureField.ISSUE_SIZE,
          dimension: CanonicalDimension.INR,
          value: '1.00',
        },
        {
          field: IssueStructureField.ISSUE_SHARE_COUNT,
          dimension: CanonicalDimension.SHARES,
          value: '1',
        },
      ],
      incomingSourceType: 'SECONDARY',
      currentAuthority: {
        issue_size: 'OFFICIAL_FILING',
        issue_share_count: 'OFFICIAL_FILING',
      },
    });

    expect(secondary.next.issueSize?.toFixed(2)).toBe('12500000000.00');
    expect(secondary.next.issueShareCount?.toFixed(0)).toBe('18520085');
    expect(secondary.decisions.every((row) => row.action === 'observe')).toBe(
      true,
    );
  });

  it('lets a higher-authority source replace a lower-authority value', () => {
    const exchange = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: [
        {
          field: IssueStructureField.ISSUE_SIZE,
          dimension: CanonicalDimension.INR,
          value: '100.00',
        },
      ],
      incomingSourceType: 'EXCHANGE',
      currentAuthority: {},
    });

    const filing = applyIssueStructureFacts({
      current: exchange.next,
      facts: [fixtures.inrTotal],
      incomingSourceType: 'OFFICIAL_FILING',
      currentAuthority: { issue_size: 'EXCHANGE' },
    });

    expect(filing.next.issueSize?.toFixed(2)).toBe('12500000000.00');
    expect(filing.decisions).toEqual([
      {
        field: IssueStructureField.ISSUE_SIZE,
        action: 'apply',
        value: '12500000000.00',
      },
    ]);
  });

  it('flags a share-count mismatch for review and does not rewrite values', () => {
    const applied = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: [
        fixtures.sharesTotal,
        fixtures.sharesMismatchFresh,
        fixtures.sharesMismatchOfs,
      ],
      incomingSourceType: 'OFFICIAL_FILING',
      currentAuthority: {},
    });

    expect(applied.shareCountMismatch).toBe(true);
    expect(hasIssueShareCountMismatch(applied.next)).toBe(true);
    expect(applied.next.issueShareCount?.toFixed(0)).toBe('18520085');
    expect(applied.next.freshIssueShareCount?.toFixed(0)).toBe('10000000');
    expect(applied.next.ofsShareCount?.toFixed(0)).toBe('1000000');
    expect(
      new Prisma.Decimal(applied.next.freshIssueShareCount ?? 0)
        .plus(applied.next.ofsShareCount ?? 0)
        .eq(applied.next.issueShareCount ?? 0),
    ).toBe(false);
  });

  it('does not derive issue amount from shares and price', () => {
    const discovered = normalizeDiscoveredIpo({
      company: { legalName: 'Example Limited' },
      ipo: {
        issueShareCount: 100,
        priceBandLow: 10,
        priceBandHigh: 12,
      },
      source: {},
    });

    const applied = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: factsFromDiscoveredIpo(discovered.ipo),
      incomingSourceType: 'EXCHANGE',
      currentAuthority: {},
    });

    expect(applied.next.issueShareCount?.toFixed(0)).toBe('100');
    expect(applied.next.issueSize).toBeNull();
  });
});
