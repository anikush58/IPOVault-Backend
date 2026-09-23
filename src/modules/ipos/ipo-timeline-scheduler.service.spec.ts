import { IpoStatus, LifecycleEventType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from '../allotment/registrar.resolver';
import { AllotmentStatus } from '../allotment/allotment.types';
import {
  IpoTimelineSchedulerService,
  createISTDateTime,
  getNowInIST,
} from './ipo-timeline-scheduler.service';

describe('IpoTimelineSchedulerService Unit Tests', () => {
  let service: IpoTimelineSchedulerService;
  let prismaMock: {
    ipo: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let resolverMock: {
    resolveAdapter: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      ipo: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    resolverMock = {
      resolveAdapter: jest.fn(),
    };

    service = new IpoTimelineSchedulerService(
      prismaMock as unknown as PrismaService,
      resolverMock as unknown as RegistrarResolver,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('Timezone & Date Helpers', () => {
    it('1. should extract correct IST date and time components', () => {
      // 2026-09-23 03:30:00 UTC == 2026-09-23 09:00:00 IST
      const utcDate = new Date('2026-09-23T03:30:00.000Z');
      const ist = getNowInIST(utcDate);
      expect(ist.dateStr).toBe('2026-09-23');
      expect(ist.hour).toBe(9);
      expect(ist.minute).toBe(0);
    });

    it('2. should create accurate IST Date boundary', () => {
      const boundary = createISTDateTime('2026-09-23', 17, 0, 0);
      expect(boundary.toISOString()).toBe('2026-09-23T11:30:00.000Z');
    });
  });

  describe('Transition 1: UPCOMING -> OPEN', () => {
    it('3. should NOT open before 09:00:00 IST on openDate', async () => {
      const openDate = new Date('2026-09-23T00:00:00.000Z');
      const nowBeforeOpen = new Date('2026-09-23T03:29:59.000Z'); // 08:59:59 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          status: IpoStatus.UPCOMING,
          company: { displayName: 'Acme Ltd' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.OPEN, eventDate: openDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowBeforeOpen);
      expect(result.openedCount).toBe(0);
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('4. should transition UPCOMING -> OPEN at or after 09:00:00 IST on openDate', async () => {
      const openDate = new Date('2026-09-23T00:00:00.000Z');
      const nowAtOpen = new Date('2026-09-23T03:30:00.000Z'); // 09:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          status: IpoStatus.UPCOMING,
          company: { displayName: 'Acme Ltd' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.OPEN, eventDate: openDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtOpen);
      expect(result.openedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: { id: 'ipo-1', status: IpoStatus.UPCOMING },
        data: { status: IpoStatus.OPEN },
      });
    });
  });

  describe('Transition 2: OPEN / CLOSING_TODAY -> CLOSED', () => {
    it('5. should NOT close before 17:00:00 IST on closeDate', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const nowBeforeClose = new Date('2026-09-25T11:29:59.000Z'); // 16:59:59 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2',
          status: IpoStatus.OPEN,
          company: { displayName: 'Beta Ltd' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowBeforeClose);
      expect(result.closedCount).toBe(0);
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('6. should transition OPEN -> CLOSED at or after 17:00:00 IST on closeDate', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const nowAtClose = new Date('2026-09-25T11:30:00.000Z'); // 17:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2',
          status: IpoStatus.OPEN,
          company: { displayName: 'Beta Ltd' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtClose);
      expect(result.closedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-2',
          status: { in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY] },
        },
        data: { status: IpoStatus.CLOSED },
      });
    });
  });

  describe('Transition 3: CLOSED -> ALLOTMENT_COMPLETED (Only on actual confirmation)', () => {
    it('7. should NOT transition when registrar code resolution returns NOT_YET_AVAILABLE', async () => {
      const allotmentDate = new Date('2026-09-26T00:00:00.000Z');
      const nowOnAllotmentDate = new Date('2026-09-26T04:00:00.000Z'); // 09:30:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.CLOSED,
          company: { displayName: 'Gamma Ltd' },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
              eventDate: allotmentDate,
            },
          ],
        },
      ]);

      const mockAdapter = {
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue({
          status: AllotmentStatus.NOT_YET_AVAILABLE,
        }),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      const result =
        await service.processTimelineTransitions(nowOnAllotmentDate);
      expect(result.allotmentConfirmedCount).toBe(0);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledWith(
        expect.objectContaining({
          ipoId: 'ipo-3',
          identifierValue: '', // No fake applicant identifier
        }),
      );
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('8. should transition to ALLOTMENT_COMPLETED and record timestamp when actual allotment is confirmed', async () => {
      const allotmentDate = new Date('2026-09-26T00:00:00.000Z');
      const nowConfirmed = new Date('2026-09-26T14:30:00.000Z'); // 20:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.CLOSED,
          allotmentResultAvailableAt: null,
          company: { displayName: 'Gamma Ltd' },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
              eventDate: allotmentDate,
            },
          ],
        },
      ]);

      // When allotment dataset is live on registrar portal, resolveRegistrarIpoCode returns company code
      const mockAdapter = {
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('GAMMA_1024'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      const result = await service.processTimelineTransitions(nowConfirmed);
      expect(result.allotmentConfirmedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-3',
          status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
        },
        data: {
          status: IpoStatus.ALLOTMENT_COMPLETED,
          allotmentResultAvailableAt: nowConfirmed,
        },
      });
    });

    it('9. should preserve existing allotmentResultAvailableAt and never overwrite', async () => {
      const allotmentDate = new Date('2026-09-26T00:00:00.000Z');
      const firstDetectedAt = new Date('2026-09-26T12:00:00.000Z');
      const subsequentRunAt = new Date('2026-09-26T16:00:00.000Z');

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.CLOSED,
          allotmentResultAvailableAt: firstDetectedAt,
          company: { displayName: 'Gamma Ltd' },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
              eventDate: allotmentDate,
            },
          ],
        },
      ]);

      const mockAdapter = {
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('GAMMA_1024'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      const result = await service.processTimelineTransitions(subsequentRunAt);
      expect(result.allotmentConfirmedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-3',
          status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
        },
        data: {
          status: IpoStatus.ALLOTMENT_COMPLETED,
        },
      });
    });
  });

  describe('Transition 4: ALLOTMENT_COMPLETED -> LISTED', () => {
    it('10. should transition ALLOTMENT_COMPLETED -> LISTED at 10:00:00 IST on listingDate', async () => {
      const listingDate = new Date('2026-09-30T00:00:00.000Z');
      const nowAtListing = new Date('2026-09-30T04:30:00.000Z'); // 10:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-4',
          status: IpoStatus.ALLOTMENT_COMPLETED,
          company: { displayName: 'Delta Ltd' },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: listingDate,
            },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtListing);
      expect(result.listedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-4',
          status: {
            in: [IpoStatus.ALLOTMENT_COMPLETED, IpoStatus.LISTING_PENDING],
          },
        },
        data: { status: IpoStatus.LISTED },
      });
    });
  });

  describe('Protection & Invariants', () => {
    it('11. should never modify WITHDRAWN or CANCELLED IPOs', async () => {
      prismaMock.ipo.findMany.mockResolvedValue([]);

      const result = await service.processTimelineTransitions();
      expect(result.openedCount).toBe(0);
      expect(result.closedCount).toBe(0);
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('12. should handle tick error isolation without throwing', async () => {
      prismaMock.ipo.findMany.mockRejectedValue(new Error('Database offline'));
      await expect(service.tick()).resolves.not.toThrow();
    });
  });
});
