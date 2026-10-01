import { NotificationType } from './notification.types';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationRepository } from './notification.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { ExpoPushDeliveryAdapter } from './adapters/expo-push-delivery.adapter';
import { InAppDeliveryAdapter } from './adapters/in-app-delivery.adapter';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';
import { NotificationService } from './notification.service';
import { IpoTimelineSchedulerService } from '../ipos/ipo-timeline-scheduler.service';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from '../allotment/registrar.resolver';

describe('IPO Allotment Mobile Push Notification & Delivery Suite', () => {
  let generator: NotificationEventGenerator;
  let orchestrator: NotificationOrchestratorService;
  let repository: NotificationRepository;
  let deliveryService: NotificationDeliveryService;
  let inAppAdapter: InAppDeliveryAdapter;
  let pushAdapter: ExpoPushDeliveryAdapter;
  let notificationService: NotificationService;
  let prismaMock: any;
  let qualityGateMock: any;

  const mockIpoId = '11111111-1111-1111-1111-111111111111';
  const mockUserWithInvestment = 'user_investor_123';
  const mockUserWithJob = 'user_job_456';
  const mockUserWithPanLog = 'user_pan_789';
  const mockUserUnrelated = 'user_unrelated_999';

  let dbNotifications: any[];
  let dbDeliveries: any[];
  let dbPushTokens: any[];

  beforeEach(() => {
    generator = new NotificationEventGenerator();
    qualityGateMock = {} as DiscoveryQualityGateService;

    dbNotifications = [];
    dbDeliveries = [];
    dbPushTokens = [
      {
        id: 'tok-1',
        userId: mockUserWithInvestment,
        token: 'ExponentPushToken[user1-token]',
        platform: 'android',
        isActive: true,
      },
      {
        id: 'tok-2',
        userId: mockUserWithJob,
        token: 'ExponentPushToken[user2-token]',
        platform: 'ios',
        isActive: true,
      },
    ];

    prismaMock = {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn(),
      },
      notification: {
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          return (
            dbNotifications.find(
              (n) =>
                n.userId === where.userId_deduplicationKey.userId &&
                n.deduplicationKey === where.userId_deduplicationKey.deduplicationKey,
            ) || null
          );
        }),
        upsert: jest.fn().mockImplementation(async ({ where, create }) => {
          const existing = dbNotifications.find(
            (n) =>
              n.userId === where.userId_deduplicationKey.userId &&
              n.deduplicationKey === where.userId_deduplicationKey.deduplicationKey,
          );
          if (existing) {
            return existing;
          }
          const newRow = {
            id: `notif-${dbNotifications.length + 1}`,
            ...create,
            readAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          dbNotifications.push(newRow);
          return newRow;
        }),
        findMany: jest.fn().mockImplementation(async () => dbNotifications),
      },
      notificationDelivery: {
        findUnique: jest.fn().mockImplementation(async ({ where }) => {
          return (
            dbDeliveries.find(
              (d) =>
                d.notificationId === where.notificationId_channel.notificationId &&
                d.channel === where.notificationId_channel.channel,
            ) || null
          );
        }),
        create: jest.fn().mockImplementation(async ({ data }) => {
          const newDelivery = {
            id: `del-${dbDeliveries.length + 1}`,
            ...data,
            attemptCount: 0,
            status: 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          dbDeliveries.push(newDelivery);
          return newDelivery;
        }),
        update: jest.fn().mockImplementation(async ({ where, data }) => {
          const idx = dbDeliveries.findIndex((d) => d.id === where.id);
          if (idx >= 0) {
            dbDeliveries[idx] = { ...dbDeliveries[idx], ...data };
            return dbDeliveries[idx];
          }
          return null;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userPushToken: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          return dbPushTokens.filter(
            (t) =>
              (where.userId === undefined || t.userId === where.userId) &&
              (where.isActive === undefined || t.isActive === where.isActive),
          );
        }),
        upsert: jest.fn().mockImplementation(async ({ where, create, update }) => {
          const idx = dbPushTokens.findIndex(
            (t) => t.userId === where.userId_token.userId && t.token === where.userId_token.token,
          );
          if (idx >= 0) {
            dbPushTokens[idx] = { ...dbPushTokens[idx], ...update };
            return dbPushTokens[idx];
          }
          const newTok = {
            id: `tok-${dbPushTokens.length + 1}`,
            ...create,
          };
          dbPushTokens.push(newTok);
          return newTok;
        }),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          let count = 0;
          dbPushTokens.forEach((t) => {
            if (where.id?.in && where.id.in.includes(t.id)) {
              Object.assign(t, data);
              count++;
            }
            if (where.userId === t.userId && where.token === t.token) {
              Object.assign(t, data);
              count++;
            }
          });
          return { count };
        }),
      },
      ipo: {
        findUnique: jest.fn().mockResolvedValue({
          id: mockIpoId,
          symbol: 'ACME',
          status: 'ALLOTMENT_COMPLETED',
          allotmentResultAvailableAt: new Date('2026-09-23T17:30:00.000Z'),
          lotSize: 50,
          priceBandHigh: '250.00',
          company: {
            displayName: 'Acme Technologies Ltd',
            legalName: 'Acme Technologies Limited',
          },
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      ipoInvestment: {
        findMany: jest.fn().mockResolvedValue([
          { brokerAccount: { userId: mockUserWithInvestment } },
        ]),
      },
      allotmentCheckJob: {
        findMany: jest.fn().mockResolvedValue([
          { userId: mockUserWithJob },
        ]),
      },
      allotmentCheckLog: {
        findMany: jest.fn().mockResolvedValue([
          { identifierHash: 'hash_pan_789' },
        ]),
      },
      userSavedPan: {
        findMany: jest.fn().mockResolvedValue([
          { userId: mockUserWithPanLog },
        ]),
      },
    };

    inAppAdapter = new InAppDeliveryAdapter();
    pushAdapter = new ExpoPushDeliveryAdapter(prismaMock);
    const deliveryRepoMock: any = {
      createDelivery: jest.fn().mockImplementation(async (notificationId, channel) => {
        const existing = await prismaMock.notificationDelivery.findUnique({
          where: { notificationId_channel: { notificationId, channel } },
        });
        if (existing) return existing;
        return prismaMock.notificationDelivery.create({
          data: { notificationId, channel, status: 'PENDING' },
        });
      }),
      claimDelivery: jest.fn().mockResolvedValue({
        status: 'CLAIMED',
        record: { id: 'del-claim-1', attemptCount: 0, status: 'PROCESSING' },
      }),
      conditionalFinalizeDelivery: jest.fn().mockResolvedValue({
        status: 'FINALIZED',
        record: { id: 'del-claim-1', status: 'DELIVERED' },
      }),
      updateDelivery: jest.fn().mockResolvedValue({ status: 'DELIVERED' }),
      findDelivery: jest.fn().mockResolvedValue(null),
    };

    deliveryService = new NotificationDeliveryService(
      deliveryRepoMock,
      inAppAdapter,
      pushAdapter,
    );

    repository = new NotificationRepository(prismaMock, deliveryService);
    orchestrator = new NotificationOrchestratorService(
      prismaMock,
      repository,
      generator,
      qualityGateMock,
    );
    notificationService = new NotificationService(prismaMock, repository, generator);
  });

  describe('1. Token Registration', () => {
    it('should securely register and associate an Expo push token with a user', async () => {
      const res = await notificationService.registerPushToken(mockUserWithInvestment, {
        token: 'ExponentPushToken[new-test-token]',
        platform: 'android',
      });

      expect(res.success).toBe(true);
      expect(res.token).toBe('ExponentPushToken[new-test-token]');

      const tokens = await prismaMock.userPushToken.findMany({
        where: { userId: mockUserWithInvestment },
      });
      const registered = tokens.find((t: any) => t.token === 'ExponentPushToken[new-test-token]');
      expect(registered).toBeDefined();
      expect(registered?.isActive).toBe(true);
    });

    it('should deactivate push token on user sign-out/unregistration', async () => {
      const res = await notificationService.deactivatePushToken(
        mockUserWithInvestment,
        'ExponentPushToken[user1-token]',
      );

      expect(res.success).toBe(true);
      const token = dbPushTokens.find((t) => t.id === 'tok-1');
      expect(token?.isActive).toBe(false);
    });
  });

  describe('2. Successful Allotment Notification', () => {
    it('should generate correct title and body format for Allotment Out', () => {
      const input = generator.generateAllotmentOutNotification(mockUserWithInvestment, {
        id: mockIpoId,
        companyName: 'Acme Technologies Ltd',
        symbol: 'ACME',
      });

      expect(input.title).toBe('IPO Allotment Out');
      expect(input.message).toBe(
        'Acme Technologies Ltd allotment is now available. Check your allotment status.',
      );
      expect(input.type).toBe(NotificationType.ALLOTTED_RESULT_AVAILABLE);
      expect(input.deduplicationKey).toBe(`ipo_allotment_out:${mockIpoId}`);
      expect(input.metadata).toEqual({
        ipoId: mockIpoId,
        companyName: 'Acme Technologies Ltd',
        symbol: 'ACME',
      });
    });

    it('should trigger notification on first confirmed allotment detection', async () => {
      const result = await orchestrator.processAllotmentOutEvent(mockIpoId);

      expect(result.evaluatedCount).toBe(3);
      expect(result.createdCount).toBe(3);
      expect(result.suppressedCount).toBe(0);

      const created = await prismaMock.notification.findMany();
      expect(created.length).toBe(3);
      expect(created[0].title).toBe('IPO Allotment Out');
      expect(created[0].message).toBe(
        'Acme Technologies Ltd allotment is now available. Check your allotment status.',
      );
    });

    it('should only notify eligible users and exclude unrelated users', async () => {
      await orchestrator.processAllotmentOutEvent(mockIpoId);

      const createdNotifications = await prismaMock.notification.findMany();
      const notifiedUserIds = createdNotifications.map((n: any) => n.userId);

      expect(notifiedUserIds).toContain(mockUserWithInvestment);
      expect(notifiedUserIds).toContain(mockUserWithJob);
      expect(notifiedUserIds).toContain(mockUserWithPanLog);
      expect(notifiedUserIds).not.toContain(mockUserUnrelated);
    });
  });

  describe('3. Duplicate Prevention', () => {
    it('should prevent duplicate notifications across repeated scheduler runs', async () => {
      // First run: Creates 3 notifications
      const run1 = await orchestrator.processAllotmentOutEvent(mockIpoId);
      expect(run1.createdCount).toBe(3);

      // Second run: Suppresses all 3 duplicates
      const run2 = await orchestrator.processAllotmentOutEvent(mockIpoId);
      expect(run2.evaluatedCount).toBe(3);
      expect(run2.createdCount).toBe(0);
      expect(run2.suppressedCount).toBe(3);
    });

    it('should maintain restart-safe deduplication across service restarts', async () => {
      await orchestrator.processAllotmentOutEvent(mockIpoId);

      const restartedOrchestrator = new NotificationOrchestratorService(
        prismaMock,
        repository,
        generator,
        qualityGateMock,
      );

      const restartRun = await restartedOrchestrator.processAllotmentOutEvent(mockIpoId);
      expect(restartRun.createdCount).toBe(0);
      expect(restartRun.suppressedCount).toBe(3);
    });
  });

  describe('4. Invalid Token Handling', () => {
    it('should automatically deactivate dead/unregistered Expo push tokens when provider returns DeviceNotRegistered', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              status: 'error',
              message: 'DeviceNotRegistered',
              details: { error: 'DeviceNotRegistered' },
            },
          ],
        }),
      }) as any;

      try {
        const deliveryResult = await pushAdapter.deliver({
          id: 'notif-test-1',
          userId: mockUserWithInvestment,
          type: NotificationType.ALLOTTED_RESULT_AVAILABLE,
          title: 'IPO Allotment Out',
          message: 'Acme Technologies Ltd allotment is now available. Check your allotment status.',
          relatedEntityType: 'IPO',
          relatedEntityId: mockIpoId,
          metadata: { ipoId: mockIpoId },
          readAt: null,
          createdAt: new Date().toISOString(),
        });

        expect(deliveryResult.status).toBe('DELIVERED');
        const tok1 = dbPushTokens.find((t) => t.id === 'tok-1');
        expect(tok1?.isActive).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('5. Notification Failure Not Breaking Allotment Processing', () => {
    it('should allow IPO lifecycle allotment confirmation even if notification orchestrator throws or push service fails', async () => {
      const failingOrchestrator: any = {
        processAllotmentOutEvent: jest
          .fn()
          .mockRejectedValue(new Error('Push Gateway Network Timeout')),
      };

      const resolverMock: any = {
        resolveAdapter: jest.fn().mockReturnValue({
          checkAllotment: jest.fn().mockResolvedValue({
            status: 'AVAILABLE',
          }),
        }),
      };

      const scheduler = new IpoTimelineSchedulerService(
        prismaMock as PrismaService,
        resolverMock as RegistrarResolver,
        failingOrchestrator,
      );

      // Verify scheduler transition does not throw despite notification error
      await expect(
        scheduler.processTimelineTransitions(new Date('2026-09-23T18:00:00.000Z')),
      ).resolves.not.toThrow();
    });
  });
});
