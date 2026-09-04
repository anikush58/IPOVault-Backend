import { Prisma } from '@prisma/client';

import { CanonicalizerService } from './canonicalizer.service';
import { createFakePrisma } from './fake-prisma';
import { mockObservationPayload } from './mock-observation';
import { normalizeDiscoveredIpo } from './normalize';

const FILING_SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const EXCHANGE_SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const RETRIEVED_AT = new Date('2026-09-01T10:00:00.000Z');

type Tx = Prisma.TransactionClient;

function asTx(prisma: ReturnType<typeof createFakePrisma>['prisma']): Tx {
  return prisma as unknown as Tx;
}

function decimalText(value: unknown, scale: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return new Prisma.Decimal(value as Prisma.Decimal).toFixed(scale);
}

function seedSources(db: ReturnType<typeof createFakePrisma>['db']): void {
  db.sources.push(
    {
      id: FILING_SOURCE_ID,
      code: 'sebi-filings',
      sourceType: 'OFFICIAL_FILING',
    },
    {
      id: EXCHANGE_SOURCE_ID,
      code: 'nse',
      sourceType: 'EXCHANGE',
    },
  );
}

describe('CanonicalizerService issue-structure contract', () => {
  it('writes typed INR and share fields from matching facts and records provenance', async () => {
    const { db, prisma } = createFakePrisma();
    seedSources(db);
    const canonicalizer = new CanonicalizerService();
    const discovered = normalizeDiscoveredIpo(
      mockObservationPayload({
        ipo: {
          issueShareCount: 18_520_085,
          freshIssueShareCount: 10_000_000,
          ofsShareCount: 8_520_085,
        },
      }),
    );

    const result = await canonicalizer.apply(asTx(prisma), {
      discovered,
      match: { decision: 'CREATE', confidence: 'HIGH' },
      sourceId: FILING_SOURCE_ID,
      sourceReference: 'filing://rhp',
      retrievedAt: RETRIEVED_AT,
    });

    expect(result.created).toBe(true);
    expect(decimalText(db.ipos[0].issueSize, 2)).toBe('12500000000.00');
    expect(decimalText(db.ipos[0].issueShareCount, 0)).toBe('18520085');
    expect(
      db.provenance.some(
        (row) =>
          row.fieldName === 'issue_share_count' && row.value === '18520085',
      ),
    ).toBe(true);
    expect(
      db.provenance.some(
        (row) =>
          row.fieldName === 'issue_size' && row.value === '12500000000.00',
      ),
    ).toBe(true);
  });

  it('does not overwrite a filing-backed amount or share count with exchange evidence', async () => {
    const { db, prisma } = createFakePrisma();
    seedSources(db);
    const canonicalizer = new CanonicalizerService();
    const filing = normalizeDiscoveredIpo(
      mockObservationPayload({
        ipo: { issueShareCount: 18_520_085 },
      }),
    );

    const created = await canonicalizer.apply(asTx(prisma), {
      discovered: filing,
      match: { decision: 'CREATE', confidence: 'HIGH' },
      sourceId: FILING_SOURCE_ID,
      sourceReference: 'filing://rhp',
      retrievedAt: RETRIEVED_AT,
    });

    const exchange = normalizeDiscoveredIpo(
      mockObservationPayload({
        ipo: {
          issueSize: 1,
          issueShareCount: 1,
        },
      }),
    );

    await canonicalizer.apply(asTx(prisma), {
      discovered: exchange,
      match: {
        decision: 'MATCH_IPO',
        confidence: 'HIGH',
        ipoId: created.ipoId,
        companyId: created.companyId,
      },
      sourceId: EXCHANGE_SOURCE_ID,
      sourceReference: 'nse://ipo/MOCK',
      retrievedAt: new Date('2026-09-02T10:00:00.000Z'),
    });

    expect(decimalText(db.ipos[0].issueSize, 2)).toBe('12500000000.00');
    expect(decimalText(db.ipos[0].issueShareCount, 0)).toBe('18520085');
    expect(
      db.changes.filter((row) =>
        ['issue_size', 'issue_share_count'].includes(String(row.fieldName)),
      ),
    ).toHaveLength(0);
    expect(
      db.provenance.some(
        (row) =>
          row.sourceId === EXCHANGE_SOURCE_ID &&
          row.fieldName === 'issue_size' &&
          row.value === '1.00',
      ),
    ).toBe(true);
  });

  it('emits a change event when a filing replaces an exchange issue amount', async () => {
    const { db, prisma } = createFakePrisma();
    seedSources(db);
    const canonicalizer = new CanonicalizerService();

    const exchange = normalizeDiscoveredIpo(
      mockObservationPayload({ ipo: { issueSize: 100 } }),
    );
    const created = await canonicalizer.apply(asTx(prisma), {
      discovered: exchange,
      match: { decision: 'CREATE', confidence: 'HIGH' },
      sourceId: EXCHANGE_SOURCE_ID,
      sourceReference: 'nse://ipo/MOCK',
      retrievedAt: RETRIEVED_AT,
    });

    const filing = normalizeDiscoveredIpo(mockObservationPayload());
    await canonicalizer.apply(asTx(prisma), {
      discovered: filing,
      match: {
        decision: 'MATCH_IPO',
        confidence: 'HIGH',
        ipoId: created.ipoId,
        companyId: created.companyId,
      },
      sourceId: FILING_SOURCE_ID,
      sourceReference: 'filing://rhp',
      retrievedAt: new Date('2026-09-02T10:00:00.000Z'),
    });

    expect(decimalText(db.ipos[0].issueSize, 2)).toBe('12500000000.00');
    expect(
      db.changes.some(
        (row) =>
          row.fieldName === 'issue_size' &&
          row.oldValue === '100.00' &&
          row.newValue === '12500000000.00' &&
          row.changeType === 'ISSUE_SIZE_CHANGED',
      ),
    ).toBe(true);
  });

  it('does not clear canonical issue structure fields when a later payload omits them', async () => {
    const { db, prisma } = createFakePrisma();
    seedSources(db);
    const canonicalizer = new CanonicalizerService();
    const created = await canonicalizer.apply(asTx(prisma), {
      discovered: normalizeDiscoveredIpo(
        mockObservationPayload({
          ipo: { issueShareCount: 18_520_085 },
        }),
      ),
      match: { decision: 'CREATE', confidence: 'HIGH' },
      sourceId: EXCHANGE_SOURCE_ID,
      sourceReference: 'nse://ipo/MOCK',
      retrievedAt: RETRIEVED_AT,
    });

    await canonicalizer.apply(asTx(prisma), {
      discovered: normalizeDiscoveredIpo(
        mockObservationPayload({
          ipo: {
            issueSize: null,
            freshIssueSize: null,
            ofsSize: null,
            issueShareCount: null,
          },
        }),
      ),
      match: {
        decision: 'MATCH_IPO',
        confidence: 'HIGH',
        ipoId: created.ipoId,
        companyId: created.companyId,
      },
      sourceId: EXCHANGE_SOURCE_ID,
      sourceReference: 'nse://ipo/MOCK',
      retrievedAt: new Date('2026-09-02T10:00:00.000Z'),
    });

    expect(decimalText(db.ipos[0].issueSize, 2)).toBe('12500000000.00');
    expect(decimalText(db.ipos[0].issueShareCount, 0)).toBe('18520085');
    expect(
      db.changes.filter((row) =>
        ['issue_size', 'issue_share_count'].includes(String(row.fieldName)),
      ),
    ).toHaveLength(0);
  });
});
