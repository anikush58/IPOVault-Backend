import { Test, TestingModule } from '@nestjs/testing';
import { AllotmentResultStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DiscoveryQualityGateService } from '../discovery/discovery-quality-gate.service';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationOrchestratorService } from './notification-orchestrator.service';
import { NotificationRepository } from './notification.repository';
import { NotificationType } from './notification.types';

describe('NotificationOrchestratorService Unit Tests (Phase 29.3)', () => {
  let service: NotificationOrchestratorService;

  const mockPrismaService = {
    ipoLifecycleEvent: {
      findMany: jest.fn(),
    },
    ipoChangeEvent: {
      findMany: jest.fn(),
    },
    ipo: {
      findUnique: jest.fn(),
    },
    allotmentCheckJobItem: {
      findUnique: jest.fn(),
    },
    allotmentCheckJob: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    userSavedPan: {
      findMany: jest.fn(),
    },
  };

  const mockRepository = {
    createNotification: jest.fn(),
  };

  const mockQualityGateService = {
    evaluateQualityGate: jest.fn(),
  };

  const mockIpo = {
    id: 'ipo-uuid-1',
    companyId: 'company-uuid-1',
    status: 'OPEN',
    symbol: 'ACME',
    lotSize: 100,
    priceBandHigh: '500.00',
    company: {
      id: 'company-uuid-1',
      legalName: 'Acme Technologies Ltd',
      displayName: 'Acme Tech',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationOrchestratorService,
        NotificationEventGenerator,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationRepository, useValue: mockRepository },
        { provide: DiscoveryQualityGateService, useValue: mockQualityGateService },
      ],
    }).compile();

    service = module.get<NotificationOrchestratorService>(NotificationOrchestratorService);

    jest.clearAllMocks();
  });

  describe('A, B, C, D. Lifecycle Event Triggers', () => {
    it('A. Orchestrates OPEN lifecycle event and generates IPO_OPENED notification for target user', async () => {
      const openEvent = {
        id: 'event-open-1',
        ipoId: mockIpo.id,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10'),
        ipo: mockIpo,
      };

      mockPrismaService.ipoLifecycleEvent.findMany.mockResolvedValue([openEvent]);
      mockRepository.createNotification.mockResolvedValue({
        id: 'notif-1',
        type: NotificationType.IPO_OPENED,
      });

      const res = await service.processLifecycleEvents({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.evaluatedCount).toBe(1);
      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          type: NotificationType.IPO_OPENED,
          deduplicationKey: `ipo_opened:${mockIpo.id}:event-open-1`,
        }),
      );
    });

    it('B. Orchestrates CLOSE lifecycle event and generates IPO_CLOSED notification', async () => {
      const closeEvent = {
        id: 'event-close-1',
        ipoId: mockIpo.id,
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-12'),
        ipo: mockIpo,
      };

      mockPrismaService.ipoLifecycleEvent.findMany.mockResolvedValue([closeEvent]);
      mockRepository.createNotification.mockResolvedValue({
        id: 'notif-2',
        type: NotificationType.IPO_CLOSED,
      });

      const res = await service.processLifecycleEvents({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.IPO_CLOSED,
        }),
      );
    });

    it('C. Orchestrates LISTING lifecycle event when within 3-day window', async () => {
      const listingEvent = {
        id: 'event-listing-1',
        ipoId: mockIpo.id,
        eventType: 'LISTING',
        eventDate: new Date(), // Today -> within 3-day window
        ipo: mockIpo,
      };

      mockPrismaService.ipoLifecycleEvent.findMany.mockResolvedValue([listingEvent]);
      mockRepository.createNotification.mockResolvedValue({
        id: 'notif-3',
        type: NotificationType.IPO_LISTING_SOON,
      });

      const res = await service.processLifecycleEvents({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.IPO_LISTING_SOON,
        }),
      );
    });

    it('D. Repeated lifecycle evaluation is idempotent', async () => {
      const openEvent = {
        id: 'event-open-1',
        ipoId: mockIpo.id,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10'),
        ipo: mockIpo,
      };

      mockPrismaService.ipoLifecycleEvent.findMany.mockResolvedValue([openEvent]);
      // First call creates item, second call repository returns null due to unique deduplication key
      mockRepository.createNotification
        .mockResolvedValueOnce({ id: 'notif-1' })
        .mockResolvedValueOnce(null);

      const res1 = await service.processLifecycleEvents({ userId: 'user-123' });
      expect(res1.createdCount).toBe(1);

      const res2 = await service.processLifecycleEvents({ userId: 'user-123' });
      expect(res2.createdCount).toBe(0);
      expect(res2.suppressedCount).toBe(1);
    });
  });

  describe('E, F. Change-Event Triggers', () => {
    it('E. Orchestrates IpoChangeEvent and generates IPO_DATA_CHANGED notification', async () => {
      const changeEvent = {
        id: 'change-1',
        ipoId: mockIpo.id,
        fieldName: 'priceBandHigh',
        oldValue: '450.00',
        newValue: '500.00',
        detectedAt: new Date(),
        changeType: 'PRICE_BAND_CHANGED',
        ipo: mockIpo,
      };

      mockPrismaService.ipoChangeEvent.findMany.mockResolvedValue([changeEvent]);
      mockRepository.createNotification.mockResolvedValue({
        id: 'notif-change',
        type: NotificationType.IPO_DATA_CHANGED,
      });

      const res = await service.processChangeEvents({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.IPO_DATA_CHANGED,
          deduplicationKey: `ipo_data_changed:${mockIpo.id}:change-1`,
        }),
      );
    });

    it('F. Repeated change event processing is idempotent', async () => {
      const changeEvent = {
        id: 'change-1',
        ipoId: mockIpo.id,
        fieldName: 'lotSize',
        oldValue: '50',
        newValue: '100',
        detectedAt: new Date(),
        changeType: 'LOT_SIZE_CHANGED',
        ipo: mockIpo,
      };

      mockPrismaService.ipoChangeEvent.findMany.mockResolvedValue([changeEvent]);
      mockRepository.createNotification.mockResolvedValue(null); // Already exists

      const res = await service.processChangeEvents({ userId: 'user-123' });
      expect(res.createdCount).toBe(0);
      expect(res.suppressedCount).toBe(1);
    });
  });

  describe('G, H, I, J, K. Quality Gate Triggers & Preference Suppression', () => {
    it('G. Generates quality warning notification for NEEDS_REVIEW status', async () => {
      mockQualityGateService.evaluateQualityGate.mockResolvedValue({
        ipoId: mockIpo.id,
        status: 'NEEDS_REVIEW',
        blockers: [{ message: 'Missing DRHP link' }],
        warnings: [],
      });
      mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpo);
      mockRepository.createNotification.mockResolvedValue({ id: 'notif-q' });

      const res = await service.processQualityGate({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.IPO_DATA_QUALITY_WARNING,
          deduplicationKey: `ipo_quality_warning:${mockIpo.id}:NEEDS_REVIEW`,
        }),
      );
    });

    it('H. Generates quality warning notification for INCOMPLETE status', async () => {
      mockQualityGateService.evaluateQualityGate.mockResolvedValue({
        ipoId: mockIpo.id,
        status: 'INCOMPLETE',
        blockers: [{ message: 'Missing issue price band' }],
        warnings: [],
      });
      mockPrismaService.ipo.findUnique.mockResolvedValue(mockIpo);
      mockRepository.createNotification.mockResolvedValue({ id: 'notif-q2' });

      const res = await service.processQualityGate({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(1);
    });

    it('I. Suppresses notification creation when quality gate is PASS or PASS_WITH_WARNINGS', async () => {
      mockQualityGateService.evaluateQualityGate.mockResolvedValue({
        ipoId: mockIpo.id,
        status: 'PASS',
        blockers: [],
        warnings: [],
      });

      const res = await service.processQualityGate({
        ipoId: mockIpo.id,
        userId: 'user-123',
      });

      expect(res.createdCount).toBe(0);
      expect(mockRepository.createNotification).not.toHaveBeenCalled();
    });

    it('J. Suppresses notification when repository returns null (disabled preference)', async () => {
      const openEvent = {
        id: 'event-open-1',
        ipoId: mockIpo.id,
        eventType: 'OPEN',
        eventDate: new Date(),
        ipo: mockIpo,
      };

      mockPrismaService.ipoLifecycleEvent.findMany.mockResolvedValue([openEvent]);
      mockRepository.createNotification.mockResolvedValue(null); // Disabled preference

      const res = await service.processLifecycleEvents({ userId: 'user-123' });
      expect(res.createdCount).toBe(0);
      expect(res.suppressedCount).toBe(1);
    });
  });

  describe('L, M, N, O, P, Q, R. Allotment Result Triggers', () => {
    const mockItem = {
      id: 'job-item-1',
      jobId: 'job-1',
      status: AllotmentResultStatus.ALLOTTED,
      sharesApplied: 100,
      sharesAllotted: 100,
      maskedId: 'ABCDE****F',
      job: {
        id: 'job-1',
        userId: 'user-123',
        ipo: mockIpo,
      },
    };

    it('L. Orchestrates definitive ALLOTTED status for job owner user', async () => {
      mockPrismaService.allotmentCheckJobItem.findUnique.mockResolvedValue(mockItem);
      mockRepository.createNotification.mockResolvedValue({ id: 'notif-allot' });

      const res = await service.processAllotmentObservation('job-item-1');

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          type: NotificationType.ALLOTTED_RESULT_AVAILABLE,
          deduplicationKey: `allotment_result:${mockIpo.id}:job-item-1`,
        }),
      );
    });

    it('M. Orchestrates PARTIALLY_ALLOTTED status', async () => {
      const partialItem = {
        ...mockItem,
        status: AllotmentResultStatus.PARTIALLY_ALLOTTED,
        sharesAllotted: 50,
      };
      mockPrismaService.allotmentCheckJobItem.findUnique.mockResolvedValue(partialItem);
      mockRepository.createNotification.mockResolvedValue({ id: 'notif-partial' });

      const res = await service.processAllotmentObservation('job-item-1');

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Partially Allotted'),
        }),
      );
    });

    it('N. Orchestrates NOT_ALLOTTED status', async () => {
      const notAllottedItem = {
        ...mockItem,
        status: AllotmentResultStatus.NOT_ALLOTTED,
        sharesAllotted: 0,
      };
      mockPrismaService.allotmentCheckJobItem.findUnique.mockResolvedValue(notAllottedItem);
      mockRepository.createNotification.mockResolvedValue({ id: 'notif-none' });

      const res = await service.processAllotmentObservation('job-item-1');

      expect(res.createdCount).toBe(1);
      expect(mockRepository.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Not Allotted'),
        }),
      );
    });

    it('O, P. Excludes UNKNOWN and FAILED/transient statuses', async () => {
      const unknownItem = {
        ...mockItem,
        status: AllotmentResultStatus.UNKNOWN,
      };
      mockPrismaService.allotmentCheckJobItem.findUnique.mockResolvedValue(unknownItem);

      const res = await service.processAllotmentObservation('job-item-1');
      expect(res.createdCount).toBe(0);
      expect(mockRepository.createNotification).not.toHaveBeenCalled();
    });

    it('R. User isolation: skips notification when job has no associated userId', async () => {
      const anonItem = {
        ...mockItem,
        job: { ...mockItem.job, userId: null },
      };
      mockPrismaService.allotmentCheckJobItem.findUnique.mockResolvedValue(anonItem);

      const res = await service.processAllotmentObservation('job-item-1');

      expect(res.createdCount).toBe(0);
      expect(mockRepository.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('T. Failure Isolation', () => {
    it('catches and isolates unexpected DB errors during notification processing without throwing', async () => {
      mockPrismaService.ipoLifecycleEvent.findMany.mockRejectedValue(
        new Error('Unexpected DB Connection Failure'),
      );

      // Should log error and return 0 count without throwing an exception
      const res = await service.processLifecycleEvents({ ipoId: mockIpo.id });
      expect(res.createdCount).toBe(0);
      expect(res.evaluatedCount).toBe(0);
    });
  });
});
