import { INestApplication } from '@nestjs/common';
import { AllotmentJobStatus, AllotmentResultStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { createTestApp, prismaStub } from './create-test-app';
import { encryptPan } from '../../src/modules/allotment/allotment.utils';

describe('Allotment E2E User Flow', () => {
  let app: INestApplication;
  let mockPrisma: Record<string, unknown>;

  const userId = 'e2e-user-uuid-100';
  const ipoId = '11111111-2222-4333-a444-555555555555';
  const pan1 = 'ABCDE1234F';
  const pan2 = 'XYZAB5678C';

  beforeAll(async () => {
    const mockIpo = {
      id: ipoId,
      symbol: 'TESTIPO',
      priceBandHigh: new Prisma.Decimal('150.00'),
      lotSize: 150,
      company: { displayName: 'Test Corp', legalName: 'Test Corp' },
      status: 'ALLOTMENT_COMPLETED',
    };

    const mockSourceIdentity = {
      externalId: '40580036070',
      source: {
        code: 'KFINTECH',
        sourceType: 'REGISTRAR',
      },
    };

    const mockSavedPans = [
      {
        id: 'sp-1',
        userId,
        panEncrypted: encryptPan(pan1),
        panMasked: 'ABCDE****F',
        panHash: 'hash-1',
      },
      {
        id: 'sp-2',
        userId,
        panEncrypted: encryptPan(pan2),
        panMasked: 'XYZAB****C',
        panHash: 'hash-2',
      },
    ];

    const mockJobRecord = {
      id: 'e2e-job-uuid-999',
      userId,
      ipoId,
      status: AllotmentJobStatus.QUEUED,
      totalChecks: 2,
      processedChecks: 2,
      successfulChecks: 2,
      failedChecks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [
        {
          id: 'item-1',
          identifierHash: 'hash-1',
          maskedId: 'ABCDE****F',
          status: AllotmentResultStatus.ALLOTTED,
          sharesApplied: 150,
          sharesAllotted: 150,
          checkedAt: new Date(),
        },
        {
          id: 'item-2',
          identifierHash: 'hash-2',
          maskedId: 'XYZAB****C',
          status: AllotmentResultStatus.NOT_ALLOTTED,
          sharesApplied: 150,
          sharesAllotted: 0,
          checkedAt: new Date(),
        },
      ],
    };

    mockPrisma = {
      ...prismaStub,
      ipo: {
        findUnique: jest.fn().mockResolvedValue(mockIpo),
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: ipoId,
              symbol: 'TESTIPO',
              priceBandHigh: new Prisma.Decimal('150.00'),
              lotSize: 150,
              company: { displayName: 'Test Corp', legalName: 'Test Corp' },
            },
          ]),
      },
      ipoSourceIdentity: {
        findFirst: jest.fn().mockResolvedValue(mockSourceIdentity),
      },
      ipoAllotmentConfig: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'config-1',
          ipoId,
          registrar: 'KFINTECH',
          registrarIpoCode: '40580036070',
          enabled: true,
        }),
      },
      userSavedPan: {
        findMany: jest.fn().mockResolvedValue(mockSavedPans),
      },
      allotmentCheckJob: {
        create: jest.fn().mockResolvedValue(mockJobRecord),
        findUnique: jest.fn().mockResolvedValue(mockJobRecord),
        findMany: jest.fn().mockResolvedValue([mockJobRecord]),
        update: jest.fn().mockResolvedValue(mockJobRecord),
      },
      allotmentCheckJobItem: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    app = await createTestApp([], mockPrisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should execute end-to-end bulk job flow using saved PANs without exposing plaintext PAN', async () => {
    // 1. Mock external fetch call for KFintech API Gateway
    jest.spyOn(global, 'fetch').mockImplementation((url: unknown) => {
      if (String(url).includes('0uz601ms56.execute-api')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [
            {
              All_Shares: 150,
              App_Shares: 150,
              Appln_No: 'APP999',
              Name: 'HOLDER TEST',
            },
          ],
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    // 2. Create Job via POST /api/v1/allotment/jobs (ipoId only)
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/allotment/jobs')
      .set('Authorization', `Bearer test-token:${userId}`)
      .send({ ipoId })
      .expect(201);

    const jobData = createRes.body.data || createRes.body;
    expect(jobData).toBeDefined();
    expect(jobData.ipoId).toBe(ipoId);
    expect(jobData.totalChecks).toBe(2);

    const jobId = jobData.id as string;

    // 3. Query Job status via GET /api/v1/allotment/jobs/:id
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/allotment/jobs/${jobId}`)
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    const fetchJobData = getRes.body.data || getRes.body;
    expect(fetchJobData.id).toBe(jobId);
    expect(fetchJobData.progressMessage).toContain('Checking');

    // 4. Security Assertion: Verify NO plaintext PAN appears anywhere in API response
    const resString = JSON.stringify(getRes.body);
    expect(resString).not.toContain(pan1);
    expect(resString).not.toContain(pan2);

    // 5. Security Assertion: Verify DB mock arguments do NOT contain plaintext PAN
    const createCalls = (
      mockPrisma as { allotmentCheckJob: { create: jest.Mock } }
    ).allotmentCheckJob.create.mock.calls;
    const dbString = JSON.stringify(createCalls);
    expect(dbString).not.toContain(pan1);
    expect(dbString).not.toContain(pan2);
  });

  it('should reject x-user-id spoofing without valid Bearer token with 401 UNAUTHORIZED', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/summary')
      .set('x-user-id', userId)
      .expect(401);
  });

  it('should return authenticated user summary allotment intelligence', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/summary')
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.summary.totalJobs).toBe(1);
    expect(res.body.data.summary.totalChecks).toBe(2);
    expect(res.body.data.summary.allottedChecks).toBe(1);
    expect(res.body.data.summary.notAllottedChecks).toBe(1);
    expect(res.body.data.summary.observedAllotmentRate).toBe('50.00');

    // Verify privacy: no raw PAN exposed in response
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(pan1);
    expect(bodyStr).not.toContain(pan2);
  });

  it('should return 401 UNAUTHORIZED for user summary intelligence when unauthenticated', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/summary')
      .expect(401);
  });

  it('should return authenticated job-specific intelligence', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/allotment/jobs/e2e-job-uuid-999/intelligence')
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.jobId).toBe('e2e-job-uuid-999');
    expect(res.body.data.summary.allottedChecks).toBe(1);
    expect(res.body.data.accounts).toHaveLength(2);
  });

  it('should return 404 NOT_FOUND when accessing job belonging to another user', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/allotment/jobs/e2e-job-uuid-999/intelligence')
      .set('Authorization', 'Bearer test-token:other-user-uuid-999')
      .expect(404);
  });

  it('should return authenticated user allotment history (GET /intelligence/history)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/history')
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.summary.totalDistinctPanIpoPairs).toBe(2);
    expect(res.body.data.summary.totalIposChecked).toBe(1);
    expect(res.body.data.summary.allottedCount).toBe(1);
    expect(res.body.data.summary.notAllottedCount).toBe(1);
    expect(res.body.data.summary.observedLatestResultRate).toBe('50.00');
    expect(res.body.data.summary.allotmentLotRatio).toBe('50.00');
    expect(res.body.data.monthlyTrend).toBeDefined();

    expect(res.body.data.quality).toBeDefined();
    expect(res.body.data.quality.totalObservations).toBe(2);
    expect(res.body.data.quality.observationCoveragePercentage).toBe('100.00');
    expect(res.body.data.quality.boundedHistory).toBe(true);

    // Security assertion: no raw PAN in response
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(pan1);
    expect(bodyStr).not.toContain(pan2);
  });

  it('should return 401 UNAUTHORIZED for allotment history when unauthenticated', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/history')
      .expect(401);
  });

  it('should return authenticated per-PAN intelligence (GET /intelligence/pans)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/pans')
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.pans).toHaveLength(2);

    const p1 = res.body.data.pans.find((p: any) => p.maskedPan === 'ABCDE****F');
    expect(p1).toBeDefined();
    expect(p1.totalDistinctIposChecked).toBe(1);
    expect(p1.allottedCount).toBe(1);
    expect(p1.observedLatestResultRate).toBe('100.00');
    expect(p1.totalLotsApplied).toBe(1);
    expect(p1.totalLotsAllotted).toBe(1);
    expect(p1.allotmentLotRatio).toBe('100.00');
    expect(p1.quality).toBeDefined();
    expect(p1.quality.totalObservations).toBe(1);

    // Security assertion: no raw PAN in response
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(pan1);
    expect(bodyStr).not.toContain(pan2);
  });

  it('should return 401 UNAUTHORIZED for PAN intelligence when unauthenticated', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/allotment/intelligence/pans')
      .expect(401);
  });

  it('should return authenticated per-IPO intelligence (GET /ipos/:id/intelligence)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/allotment/ipos/${ipoId}/intelligence`)
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.ipoId).toBe(ipoId);
    expect(res.body.data.userSummary.totalDistinctPanIpoPairs).toBe(2);
    expect(res.body.data.userSummary.allotmentLotRatio).toBe('50.00');
    expect(res.body.data.accounts).toHaveLength(2);
    expect(res.body.data.quality).toBeDefined();
    expect(res.body.data.quality.totalObservations).toBe(2);

    // Security assertion: no raw PAN in response
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain(pan1);
    expect(bodyStr).not.toContain(pan2);
  });

  it('should return 401 UNAUTHORIZED for per-IPO intelligence when unauthenticated', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/allotment/ipos/${ipoId}/intelligence`)
      .expect(401);
  });

  it('should return 404 NOT_FOUND for per-IPO intelligence when IPO does not exist', async () => {
    (mockPrisma.ipo as { findUnique: jest.Mock }).findUnique.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get('/api/v1/allotment/ipos/00000000-0000-0000-0000-000000000000/intelligence')
      .set('Authorization', `Bearer test-token:${userId}`)
      .expect(404);
  });
});
