import { Prisma } from '@prisma/client';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { createFakePrisma } from './fake-prisma';
import { MatchingService } from './matching.service';
import { mockObservationPayload } from './mock-observation';
import { PrismaService } from '../../database/prisma.service';
import { IncomingObservation } from './discovery.types';

const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DISCOVERED_AT = new Date('2026-09-01T10:00:00.000Z');

function observation(
  payload: ReturnType<typeof mockObservationPayload>,
): IncomingObservation {
  return {
    sourceId: SOURCE_ID,
    externalId: payload.source.externalId,
    sourceReference: payload.source.reference,
    companyName: payload.company.legalName,
    rawPayload: payload,
    discoveredAt: DISCOVERED_AT,
  };
}

function createPipeline() {
  const { db, prisma } = createFakePrisma();
  const prismaService = prisma as unknown as PrismaService;
  const records = new DiscoveryRecordRepository(prismaService);
  const matching = new MatchingService(prismaService);
  const canonicalizer = new CanonicalizerService();
  const service = new DiscoveryService(
    prismaService,
    records,
    matching,
    canonicalizer,
  );

  return { db, service, canonicalizer };
}

describe('DiscoveryService', () => {
  it('persists a new observation as a discovery record and creates a canonical IPO', async () => {
    const { db, service } = createPipeline();
    const payload = mockObservationPayload();

    const result = await service.process(observation(payload));

    expect(result.outcome).toBe('CREATED');
    expect(db.discovery).toHaveLength(1);
    expect(db.discovery[0].status).toBe('CREATED');
    expect(db.discovery[0].rawPayload).toEqual(payload);
    expect(db.companies).toHaveLength(1);
    expect(db.ipos).toHaveLength(1);
    expect(db.ipos[0].issueShareCount ?? null).toBeNull();
    expect(db.ipos[0].freshIssueShareCount ?? null).toBeNull();
    expect(db.ipos[0].ofsShareCount ?? null).toBeNull();
    expect(db.identities).toHaveLength(1);
    expect(db.identities[0].externalId).toBe('MOCK-IPO-001');
    expect(result.ipoId).toBe(db.ipos[0].id);
  });

  it('treats a repeated identical observation as idempotent', async () => {
    const { db, service } = createPipeline();
    const payload = mockObservationPayload();

    const first = await service.process(observation(payload));
    const second = await service.process(observation(payload));

    expect(first.outcome).toBe('CREATED');
    expect(second.outcome).toBe('DUPLICATE');
    expect(second.discoveryRecordId).toBe(first.discoveryRecordId);
    expect(db.discovery).toHaveLength(1);
    expect(db.ipos).toHaveLength(1);
    expect(db.changes).toHaveLength(0);
  });

  it('preserves a changed observation as a new discovery record', async () => {
    const { db, service } = createPipeline();

    await service.process(observation(mockObservationPayload()));
    const changed = mockObservationPayload({
      ipo: { priceBandHigh: 130 },
    });
    const result = await service.process(observation(changed));

    expect(result.outcome).toBe('MATCHED');
    expect(db.discovery).toHaveLength(2);
    expect(db.discovery[0].rawPayload).toEqual(mockObservationPayload());
    expect(db.discovery[1].rawPayload).toEqual(changed);
    expect(db.ipos).toHaveLength(1);
    expect(
      new Prisma.Decimal(db.ipos[0].priceBandHigh as Prisma.Decimal).toFixed(2),
    ).toBe('130.00');
  });

  it('does not create a change event when canonical values are unchanged', async () => {
    const { db, service } = createPipeline();

    await service.process(observation(mockObservationPayload()));
    await service.process(
      observation(
        mockObservationPayload({
          company: { legalName: '  Mock Technologies Limited  ' },
        }),
      ),
    );

    expect(db.discovery).toHaveLength(2);
    expect(db.changes).toHaveLength(0);
    expect(db.ipos).toHaveLength(1);
  });

  it('creates exactly one change event when a canonical value changes', async () => {
    const { db, service } = createPipeline();

    await service.process(observation(mockObservationPayload()));
    await service.process(
      observation(mockObservationPayload({ ipo: { priceBandHigh: 130 } })),
    );

    expect(db.changes).toHaveLength(1);
    expect(db.changes[0].fieldName).toBe('price_band_high');
    expect(db.changes[0].oldValue).toBe('126.00');
    expect(db.changes[0].newValue).toBe('130.00');
    expect(db.changes[0].changeType).toBe('PRICE_BAND_CHANGED');
  });

  it('records provenance for canonical fields', async () => {
    const { db, service } = createPipeline();

    const result = await service.process(observation(mockObservationPayload()));

    expect(db.provenance.length).toBeGreaterThan(0);
    expect(
      db.provenance.some(
        (row) =>
          row.entityType === 'IPO' &&
          row.entityId === result.ipoId &&
          row.fieldName === 'price_band_high' &&
          row.value === '126.00',
      ),
    ).toBe(true);
    expect(
      db.provenance.some(
        (row) => row.entityType === 'COMPANY' && row.fieldName === 'cin',
      ),
    ).toBe(true);
  });

  it('rejects an insufficient-confidence match without writing canonical data', async () => {
    const { db, service } = createPipeline();
    const payload = mockObservationPayload({
      company: { cin: null, legalName: 'Some Similar Name Ltd' },
      source: { externalId: null, reference: 'mock://weak' },
    });

    const result = await service.process(observation(payload));

    expect(result.outcome).toBe('REJECTED');
    expect(db.discovery).toHaveLength(1);
    expect(db.discovery[0].status).toBe('REJECTED');
    expect(db.companies).toHaveLength(0);
    expect(db.ipos).toHaveLength(0);
  });

  it('rolls back canonical writes when the transaction fails', async () => {
    const { db, service, canonicalizer } = createPipeline();
    const apply = canonicalizer.apply.bind(canonicalizer);

    canonicalizer.apply = async (tx, input) => {
      await apply(tx, input);
      throw new Error('forced failure');
    };

    await expect(
      service.process(observation(mockObservationPayload())),
    ).rejects.toThrow('forced failure');

    expect(db.companies).toHaveLength(0);
    expect(db.ipos).toHaveLength(0);
    expect(db.identities).toHaveLength(0);
    expect(db.changes).toHaveLength(0);
    expect(db.provenance).toHaveLength(0);
    expect(db.discovery).toHaveLength(1);
    expect(db.discovery[0].status).toBe('ERROR');
    expect(db.discovery[0].rawPayload).toEqual(mockObservationPayload());
  });
});
