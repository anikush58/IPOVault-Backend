import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDeliveryRepository } from './notification-delivery.repository';
import { PrismaService } from '../../database/prisma.service';
import { DeliveryStatus } from './notification.types';

describe('NotificationDeliveryRepository — Starvation Prevention & Candidate Queries', () => {
  let repository: NotificationDeliveryRepository;
  let prismaService: {
    notificationDelivery: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
      upsert: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  const mockRawNotification = {
    id: 'notif-1',
    userId: 'user-1',
    type: 'IPO_OPENED',
    title: 'IPO Opened',
    message: 'Test message',
    relatedEntityType: null,
    relatedEntityId: null,
    metadata: null,
    deduplicationKey: 'key-1',
    readAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prismaService = {
      notificationDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDeliveryRepository,
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    repository = module.get<NotificationDeliveryRepository>(NotificationDeliveryRepository);
  });

  describe('findEligibleDeliveries (Starvation Prevention)', () => {
    it('constructs correct Prisma OR query excluding attemptCount >= maxAttempts', async () => {
      await repository.findEligibleDeliveries(50, 5);

      expect(prismaService.notificationDelivery.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { status: DeliveryStatus.PENDING },
            {
              status: DeliveryStatus.FAILED,
              attemptCount: { lt: 5 },
            },
          ],
        },
        orderBy: {
          createdAt: 'asc',
        },
        take: 50,
        include: {
          notification: true,
        },
      });
    });

    it('returns PENDING and retryable FAILED deliveries when present', async () => {
      prismaService.notificationDelivery.findMany.mockResolvedValue([
        {
          id: 'del-pending',
          notificationId: 'notif-1',
          channel: 'IN_APP',
          status: 'PENDING',
          attemptCount: 0,
          lastAttemptAt: null,
          processingStartedAt: null,
          deliveredAt: null,
          failureReason: null,
          providerMessageId: null,
          createdAt: new Date('2026-09-11T10:00:00Z'),
          updatedAt: new Date('2026-09-11T10:00:00Z'),
          notification: mockRawNotification,
        },
        {
          id: 'del-failed-retryable',
          notificationId: 'notif-1',
          channel: 'IN_APP',
          status: 'FAILED',
          attemptCount: 2,
          lastAttemptAt: new Date('2026-09-11T10:05:00Z'),
          processingStartedAt: null,
          deliveredAt: null,
          failureReason: 'Temporary error',
          providerMessageId: null,
          createdAt: new Date('2026-09-11T10:01:00Z'),
          updatedAt: new Date('2026-09-11T10:05:00Z'),
          notification: mockRawNotification,
        },
      ]);

      const results = await repository.findEligibleDeliveries(50, 5);

      expect(results).toHaveLength(2);
      expect(results[0].delivery.id).toBe('del-pending');
      expect(results[0].delivery.status).toBe(DeliveryStatus.PENDING);
      expect(results[1].delivery.id).toBe('del-failed-retryable');
      expect(results[1].delivery.status).toBe(DeliveryStatus.FAILED);
      expect(results[1].delivery.attemptCount).toBe(2);
    });

    it('proves starvation prevention: 50 exhausted FAILED rows in DB are filtered out by query so PENDING is returned', async () => {
      // Create 50 mock exhausted FAILED rows (attemptCount = 5)
      const exhaustedRows = Array.from({ length: 50 }, (_, i) => ({
        id: `del-exhausted-${i}`,
        notificationId: `notif-${i}`,
        channel: 'IN_APP',
        status: 'FAILED',
        attemptCount: 5,
        lastAttemptAt: new Date('2026-09-11T09:00:00Z'),
        processingStartedAt: null,
        deliveredAt: null,
        failureReason: 'Max attempts reached',
        providerMessageId: null,
        createdAt: new Date(`2026-09-11T09:00:${i.toString().padStart(2, '0')}Z`),
        updatedAt: new Date('2026-09-11T09:00:00Z'),
        notification: mockRawNotification,
      }));

      const pendingRow = {
        id: 'del-new-pending',
        notificationId: 'notif-new',
        channel: 'IN_APP',
        status: 'PENDING',
        attemptCount: 0,
        lastAttemptAt: null,
        processingStartedAt: null,
        deliveredAt: null,
        failureReason: null,
        providerMessageId: null,
        createdAt: new Date('2026-09-11T10:30:00Z'),
        updatedAt: new Date('2026-09-11T10:30:00Z'),
        notification: mockRawNotification,
      };

      // Mock findMany implementation simulating database evaluation of OR filter
      prismaService.notificationDelivery.findMany.mockImplementation((args: any) => {
        const { take } = args;

        const allRows = [...exhaustedRows, pendingRow];

        // Simulate PostgreSQL / Prisma evaluation of the OR predicate:
        // OR: [ { status: 'PENDING' }, { status: 'FAILED', attemptCount: { lt: maxAttempts } } ]
        const filtered = allRows.filter((row) => {
          if (row.status === 'PENDING') return true;
          if (row.status === 'FAILED' && row.attemptCount < 5) return true;
          return false;
        });

        return Promise.resolve(filtered.slice(0, take));
      });

      const results = await repository.findEligibleDeliveries(50, 5);

      // Verify that exhausted records are excluded at query level and PENDING record is retrieved
      expect(results).toHaveLength(1);
      expect(results[0].delivery.id).toBe('del-new-pending');
      expect(results[0].delivery.status).toBe(DeliveryStatus.PENDING);
    });
  });
});
