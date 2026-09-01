import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
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

function createFlow() {
  const { db, prisma } = createFakePrisma();
  const prismaService = prisma as unknown as PrismaService;
  const canonicalizer = new CanonicalizerService();
  const discovery = new DiscoveryService(
    prismaService,
    new DiscoveryRecordRepository(prismaService),
    new MatchingService(prismaService),
    canonicalizer,
  );
  const flow = new NseDiscoveryFlow(new NseSourceAdapter(), discovery);

  return { db, flow, canonicalizer };
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
