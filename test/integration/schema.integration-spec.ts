import { Prisma, PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

describe('database schema', () => {
  const prisma = new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.discoveryRecord.deleteMany();
    await prisma.fieldProvenance.deleteMany();
    await prisma.ipoChangeEvent.deleteMany();
    await prisma.ipoSourceIdentity.deleteMany();
    await prisma.ipoLifecycleEvent.deleteMany();
    await prisma.ipo.deleteMany();
    await prisma.company.deleteMany();
    await prisma.source.deleteMany();
  });

  it('creates a company and IPO atomically and persists typed money and calendar dates', async () => {
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          legalName: 'Example Technologies Limited',
          displayName: 'Example Tech',
          cin: 'U12345MH2024PLC000001',
        },
      });

      const ipo = await tx.ipo.create({
        data: {
          companyId: company.id,
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          issueSize: new Prisma.Decimal('12500000000.00'),
          priceBandLow: new Prisma.Decimal('120.00'),
          priceBandHigh: new Prisma.Decimal('126.00'),
          lotSize: 120,
        },
      });

      const openEvent = await tx.ipoLifecycleEvent.create({
        data: {
          ipoId: ipo.id,
          eventType: 'OPEN',
          eventDate: new Date('2026-09-10'),
        },
      });

      return { company, ipo, openEvent };
    });

    expect(result.company.cin).toBe('U12345MH2024PLC000001');
    expect(result.ipo.issueSize?.toFixed(2)).toBe('12500000000.00');
    expect(result.ipo.issueShareCount).toBeNull();
    expect(result.ipo.freshIssueShareCount).toBeNull();
    expect(result.ipo.ofsShareCount).toBeNull();
    expect(
      result.openEvent.eventDate.toISOString().startsWith('2026-09-10'),
    ).toBe(true);
    expect(
      (result.company as unknown as { isin?: string }).isin,
    ).toBeUndefined();
  });

  it('stores share counts independently of INR issue amounts and does not infer equality', async () => {
    const company = await prisma.company.create({
      data: {
        legalName: 'Share Count Limited',
        displayName: 'Share Count',
      },
    });

    const ipo = await prisma.ipo.create({
      data: {
        companyId: company.id,
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        issueSize: new Prisma.Decimal('12500000000.00'),
        issueShareCount: new Prisma.Decimal('18520085'),
        freshIssueShareCount: new Prisma.Decimal('10000000'),
        ofsShareCount: new Prisma.Decimal('8520085'),
      },
    });

    expect(ipo.issueSize?.toFixed(2)).toBe('12500000000.00');
    expect(ipo.issueShareCount?.toFixed(0)).toBe('18520085');
    expect(ipo.freshIssueShareCount?.toFixed(0)).toBe('10000000');
    expect(ipo.ofsShareCount?.toFixed(0)).toBe('8520085');
    expect(
      ipo.freshIssueShareCount
        ?.plus(ipo.ofsShareCount ?? 0)
        .equals(ipo.issueShareCount ?? 0),
    ).toBe(true);
  });

  it('rejects a second lifecycle date for the same IPO event type', async () => {
    const ipo = await createIpo(prisma);

    await prisma.ipoLifecycleEvent.create({
      data: {
        ipoId: ipo.id,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10'),
      },
    });

    await expect(
      prisma.ipoLifecycleEvent.create({
        data: {
          ipoId: ipo.id,
          eventType: 'OPEN',
          eventDate: new Date('2026-09-11'),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('keeps discovery records append-only for the same source and external id', async () => {
    const source = await prisma.source.create({
      data: {
        code: 'nse',
        name: 'NSE',
        sourceType: 'EXCHANGE',
      },
    });

    await prisma.discoveryRecord.create({
      data: {
        sourceId: source.id,
        externalId: 'IPO123',
        rawPayload: { name: 'Example' },
        contentHash: 'a'.repeat(64),
        discoveredAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    });

    const second = await prisma.discoveryRecord.create({
      data: {
        sourceId: source.id,
        externalId: 'IPO123',
        rawPayload: { name: 'Example Updated' },
        contentHash: 'b'.repeat(64),
        discoveredAt: new Date('2026-09-01T11:00:00.000Z'),
      },
    });

    expect(second.id).toBeDefined();

    await expect(
      prisma.discoveryRecord.create({
        data: {
          sourceId: source.id,
          externalId: 'IPO123',
          rawPayload: { name: 'Example Updated' },
          contentHash: 'b'.repeat(64),
          discoveredAt: new Date('2026-09-01T12:00:00.000Z'),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('allows multiple discovery records with a null external id only when content hashes differ', async () => {
    const source = await prisma.source.create({
      data: {
        code: 'bse',
        name: 'BSE',
        sourceType: 'EXCHANGE',
      },
    });

    await prisma.discoveryRecord.create({
      data: {
        sourceId: source.id,
        rawPayload: { a: 1 },
        contentHash: 'c'.repeat(64),
        discoveredAt: new Date(),
      },
    });

    await prisma.discoveryRecord.create({
      data: {
        sourceId: source.id,
        rawPayload: { a: 2 },
        contentHash: 'd'.repeat(64),
        discoveredAt: new Date(),
      },
    });

    await expect(
      prisma.discoveryRecord.create({
        data: {
          sourceId: source.id,
          rawPayload: { a: 1 },
          contentHash: 'c'.repeat(64),
          discoveredAt: new Date(),
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('restricts deleting an IPO that has change events', async () => {
    const ipo = await createIpo(prisma);

    await prisma.ipoChangeEvent.create({
      data: {
        ipoId: ipo.id,
        fieldName: 'status',
        newValue: 'UPCOMING',
        detectedAt: new Date(),
        changeType: 'STATUS_CHANGED',
      },
    });

    await expect(
      prisma.ipo.delete({ where: { id: ipo.id } }),
    ).rejects.toThrow();

    const remaining = await prisma.ipo.findUnique({ where: { id: ipo.id } });
    expect(remaining).not.toBeNull();
  });

  it('serves GET /api/v1/health against a live database', async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        database: 'up',
      },
    });

    await app.close();
  });
});

async function createIpo(prisma: PrismaClient) {
  const company = await prisma.company.create({
    data: {
      legalName: 'Lifecycle Test Limited',
      displayName: 'Lifecycle Test',
    },
  });

  return prisma.ipo.create({
    data: {
      companyId: company.id,
      marketSegment: 'SME',
      exchange: 'BSE',
    },
  });
}
