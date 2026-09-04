import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { NseFetchError } from './adapters/nse/nse-fetch.error';
import { NseHttpClient } from './adapters/nse/nse.fetcher';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { createFakePrisma } from './fake-prisma';
import { MatchingService } from './matching.service';
import { NseDiscoveryFlow } from './nse-discovery.flow';

const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISCOVERED_AT = new Date('2026-09-01T10:00:00.000Z');
const CONTEXT = { sourceId: SOURCE_ID, discoveredAt: DISCOVERED_AT };

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, 'adapters', 'nse', 'fixtures', name), 'utf8'),
  ) as unknown;
}

function withPriceBand(raw: unknown, priceBand: string): unknown {
  const clone = JSON.parse(JSON.stringify(raw)) as {
    data: Array<{ priceBand: string }>;
  };
  clone.data[0].priceBand = priceBand;
  return clone;
}

function createFlow(options?: {
  fetchIpoDocument?: jest.Mock;
  findSource?: jest.Mock;
}) {
  const { db, prisma } = createFakePrisma();
  const prismaService = Object.assign(prisma as object, {
    source: {
      findUnique:
        options?.findSource ??
        jest.fn(async () => ({ id: SOURCE_ID, code: 'nse' })),
    },
  }) as unknown as PrismaService;
  const http = {
    fetchIpoDocument:
      options?.fetchIpoDocument ??
      jest.fn(async () => {
        throw new Error('live NSE fetch must not run in fixture tests');
      }),
  } as unknown as NseHttpClient;
  const canonicalizer = new CanonicalizerService();
  const discovery = new DiscoveryService(
    prismaService,
    new DiscoveryRecordRepository(prismaService),
    new MatchingService(prismaService),
    canonicalizer,
  );
  const adapter = new NseSourceAdapter();
  const flow = new NseDiscoveryFlow(adapter, discovery, http, prismaService);

  return { db, flow, canonicalizer, adapter, discovery, http };
}

describe('NSE fixture → DiscoveryService.process', () => {
  it('creates, is idempotent, preserves changes, records provenance, and rolls back on failure', async () => {
    const valid = loadFixture('nse-ipo.valid.json');
    const { db, flow } = createFlow();

    const first = await flow.ingest(valid, CONTEXT);

    expect(first.outcome).toBe('CREATED');
    expect(db.discovery).toHaveLength(1);
    expect(db.discovery[0].status).toBe('CREATED');
    expect(db.discovery[0].externalId).toBe('MOCKTECH');
    expect(db.companies).toHaveLength(1);
    expect(db.companies[0].legalName).toBe('Mock Technologies Limited');
    expect(db.ipos).toHaveLength(1);
    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].externalId).toBe('MOCKTECH');
    expect(
      new Prisma.Decimal(db.ipos[0].priceBandHigh as Prisma.Decimal).toFixed(2),
    ).toBe('126.00');
    expect(
      db.provenance.some(
        (row) =>
          row.entityType === 'IPO' &&
          row.fieldName === 'price_band_high' &&
          row.value === '126.00',
      ),
    ).toBe(true);

    const second = await flow.ingest(valid, CONTEXT);

    expect(second.outcome).toBe('DUPLICATE');
    expect(second.discoveryRecordId).toBe(first.discoveryRecordId);
    expect(db.discovery).toHaveLength(1);
    expect(db.ipos).toHaveLength(1);
    expect(db.changes).toHaveLength(0);

    const changed = await flow.ingest(
      withPriceBand(valid, '₹120.00 - ₹130.00'),
      CONTEXT,
    );

    expect(changed.outcome).toBe('MATCHED');
    expect(db.discovery).toHaveLength(2);
    expect(db.ipos).toHaveLength(1);
    expect(
      new Prisma.Decimal(db.ipos[0].priceBandHigh as Prisma.Decimal).toFixed(2),
    ).toBe('130.00');
    expect(db.changes).toHaveLength(1);
    expect(db.changes[0].fieldName).toBe('price_band_high');
    expect(db.changes[0].oldValue).toBe('126.00');
    expect(db.changes[0].newValue).toBe('130.00');
    expect(db.changes[0].changeType).toBe('PRICE_BAND_CHANGED');

    const {
      db: rollbackDb,
      flow: rollbackFlow,
      canonicalizer: rollbackCanonicalizer,
    } = createFlow();
    const apply = rollbackCanonicalizer.apply.bind(rollbackCanonicalizer);
    rollbackCanonicalizer.apply = async (tx, input) => {
      await apply(tx, input);
      throw new Error('forced failure');
    };

    await expect(rollbackFlow.ingest(valid, CONTEXT)).rejects.toThrow(
      'forced failure',
    );
    expect(rollbackDb.companies).toHaveLength(0);
    expect(rollbackDb.ipos).toHaveLength(0);
    expect(rollbackDb.identities).toHaveLength(0);
    expect(rollbackDb.changes).toHaveLength(0);
    expect(rollbackDb.provenance).toHaveLength(0);
    expect(rollbackDb.discovery).toHaveLength(1);
    expect(rollbackDb.discovery[0].status).toBe('ERROR');
  });
});

const upcomingIssues = [
  {
    companyName: 'Deepa Jewellers Limited',
    symbol: 'DEEPA',
    series: 'EQ',
    status: 'Active',
    issueStartDate: '01-Sep-2026',
    issueEndDate: '03-Sep-2026',
    issuePrice: 'Rs.168 to Rs.177',
    issueSize: '18520085',
  },
  {
    companyName: 'Qualiance International Limited',
    symbol: 'QUALIANCE',
    series: 'SME',
    status: 'Forthcoming',
    issueStartDate: '04-Sep-2026',
    issueEndDate: '08-Sep-2026',
    issuePrice: 'Rs.120 to Rs.127',
    issueSize: '3552000',
  },
];

describe('NSE live ingestLive()', () => {
  it('passes the fetched body to the adapter and processes each issue', async () => {
    const fetchIpoDocument = jest.fn().mockResolvedValue({
      status: 200,
      body: upcomingIssues,
    });
    const { db, flow, adapter, discovery } = createFlow({ fetchIpoDocument });
    const observe = jest.spyOn(adapter, 'observe');
    const process = jest.spyOn(discovery, 'process');

    const results = await flow.ingestLive(DISCOVERED_AT);

    expect(fetchIpoDocument).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(upcomingIssues, {
      sourceId: SOURCE_ID,
      discoveredAt: DISCOVERED_AT,
    });
    expect(process).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.outcome)).toEqual([
      'CREATED',
      'CREATED',
    ]);
    expect(db.ipos[0].issueSize ?? null).toBeNull();
    expect(db.ipos[0].issueShareCount ?? null).toBeNull();
    expect(db.ipos[1].issueSize ?? null).toBeNull();
    expect(db.ipos[1].issueShareCount ?? null).toBeNull();
  });

  it('fails clearly when the NSE source is missing and does not fetch or process', async () => {
    const fetchIpoDocument = jest.fn();
    const findSource = jest.fn().mockResolvedValue(null);
    const { flow, db, discovery } = createFlow({
      fetchIpoDocument,
      findSource,
    });
    const process = jest.spyOn(discovery, 'process');

    await expect(flow.ingestLive()).rejects.toThrow(
      /Seed a sources row with code "nse"/,
    );
    expect(fetchIpoDocument).not.toHaveBeenCalled();
    expect(process).not.toHaveBeenCalled();
    expect(db.companies).toHaveLength(0);
    expect(db.ipos).toHaveLength(0);
  });

  it('propagates fetch errors without canonicalization', async () => {
    const fetchIpoDocument = jest
      .fn()
      .mockRejectedValue(
        new NseFetchError('NSE request failed with status 403'),
      );
    const { flow, db, discovery } = createFlow({ fetchIpoDocument });
    const process = jest.spyOn(discovery, 'process');

    await expect(flow.ingestLive()).rejects.toThrow(NseFetchError);
    expect(process).not.toHaveBeenCalled();
    expect(db.companies).toHaveLength(0);
    expect(db.ipos).toHaveLength(0);
    expect(db.discovery).toHaveLength(0);
    expect(db.changes).toHaveLength(0);
    expect(db.provenance).toHaveLength(0);
  });

  it('does not bypass DiscoveryService.process for live ingestion', async () => {
    const fetchIpoDocument = jest.fn().mockResolvedValue({
      status: 200,
      body: [upcomingIssues[0]],
    });
    const { flow, discovery } = createFlow({ fetchIpoDocument });
    const process = jest.spyOn(discovery, 'process').mockResolvedValue({
      outcome: 'CREATED',
      discoveryRecordId: 'rec-1',
      ipoId: 'ipo-1',
    });

    const results = await flow.ingestLive(DISCOVERED_AT);

    expect(process).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        outcome: 'CREATED',
        discoveryRecordId: 'rec-1',
        ipoId: 'ipo-1',
      },
    ]);
  });
});
