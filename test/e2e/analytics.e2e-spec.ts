import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { createTestApp, prismaStub } from './create-test-app';

describe('Analytics API E2E Suite (Phase 30.7)', () => {
  let app: INestApplication;
  let mockPrisma: Record<string, unknown>;

  const mockIpo1 = {
    id: '11111111-1111-1111-1111-111111111111',
    symbol: 'MARKETIPO',
    status: 'OPEN',
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    issueSize: new Prisma.Decimal('500000000.00'),
    freshIssueSize: new Prisma.Decimal('300000000.00'),
    ofsSize: new Prisma.Decimal('200000000.00'),
    issueShareCount: new Prisma.Decimal('5000000.00'),
    freshIssueShareCount: new Prisma.Decimal('3000000.00'),
    ofsShareCount: new Prisma.Decimal('2000000.00'),
    priceBandLow: new Prisma.Decimal('100.00'),
    priceBandHigh: new Prisma.Decimal('120.00'),
    companyId: 'comp-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    lifecycleEvents: [],
  };

  beforeAll(async () => {
    mockPrisma = {
      ...prismaStub,
      ipo: {
        count: jest.fn().mockResolvedValue(1),
        groupBy: jest.fn().mockImplementation((args) => {
          if (args.by.includes('status')) {
            return Promise.resolve([{ status: 'OPEN', _count: { id: 1 } }]);
          }
          if (args.by.includes('marketSegment')) {
            return Promise.resolve([{ marketSegment: 'MAINBOARD', _count: { id: 1 } }]);
          }
          if (args.by.includes('exchange')) {
            return Promise.resolve([{ exchange: 'NSE', _count: { id: 1 } }]);
          }
          return Promise.resolve([]);
        }),
        findMany: jest.fn().mockResolvedValue([mockIpo1]),
      },
      source: {
        findMany: jest.fn().mockResolvedValue([
          { healthStatus: 'HEALTHY', enabled: true },
        ]),
      },
      fieldProvenance: {
        count: jest.fn().mockResolvedValue(10),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ipoLifecycleEvent: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      allotmentCheckLog: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      allotmentCheckJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    app = await createTestApp([], mockPrisma);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /api/v1/analytics/market', () => {
    it('should return 200 OK with wrapped market analytics data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/market')
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('snapshot');
      expect(res.body.data).toHaveProperty('marketSummary');
      expect(res.body.data.snapshot.totalIpos).toBe(1);
    });

    it('should support valid query filters', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/market?segment=MAINBOARD&exchange=NSE&period=MONTH')
        .expect(200);

      expect(res.body.data.filter.segment).toBe('MAINBOARD');
      expect(res.body.data.filter.exchange).toBe('NSE');
      expect(res.body.data.filter.period).toBe('MONTH');
    });

    it('should return 400 Bad Request for invalid date range (from > to)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/market?from=2026-12-31&to=2026-01-01')
        .expect(400);

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });

    it('should return 400 Bad Request for invalid enum value', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/market?segment=INVALID_SEGMENT')
        .expect(400);

      expect(res.status).toBe(400);
      expect(res.body.error).toHaveProperty('code', 'VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/analytics/performance', () => {
    it('should return 200 OK with performance analytics data', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/performance')
        .expect(200);

      expect(res.body.data).toHaveProperty('priceBandSummary');
      expect(res.body.data).toHaveProperty('listingTimeline');
      expect(res.body.data).toHaveProperty('listingPerformance');
      expect(res.body.data.listingPerformance.listingPerformanceSupported).toBe(false);
    });
  });

  describe('GET /api/v1/analytics/subscription', () => {
    it('should return 200 OK with explicit FUTURE_DATA_DEPENDENT status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/subscription')
        .expect(200);

      expect(res.body.data.subscriptionSummary.subscriptionSupported).toBe(false);
      expect(res.body.data.subscriptionSummary.unsupportedMetricReason).toContain(
        'FUTURE_DATA_DEPENDENT',
      );
    });
  });

  describe('GET /api/v1/analytics/allotment', () => {
    it('should return 200 OK with descriptive allotment outcome rates', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/allotment')
        .expect(200);

      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data).toHaveProperty('byIpoDetailed');
      expect(res.body.data.summary).toHaveProperty('disclaimer');
      expect(res.body.data.summary.disclaimer).toContain('descriptive statistics');
    });
  });

  describe('GET /api/v1/analytics/quality', () => {
    it('should return 200 OK with unified data-quality summary', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/quality')
        .expect(200);

      expect(res.body.data).toHaveProperty('overallQualityStatus');
      expect(res.body.data).toHaveProperty('domains');
      expect(res.body.data).toHaveProperty('sourceHealth');
      expect(res.body.data).toHaveProperty('freshness');
    });
  });

  describe('GET /api/v1/analytics/contracts', () => {
    it('should return 200 OK with metric contracts registry', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/contracts')
        .expect(200);

      expect(res.body.data).toHaveProperty('TOTAL_IPOS');
      expect(res.body.data).toHaveProperty('OBSERVED_POSITIVE_ALLOTMENT_RATE');
    });
  });

  describe('Privacy & Security Boundary', () => {
    it('should verify no endpoints expose sensitive PAN or internal credentials', async () => {
      const endpoints = [
        '/api/v1/analytics/market',
        '/api/v1/analytics/performance',
        '/api/v1/analytics/subscription',
        '/api/v1/analytics/allotment',
        '/api/v1/analytics/quality',
        '/api/v1/analytics/contracts',
      ];

      for (const endpoint of endpoints) {
        const res = await request(app.getHttpServer()).get(endpoint).expect(200);
        const json = JSON.stringify(res.body);

        expect(json).not.toContain('panEncrypted');
        expect(json).not.toContain('panMasked');
        expect(json).not.toContain('password');
        expect(json).not.toContain('secret');
        expect(json).not.toContain('credentials');
      }
    });
  });
});
