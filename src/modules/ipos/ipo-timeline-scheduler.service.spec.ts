import { IpoStatus, LifecycleEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from '../allotment/registrar.resolver';
import { AllotmentIdentifierType } from '../allotment/allotment.types';
import {
  IpoTimelineSchedulerService,
  createISTDateTime,
  getNowInIST,
} from './ipo-timeline-scheduler.service';

describe('IpoTimelineSchedulerService Unit Tests', () => {
  let service: IpoTimelineSchedulerService;
  let prismaMock: any;
  let resolverMock: {
    resolveAdapter: jest.Mock;
  };
  let notificationOrchestratorMock: {
    processAllotmentOutEvent: jest.Mock;
  };
  let ipoGuruServiceMock: {
    fetchIpos: jest.Mock;
  };
  let allotmentJobServiceMock: {
    createJob: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock = {
      ipo: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      },
      userSavedPan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ipoInvestment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      allotmentCheckJob: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;

    resolverMock = {
      resolveAdapter: jest.fn(),
    };

    notificationOrchestratorMock = {
      processAllotmentOutEvent: jest.fn().mockResolvedValue({}),
    };

    ipoGuruServiceMock = {
      fetchIpos: jest.fn().mockResolvedValue([]),
    };

    allotmentJobServiceMock = {
      createJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    service = new IpoTimelineSchedulerService(
      prismaMock as unknown as PrismaService,
      resolverMock as unknown as RegistrarResolver,
      notificationOrchestratorMock as any,
      ipoGuruServiceMock as any,
      allotmentJobServiceMock as any,
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

  describe('Transition 1: UPCOMING -> OPEN (LIVE_NOW at 12:00 AM IST on opening date)', () => {
    it('3. should NOT open before 12:00 AM (00:00:00) IST on openDate', async () => {
      // openDate: 2026-09-23 (00:00:00 IST is 2026-09-22 18:30:00 UTC)
      const openDate = new Date('2026-09-23T00:00:00.000Z');
      const nowBeforeMidnight = new Date('2026-09-22T18:29:59.000Z'); // 23:59:59 IST previous day

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          status: IpoStatus.UPCOMING,
          company: { displayName: 'Acme Ltd', legalName: 'Acme Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.OPEN, eventDate: openDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowBeforeMidnight);
      expect(result.openedCount).toBe(0);
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('4. should transition UPCOMING -> OPEN at 12:00 AM (00:00:00) IST on openDate', async () => {
      const openDate = new Date('2026-09-23T00:00:00.000Z');
      const nowAtMidnight = new Date('2026-09-22T18:30:00.000Z'); // 00:00:00 IST on 2026-09-23

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-1',
          status: IpoStatus.UPCOMING,
          company: { displayName: 'Acme Ltd', legalName: 'Acme Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.OPEN, eventDate: openDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtMidnight);
      expect(result.openedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: { id: 'ipo-1', status: IpoStatus.UPCOMING },
        data: { status: IpoStatus.OPEN },
      });
    });
  });

  describe('Transition 2: OPEN / UPCOMING -> CLOSING_TODAY (from 00:00 to 17:00 IST on closing date)', () => {
    it('5a. should transition OPEN -> CLOSING_TODAY at 00:00:00 IST on closeDate', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const nowAtClosingDayStart = new Date('2026-09-24T18:30:00.000Z'); // 00:00:00 IST on 2026-09-25

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2',
          status: IpoStatus.OPEN,
          company: { displayName: 'Beta Ltd', legalName: 'Beta Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtClosingDayStart);
      expect(result.closingTodayCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-2',
          status: { in: [IpoStatus.OPEN, IpoStatus.UPCOMING] },
        },
        data: { status: IpoStatus.CLOSING_TODAY },
      });
    });
  });

  describe('Transition 2b: CLOSING_TODAY / OPEN -> CLOSED (at 5:00 PM IST on closing date)', () => {
    it('5. should NOT close before 17:00:00 IST on closeDate', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const nowBeforeClose = new Date('2026-09-25T11:29:59.000Z'); // 16:59:59 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2',
          status: IpoStatus.CLOSING_TODAY,
          company: { displayName: 'Beta Ltd', legalName: 'Beta Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowBeforeClose);
      expect(result.closedCount).toBe(0);
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: IpoStatus.CLOSED } }),
      );
    });

    it('6. should transition CLOSING_TODAY / OPEN -> CLOSED at 17:00:00 IST on closeDate', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const nowAtClose = new Date('2026-09-25T11:30:00.000Z'); // 17:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2',
          status: IpoStatus.CLOSING_TODAY,
          company: { displayName: 'Beta Ltd', legalName: 'Beta Limited' },
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
          status: { in: [IpoStatus.OPEN, IpoStatus.CLOSING_TODAY, IpoStatus.UPCOMING] },
        },
        data: { status: IpoStatus.CLOSED },
      });
    });
  });

  describe('Transition 3: CLOSED -> ALLOTMENT_PENDING (Allotment Awaited at 12:00 AM IST on allotment date)', () => {
    it('7. should transition CLOSED -> ALLOTMENT_PENDING at 12:00 AM (00:00:00) IST on allotment date', async () => {
      const closeDate = new Date('2026-09-25T00:00:00.000Z');
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowAtAllotmentMidnight = new Date('2026-09-27T18:30:00.000Z'); // 00:00:00 IST on 2026-09-28

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-2b',
          status: IpoStatus.CLOSED,
          company: { displayName: 'Beta Ltd', legalName: 'Beta Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
            { eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: allotmentDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAtAllotmentMidnight);
      expect(result.allotmentAwaitedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-2b',
          status: IpoStatus.CLOSED,
        },
        data: { status: IpoStatus.ALLOTMENT_PENDING },
      });
    });
  });

  describe('Transition 4: Allotment Polling & ALLOTMENT_COMPLETED (ALLOTMENT_OUT)', () => {
    it('8. should NOT start registrar polling before 9:00 PM (21:00:00) IST on allotment date', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowBefore9PM = new Date('2026-09-28T15:29:59.000Z'); // 20:59:59 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.ALLOTMENT_PENDING,
          company: { displayName: 'Gamma Ltd', legalName: 'Gamma Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: allotmentDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowBefore9PM);
      expect(result.allotmentConfirmedCount).toBe(0);
      expect(resolverMock.resolveAdapter).not.toHaveBeenCalled();
    });

    it('9. should poll registrar after 9:00 PM IST and transition to ALLOTMENT_COMPLETED when allotment is out', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowAt9PM = new Date('2026-09-28T15:30:00.000Z'); // 21:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.ALLOTMENT_PENDING,
          allotmentResultAvailableAt: null,
          company: { displayName: 'Gamma Ltd', legalName: 'Gamma Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: allotmentDate },
          ],
        },
      ]);

      const mockAdapter = {
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('GAMMA_ALLOTMENT_LIVE'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      const result = await service.processTimelineTransitions(nowAt9PM);
      expect(result.allotmentConfirmedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-3',
          status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
        },
        data: {
          status: IpoStatus.ALLOTMENT_COMPLETED,
          allotmentResultAvailableAt: nowAt9PM,
        },
      });
      expect(notificationOrchestratorMock.processAllotmentOutEvent).toHaveBeenCalledWith('ipo-3');
    });

    it('10. should throttle 5-minute allotment polling intervals per IPO', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowAt9PM = new Date('2026-09-28T15:30:00.000Z'); // 21:00:00 IST
      const nowAt902PM = new Date('2026-09-28T15:32:00.000Z'); // 21:02:00 IST (2 mins later, < 5 mins)
      const nowAt906PM = new Date('2026-09-28T15:36:00.000Z'); // 21:06:00 IST (> 5 mins later)

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-3',
          status: IpoStatus.ALLOTMENT_PENDING,
          company: { displayName: 'Gamma Ltd', legalName: 'Gamma Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: allotmentDate },
          ],
        },
      ]);

      const mockAdapter = {
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue(null), // Not available yet
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      // 1st tick at 21:00 -> polls registrar
      await service.processTimelineTransitions(nowAt9PM);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(1);

      // 2nd tick at 21:02 -> throttled (skipped)
      await service.processTimelineTransitions(nowAt902PM);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(1);

      // 3rd tick at 21:06 -> eligible (> 5 mins elapsed) -> polls registrar
      await service.processTimelineTransitions(nowAt906PM);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(2);
    });
    it('10b. should trigger automated user allotment checks upon ALLOTMENT_OUT for eligible users', async () => {
      prismaMock.userSavedPan.findMany.mockResolvedValue([
        { userId: 'user-alpha' },
        { userId: 'user-beta' },
      ]);
      prismaMock.ipoInvestment.findMany.mockResolvedValue([]);
      prismaMock.allotmentCheckJob.findFirst.mockResolvedValue(null);

      const count = await service.triggerAutomaticUserAllotmentChecks('ipo-test-auto');
      expect(count).toBe(2);
      expect(allotmentJobServiceMock.createJob).toHaveBeenCalledWith(
        { ipoId: 'ipo-test-auto', identifierType: AllotmentIdentifierType.PAN },
        'user-alpha',
      );
      expect(allotmentJobServiceMock.createJob).toHaveBeenCalledWith(
        { ipoId: 'ipo-test-auto', identifierType: AllotmentIdentifierType.PAN },
        'user-beta',
      );
    });

    it('10c. should NOT re-trigger automatic user allotment check if job already ran recently (idempotent)', async () => {
      prismaMock.userSavedPan.findMany.mockResolvedValue([{ userId: 'user-alpha' }]);
      prismaMock.ipoInvestment.findMany.mockResolvedValue([]);
      // Simulate an existing job created within 24h
      prismaMock.allotmentCheckJob.findFirst.mockResolvedValue({ id: 'existing-job-1' });

      const count = await service.triggerAutomaticUserAllotmentChecks('ipo-test-auto');
      expect(count).toBe(0);
      expect(allotmentJobServiceMock.createJob).not.toHaveBeenCalled();
    });
  });

  describe('Transition 5: ALLOTMENT_COMPLETED -> LISTED (at 10:00 AM IST on listing date)', () => {
    it('11. should transition ALLOTMENT_COMPLETED -> LISTED at 10:00:00 IST on listing date', async () => {
      const listingDate = new Date('2026-09-30T00:00:00.000Z');
      const nowAt10AM = new Date('2026-09-30T04:30:00.000Z'); // 10:00:00 IST

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-4',
          status: IpoStatus.ALLOTMENT_COMPLETED,
          company: { displayName: 'Delta Ltd', legalName: 'Delta Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.LISTING, eventDate: listingDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAt10AM);
      expect(result.listedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-4',
          status: { in: [IpoStatus.ALLOTMENT_COMPLETED, IpoStatus.LISTING_PENDING] },
        },
        data: { status: IpoStatus.LISTED },
      });
    });
  });

  describe('Listing Price Persistence', () => {
    it('12. should detect and persist listing price for LISTED IPO when found', async () => {
      const now = new Date('2026-09-30T05:00:00.000Z');
      const sampleListedIpo = {
        id: 'ipo-listed-1',
        status: IpoStatus.LISTED,
        symbol: 'DELTA',
        priceBandHigh: new Prisma.Decimal('100.00'),
        priceBandLow: new Prisma.Decimal('95.00'),
        lotSize: 100,
        listingPrice: null,
        company: { displayName: 'Delta Ltd', legalName: 'Delta Limited' },
        lifecycleEvents: [],
      };

      prismaMock.ipo.findMany.mockResolvedValue([sampleListedIpo]);

      ipoGuruServiceMock.fetchIpos.mockResolvedValue({
        ipos: [
          {
            name: 'Delta Ltd',
            symbol: 'DELTA',
            listing_price: '150.00',
          },
        ],
      });

      const result = await service.processTimelineTransitions(now);
      expect(result.listingPriceCount).toBe(1);
      expect(prismaMock.ipo.update).toHaveBeenCalledWith({
        where: { id: 'ipo-listed-1' },
        data: {
          listingPrice: new Prisma.Decimal(150),
          listingGainPct: new Prisma.Decimal(50),
          profitAmount: new Prisma.Decimal(5000),
          profitPercentage: new Prisma.Decimal(50),
        },
      });
    });

    it('13. should NOT overwrite an already stored listing price', async () => {
      const now = new Date('2026-09-30T05:00:00.000Z');
      const sampleListedIpoWithPrice = {
        id: 'ipo-listed-1',
        status: IpoStatus.LISTED,
        symbol: 'DELTA',
        listingPrice: new Prisma.Decimal('150.00'),
        company: { displayName: 'Delta Ltd', legalName: 'Delta Limited' },
        lifecycleEvents: [],
      };

      prismaMock.ipo.findMany.mockResolvedValue([sampleListedIpoWithPrice]);

      const result = await service.processTimelineTransitions(now);
      expect(result.listingPriceCount).toBe(0);
      expect(prismaMock.ipo.update).not.toHaveBeenCalled();
    });
  });

  describe('Catch-up, Idempotency & Error Isolation', () => {
    it('14. should safely catch up multiple past transitions in a single tick after downtime', async () => {
      // IPO is currently UPCOMING, but open date (00:00 IST), close date (17:00 IST), and allotment date have all passed
      const openDate = new Date('2026-09-20T00:00:00.000Z');
      const closeDate = new Date('2026-09-22T00:00:00.000Z');
      const allotmentDate = new Date('2026-09-24T00:00:00.000Z');
      const nowAfterAllotment = new Date('2026-09-24T06:00:00.000Z'); // 11:30 AM IST on allotment date

      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-catchup-1',
          status: IpoStatus.UPCOMING,
          company: { displayName: 'Zeta Ltd', legalName: 'Zeta Limited' },
          lifecycleEvents: [
            { eventType: LifecycleEventType.OPEN, eventDate: openDate },
            { eventType: LifecycleEventType.CLOSE, eventDate: closeDate },
            { eventType: LifecycleEventType.BASIS_OF_ALLOTMENT, eventDate: allotmentDate },
          ],
        },
      ]);

      const result = await service.processTimelineTransitions(nowAfterAllotment);
      expect(result.closedCount).toBe(1);
      expect(result.allotmentAwaitedCount).toBe(1);
    });

    it('15. should isolate errors during tick without crashing', async () => {
      prismaMock.ipo.findMany.mockRejectedValue(new Error('Database connection lost'));
      await expect(service.tick()).resolves.not.toThrow();
    });

    it('16. should query ONLY PUBLISHED IPOs and exclude DRAFT publicationStatus from timeline transitions', async () => {
      prismaMock.ipo.findMany.mockResolvedValue([]);
      await service.processTimelineTransitions(new Date());
      expect(prismaMock.ipo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publicationStatus: 'PUBLISHED',
          }),
        }),
      );
    });

    it('17. should check allotment for awaited IPOs and update confirmed records to ALLOTMENT_COMPLETED', async () => {
      const sampleAwaitedIpo = {
        id: 'ipo-awaited-1',
        status: IpoStatus.ALLOTMENT_PENDING,
        company: { displayName: 'Awaited Co', legalName: 'Awaited Company Ltd' },
        lifecycleEvents: [],
        allotmentConfig: { registrar: 'KFin Technologies Limited' },
      };

      prismaMock.ipo.findMany.mockResolvedValue([sampleAwaitedIpo]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: {
          resolveRegistrarIpoCode: jest.fn().mockResolvedValue('KFIN-ACTUAL-CODE-123'),
        },
        registrarIpoCode: 'KFIN-ACTUAL-CODE-123',
      });

      const res = await service.checkAllotmentForAwaitedIpos();
      expect(res.totalChecked).toBe(1);
      expect(res.totalUpdated).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-awaited-1',
          status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
        },
        data: expect.objectContaining({
          status: IpoStatus.ALLOTMENT_COMPLETED,
        }),
      });
      expect(notificationOrchestratorMock.processAllotmentOutEvent).toHaveBeenCalledWith('ipo-awaited-1');
    });
  });
});
