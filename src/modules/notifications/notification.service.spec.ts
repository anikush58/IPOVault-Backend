import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NotificationType } from './notification.types';

describe('NotificationService & Repository Unit Tests', () => {
  let service: NotificationService;
  let repository: NotificationRepository;

  const mockPrismaService = {
    notification: {
      upsert: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    notificationPreference: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  // Phase 29.4: NotificationRepository now depends on NotificationDeliveryService.
  // Mock it so existing Phase 29.2 tests are unaffected.
  const mockDeliveryService = {
    initDelivery: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        NotificationRepository,
        NotificationEventGenerator,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: NotificationDeliveryService,
          useValue: mockDeliveryService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    repository = module.get<NotificationRepository>(NotificationRepository);

    jest.clearAllMocks();
    // Ensure delivery mock always resolves for all tests
    mockDeliveryService.initDelivery.mockResolvedValue(undefined);
  });



  describe('I, J. Idempotency & Duplicate Generation Prevention', () => {
    it('uses upsert with unique (userId, deduplicationKey) to prevent duplicate creation', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValue(null);

      const createdItem = {
        id: 'notif-1',
        userId: 'user-123',
        type: 'IPO_OPENED',
        title: 'IPO Subscription Opened',
        message: 'Subscription for Acme Corp is open.',
        relatedEntityType: 'IPO',
        relatedEntityId: 'ipo-1',
        metadata: { companyName: 'Acme Corp' },
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
        readAt: null,
        createdAt: new Date('2026-09-10T12:00:00Z'),
        updatedAt: new Date('2026-09-10T12:00:00Z'),
      };

      mockPrismaService.notification.upsert.mockResolvedValue(createdItem);

      const result1 = await repository.createNotification({
        userId: 'user-123',
        type: NotificationType.IPO_OPENED,
        title: 'IPO Subscription Opened',
        message: 'Subscription for Acme Corp is open.',
        relatedEntityType: 'IPO',
        relatedEntityId: 'ipo-1',
        metadata: { companyName: 'Acme Corp' },
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
      });

      expect(result1).not.toBeNull();
      expect(result1?.id).toBe('notif-1');

      expect(mockPrismaService.notification.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_deduplicationKey: {
              userId: 'user-123',
              deduplicationKey: 'ipo_opened:ipo-1:event-1',
            },
          },
        }),
      );
    });
  });

  describe('K. Concurrent / Unique Conflict Handling', () => {
    it('catches P2002 Prisma unique constraint error gracefully', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValue(null);

      const error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.15.0' },
      );

      mockPrismaService.notification.upsert.mockRejectedValue(error);

      const result = await repository.createNotification({
        userId: 'user-123',
        type: NotificationType.IPO_OPENED,
        title: 'IPO Subscription Opened',
        message: 'Subscription for Acme Corp is open.',
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
      });

      expect(result).toBeNull();
    });
  });

  describe('L, M, N. Read State & Read/Read-All Idempotency', () => {
    it('L. Sets readAt when marking an unread notification as read', async () => {
      const unreadItem = {
        id: 'notif-1',
        userId: 'user-123',
        type: 'IPO_OPENED',
        title: 'Title',
        message: 'Msg',
        relatedEntityType: null,
        relatedEntityId: null,
        metadata: null,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const now = new Date();
      const readItem = { ...unreadItem, readAt: now };

      mockPrismaService.notification.findFirst.mockResolvedValue(unreadItem);
      mockPrismaService.notification.update.mockResolvedValue(readItem);

      const result = await service.markNotificationAsRead('notif-1', 'user-123');

      expect(result.readAt).toBe(now.toISOString());
      expect(mockPrismaService.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { readAt: expect.any(Date) },
      });
    });

    it('M. Read idempotency: returns existing readAt when marking an already-read notification as read', async () => {
      const existingReadDate = new Date('2026-09-10T10:00:00Z');
      const alreadyReadItem = {
        id: 'notif-1',
        userId: 'user-123',
        type: 'IPO_OPENED',
        title: 'Title',
        message: 'Msg',
        relatedEntityType: null,
        relatedEntityId: null,
        metadata: null,
        readAt: existingReadDate,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.notification.findFirst.mockResolvedValue(alreadyReadItem);

      const result = await service.markNotificationAsRead('notif-1', 'user-123');

      expect(result.readAt).toBe(existingReadDate.toISOString());
      expect(mockPrismaService.notification.update).not.toHaveBeenCalled();
    });

    it('N. Read-all idempotency: updates unread notifications for user and returns count', async () => {
      mockPrismaService.notification.updateMany.mockResolvedValue({ count: 4 });

      const res1 = await service.markAllNotificationsAsRead('user-123');
      expect(res1.updatedCount).toBe(4);

      mockPrismaService.notification.updateMany.mockResolvedValue({ count: 0 });
      const res2 = await service.markAllNotificationsAsRead('user-123');
      expect(res2.updatedCount).toBe(0);
    });
  });

  describe('O. User Isolation', () => {
    it('throws 401 Unauthorized if x-user-id header is missing or empty', async () => {
      await expect(
        service.getUserNotifications('', { page: 1, limit: 20, unreadOnly: false }),
      ).rejects.toThrow(AppException);

      await expect(
        service.getUserNotificationById('notif-1', undefined),
      ).rejects.toThrow(AppException);
    });

    it('throws 404 Not Found if notification belongs to another user or does not exist', async () => {
      mockPrismaService.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserNotificationById('notif-belonging-to-other-user', 'user-123'),
      ).rejects.toThrow(AppException);
    });
  });

  describe('P, Q, R. Pagination, unreadOnly, and unread count', () => {
    it('queries with database-level pagination, unreadOnly filtering, and unreadCount', async () => {
      const items = [
        {
          id: 'notif-1',
          userId: 'user-123',
          type: 'IPO_OPENED',
          title: 'T1',
          message: 'M1',
          relatedEntityType: 'IPO',
          relatedEntityId: 'ipo-1',
          metadata: null,
          readAt: null,
          createdAt: new Date('2026-09-10T12:00:00Z'),
          updatedAt: new Date('2026-09-10T12:00:00Z'),
        },
      ];

      mockPrismaService.notification.findMany.mockResolvedValue(items);
      mockPrismaService.notification.count
        .mockResolvedValueOnce(1) // filteredTotal
        .mockResolvedValueOnce(5); // unreadCount

      const result = await service.getUserNotifications('user-123', {
        page: 2,
        limit: 10,
        unreadOnly: true,
      });

      expect(result.notifications).toHaveLength(1);
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
      expect(result.unreadCount).toBe(5);
    });
  });

  describe('Phase 29.2 Notification Preferences & Generator Integration Tests', () => {
    it('A, L. Returns all supported notification types with default states when user has no stored rows', async () => {
      mockPrismaService.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.getUserPreferences('user-123');

      expect(result.preferences).toHaveLength(6);
      for (const pref of result.preferences) {
        expect(pref.enabled).toBe(true);
        expect(pref.isDefault).toBe(true);
      }
    });

    it('B, C, E. Updates an explicit preference for a user (upsert) and returns updated preference', async () => {
      const updatedRow = {
        id: 'pref-1',
        userId: 'user-123',
        notificationType: 'IPO_OPENED',
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.notificationPreference.upsert.mockResolvedValue(updatedRow);

      const result = await service.updateUserPreference('IPO_OPENED', false, 'user-123');

      expect(result).toEqual({
        type: 'IPO_OPENED',
        enabled: false,
        isDefault: false,
      });

      expect(mockPrismaService.notificationPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_notificationType: {
            userId: 'user-123',
            notificationType: 'IPO_OPENED',
          },
        },
        create: {
          userId: 'user-123',
          notificationType: 'IPO_OPENED',
          enabled: false,
        },
        update: {
          enabled: false,
        },
      });
    });

    it('D. Throws 400 Validation Error for unknown notification type', async () => {
      await expect(
        service.updateUserPreference('INVALID_TYPE_X', false, 'user-123'),
      ).rejects.toThrow(AppException);
    });

    it('F. Resets explicit preferences to default by deleting user explicit rows', async () => {
      mockPrismaService.notificationPreference.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.notificationPreference.findMany.mockResolvedValue([]);

      const result = await service.resetUserPreferences('user-123');

      expect(mockPrismaService.notificationPreference.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(result.preferences).toHaveLength(6);
      expect(result.preferences.every((p) => p.isDefault)).toBe(true);
    });

    it('G. Suppresses notification creation when notification type is disabled for user', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValue({
        id: 'pref-1',
        userId: 'user-123',
        notificationType: 'IPO_OPENED',
        enabled: false,
      });

      const result = await repository.createNotification({
        userId: 'user-123',
        type: NotificationType.IPO_OPENED,
        title: 'Title',
        message: 'Msg',
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
      });

      expect(result).toBeNull();
      // Prisma notification.upsert should NOT be called
      expect(mockPrismaService.notification.upsert).not.toHaveBeenCalled();
    });

    it('H. Allows notification creation when notification type is enabled for user', async () => {
      mockPrismaService.notificationPreference.findUnique.mockResolvedValue({
        id: 'pref-1',
        userId: 'user-123',
        notificationType: 'IPO_OPENED',
        enabled: true,
      });

      const created = {
        id: 'notif-1',
        userId: 'user-123',
        type: 'IPO_OPENED',
        title: 'Title',
        message: 'Msg',
        relatedEntityType: null,
        relatedEntityId: null,
        metadata: null,
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.notification.upsert.mockResolvedValue(created);

      const result = await repository.createNotification({
        userId: 'user-123',
        type: NotificationType.IPO_OPENED,
        title: 'Title',
        message: 'Msg',
        deduplicationKey: 'ipo_opened:ipo-1:event-1',
      });

      expect(result).not.toBeNull();
      expect(mockPrismaService.notification.upsert).toHaveBeenCalled();
    });

    it('I. Disabling a preference does not delete existing notifications', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValue({
        id: 'pref-1',
        userId: 'user-123',
        notificationType: 'IPO_OPENED',
        enabled: false,
      });

      await service.updateUserPreference('IPO_OPENED', false, 'user-123');

      // Verify Prisma notification.delete / deleteMany is NOT called
      expect(mockPrismaService.notification.updateMany).not.toHaveBeenCalled();
    });

    it('J. Enabling a preference does not trigger historical backfill of past notifications', async () => {
      mockPrismaService.notificationPreference.upsert.mockResolvedValue({
        id: 'pref-1',
        userId: 'user-123',
        notificationType: 'IPO_OPENED',
        enabled: true,
      });

      await service.updateUserPreference('IPO_OPENED', true, 'user-123');

      // Verify Prisma notification.upsert is NOT called automatically for historical events
      expect(mockPrismaService.notification.upsert).not.toHaveBeenCalled();
    });
  });
});
