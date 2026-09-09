import { Prisma } from '@prisma/client';
import request from 'supertest';

import { IpoWithRelations } from '../../src/modules/ipos/ipo.types';
import { createTestApp } from './create-test-app';

const now = new Date('2026-09-01T12:00:00.000Z');

function ipo(partial: {
  id: string;
  status: IpoWithRelations['status'];
  marketSegment: IpoWithRelations['marketSegment'];
  exchange: IpoWithRelations['exchange'];
  createdAt: Date;
}): IpoWithRelations {
  return {
    id: partial.id,
    companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    marketSegment: partial.marketSegment,
    exchange: partial.exchange,
    status: partial.status,
    symbol: 'SYM',
    issueSize: new Prisma.Decimal('100.00'),
    freshIssueSize: null,
    ofsSize: null,
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('10.00'),
    priceBandHigh: new Prisma.Decimal('12.00'),
    lotSize: 10,
    minimumLots: 1,
    createdAt: partial.createdAt,
    updatedAt: partial.createdAt,
    company: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      legalName: 'List Co Limited',
      displayName: 'List Co',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: now,
      updatedAt: now,
    },
    lifecycleEvents: [
      {
        id: `${partial.id.slice(0, 8)}-cccc-4ccc-8ccc-cccccccccccc`,
        ipoId: partial.id,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

const seed: IpoWithRelations[] = [
  ipo({
    id: '11111111-1111-4111-8111-111111111111',
    status: 'OPEN',
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
  }),
  ipo({
    id: '22222222-2222-4222-8222-222222222222',
    status: 'UPCOMING',
    marketSegment: 'SME',
    exchange: 'BSE',
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
  }),
  ipo({
    id: '33333333-3333-4333-8333-333333333333',
    status: 'OPEN',
    marketSegment: 'SME',
    exchange: 'BOTH',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  }),
];

function createIpoPrismaStub(rows: IpoWithRelations[]) {
  const matches = (where: {
    status?: string;
    marketSegment?: string;
    exchange?: string;
  }) =>
    rows.filter((item) => {
      if (where.status && item.status !== where.status) {
        return false;
      }
      if (where.marketSegment && item.marketSegment !== where.marketSegment) {
        return false;
      }
      if (where.exchange && item.exchange !== where.exchange) {
        return false;
      }
      return true;
    });

  return {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ '?column?': 1 }],
    ipo: {
      findMany: async ({
        where = {},
        skip = 0,
        take = rows.length,
      }: {
        where?: {
          status?: string;
          marketSegment?: string;
          exchange?: string;
        };
        skip?: number;
        take?: number;
      }) =>
        matches(where)
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, skip + take),
      count: async ({
        where = {},
      }: {
        where?: {
          status?: string;
          marketSegment?: string;
          exchange?: string;
        };
      }) => matches(where).length,
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        rows.find((item) => item.id === id) ?? null,
    },
    discoveryRecord: {
      findMany: async () => [],
    },
    source: {
      findMany: async () => [],
      findUnique: async () => null,
    },
    sourceIdentity: {
      findMany: async () => [],
    },
    ipoChangeEvent: {
      findMany: async ({ where = {} }: any) => {
        if (where.ipoId === '11111111-1111-4111-8111-111111111111') {
          const events = [
            {
              id: 'chg-1',
              ipoId: '11111111-1111-4111-8111-111111111111',
              fieldName: 'price_band_high',
              oldValue: '175.00',
              newValue: '180.00',
              changeType: 'PRICE_BAND_CHANGED',
              sourceId: 'src-1',
              sourceReference: 'ref-1',
              detectedAt: new Date('2026-09-10T12:00:00.000Z'),
              createdAt: new Date('2026-09-10T12:00:00.000Z'),
              source: {
                id: 'src-1',
                code: 'sebi',
                name: 'SEBI',
                sourceType: 'OFFICIAL_FILING',
              },
            },
          ];
          if (where.fieldName && events[0].fieldName !== where.fieldName) return [];
          if (where.source?.code && events[0].source.code !== where.source.code) return [];
          return events;
        }
        return [];
      },
    },
    ipoLifecycleEvent: {
      findMany: async () => [],
    },
  };
}

describe('IPO read API', () => {
  it('lists IPOs with the success envelope and pagination meta', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get('/api/v1/ipos');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 3 });
    expect(response.body.data).toHaveLength(3);
    expect(response.body.data[0].id).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(response.body.data[0].company.displayName).toBe('List Co');
    expect(response.body.data[0].lifecycle.openDate).toBe('2026-09-10');
    expect(JSON.stringify(response.body)).not.toContain('lifecycleEvents');

    await app.close();
  });

  it('filters by status, marketSegment, and exchange', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const status = await request(app.getHttpServer()).get(
      '/api/v1/ipos?status=OPEN',
    );
    const segment = await request(app.getHttpServer()).get(
      '/api/v1/ipos?marketSegment=SME',
    );
    const exchange = await request(app.getHttpServer()).get(
      '/api/v1/ipos?exchange=BSE',
    );

    expect(status.body.data).toHaveLength(2);
    expect(status.body.meta.total).toBe(2);
    expect(segment.body.data.map((row: { id: string }) => row.id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(exchange.body.data).toHaveLength(1);
    expect(exchange.body.data[0].exchange).toBe('BSE');

    await app.close();
  });

  it('paginates with page and limit', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const page1 = await request(app.getHttpServer()).get(
      '/api/v1/ipos?page=1&limit=2',
    );
    const page2 = await request(app.getHttpServer()).get(
      '/api/v1/ipos?page=2&limit=2',
    );

    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 3 });
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3 });
    expect(page2.body.data[0].id).toBe('33333333-3333-4333-8333-333333333333');

    await app.close();
  });

  it('returns one canonical IPO by id', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get(
      '/api/v1/ipos/11111111-1111-4111-8111-111111111111',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        status: 'OPEN',
        marketSegment: 'MAINBOARD',
        company: expect.objectContaining({
          displayName: 'List Co',
        }),
        lifecycle: expect.objectContaining({
          openDate: '2026-09-10',
          listingDate: null,
        }),
      }),
    });
    expect(response.body.data).not.toHaveProperty('rawPayload');

    await app.close();
  });

  it('returns IPO_NOT_FOUND for a missing IPO', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get(
      '/api/v1/ipos/99999999-9999-4999-8999-999999999999',
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('IPO_NOT_FOUND');
    expect(response.body.error.message).toBe('IPO was not found');
    expect(typeof response.body.error.requestId).toBe('string');
    expect(response.headers['x-request-id']).toBe(
      response.body.error.requestId,
    );

    await app.close();
  });

  it('rejects invalid filters, pagination, and ids', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const status = await request(app.getHttpServer()).get(
      '/api/v1/ipos?status=ACTIVE',
    );
    const limit = await request(app.getHttpServer()).get(
      '/api/v1/ipos?limit=101',
    );
    const id = await request(app.getHttpServer()).get(
      '/api/v1/ipos/not-a-uuid',
    );

    expect(status.status).toBe(400);
    expect(status.body.error.code).toBe('VALIDATION_ERROR');
    expect(limit.status).toBe(400);
    expect(id.status).toBe(400);
    expect(id.body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('GET /api/v1/ipos/:id/changes - returns persisted change history with envelope', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get(
      '/api/v1/ipos/11111111-1111-4111-8111-111111111111/changes',
    );

    expect(response.status).toBe(200);
    expect(response.body.data.ipoId).toBe('11111111-1111-4111-8111-111111111111');
    expect(response.body.data.changes).toHaveLength(1);
    expect(response.body.data.changes[0]).toEqual({
      id: 'chg-1',
      fieldName: 'price_band_high',
      oldValue: '175.00',
      newValue: '180.00',
      changeType: 'PRICE_BAND_CHANGED',
      source: {
        id: 'src-1',
        code: 'sebi',
        name: 'SEBI',
        sourceType: 'OFFICIAL_FILING',
      },
      sourceReference: 'ref-1',
      detectedAt: '2026-09-10T12:00:00.000Z',
      createdAt: '2026-09-10T12:00:00.000Z',
    });

    await app.close();
  });

  it('GET /api/v1/ipos/:id/changes - returns empty changes array for valid IPO with no history', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get(
      '/api/v1/ipos/22222222-2222-4222-8222-222222222222/changes',
    );

    expect(response.status).toBe(200);
    expect(response.body.data.ipoId).toBe('22222222-2222-4222-8222-222222222222');
    expect(response.body.data.changes).toEqual([]);

    await app.close();
  });

  it('GET /api/v1/ipos/:id/changes - returns 404 for unknown IPO ID', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const response = await request(app.getHttpServer()).get(
      '/api/v1/ipos/99999999-9999-4999-8999-999999999999/changes',
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('IPO_NOT_FOUND');

    await app.close();
  });

  it('GET /api/v1/ipos/:id/changes - filters by field and source query params', async () => {
    const app = await createTestApp([], createIpoPrismaStub(seed));

    const matchFilter = await request(app.getHttpServer()).get(
      '/api/v1/ipos/11111111-1111-4111-8111-111111111111/changes?field=price_band_high&source=sebi',
    );
    expect(matchFilter.status).toBe(200);
    expect(matchFilter.body.data.changes).toHaveLength(1);

    const noMatchFilter = await request(app.getHttpServer()).get(
      '/api/v1/ipos/11111111-1111-4111-8111-111111111111/changes?field=lot_size',
    );
    expect(noMatchFilter.status).toBe(200);
    expect(noMatchFilter.body.data.changes).toEqual([]);

    await app.close();
  });
});
