import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  IpoStatus,
  LifecycleEventType,
  ParticipantRole,
  Prisma,
  SourceType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { KfinRegistrarAdapter } from '../allotment/adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from '../allotment/adapters/mufg-intime-registrar.adapter';
import { RegistrarAdapterRegistry } from '../allotment/adapters/registrar-adapter.registry';
import { KfinRegistryStore } from '../allotment/discovery/kfin-registry.store';
import { RegistrarResolver } from '../allotment/registrar.resolver';
import { AllotmentIdentifierType } from '../allotment/allotment.types';
import {
  BACKFILL_MAX_ATTEMPTS,
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
    it('8. should NOT start registrar polling before allotment date (before 00:00:00 IST on allotment date)', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowBeforeAllotmentDate = new Date('2026-09-27T18:29:59.000Z'); // 23:59:59 IST day before

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

      const result = await service.processTimelineTransitions(nowBeforeAllotmentDate);
      expect(result.allotmentConfirmedCount).toBe(0);
      expect(resolverMock.resolveAdapter).not.toHaveBeenCalled();
    });

    it('9. should poll registrar on allotment date and transition to ALLOTMENT_COMPLETED when allotment is out', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowOnAllotmentDate = new Date('2026-09-28T04:30:00.000Z'); // 10:00:00 IST morning

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
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('GAMMA_ALLOTMENT_LIVE'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      const result = await service.processTimelineTransitions(nowOnAllotmentDate);
      expect(result.allotmentConfirmedCount).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-3',
          status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
        },
        data: {
          status: IpoStatus.ALLOTMENT_COMPLETED,
          allotmentResultAvailableAt: nowOnAllotmentDate,
        },
      });
      expect(notificationOrchestratorMock.processAllotmentOutEvent).toHaveBeenCalledWith('ipo-3');
    });

    it('10. should throttle 5-minute allotment polling intervals per IPO', async () => {
      const allotmentDate = new Date('2026-09-28T00:00:00.000Z');
      const nowAt10AM = new Date('2026-09-28T04:30:00.000Z'); // 10:00:00 IST
      const nowAt1002AM = new Date('2026-09-28T04:32:00.000Z'); // 10:02:00 IST (2 mins later, < 5 mins)
      const nowAt1006AM = new Date('2026-09-28T04:36:00.000Z'); // 10:06:00 IST (> 5 mins later)

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
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue(null), // Not available yet
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: mockAdapter,
        registrarIpoCode: 'GAMMA',
      });

      // 1st tick at 10:00 -> polls registrar
      await service.processTimelineTransitions(nowAt10AM);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(1);

      // 2nd tick at 10:02 -> throttled (skipped)
      await service.processTimelineTransitions(nowAt1002AM);
      expect(mockAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(1);

      // 3rd tick at 10:06 -> eligible (> 5 mins elapsed) -> polls registrar
      await service.processTimelineTransitions(nowAt1006AM);
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
          status: {
            in: [
              IpoStatus.CLOSED,
              IpoStatus.ALLOTMENT_PENDING,
              IpoStatus.OPEN,
              IpoStatus.CLOSING_TODAY,
            ],
          },
        },
        data: expect.objectContaining({
          status: IpoStatus.ALLOTMENT_COMPLETED,
        }),
      });
      expect(notificationOrchestratorMock.processAllotmentOutEvent).toHaveBeenCalledWith('ipo-awaited-1');
    });

    it('18. should check and update IPOs currently in OPEN status when close date has passed', async () => {
      const pastCloseDate = new Date('2026-10-25T00:00:00.000Z');
      const sampleOpenIpo = {
        id: 'ipo-open-1',
        status: IpoStatus.OPEN,
        company: { displayName: 'Acme India', legalName: 'Acme India Industries Limited' },
        lifecycleEvents: [
          { eventType: LifecycleEventType.CLOSE, eventDate: pastCloseDate },
        ],
        allotmentConfig: { registrar: 'Bigshare Services Pvt Ltd', registrarIpoCode: '606' },
      };

      prismaMock.ipo.findMany.mockResolvedValue([sampleOpenIpo]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: {
          resolveRegistrarIpoCode: jest.fn().mockResolvedValue('606'),
        },
        registrarIpoCode: '606',
      });

      const res = await service.checkAllotmentForAwaitedIpos();
      expect(res.totalChecked).toBe(1);
      expect(res.totalUpdated).toBe(1);
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-open-1',
          status: {
            in: [
              IpoStatus.CLOSED,
              IpoStatus.ALLOTMENT_PENDING,
              IpoStatus.OPEN,
              IpoStatus.CLOSING_TODAY,
            ],
          },
        },
        data: expect.objectContaining({
          status: IpoStatus.ALLOTMENT_COMPLETED,
        }),
      });
    });

    it('19. should persist discovered KFintech clientId during confirmActualAllotmentAvailability even when IPO is already LISTED', async () => {
      const persistMock = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistMock;
      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const listedMaxwell = {
        id: 'ipo-maxwell-listed-1',
        status: IpoStatus.LISTED,
        symbol: 'MAXWELL',
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        lifecycleEvents: [],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
          enabled: true,
        },
      } as unknown as Parameters<
        IpoTimelineSchedulerService['confirmActualAllotmentAvailability']
      >[0];

      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: {
          code: 'KFINTECH',
          resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
        },
        registrarIpoCode: undefined,
      });

      const confirmed =
        await service.confirmActualAllotmentAvailability(listedMaxwell);

      expect(confirmed).toBe(true);
      expect(persistMock).toHaveBeenCalledWith(
        'ipo-maxwell-listed-1',
        'KFINTECH',
        '88356314970',
      );
      expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
        where: { ipoId: 'ipo-maxwell-listed-1' },
        data: { registrarIpoCode: '88356314970' },
      });
    });

    it('20. should backfill allotmentResultAvailableAt and registrarIpoCode for already-LISTED IPOs during processTimelineTransitions without altering LISTED status', async () => {
      const persistMock = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistMock;
      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const now = createISTDateTime('2026-11-11', 12, 0);
      const listedMaxwell = {
        id: 'ipo-maxwell-listed-2',
        status: IpoStatus.LISTED,
        symbol: 'MAXWELL',
        listingPrice: 120,
        allotmentResultAvailableAt: null,
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.OPEN,
            eventDate: createISTDateTime('2026-10-30', 10, 0),
          },
          {
            eventType: LifecycleEventType.CLOSE,
            eventDate: createISTDateTime('2026-11-03', 17, 0),
          },
          {
            eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
            eventDate: createISTDateTime('2026-11-04', 0, 0),
          },
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-06', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([listedMaxwell]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: {
          code: 'KFINTECH',
          resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
        },
        registrarIpoCode: undefined,
      });

      await service.processTimelineTransitions(now);

      expect(persistMock).toHaveBeenCalledWith(
        'ipo-maxwell-listed-2',
        'KFINTECH',
        '88356314970',
      );
      expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
        where: { ipoId: 'ipo-maxwell-listed-2' },
        data: { registrarIpoCode: '88356314970' },
      });
      expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ipo-maxwell-listed-2',
          allotmentResultAvailableAt: null,
        },
        data: {
          allotmentResultAvailableAt: now,
        },
      });
      expect(
        notificationOrchestratorMock.processAllotmentOutEvent,
      ).not.toHaveBeenCalled();
    });

    it('21. should skip automatic backfill for historical LISTED IPOs older than 30 days and legacy LISTED IPOs without recent dates', async () => {
      const now = createISTDateTime('2026-11-11', 12, 0);
      const oldListedIpo = {
        id: 'ipo-old-listed-31d',
        status: IpoStatus.LISTED,
        symbol: 'OLDIPO',
        listingPrice: 110,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-09-20', 10, 0),
        company: {
          displayName: 'Old Listed Co',
          legalName: 'Old Listed Company Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-10-11', 10, 0), // 31 days before 2026-11-11
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      const legacyListedWithoutEvents = {
        id: 'ipo-legacy-listed-nodates',
        status: IpoStatus.LISTED,
        symbol: 'LEGACYIPO',
        listingPrice: 95,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-08-01', 10, 0),
        company: {
          displayName: 'Legacy Listed Co',
          legalName: 'Legacy Listed Company Limited',
        },
        lifecycleEvents: [],
        allotmentConfig: {
          registrar: 'mufg_intime',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([
        oldListedIpo,
        legacyListedWithoutEvents,
      ]);

      await service.processTimelineTransitions(now);

      expect(resolverMock.resolveAdapter).not.toHaveBeenCalled();
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      expect(
        notificationOrchestratorMock.processAllotmentOutEvent,
      ).not.toHaveBeenCalled();
    });

    it('22. should preserve automatic backfill for recent ALLOTMENT_COMPLETED, LISTING_PENDING, and within-30-day LISTED IPOs without sending notifications', async () => {
      const now = createISTDateTime('2026-11-11', 12, 0);
      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const completedIpo = {
        id: 'ipo-recent-completed',
        status: IpoStatus.ALLOTMENT_COMPLETED,
        symbol: 'COMPIPO',
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-05', 10, 0),
        company: {
          displayName: 'Recent Completed Co',
          legalName: 'Recent Completed Company Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
            eventDate: createISTDateTime('2026-11-09', 0, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      const listingPendingIpo = {
        id: 'ipo-recent-listing-pending',
        status: IpoStatus.LISTING_PENDING,
        symbol: 'PENDIPO',
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-05', 10, 0),
        company: {
          displayName: 'Listing Pending Co',
          legalName: 'Listing Pending Company Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-13', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'bigshare',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      const thirtyDayListedIpo = {
        id: 'ipo-listed-day-30',
        status: IpoStatus.LISTED,
        symbol: 'THIRTYIPO',
        listingPrice: 130,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-10-05', 10, 0),
        company: {
          displayName: 'Thirty Day Co',
          legalName: 'Thirty Day Company Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-10-12', 10, 0), // Exact 30th day on 2026-11-11
          },
        ],
        allotmentConfig: {
          registrar: 'maashitla',
          registrarIpoCode: null,
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([
        completedIpo,
        listingPendingIpo,
        thirtyDayListedIpo,
      ]);

      resolverMock.resolveAdapter
        .mockResolvedValueOnce({
          adapter: {
            code: 'KFINTECH',
            resolveRegistrarIpoCode: jest.fn().mockResolvedValue('11111111111'),
          },
          registrarIpoCode: undefined,
        })
        .mockResolvedValueOnce({
          adapter: {
            code: 'BIGSHARE',
            resolveRegistrarIpoCode: jest.fn().mockResolvedValue('607'),
          },
          registrarIpoCode: undefined,
        })
        .mockResolvedValueOnce({
          adapter: {
            code: 'MAASHITLA',
            resolveRegistrarIpoCode: jest.fn().mockResolvedValue('thirty-day'),
          },
          registrarIpoCode: undefined,
        });

      await service.processTimelineTransitions(now);

      for (const ipoId of [
        'ipo-recent-completed',
        'ipo-recent-listing-pending',
        'ipo-listed-day-30',
      ]) {
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: { id: ipoId, allotmentResultAvailableAt: null },
          data: { allotmentResultAvailableAt: now },
        });
      }
      expect(
        notificationOrchestratorMock.processAllotmentOutEvent,
      ).not.toHaveBeenCalled();
    });

    it('23. should verify known registrar code against cached KFintech active list without force-refreshing', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipo-scheduler-test23-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );

      const store = new KfinRegistryStore({
        storagePath: path.join(tmpDir, 'kfin-registry.json'),
      });
      const getRegistrySpy = jest.spyOn(store, 'getActiveRegistry');
      let bundleFetchCount = 0;
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.3d909f65.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.3d909f65.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.3d909f65.js')) {
            bundleFetchCount++;
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"88356314970","name":"MAXWELL ENGINEERING SOLUTIONS LIMITED"}]');`,
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
        });

      const realKfinAdapter = new KfinRegistrarAdapter(store);
      const resolveCodeSpy = jest.spyOn(
        realKfinAdapter,
        'resolveRegistrarIpoCode',
      );
      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as never,
        ipoGuruServiceMock as never,
        allotmentJobServiceMock as never,
      );

      const now = createISTDateTime('2026-11-11', 12, 0);
      const listedKnownCodeIpo = {
        id: 'ipo-maxwell-known-code',
        status: IpoStatus.LISTED,
        symbol: 'MAXWELL',
        listingPrice: 120,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-10-29', 10, 0),
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-06', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([listedKnownCodeIpo]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: realKfinAdapter,
        registrarIpoCode: '88356314970',
      });

      try {
        await isolatedService.processTimelineTransitions(now);

        expect(resolveCodeSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            requireLiveActiveList: true,
            skipForceRefresh: true,
          }),
        );
        expect(getRegistrySpy).toHaveBeenCalledTimes(1);
        expect(getRegistrySpy).not.toHaveBeenCalledWith(true);
        expect(bundleFetchCount).toBe(1);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'ipo-maxwell-known-code',
            allotmentResultAvailableAt: null,
          },
          data: { allotmentResultAvailableAt: now },
        });
      } finally {
        resolveCodeSpy.mockRestore();
        isolatedService.onModuleDestroy();
        fetchSpy.mockRestore();
        getRegistrySpy.mockRestore();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('24. should reuse normal cached KFintech registry across multiple recent IPOs instead of force-refreshing per IPO', async () => {
      const store = new KfinRegistryStore();
      const getRegistrySpy = jest.spyOn(store, 'getActiveRegistry');
      let bundleFetchCount = 0;
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.3d909f65.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.3d909f65.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.3d909f65.js')) {
            bundleFetchCount++;
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"88356314970","name":"MAXWELL ENGINEERING SOLUTIONS LIMITED"}]');`,
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
        });

      const realKfinAdapter = new KfinRegistrarAdapter(store);
      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const now = createISTDateTime('2026-11-11', 12, 0);
      const makeRecentListed = (id: string, name: string) => ({
        id,
        status: IpoStatus.LISTED,
        symbol: id.toUpperCase(),
        listingPrice: 100,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-10-30', 10, 0),
        company: { displayName: name, legalName: `${name} Limited` },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-06', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: null,
          enabled: true,
        },
      });

      prismaMock.ipo.findMany.mockResolvedValue([
        makeRecentListed('ipo-1', 'Maxwell Engineering Solutions'),
        makeRecentListed('ipo-2', 'Unpublished Alpha Tech'),
        makeRecentListed('ipo-3', 'Unpublished Beta Infra'),
      ]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: realKfinAdapter,
        registrarIpoCode: undefined,
      });

      try {
        await service.processTimelineTransitions(now);

        expect(bundleFetchCount).toBe(1);
        expect(getRegistrySpy).not.toHaveBeenCalledWith(true);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: { id: 'ipo-1', allotmentResultAvailableAt: null },
          data: { allotmentResultAvailableAt: now },
        });
      } finally {
        fetchSpy.mockRestore();
        getRegistrySpy.mockRestore();
      }
    });

    it('25. should bound repeated failed backfill attempts via exponential backoff and persist retry exhaustion across scheduler restarts', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipovault-backfill-retry-'),
      );
      const statePath = path.join(tmpDir, 'backfill-state.json');
      const prevEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = statePath;

      try {
        const persistentService = new IpoTimelineSchedulerService(
          prismaMock as unknown as PrismaService,
          resolverMock as unknown as RegistrarResolver,
          notificationOrchestratorMock as never,
          ipoGuruServiceMock as never,
          allotmentJobServiceMock as never,
        );

        const resolveMock = jest.fn().mockResolvedValue(null);
        const recentFailingListedIpo = {
          id: 'ipo-mufg-failing',
          status: IpoStatus.LISTED,
          symbol: 'MUFGFAIL',
          listingPrice: 100,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-01', 10, 0),
          company: {
            displayName: 'MUFG Missing Co',
            legalName: 'MUFG Missing Company Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-11-06', 10, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'mufg_intime',
            registrarIpoCode: null,
            enabled: true,
          },
        };

        prismaMock.ipo.findMany.mockResolvedValue([recentFailingListedIpo]);
        resolverMock.resolveAdapter.mockResolvedValue({
          adapter: {
            code: 'MUFG_INTIME',
            resolveRegistrarIpoCode: resolveMock,
          },
          registrarIpoCode: undefined,
        });

        const baseMs = createISTDateTime('2026-11-11', 10, 0).getTime();
        // Run 20 hourly/5-min ticks over ~20 hours
        const minuteOffsets = [
          0, 2, 4, 5, 10, 19, 20, 40, 64, 65, 120, 199, 200, 300, 380, 560, 720,
          900, 1080, 1200,
        ];
        for (const mins of minuteOffsets) {
          await persistentService.processTimelineTransitions(
            new Date(baseMs + mins * 60 * 1000),
          );
        }

        // Attempts 1..5 run at 0m (fail -> +5m), 5m (fail -> +15m = 20m), 20m (fail -> +45m = 65m),
        // 65m (fail -> +135m = 200m), 200m (fail -> exhausted). Never exceeds BACKFILL_MAX_ATTEMPTS.
        expect(resolveMock).toHaveBeenCalledTimes(BACKFILL_MAX_ATTEMPTS);

        persistentService.onModuleDestroy();

        // Simulate process restart with a fresh scheduler instance reading persisted retry state
        const restartedService = new IpoTimelineSchedulerService(
          prismaMock as unknown as PrismaService,
          resolverMock as unknown as RegistrarResolver,
          notificationOrchestratorMock as never,
          ipoGuruServiceMock as never,
          allotmentJobServiceMock as never,
        );

        await restartedService.processTimelineTransitions(
          new Date(baseMs + 24 * 60 * 60 * 1000),
        );
        expect(resolveMock).toHaveBeenCalledTimes(BACKFILL_MAX_ATTEMPTS);
        restartedService.onModuleDestroy();
      } finally {
        if (prevEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('26. should NEVER write allotmentResultAvailableAt solely from a pre-populated registrarIpoCode when absent from active registrar lists', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipo-scheduler-test26-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );

      const store = new KfinRegistryStore({
        storagePath: path.join(tmpDir, 'kfin-registry.json'),
      });
      const getRegistrySpy = jest.spyOn(store, 'getActiveRegistry');
      let kfinBundleFetches = 0;
      let mufgGetDetailsFetches = 0;

      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.3d909f65.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.3d909f65.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.3d909f65.js')) {
            kfinBundleFetches++;
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"11111111111","name":"SOME OTHER KFIN IPO LIMITED"}]');`,
            } as unknown as Response);
          }
          if (urlStr.includes('/Initial_Offer/IPO.aspx/GetDetails')) {
            mufgGetDetailsFetches++;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                d: '<NewDataSet><Table><company_id>555555</company_id><companyname>SOME OTHER MUFG IPO LIMITED</companyname></Table></NewDataSet>',
              }),
            } as unknown as Response);
          }
          return Promise.reject(new Error(`Unexpected fetch to ${urlStr}`));
        });

      const realKfinAdapter = new KfinRegistrarAdapter(store);
      const realMufgAdapter = new MufgIntimeRegistrarAdapter();
      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as never,
        ipoGuruServiceMock as never,
        allotmentJobServiceMock as never,
      );

      const now = createISTDateTime('2026-11-11', 12, 0);
      const kfinListingPending = {
        id: 'ipo-kfin-pending-unlisted',
        status: IpoStatus.LISTING_PENDING,
        symbol: 'KFINPEND',
        listingPrice: null,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-01', 10, 0),
        company: {
          displayName: 'Unpublished KFin IPO',
          legalName: 'Unpublished KFin IPO Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-13', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '77777777777',
          enabled: true,
        },
      };
      const mufgCompleted = {
        id: 'ipo-mufg-completed-unlisted',
        status: IpoStatus.ALLOTMENT_COMPLETED,
        symbol: 'MUFGCOMP',
        listingPrice: null,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-01', 10, 0),
        company: {
          displayName: 'Unpublished MUFG One',
          legalName: 'Unpublished MUFG One Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-14', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'mufg_intime',
          registrarIpoCode: '999991',
          enabled: true,
        },
      };
      const mufgRecentListed = {
        id: 'ipo-mufg-listed-unlisted',
        status: IpoStatus.LISTED,
        symbol: 'MUFGLIST',
        listingPrice: 150,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-10-30', 10, 0),
        company: {
          displayName: 'Unpublished MUFG Two',
          legalName: 'Unpublished MUFG Two Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-07', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'mufg_intime',
          registrarIpoCode: '999992',
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([
        kfinListingPending,
        mufgCompleted,
        mufgRecentListed,
      ]);
      resolverMock.resolveAdapter
        .mockResolvedValueOnce({
          adapter: realKfinAdapter,
          registrarIpoCode: '77777777777',
        })
        .mockResolvedValueOnce({
          adapter: realMufgAdapter,
          registrarIpoCode: '999991',
        })
        .mockResolvedValueOnce({
          adapter: realMufgAdapter,
          registrarIpoCode: '999992',
        });

      try {
        await isolatedService.processTimelineTransitions(now);

        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(getRegistrySpy).toHaveBeenCalledTimes(1);
        expect(getRegistrySpy).not.toHaveBeenCalledWith(true);
        expect(kfinBundleFetches).toBe(1);
        expect(mufgGetDetailsFetches).toBe(1);
      } finally {
        isolatedService.onModuleDestroy();
        fetchSpy.mockRestore();
        getRegistrySpy.mockRestore();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('27. should backfill allotmentResultAvailableAt only after an already-known code later appears in the registrar active list', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipo-scheduler-test27-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      const prevMufgTtlEnv = process.env.MUFG_INTIME_COMPANY_LIST_CACHE_TTL_MS;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );
      process.env.MUFG_INTIME_COMPANY_LIST_CACHE_TTL_MS = '60000';

      let publishCompany = false;
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          if (String(url).includes('/Initial_Offer/IPO.aspx/GetDetails')) {
            const payload = publishCompany
              ? '<NewDataSet><Table><company_id>888123</company_id><companyname>ACME TECHNOLOGIES LIMITED</companyname></Table></NewDataSet>'
              : '<NewDataSet><Table><company_id>555555</company_id><companyname>OTHER COMPANY LIMITED</companyname></Table></NewDataSet>';
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ d: payload }),
            } as unknown as Response);
          }
          return Promise.reject(
            new Error(`Unexpected fetch to ${String(url)}`),
          );
        });

      const realMufgAdapter = new MufgIntimeRegistrarAdapter();
      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as never,
        ipoGuruServiceMock as never,
        allotmentJobServiceMock as never,
      );

      const t1 = createISTDateTime('2026-11-11', 12, 0);
      const t2 = new Date(t1.getTime() + 10 * 60 * 1000);
      const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(t1.getTime());

      const mufgKnownIpo = {
        id: 'ipo-mufg-delayed-publish',
        status: IpoStatus.LISTED,
        symbol: 'ACME',
        listingPrice: 180,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-01', 10, 0),
        company: {
          displayName: 'Acme Technologies',
          legalName: 'Acme Technologies Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-08', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'mufg_intime',
          registrarIpoCode: '888123',
          enabled: true,
        },
      };

      prismaMock.ipo.findMany.mockResolvedValue([mufgKnownIpo]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: realMufgAdapter,
        registrarIpoCode: '888123',
      });

      try {
        await isolatedService.processTimelineTransitions(t1);
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();

        // Wait past retry backoff and cache TTL, then registrar publishes the company
        publishCompany = true;
        dateNowSpy.mockReturnValue(t2.getTime());

        await isolatedService.processTimelineTransitions(t2);
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'ipo-mufg-delayed-publish',
            allotmentResultAvailableAt: null,
          },
          data: { allotmentResultAvailableAt: t2 },
        });
      } finally {
        dateNowSpy.mockRestore();
        isolatedService.onModuleDestroy();
        fetchSpy.mockRestore();
        if (prevMufgTtlEnv === undefined) {
          delete process.env.MUFG_INTIME_COMPANY_LIST_CACHE_TTL_MS;
        } else {
          process.env.MUFG_INTIME_COMPANY_LIST_CACHE_TTL_MS = prevMufgTtlEnv;
        }
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('28. should reject KFIN_VERIFIED_FALLBACK_REGISTRY, STATIC_BASELINE, and stale disk snapshot matches in Section 5 and Section 8', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipo-scheduler-test28-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );

      const diskPath = path.join(tmpDir, 'stale-kfin.json');
      fs.writeFileSync(
        diskPath,
        JSON.stringify({
          metadata: {
            version: 1,
            registrarCode: 'KFINTECH',
            sourceTimestamp: '2026-11-10T00:00:00.000Z',
            fetchedAt: '2026-11-10T00:00:00.000Z',
            sourceType: 'PORTAL_SPA_BUNDLE',
            itemCount: 1,
            validationStatus: 'VALID',
            isStale: false,
            contentHash: 'deadbeef',
          },
          items: [
            {
              clientId: '88356314970',
              name: 'MAXWELL ENGINEERING SOLUTIONS LIMITED',
            },
          ],
        }),
        'utf8',
      );

      const liveOmitStore = new KfinRegistryStore({
        storagePath: path.join(tmpDir, 'live-omit.json'),
      });
      const liveOmitAdapter = new KfinRegistrarAdapter(liveOmitStore);

      const offlineStore = new KfinRegistryStore({
        storagePath: path.join(tmpDir, 'offline.json'),
      });
      const offlineAdapter = new KfinRegistrarAdapter(offlineStore);

      const staleDiskStore = new KfinRegistryStore({
        storagePath: diskPath,
        minItemsThreshold: 1,
      });
      staleDiskStore.hydrateFromPersistentStorage();
      const staleDiskAdapter = new KfinRegistrarAdapter(staleDiskStore);

      let mode: 'LIVE_OMIT' | 'OFFLINE' = 'LIVE_OMIT';
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation((url: unknown) => {
          if (mode === 'OFFLINE') {
            return Promise.reject(new Error('ECONNREFUSED'));
          }
          const urlStr = String(url);
          if (urlStr === 'https://ipostatus.kfintech.com/') {
            return Promise.resolve({
              ok: true,
              status: 200,
              text: async () =>
                '<!doctype html><html><head><script src="./static/js/main.other.js"></script></head><body></body></html>',
            } as unknown as Response);
          }
          if (urlStr.includes('/asset-manifest.json')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({
                files: { 'main.js': './static/js/main.other.js' },
              }),
            } as unknown as Response);
          }
          if (urlStr.includes('main.other.js')) {
            return Promise.resolve({
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'text/javascript' }),
              text: async () =>
                `var rf=JSON.parse('[{"clientId":"11111111111","name":"OTHER ACTIVE IPO LIMITED"}]');`,
            } as unknown as Response);
          }
          return Promise.reject(
            new Error(`Unexpected fetch to ${String(url)}`),
          );
        });

      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as never,
        ipoGuruServiceMock as never,
        allotmentJobServiceMock as never,
      );

      const now = createISTDateTime('2026-11-11', 12, 0);
      const sec5Pending = {
        id: 'ipo-sec5-fallback-only',
        status: IpoStatus.ALLOTMENT_PENDING,
        symbol: 'MAXWELL',
        listingPrice: null,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-11-08', 10, 0),
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
            eventDate: createISTDateTime('2026-11-11', 0, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
          enabled: true,
        },
      };
      const sec8Listed = {
        id: 'ipo-sec8-fallback-only',
        status: IpoStatus.LISTED,
        symbol: 'MAXWELL',
        listingPrice: 120,
        allotmentResultAvailableAt: null,
        createdAt: createISTDateTime('2026-10-29', 10, 0),
        company: {
          displayName: 'Maxwell Engineering Solutions',
          legalName: 'Maxwell Engineering Solutions Limited',
        },
        lifecycleEvents: [
          {
            eventType: LifecycleEventType.LISTING,
            eventDate: createISTDateTime('2026-11-06', 10, 0),
          },
        ],
        allotmentConfig: {
          registrar: 'kfintech',
          registrarIpoCode: '88356314970',
          enabled: true,
        },
      };

      try {
        // Case A: Fresh live bundle omits Maxwell (exists in KFIN_VERIFIED_FALLBACK_REGISTRY)
        prismaMock.ipo.findMany.mockResolvedValue([sec5Pending, sec8Listed]);
        resolverMock.resolveAdapter.mockResolvedValue({
          adapter: liveOmitAdapter,
          registrarIpoCode: '88356314970',
        });

        await isolatedService.processTimelineTransitions(now);
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(
          notificationOrchestratorMock.processAllotmentOutEvent,
        ).not.toHaveBeenCalled();

        // Case B: Live source offline -> STATIC_BASELINE and stale PERSISTED_DISK_SNAPSHOT
        mode = 'OFFLINE';
        const laterNow = new Date(now.getTime() + 10 * 60 * 1000);
        resolverMock.resolveAdapter
          .mockResolvedValueOnce({
            adapter: offlineAdapter,
            registrarIpoCode: '88356314970',
          })
          .mockResolvedValueOnce({
            adapter: staleDiskAdapter,
            registrarIpoCode: '88356314970',
          });

        await isolatedService.processTimelineTransitions(laterNow);
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(
          notificationOrchestratorMock.processAllotmentOutEvent,
        ).not.toHaveBeenCalled();
      } finally {
        isolatedService.onModuleDestroy();
        fetchSpy.mockRestore();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects placeholder registrar codes (N/A, TBD, NIL) from adapter probes and backfill', async () => {
      const placeholderAdapter = {
        code: 'BIGSHARE',
        resolveRegistrarIpoCode: jest
          .fn()
          .mockResolvedValueOnce('N/A')
          .mockResolvedValueOnce('TBD')
          .mockResolvedValueOnce('NIL'),
      };
      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const now = createISTDateTime('2026-11-11', 12, 0);
      prismaMock.ipo.findMany.mockResolvedValue([
        {
          id: 'ipo-sched-placeholder-1',
          status: IpoStatus.ALLOTMENT_PENDING,
          symbol: 'SCHPH1',
          listingPrice: null,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-08', 10, 0),
          company: {
            displayName: 'Scheduler Placeholder One',
            legalName: 'Scheduler Placeholder One Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
              eventDate: createISTDateTime('2026-11-11', 0, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'BIGSHARE',
            registrarIpoCode: 'TBD',
            enabled: true,
          },
        },
        {
          id: 'ipo-sched-placeholder-2',
          status: IpoStatus.LISTED,
          symbol: 'SCHPH2',
          listingPrice: 120,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-01', 10, 0),
          company: {
            displayName: 'Scheduler Placeholder Two',
            legalName: 'Scheduler Placeholder Two Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-11-06', 10, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'BIGSHARE',
            registrarIpoCode: 'N/A',
            enabled: true,
          },
        },
      ]);
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: placeholderAdapter,
        registrarIpoCode: undefined,
      });

      await service.processTimelineTransitions(now);

      expect(placeholderAdapter.resolveRegistrarIpoCode).toHaveBeenCalled();
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      expect(
        notificationOrchestratorMock.processAllotmentOutEvent,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Cross-Source Registrar Metadata Reconciliation & Persistence Safeguards', () => {
    it('includes sourceIdentities and REGISTRAR participants in scheduler findMany queries', async () => {
      prismaMock.ipo.findMany.mockResolvedValue([]);

      const now = createISTDateTime('2026-11-11', 12, 0);
      await service.processTimelineTransitions(now);
      await service.checkAllotmentForAwaitedIpos();

      expect(prismaMock.ipo.findMany).toHaveBeenCalledTimes(2);
      for (const call of prismaMock.ipo.findMany.mock.calls) {
        expect(call[0].include).toEqual(
          expect.objectContaining({
            company: true,
            lifecycleEvents: true,
            allotmentConfig: true,
            sourceIdentities: {
              include: {
                source: true,
              },
            },
            participants: {
              where: {
                role: ParticipantRole.REGISTRAR,
              },
            },
          }),
        );
      }
    });

    it('rejects conflicting REGISTRAR participant across timeline polling, LISTED backfill, and direct helpers with zero DB writes', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipovault-sched-conflict-part-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );

      const persistSpy = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistSpy;

      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const kfinAdapter = {
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: kfinAdapter,
        registrarIpoCode: '88356314970',
      });

      const registry = new RegistrarAdapterRegistry();
      registry.register(kfinAdapter as any);

      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as any,
        ipoGuruServiceMock as any,
        allotmentJobServiceMock as any,
        registry,
      );

      try {
        const listedConflictIpo: any = {
          id: 'ipo-conflict-part-listed',
          status: IpoStatus.LISTED,
          symbol: 'CNFL1',
          listingPrice: 125,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-01', 10, 0),
          company: {
            displayName: 'Conflict Participant Ltd',
            legalName: 'Conflict Participant Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-11-06', 10, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'KFINTECH',
            registrarIpoCode: null,
            enabled: true,
          },
          sourceIdentities: [],
          participants: [
            {
              role: ParticipantRole.REGISTRAR,
              name: 'Bigshare Services Pvt Ltd',
              entityName: null,
            },
          ],
        };

        const pendingConflictIpo: any = {
          ...listedConflictIpo,
          id: 'ipo-conflict-part-pending',
          status: IpoStatus.ALLOTMENT_PENDING,
          symbol: 'CNFL2',
          listingPrice: null,
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.BASIS_OF_ALLOTMENT,
              eventDate: createISTDateTime('2026-11-11', 0, 0),
            },
          ],
        };

        prismaMock.ipo.findMany.mockResolvedValue([
          listedConflictIpo,
          pendingConflictIpo,
        ]);

        const now = createISTDateTime('2026-11-11', 12, 0);
        const result = await isolatedService.processTimelineTransitions(now);

        expect(result.allotmentConfirmedCount).toBe(0);
        expect(
          await isolatedService.confirmActualAllotmentAvailability(
            listedConflictIpo,
          ),
        ).toBe(false);
        expect(
          await (isolatedService as any).persistDiscoveredCode(
            listedConflictIpo,
            'KFINTECH',
            '88356314970',
          ),
        ).toBe(false);

        expect(kfinAdapter.resolveRegistrarIpoCode).not.toHaveBeenCalled();
        expect(persistSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(
          notificationOrchestratorMock.processAllotmentOutEvent,
        ).not.toHaveBeenCalled();
      } finally {
        isolatedService.onModuleDestroy();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('rejects conflicting sourceIdentity registrar with zero code persistence and zero timestamp backfill', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipovault-sched-conflict-src-'),
      );
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = path.join(
        tmpDir,
        'retry-state.json',
      );

      const persistSpy = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistSpy;

      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const kfinAdapter = {
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: kfinAdapter,
        registrarIpoCode: '88356314970',
      });

      const registry = new RegistrarAdapterRegistry();
      registry.register(kfinAdapter as any);

      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as any,
        ipoGuruServiceMock as any,
        allotmentJobServiceMock as any,
        registry,
      );

      try {
        const listedConflictIpo: any = {
          id: 'ipo-conflict-src-1',
          status: IpoStatus.LISTED,
          symbol: 'CNFLSRC',
          listingPrice: 200,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-01', 10, 0),
          company: {
            displayName: 'Conflict SourceIdentity Ltd',
            legalName: 'Conflict SourceIdentity Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-11-06', 10, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'KFINTECH',
            registrarIpoCode: null,
            enabled: true,
          },
          sourceIdentities: [
            {
              source: {
                sourceType: SourceType.REGISTRAR,
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India Pvt Ltd',
              },
            },
          ],
          participants: [],
        };

        prismaMock.ipo.findMany.mockResolvedValue([listedConflictIpo]);

        await isolatedService.processTimelineTransitions(
          createISTDateTime('2026-11-11', 12, 0),
        );

        expect(kfinAdapter.resolveRegistrarIpoCode).not.toHaveBeenCalled();
        expect(persistSpy).not.toHaveBeenCalled();
        expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
        expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
        expect(
          notificationOrchestratorMock.processAllotmentOutEvent,
        ).not.toHaveBeenCalled();
      } finally {
        isolatedService.onModuleDestroy();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('fails closed on unknown companion fields, disabled configs, lookup failures, and post-resolve adapter mismatches', async () => {
      const persistSpy = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistSpy;

      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      const kfinAdapter = {
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn().mockResolvedValue('88356314970'),
      };
      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: kfinAdapter,
        registrarIpoCode: '88356314970',
      });

      const baseCompany = {
        displayName: 'Unknown Companion Ltd',
        legalName: 'Unknown Companion Limited',
      };

      // 1. Participant with recognized name + unrecognized entityName companion field
      const unknownPartCompanion: any = {
        id: 'ipo-unk-part',
        status: IpoStatus.ALLOTMENT_PENDING,
        company: baseCompany,
        lifecycleEvents: [],
        allotmentConfig: null,
        sourceIdentities: [],
        participants: [
          {
            role: ParticipantRole.REGISTRAR,
            name: 'KFin Technologies Limited',
            entityName: 'Mystery Unrecognized Registrar',
          },
        ],
      };

      // 2. SourceIdentity with recognized code + unrecognized name companion field
      const unknownSourceCompanion: any = {
        id: 'ipo-unk-src',
        status: IpoStatus.ALLOTMENT_PENDING,
        company: baseCompany,
        lifecycleEvents: [],
        allotmentConfig: null,
        sourceIdentities: [
          {
            source: {
              sourceType: SourceType.REGISTRAR,
              code: 'KFINTECH',
              name: 'Unrecognized Alias Registrar Co',
            },
          },
        ],
        participants: [],
      };

      // 3. Disabled allotmentConfig
      const disabledConfigIpo: any = {
        id: 'ipo-disabled-cfg',
        status: IpoStatus.LISTED,
        company: baseCompany,
        lifecycleEvents: [],
        allotmentConfig: {
          registrar: 'KFINTECH',
          enabled: false,
        },
        sourceIdentities: [],
        participants: [],
      };

      // 4. Lookup failure when participants relation wasn't preloaded
      prismaMock.ipoParticipant = {
        findMany: jest.fn().mockRejectedValue(new Error('DB timeout')),
      };
      const lookupFailureIpo: any = {
        id: 'ipo-lookup-fail',
        status: IpoStatus.LISTED,
        company: baseCompany,
        lifecycleEvents: [],
        allotmentConfig: {
          registrar: 'KFINTECH',
          enabled: true,
        },
        sourceIdentities: [],
      };

      // 5. Consistent stored MUFG_INTIME metadata vs mismatched resolved KFINTECH adapter
      const postResolveMismatchIpo: any = {
        id: 'ipo-post-mismatch',
        status: IpoStatus.ALLOTMENT_PENDING,
        company: baseCompany,
        lifecycleEvents: [],
        allotmentConfig: {
          registrar: 'MUFG_INTIME',
          enabled: true,
        },
        sourceIdentities: [],
        participants: [],
      };

      expect(
        await service.confirmActualAllotmentAvailability(unknownPartCompanion),
      ).toBe(false);
      expect(
        await service.confirmActualAllotmentAvailability(unknownSourceCompanion),
      ).toBe(false);
      expect(
        await service.confirmActualAllotmentAvailability(disabledConfigIpo),
      ).toBe(false);
      expect(
        await service.confirmActualAllotmentAvailability(lookupFailureIpo),
      ).toBe(false);
      expect(
        await service.confirmActualAllotmentAvailability(postResolveMismatchIpo),
      ).toBe(false);

      expect(kfinAdapter.resolveRegistrarIpoCode).not.toHaveBeenCalled();
      expect(persistSpy).not.toHaveBeenCalled();
      expect(prismaMock.ipoAllotmentConfig.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.ipo.updateMany).not.toHaveBeenCalled();
    });

    it('accepts consistent cross-source metadata with fresh live KFin active-list confirmation while preserving safeguards', async () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'ipovault-sched-consistent-kfin-'),
      );
      const snapshotPath = path.join(tmpDir, 'kfin-registry.json');
      const retryStatePath = path.join(tmpDir, 'retry-state.json');
      const prevRetryEnv = process.env.ALLOTMENT_BACKFILL_STATE_PATH;
      process.env.ALLOTMENT_BACKFILL_STATE_PATH = retryStatePath;

      const store = new KfinRegistryStore({
        storagePath: snapshotPath,
        minItemsThreshold: 1,
      });
      const kfinAdapter = new KfinRegistrarAdapter(store);
      const registry = new RegistrarAdapterRegistry();
      registry.register(kfinAdapter);

      const bundleJs =
        `var rf=JSON.parse('[{"clientId":"88356314970","name":"MAXWELL ENERGY SYSTEMS LIMITED"}]');`;
      const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const target = String(url);
        if (target === 'https://ipostatus.kfintech.com/') {
          return {
            ok: true,
            status: 200,
            text: async () =>
              '<!doctype html><html><head><script src="./static/js/main.consistent99.js"></script></head><body></body></html>',
          } as unknown as Response;
        }
        if (target.includes('/asset-manifest.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              files: { 'main.js': './static/js/main.consistent99.js' },
            }),
          } as unknown as Response;
        }
        if (target.includes('main.consistent99.js')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/javascript' }),
            text: async () => bundleJs,
          } as unknown as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as unknown as Response;
      });

      const persistSpy = jest.fn().mockResolvedValue(undefined);
      (
        resolverMock as unknown as {
          persistDiscoveredRegistrarIdentity: jest.Mock;
        }
      ).persistDiscoveredRegistrarIdentity = persistSpy;

      prismaMock.ipoAllotmentConfig = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      };

      resolverMock.resolveAdapter.mockResolvedValue({
        adapter: kfinAdapter,
        registrarIpoCode: undefined,
      });

      const isolatedService = new IpoTimelineSchedulerService(
        prismaMock as unknown as PrismaService,
        resolverMock as unknown as RegistrarResolver,
        notificationOrchestratorMock as any,
        ipoGuruServiceMock as any,
        allotmentJobServiceMock as any,
        registry,
      );

      try {
        const now = createISTDateTime('2026-11-11', 12, 0);
        const freshListedConsistentIpo: any = {
          id: 'ipo-kfin-consistent-listed',
          status: IpoStatus.LISTED,
          symbol: 'MAXWELL',
          listingPrice: 145,
          allotmentResultAvailableAt: null,
          createdAt: createISTDateTime('2026-11-01', 10, 0),
          company: {
            displayName: 'Maxwell Energy Systems',
            legalName: 'Maxwell Energy Systems Limited',
          },
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-11-06', 10, 0),
            },
          ],
          allotmentConfig: {
            registrar: 'KFin Technologies Limited',
            registrarIpoCode: null,
            enabled: true,
          },
          sourceIdentities: [
            {
              source: {
                sourceType: SourceType.REGISTRAR,
                code: 'KFINTECH',
                name: 'KFintech',
              },
            },
            {
              // Non-registrar exchange source must not trigger conflict
              source: {
                sourceType: SourceType.EXCHANGE,
                code: 'NSE_UNKNOWN_CODE',
                name: 'National Stock Exchange',
              },
            },
          ],
          participants: [
            {
              role: ParticipantRole.REGISTRAR,
              name: 'KFin Technologies Ltd',
              entityName: 'KFintech',
            },
            {
              role: ParticipantRole.BRLM,
              name: 'Some Investment Bank',
              entityName: null,
            },
          ],
        };

        // Older than 30 days -> must be skipped by 30-day cutoff even with consistent metadata
        const stale30DayIpo: any = {
          ...freshListedConsistentIpo,
          id: 'ipo-kfin-consistent-stale31d',
          createdAt: createISTDateTime('2026-10-01', 10, 0),
          lifecycleEvents: [
            {
              eventType: LifecycleEventType.LISTING,
              eventDate: createISTDateTime('2026-10-05', 10, 0),
            },
          ],
        };

        prismaMock.ipo.findMany.mockResolvedValue([
          freshListedConsistentIpo,
          stale30DayIpo,
        ]);

        await isolatedService.processTimelineTransitions(now);

        expect(resolverMock.resolveAdapter).toHaveBeenCalledWith(
          'ipo-kfin-consistent-listed',
          undefined,
          expect.objectContaining({
            requireLiveActiveList: true,
            skipIdentityPersistence: true,
            skipForceRefresh: true,
          }),
        );
        expect(resolverMock.resolveAdapter).toHaveBeenCalledTimes(1);

        expect(persistSpy).toHaveBeenCalledWith(
          'ipo-kfin-consistent-listed',
          'KFINTECH',
          '88356314970',
        );
        expect(prismaMock.ipoAllotmentConfig.updateMany).toHaveBeenCalledWith({
          where: { ipoId: 'ipo-kfin-consistent-listed' },
          data: { registrarIpoCode: '88356314970' },
        });
        expect(prismaMock.ipo.updateMany).toHaveBeenCalledWith({
          where: {
            id: 'ipo-kfin-consistent-listed',
            allotmentResultAvailableAt: null,
          },
          data: {
            allotmentResultAvailableAt: now,
          },
        });
        expect(prismaMock.ipo.updateMany.mock.calls[0][0].data).not.toHaveProperty(
          'status',
        );
        expect(
          notificationOrchestratorMock.processAllotmentOutEvent,
        ).not.toHaveBeenCalled();

        // Verify 5-attempt backoff + retry-state persistence remains intact for failing IPOs
        prismaMock.ipo.updateMany.mockClear();
        resolverMock.resolveAdapter.mockResolvedValueOnce({
          adapter: {
            code: 'KFINTECH',
            resolveRegistrarIpoCode: jest.fn().mockResolvedValue(null),
          },
          registrarIpoCode: undefined,
        });
        const retryIpo: any = {
          ...freshListedConsistentIpo,
          id: 'ipo-kfin-retry-consistent',
        };
        prismaMock.ipo.findMany.mockResolvedValue([retryIpo]);
        await isolatedService.processTimelineTransitions(now);
        const persistedRetryState = JSON.parse(
          fs.readFileSync(retryStatePath, 'utf-8'),
        );
        expect(
          persistedRetryState.entries?.['ipo-kfin-retry-consistent'],
        ).toBeDefined();
        expect(
          persistedRetryState.entries['ipo-kfin-retry-consistent'].attempts,
        ).toBe(1);
        expect(BACKFILL_MAX_ATTEMPTS).toBe(5);
      } finally {
        isolatedService.onModuleDestroy();
        fetchSpy.mockRestore();
        if (prevRetryEnv === undefined) {
          delete process.env.ALLOTMENT_BACKFILL_STATE_PATH;
        } else {
          process.env.ALLOTMENT_BACKFILL_STATE_PATH = prevRetryEnv;
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('suppresses eager RegistrarResolver Step 4 persistence during strict scheduler probes and produces zero DB writes when rejected', async () => {
      const kfinAdapter = {
        code: 'KFINTECH',
        resolveRegistrarIpoCode: jest.fn(),
      };
      const registry = new RegistrarAdapterRegistry();
      registry.register(kfinAdapter as any);

      const dbEvents: string[] = [];
      const resolverPrisma: any = {
        ipoAllotmentConfig: {
          findUnique: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockImplementation(async () => {
            dbEvents.push('ipoAllotmentConfig.upsert');
            return {};
          }),
          updateMany: jest.fn().mockImplementation(async () => {
            dbEvents.push('ipoAllotmentConfig.updateMany');
            return { count: 1 };
          }),
        },
        ipoSourceIdentity: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn().mockImplementation(async () => {
            dbEvents.push('ipoSourceIdentity.upsert');
            return {};
          }),
        },
        ipoParticipant: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        ipo: {
          findUnique: jest.fn().mockResolvedValue({
            id: '11111111-1111-4111-8111-111111111111',
            companyId: 'comp-real-1',
            symbol: 'REALRES',
            company: {
              displayName: 'Real Resolver Ltd',
              legalName: 'Real Resolver Limited',
            },
          }),
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        source: {
          findUnique: jest.fn().mockImplementation(async () => {
            dbEvents.push('source.findUnique');
            return { id: 'src-kfin-1', code: 'KFINTECH' };
          }),
        },
        userSavedPan: { findMany: jest.fn().mockResolvedValue([]) },
        ipoInvestment: { findMany: jest.fn().mockResolvedValue([]) },
        allotmentCheckJob: { findFirst: jest.fn().mockResolvedValue(null) },
      };

      const realResolver = new RegistrarResolver(resolverPrisma, registry);
      const persistMethodSpy = jest
        .spyOn(realResolver, 'persistDiscoveredRegistrarIdentity')
        .mockImplementation(async (...args) => {
          dbEvents.push(`resolver.persistDiscoveredRegistrarIdentity:${args[1]}:${args[2]}`);
          return RegistrarResolver.prototype.persistDiscoveredRegistrarIdentity.apply(
            realResolver,
            args,
          );
        });

      const integratedService = new IpoTimelineSchedulerService(
        resolverPrisma,
        realResolver,
        notificationOrchestratorMock as any,
        ipoGuruServiceMock as any,
        allotmentJobServiceMock as any,
        registry,
      );

      try {
        const cleanUnpopulatedIpo: any = {
          id: '11111111-1111-4111-8111-111111111111',
          status: IpoStatus.LISTED,
          symbol: 'REALRES',
          allotmentResultAvailableAt: null,
          company: {
            displayName: 'Real Resolver Ltd',
            legalName: 'Real Resolver Limited',
          },
          lifecycleEvents: [],
          allotmentConfig: null,
          sourceIdentities: [],
          participants: [],
        };

        // 1. Conflicting metadata: zero DB writes anywhere (including inside RegistrarResolver)
        const conflictingIpo: any = {
          ...cleanUnpopulatedIpo,
          id: '22222222-2222-4222-8222-222222222222',
          sourceIdentities: [
            {
              source: {
                sourceType: SourceType.REGISTRAR,
                code: 'MUFG_INTIME',
                name: 'MUFG Intime India Pvt Ltd',
              },
            },
          ],
          participants: [
            {
              role: ParticipantRole.REGISTRAR,
              name: 'KFin Technologies Limited',
              entityName: null,
            },
          ],
        };
        kfinAdapter.resolveRegistrarIpoCode.mockResolvedValue('88356314970');

        expect(
          await integratedService.confirmActualAllotmentAvailability(
            conflictingIpo,
          ),
        ).toBe(false);
        expect(dbEvents).toEqual([]);
        expect(persistMethodSpy).not.toHaveBeenCalled();

        // 2. Unpopulated metadata where Step 4 resolves, then strict confirmation returns null ->
        //    ZERO Step 4 eager persistence or any other DB writes!
        kfinAdapter.resolveRegistrarIpoCode
          .mockResolvedValueOnce('88356314970')
          .mockResolvedValueOnce(null);

        expect(
          await integratedService.confirmActualAllotmentAvailability(
            cleanUnpopulatedIpo,
          ),
        ).toBe(false);
        expect(kfinAdapter.resolveRegistrarIpoCode).toHaveBeenCalledTimes(2);
        expect(dbEvents).toEqual([]);
        expect(persistMethodSpy).not.toHaveBeenCalled();

        // 3. Unpopulated metadata where live confirmation succeeds ->
        //    Step 4 still writes nothing eagerly; persistence runs strictly AFTER validation!
        kfinAdapter.resolveRegistrarIpoCode.mockReset();
        kfinAdapter.resolveRegistrarIpoCode.mockImplementation(async () => {
          dbEvents.push(
            `adapter.probe#${kfinAdapter.resolveRegistrarIpoCode.mock.calls.length}`,
          );
          return '88356314970';
        });

        expect(
          await integratedService.confirmActualAllotmentAvailability(
            cleanUnpopulatedIpo,
          ),
        ).toBe(true);
        expect(dbEvents).toEqual([
          'adapter.probe#1',
          'adapter.probe#2',
          'resolver.persistDiscoveredRegistrarIdentity:KFINTECH:88356314970',
          'source.findUnique',
          'ipoSourceIdentity.upsert',
          'ipoAllotmentConfig.upsert',
          'ipoAllotmentConfig.updateMany',
        ]);
      } finally {
        integratedService.onModuleDestroy();
      }
    });
  });
});
