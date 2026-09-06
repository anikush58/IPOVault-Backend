import { INestApplication } from '@nestjs/common';
import { AllotmentJobStatus, AllotmentResultStatus } from '@prisma/client';
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
          maskedId: 'ABCDE****F',
          status: AllotmentResultStatus.ALLOTTED,
          sharesApplied: 150,
          sharesAllotted: 150,
          checkedAt: new Date(),
        },
        {
          id: 'item-2',
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
      },
      ipoSourceIdentity: {
        findFirst: jest.fn().mockResolvedValue(mockSourceIdentity),
      },
      userSavedPan: {
        findMany: jest.fn().mockResolvedValue(mockSavedPans),
      },
      allotmentCheckJob: {
        create: jest.fn().mockResolvedValue(mockJobRecord),
        findUnique: jest.fn().mockResolvedValue(mockJobRecord),
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
      .set('x-user-id', userId)
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
      .set('x-user-id', userId)
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
});
