import { INestApplication } from '@nestjs/common';
import { AllotmentJobStatus, AllotmentResultStatus, Prisma } from '@prisma/client';
import request from 'supertest';
import { createTestApp, prismaStub } from './create-test-app';
import { encryptPan, hashIdentifier } from '../../src/modules/allotment/allotment.utils';

describe('Security: Authentication & Ownership Isolation (e2e)', () => {
  let app: INestApplication;

  const userAlice = 'firebase-uid-alice-123';
  const userBob = 'firebase-uid-bob-456';
  const ipoId = '11111111-2222-4333-a444-555555555555';

  const alicePanId = 'pan-alice-1';
  const bobPanId = 'pan-bob-1';
  const alicePanPlain = 'ABCDE1234F';
  const bobPanPlain = 'XYZAB5678C';

  const aliceJobId = 'job-alice-100';

  // In-memory data store for prisma stub
  const dbSavedPans: Array<{
    id: string;
    userId: string;
    panEncrypted: string;
    panMasked: string;
    panHash: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [
    {
      id: alicePanId,
      userId: userAlice,
      panEncrypted: encryptPan(alicePanPlain),
      panMasked: 'ABCDE****F',
      panHash: hashIdentifier(alicePanPlain),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: bobPanId,
      userId: userBob,
      panEncrypted: encryptPan(bobPanPlain),
      panMasked: 'XYZAB****C',
      panHash: hashIdentifier(bobPanPlain),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockIpo = {
    id: ipoId,
    symbol: 'SECURITYIPO',
    priceBandHigh: new Prisma.Decimal('100.00'),
    lotSize: 100,
    company: { displayName: 'Security Corp', legalName: 'Security Corp' },
    status: 'ALLOTMENT_COMPLETED',
  };

  const mockJob = {
    id: aliceJobId,
    userId: userAlice,
    ipoId,
    status: AllotmentJobStatus.COMPLETED,
    totalChecks: 1,
    processedChecks: 1,
    successfulChecks: 1,
    failedChecks: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        id: 'job-item-1',
        identifierHash: hashIdentifier(alicePanPlain),
        maskedId: 'ABCDE****F',
        status: AllotmentResultStatus.ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 100,
        checkedAt: new Date(),
      },
    ],
  };

  const customPrisma = {
    ...prismaStub,
    ipo: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === ipoId) return mockIpo;
        return null;
      }),
      findMany: jest.fn(async () => [mockIpo]),
    },
    ipoSourceIdentity: {
      findFirst: jest.fn(async () => null),
    },
    userSavedPan: {
      findMany: jest.fn(async ({ where }: any) => {
        return dbSavedPans.filter((p) => p.userId === where.userId);
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) {
          return dbSavedPans.find((p) => p.id === where.id) || null;
        }
        if (where.userId_panHash) {
          return (
            dbSavedPans.find(
              (p) =>
                p.userId === where.userId_panHash.userId &&
                p.panHash === where.userId_panHash.panHash,
            ) || null
          );
        }
        return null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          dbSavedPans.find(
            (p) =>
              (where.id ? p.id === where.id : true) &&
              (where.userId ? p.userId === where.userId : true) &&
              (where.panHash ? p.panHash === where.panHash : true),
          ) || null
        );
      }),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const existing = dbSavedPans.find(
          (p) =>
            p.userId === where.userId_panHash.userId &&
            p.panHash === where.userId_panHash.panHash,
        );
        if (existing) {
          existing.panEncrypted = update.panEncrypted;
          existing.panMasked = update.panMasked;
          existing.updatedAt = new Date();
          return existing;
        }
        const created = {
          id: `pan-${Date.now()}-${Math.random()}`,
          userId: create.userId,
          panEncrypted: create.panEncrypted,
          panMasked: create.panMasked,
          panHash: create.panHash,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbSavedPans.push(created);
        return created;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = dbSavedPans.findIndex((p) => p.id === where.id);
        if (idx !== -1) {
          const removed = dbSavedPans.splice(idx, 1)[0];
          return removed;
        }
        throw new Error('Record to delete does not exist');
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        let count = 0;
        for (let i = dbSavedPans.length - 1; i >= 0; i--) {
          if (dbSavedPans[i].userId === where.userId) {
            dbSavedPans.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    allotmentCheckJob: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id === aliceJobId) return mockJob;
        return null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === aliceJobId && (!where.userId || where.userId === userAlice)) {
          return mockJob;
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => ({
        id: `job-${Date.now()}`,
        userId: data.userId,
        ipoId: data.ipoId,
        status: AllotmentJobStatus.QUEUED,
        totalChecks: 1,
        processedChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      findMany: jest.fn(async () => [mockJob]),
    },
    brokerAccount: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.userId === userAlice) {
          return [
            {
              id: 'broker-alice-1',
              userId: userAlice,
              broker: 'ZERODHA',
              accountIdentifier: 'ALICE123',
              status: 'CONNECTED',
              connection: null,
            },
          ];
        }
        return [];
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.id === 'broker-alice-1' && where?.userId === userAlice) {
          return {
            id: 'broker-alice-1',
            userId: userAlice,
            broker: 'ZERODHA',
            accountIdentifier: 'ALICE123',
            status: 'CONNECTED',
            connection: null,
          };
        }
        return null;
      }),
    },
    notificationPreference: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    notification: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
      upsert: jest.fn(async () => ({})),
    },
    notificationDelivery: {
      count: jest.fn(async () => 0),
      groupBy: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      aggregate: jest.fn(async () => ({ _sum: { attemptCount: 0 } })),
    },
  };

  beforeAll(async () => {
    app = await createTestApp([], customPrisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Authentication Guard & Token Verification', () => {
    it('rejects unauthenticated requests to PAN sync with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/user/pans/sync')
        .send({ pans: ['ABCDE1234F'] });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated requests to allotment job creation with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/allotment/jobs')
        .send({ ipoId, autoUseSavedPans: true });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated requests to allotment job retrieval with 401', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/allotment/jobs/${aliceJobId}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated requests to broker accounts with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/broker-accounts');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects unauthenticated requests to notifications with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects invalid token scheme (e.g. Basic auth) with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', 'Basic dXNlcjpwYXNz');
      expect(res.status).toBe(401);
    });

    it('rejects malformed/invalid Bearer tokens with 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('Authorization', 'Bearer invalid-token-string');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Anti-Spoofing: x-user-id header is ignored in favor of verified UID', () => {
    it('does NOT allow x-user-id header to authenticate without Bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('x-user-id', userAlice);
      expect(res.status).toBe(401);
    });

    it('does NOT allow x-user-id header to impersonate another user when authenticated as Bob', async () => {
      // Bob authenticates as Bob, but tries to send x-user-id: userAlice
      const res = await request(app.getHttpServer())
        .get('/api/v1/broker-accounts')
        .set('Authorization', `Bearer test-token:${userBob}`)
        .set('x-user-id', userAlice);

      expect(res.status).toBe(200);
      // Bob has 0 broker accounts, Alice has 1. Bob must receive only his own accounts ([]).
      expect(res.body.data).toEqual([]);
    });
  });

  describe('3. PAN Deletion Scoping & Ownership', () => {
    it('Bob cannot delete Alice PAN by ID (returns 404)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/user/pans/${alicePanId}`)
        .set('Authorization', `Bearer test-token:${userBob}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Alice can delete her own PAN by ID (returns 200)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/user/pans/${alicePanId}`)
        .set('Authorization', `Bearer test-token:${userAlice}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(alicePanId);
    });

    it('Bob can delete all of his own PANs via bulk DELETE /api/v1/user/pans', async () => {
      const res = await request(app.getHttpServer())
        .delete('/api/v1/user/pans')
        .set('Authorization', `Bearer test-token:${userBob}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deletedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Allotment Job & Intelligence Ownership Isolation', () => {
    it('Bob cannot access Alice allotment job (returns 404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/allotment/jobs/${aliceJobId}`)
        .set('Authorization', `Bearer test-token:${userBob}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Alice can access her own allotment job (returns 200)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/allotment/jobs/${aliceJobId}`)
        .set('Authorization', `Bearer test-token:${userAlice}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(aliceJobId);
      expect(res.body.data.userId).toBe(userAlice);
    });

    it('Bob cannot access intelligence for Alice allotment job (returns 404)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/allotment/jobs/${aliceJobId}/intelligence`)
        .set('Authorization', `Bearer test-token:${userBob}`);

      expect(res.status).toBe(404);
    });

    it('Bob cannot trigger retry-failed on Alice allotment job (returns 404)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/allotment/jobs/${aliceJobId}/retry-failed`)
        .set('Authorization', `Bearer test-token:${userBob}`);

      expect(res.status).toBe(404);
    });
  });

  describe('5. Public Route Exceptions (Explicit & Documented)', () => {
    it('POST /api/v1/allotment/check is public for instant stateless registrar checks', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/allotment/check')
        .send({
          ipoId,
          identifierType: 'PAN',
          identifierValue: 'ABCDE1234F',
          sourceType: 'REGISTRAR',
        });

      // Public route - does NOT return 401
      expect(res.status).not.toBe(401);
    });

    it('GET /api/v1/allotment/sources is public for fetching registrar sources', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/allotment/sources');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('GET /api/v1/notifications/delivery/operations is public aggregate monitoring', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/notifications/delivery/operations');

      expect(res.status).toBe(200);
    });
  });
});
