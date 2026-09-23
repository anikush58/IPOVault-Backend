import { NotificationType } from './notification.types';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationRepository } from './notification.repository';
import { NotificationDeliveryService } from './notification-delivery.service';
import { ExpoPushDeliveryAdapter } from './adapters/expo-push-delivery.adapter';
import { InAppDeliveryAdapter } from './adapters/in-app-delivery.adapter';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';

describe('IPO Allotment Out Notification & Delivery Suite', () => {
  let generator: NotificationEventGenerator;
  let orchestrator: NotificationOrchestratorService;
  let repository: NotificationRepository;
  let deliveryService: NotificationDeliveryService;
  let inAppAdapter: InAppDeliveryAdapter;
  let pushAdapter: ExpoPushDeliveryAdapter;
  let prismaMock: any;
  let qualityGateMock: any;

  const mockIpoId = '11111111-1111-1111-1111-111111111111';
  const mockUserWithInvestment = 'user_investor_123';
  const mockUserWithJob = 'user_job_456';
  const mockUserWithPanLog = 'user_pan_789';
  const mockUserUnrelated = 'user_unrelated_999';

  beforeEach(() => {
    generator = new NotificationEventGenerator();
    qualityGateMock = {} as DiscoveryQualityGateService;

    // In-memory persistent storage simulating PostgreSQL tables
    const dbNotifications: any[] = [];
    const dbDeliveries: any[] = [];
    const dbPushTokens: any[] = [
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
            (t) => t.userId === where.userId && (where.isActive === undefined || t.isActive === where.isActive),
          );
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
  });

  it('1. should generate correct notification payload for Allotment Out', () => {
    const input = generator.generateAllotmentOutNotification(mockUserWithInvestment, {
      id: mockIpoId,
      companyName: 'Acme Technologies Ltd',
      symbol: 'ACME',
    });

    expect(input.title).toBe('IPO Allotment Out');
    expect(input.message).toBe(
      'The allotment status for Acme Technologies Ltd is now available. Check your allotment status.',
    );
    expect(input.type).toBe(NotificationType.ALLOTTED_RESULT_AVAILABLE);
    expect(input.deduplicationKey).toBe(`ipo_allotment_out:${mockIpoId}`);
    expect(input.metadata).toEqual({
      ipoId: mockIpoId,
      companyName: 'Acme Technologies Ltd',
      symbol: 'ACME',
    });
  });

  it('2. first detection creates notifications for all eligible users', async () => {
    const result = await orchestrator.processAllotmentOutEvent(mockIpoId);

    // 3 eligible users (investor, job user, pan log user)
    expect(result.evaluatedCount).toBe(3);
    expect(result.createdCount).toBe(3);
    expect(result.suppressedCount).toBe(0);
  });

  it('3. only eligible users receive notification; unrelated users are excluded', async () => {
    await orchestrator.processAllotmentOutEvent(mockIpoId);

    const createdNotifications = await prismaMock.notification.findMany();
    const notifiedUserIds = createdNotifications.map((n: any) => n.userId);

    expect(notifiedUserIds).toContain(mockUserWithInvestment);
    expect(notifiedUserIds).toContain(mockUserWithJob);
    expect(notifiedUserIds).toContain(mockUserWithPanLog);
    expect(notifiedUserIds).not.toContain(mockUserUnrelated);
  });

  it('4. repeated detection does not duplicate notifications', async () => {
    // Run 1: First detection
    const result1 = await orchestrator.processAllotmentOutEvent(mockIpoId);
    expect(result1.createdCount).toBe(3);

    // Run 2: Repeated scheduler run
    const result2 = await orchestrator.processAllotmentOutEvent(mockIpoId);
    expect(result2.evaluatedCount).toBe(3);
    expect(result2.createdCount).toBe(0);
    expect(result2.suppressedCount).toBe(3);
  });

  it('5. restart-safe duplicate prevention persists across service instantiations', async () => {
    // Initial run
    await orchestrator.processAllotmentOutEvent(mockIpoId);

    // Simulate server restart: new service instance with existing DB mock
    const newOrchestrator = new NotificationOrchestratorService(
      prismaMock,
      repository,
      generator,
      qualityGateMock,
    );

    const resultAfterRestart = await newOrchestrator.processAllotmentOutEvent(mockIpoId);
    expect(resultAfterRestart.createdCount).toBe(0);
    expect(resultAfterRestart.suppressedCount).toBe(3);
  });

  it('6. does not trigger notification if IPO allotment is pending or not yet confirmed', async () => {
    prismaMock.ipo.findUnique.mockResolvedValueOnce({
      id: '22222222-2222-2222-2222-222222222222',
      status: 'ALLOTMENT_PENDING',
      allotmentResultAvailableAt: null,
      company: { displayName: 'Pending IPO Ltd' },
    });

    const result = await orchestrator.processAllotmentOutEvent(
      '22222222-2222-2222-2222-222222222222',
    );
    expect(result.evaluatedCount).toBe(0);
    expect(result.createdCount).toBe(0);
  });
});
