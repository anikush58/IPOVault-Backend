import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './create-test-app';

describe('Notification API & Preferences (e2e)', () => {
  let app: INestApplication;

  const userA = 'user-alice-123';
  const userB = 'user-bob-456';

  const sampleNotifications = [
    {
      id: '11111111-1111-4111-a111-111111111111',
      userId: userA,
      type: 'IPO_OPENED',
      title: 'Acme IPO Opened',
      message: 'Subscription opened',
      relatedEntityType: 'IPO',
      relatedEntityId: 'ipo-uuid-1',
      metadata: { companyName: 'Acme Corp', symbol: 'ACME' },
      deduplicationKey: 'ipo_opened:ipo-uuid-1:event-1',
      readAt: null,
      createdAt: new Date('2026-09-10T10:00:00.000Z'),
      updatedAt: new Date('2026-09-10T10:00:00.000Z'),
    },
    {
      id: '22222222-2222-4222-a222-222222222222',
      userId: userA,
      type: 'ALLOTTED_RESULT_AVAILABLE',
      title: 'Allotment Result Available',
      message: 'Shares allotted',
      relatedEntityType: 'IPO',
      relatedEntityId: 'ipo-uuid-1',
      metadata: {
        companyName: 'Acme Corp',
        symbol: 'ACME',
        status: 'ALLOTTED',
        sharesApplied: 100,
        sharesAllotted: 100,
        maskedId: 'ABCDE****F',
      },
      deduplicationKey: 'allotment_result:ipo-uuid-1:job-item-1',
      readAt: new Date('2026-09-10T11:00:00.000Z'),
      createdAt: new Date('2026-09-10T10:30:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
    },
    {
      id: '33333333-3333-4333-a333-333333333333',
      userId: userB,
      type: 'IPO_CLOSED',
      title: 'Bob Notification',
      message: 'Private message for Bob',
      relatedEntityType: 'IPO',
      relatedEntityId: 'ipo-uuid-2',
      metadata: { companyName: 'Beta Corp' },
      deduplicationKey: 'ipo_closed:ipo-uuid-2:event-2',
      readAt: null,
      createdAt: new Date('2026-09-10T09:00:00.000Z'),
      updatedAt: new Date('2026-09-10T09:00:00.000Z'),
    },
  ];

  const dbNotifications = [...sampleNotifications];
  const dbPreferences: Array<{
    id: string;
    userId: string;
    notificationType: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  const customPrisma = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
    notificationPreference: {
      findMany: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId;
        return dbPreferences.filter((p) => p.userId === userId);
      }),
      findUnique: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId_notificationType?.userId;
        const type = args?.where?.userId_notificationType?.notificationType;
        return (
          dbPreferences.find(
            (p) => p.userId === userId && p.notificationType === type,
          ) || null
        );
      }),
      upsert: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId_notificationType?.userId;
        const type = args?.where?.userId_notificationType?.notificationType;
        let existing = dbPreferences.find(
          (p) => p.userId === userId && p.notificationType === type,
        );
        if (existing) {
          existing.enabled = args.update.enabled;
          existing.updatedAt = new Date();
          return existing;
        }
        const newPref = {
          id: `pref-${Date.now()}`,
          userId,
          notificationType: type,
          enabled: args.create.enabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbPreferences.push(newPref);
        return newPref;
      }),
      deleteMany: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId;
        let count = 0;
        for (let i = dbPreferences.length - 1; i >= 0; i--) {
          if (dbPreferences[i].userId === userId) {
            dbPreferences.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
    notification: {
      findMany: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId;
        const unreadOnly = args?.where?.readAt === null;
        let filtered = dbNotifications.filter((n) => n.userId === userId);
        if (unreadOnly) {
          filtered = filtered.filter((n) => n.readAt === null);
        }
        filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const skip = args?.skip || 0;
        const take = args?.take || filtered.length;
        return filtered.slice(skip, skip + take);
      }),
      count: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId;
        const unreadOnly = args?.where?.readAt === null;
        let filtered = dbNotifications.filter((n) => n.userId === userId);
        if (unreadOnly) {
          filtered = filtered.filter((n) => n.readAt === null);
        }
        return filtered.length;
      }),
      findFirst: jest.fn(async (args?: any) => {
        const id = args?.where?.id;
        const userId = args?.where?.userId;
        return dbNotifications.find((n) => n.id === id && n.userId === userId) || null;
      }),
      update: jest.fn(async (args?: any) => {
        const id = args?.where?.id;
        const item = dbNotifications.find((n) => n.id === id);
        if (item) {
          item.readAt = args?.data?.readAt || new Date();
          return item;
        }
        throw new Error('Not found');
      }),
      updateMany: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId;
        const unreadOnly = args?.where?.readAt === null;
        let count = 0;
        const now = new Date();
        dbNotifications.forEach((n) => {
          if (n.userId === userId && (!unreadOnly || n.readAt === null)) {
            n.readAt = now;
            count++;
          }
        });
        return { count };
      }),
      upsert: jest.fn(async (args?: any) => {
        const userId = args?.where?.userId_deduplicationKey?.userId;
        const key = args?.where?.userId_deduplicationKey?.deduplicationKey;
        const existing = dbNotifications.find(
          (n) => n.userId === userId && n.deduplicationKey === key,
        );
        if (existing) {
          return existing;
        }
        const newItem = {
          id: `new-${Date.now()}`,
          userId,
          type: args.create.type,
          title: args.create.title,
          message: args.create.message,
          relatedEntityType: args.create.relatedEntityType || null,
          relatedEntityId: args.create.relatedEntityId || null,
          metadata: args.create.metadata || null,
          deduplicationKey: key,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        dbNotifications.push(newItem);
        return newItem;
      }),
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

  describe('Delivery Operations & Visibility API (Phase 29.8 e2e)', () => {
    it('GET /api/v1/notifications/delivery/operations returns aggregate health summary', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/delivery/operations')
        .expect(200);

      expect(response.body.data).toEqual(
        expect.objectContaining({
          totalDeliveries: expect.any(Number),
          pendingCount: expect.any(Number),
          processingCount: expect.any(Number),
          deliveredCount: expect.any(Number),
          failedCount: expect.any(Number),
          exhaustedFailedCount: expect.any(Number),
          retryableFailedCount: expect.any(Number),
          staleProcessingCount: expect.any(Number),
          deliverySuccessRatePercentage: expect.any(Number),
          deliveryFailureRatePercentage: expect.any(Number),
          recentHealth: expect.objectContaining({
            windowMs: 86400000,
            deliveriesCreated: expect.any(Number),
            delivered: expect.any(Number),
            failed: expect.any(Number),
            exhausted: expect.any(Number),
            retryAttempts: expect.any(Number),
          }),
        }),
      );

      const jsonStr = JSON.stringify(response.body);
      expect(jsonStr).not.toContain('userId');
      expect(jsonStr).not.toContain('panHash');
      expect(jsonStr).not.toContain('panEncrypted');
    });
  });

  describe('Notification Preferences API (Phase 29.2 e2e)', () => {
    it('1, 2, 3. GET /api/v1/notifications/preferences returns all supported types in default state', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.preferences).toHaveLength(6);
      for (const pref of response.body.data.preferences) {
        expect(pref.enabled).toBe(true);
        expect(pref.isDefault).toBe(true);
      }
    });

    it('4, 5. PUT /api/v1/notifications/preferences/:type disables a notification type and persists state', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_OPENED')
        .set('x-user-id', userA)
        .send({ enabled: false })
        .expect(200);

      expect(response.body.data).toEqual({
        type: 'IPO_OPENED',
        enabled: false,
        isDefault: false,
      });

      // Verify GET preferences reflects disabled state for userA
      const getRes = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set('x-user-id', userA)
        .expect(200);

      const ipoOpenedPref = getRes.body.data.preferences.find(
        (p: any) => p.type === 'IPO_OPENED',
      );
      expect(ipoOpenedPref).toEqual({
        type: 'IPO_OPENED',
        enabled: false,
        isDefault: false,
      });
    });

    it('6. PUT /api/v1/notifications/preferences/:type re-enables a notification type', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_OPENED')
        .set('x-user-id', userA)
        .send({ enabled: true })
        .expect(200);

      expect(response.body.data.enabled).toBe(true);
    });

    it('7. POST /api/v1/notifications/preferences/reset resets preferences to system defaults', async () => {
      // First disable a preference
      await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_CLOSED')
        .set('x-user-id', userA)
        .send({ enabled: false });

      const response = await request(app.getHttpServer())
        .post('/api/v1/notifications/preferences/reset')
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.preferences).toHaveLength(6);
      expect(response.body.data.preferences.every((p: any) => p.isDefault)).toBe(true);
    });

    it('8. User Isolation: User A preference changes do not affect User B', async () => {
      // Disable IPO_DATA_CHANGED for userA
      await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_DATA_CHANGED')
        .set('x-user-id', userA)
        .send({ enabled: false });

      // Check User B preferences
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications/preferences')
        .set('x-user-id', userB)
        .expect(200);

      const userBPref = response.body.data.preferences.find(
        (p: any) => p.type === 'IPO_DATA_CHANGED',
      );
      expect(userBPref.enabled).toBe(true);
      expect(userBPref.isDefault).toBe(true);
    });

    it('9. Returns 400 Bad Request for unsupported notification type', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/INVALID_UNKNOWN_TYPE')
        .set('x-user-id', userA)
        .send({ enabled: false })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('10. Returns 400 Bad Request for invalid request body', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_OPENED')
        .set('x-user-id', userA)
        .send({ enabled: 'not-a-boolean' })
        .expect(400);
    });

    it('11. Disabling preference preserves existing notifications in list', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/notifications/preferences/IPO_OPENED')
        .set('x-user-id', userA)
        .send({ enabled: false });

      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('x-user-id', userA)
        .expect(200);

      // Existing sample notification of type IPO_OPENED remains
      const exists = response.body.data.notifications.some(
        (n: any) => n.type === 'IPO_OPENED',
      );
      expect(exists).toBe(true);
    });
  });

  describe('Notifications List & Details (Phase 29.1 e2e preserved)', () => {
    it('lists notifications for authenticated user', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.notifications.length).toBeGreaterThan(0);
    });

    it('retrieves owned notification', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/notifications/${sampleNotifications[0].id}`)
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.id).toBe(sampleNotifications[0].id);
    });

    it('returns 404 for unowned notification', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/notifications/${sampleNotifications[2].id}`)
        .set('x-user-id', userA)
        .expect(404);
    });

    it('marks notification as read', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/notifications/${sampleNotifications[0].id}/read`)
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.readAt).not.toBeNull();
    });

    it('marks all unread notifications as read', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/notifications/read-all')
        .set('x-user-id', userA)
        .expect(200);

      expect(response.body.data.updatedCount).toBeGreaterThanOrEqual(0);
    });

    it('returns 401 if x-user-id header is missing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .expect(401);
    });

    it('verifies sensitive data (PAN, panHash, panEncrypted) is not exposed', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/notifications')
        .set('x-user-id', userA)
        .expect(200);

      const jsonString = JSON.stringify(response.body);
      expect(jsonString).not.toContain('panHash');
      expect(jsonString).not.toContain('panEncrypted');
      expect(jsonString).not.toContain('identifierHash');
    });
  });
});
