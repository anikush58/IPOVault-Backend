import { AllotmentResultStatus, IpoChangeEvent, IpoLifecycleEvent } from '@prisma/client';
import { NotificationEventGenerator } from './notification-event.generator';
import { NotificationType } from './notification.types';

describe('NotificationEventGenerator', () => {
  let generator: NotificationEventGenerator;

  const mockIpo = {
    id: 'ipo-uuid-1',
    companyName: 'Acme Technologies Ltd',
    symbol: 'ACME',
    lotSize: 100,
    priceBandHigh: 500,
  };

  beforeEach(() => {
    generator = new NotificationEventGenerator();
  });

  describe('A. Notification Type Validation & DTO Schema', () => {
    it('defines strict allowlist of initial notification types', () => {
      expect(NotificationType.IPO_OPENED).toBe('IPO_OPENED');
      expect(NotificationType.IPO_CLOSED).toBe('IPO_CLOSED');
      expect(NotificationType.IPO_LISTING_SOON).toBe('IPO_LISTING_SOON');
      expect(NotificationType.IPO_DATA_CHANGED).toBe('IPO_DATA_CHANGED');
      expect(NotificationType.IPO_DATA_QUALITY_WARNING).toBe('IPO_DATA_QUALITY_WARNING');
      expect(NotificationType.ALLOTTED_RESULT_AVAILABLE).toBe('ALLOTTED_RESULT_AVAILABLE');
    });
  });

  describe('B. Lifecycle Event Generation', () => {
    it('generates IPO_OPENED notification for OPEN lifecycle event', () => {
      const event: IpoLifecycleEvent = {
        id: 'event-open-1',
        ipoId: mockIpo.id,
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = generator.generateLifecycleNotification('user-1', mockIpo, event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(NotificationType.IPO_OPENED);
      expect(result?.title).toBe('IPO Subscription Opened');
      expect(result?.deduplicationKey).toBe(`ipo_opened:${mockIpo.id}:${event.id}`);
      expect(result?.message).toContain('Acme Technologies Ltd (ACME)');
    });

    it('generates IPO_CLOSED notification for CLOSE lifecycle event', () => {
      const event: IpoLifecycleEvent = {
        id: 'event-close-1',
        ipoId: mockIpo.id,
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-12'),
        sourceId: null,
        sourceReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = generator.generateLifecycleNotification('user-1', mockIpo, event);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(NotificationType.IPO_CLOSED);
      expect(result?.title).toBe('IPO Subscription Closed');
      expect(result?.deduplicationKey).toBe(`ipo_closed:${mockIpo.id}:${event.id}`);
    });
  });

  describe('C. Listing-Soon Condition', () => {
    it('generates IPO_LISTING_SOON notification when listing date is within 3 days', () => {
      const evalDate = new Date('2026-09-10');
      const listingDate = new Date('2026-09-12'); // 2 days away <= LISTING_SOON_WINDOW_DAYS (3)

      const event: IpoLifecycleEvent = {
        id: 'event-listing-1',
        ipoId: mockIpo.id,
        eventType: 'LISTING',
        eventDate: listingDate,
        sourceId: null,
        sourceReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = generator.generateLifecycleNotification('user-1', mockIpo, event, evalDate);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(NotificationType.IPO_LISTING_SOON);
      expect(result?.title).toBe('IPO Listing Soon');
      expect(result?.deduplicationKey).toBe(`ipo_listing_soon:${mockIpo.id}:2026-09-12`);
    });

    it('returns null when listing date is beyond the 3-day window', () => {
      const evalDate = new Date('2026-09-10');
      const farListingDate = new Date('2026-09-20'); // 10 days away

      const event: IpoLifecycleEvent = {
        id: 'event-listing-2',
        ipoId: mockIpo.id,
        eventType: 'LISTING',
        eventDate: farListingDate,
        sourceId: null,
        sourceReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = generator.generateLifecycleNotification('user-1', mockIpo, event, evalDate);
      expect(result).toBeNull();
    });

    it('correctly evaluates listing-soon helper window', () => {
      const now = new Date('2026-09-10');
      expect(generator.isWithinListingSoonWindow(new Date('2026-09-10'), now)).toBe(true);
      expect(generator.isWithinListingSoonWindow(new Date('2026-09-13'), now)).toBe(true);
      expect(generator.isWithinListingSoonWindow(new Date('2026-09-14'), now)).toBe(false);
      expect(generator.isWithinListingSoonWindow(new Date('2026-09-09'), now)).toBe(false);
    });
  });

  describe('D. Change-Event Notification', () => {
    it('generates IPO_DATA_CHANGED notification referencing IpoChangeEvent without secrets', () => {
      const changeEvent: IpoChangeEvent = {
        id: 'change-1',
        ipoId: mockIpo.id,
        fieldName: 'priceBandHigh',
        oldValue: '450.00',
        newValue: '500.00',
        sourceId: null,
        sourceReference: null,
        detectedAt: new Date(),
        changeType: 'PRICE_BAND_CHANGED',
        createdAt: new Date(),
      };

      const result = generator.generateDataChangeNotification('user-1', mockIpo, changeEvent);

      expect(result.type).toBe(NotificationType.IPO_DATA_CHANGED);
      expect(result.title).toBe('IPO Data Updated');
      expect(result.message).toContain('priceBandHigh changed from "450.00" to "500.00"');
      expect(result.deduplicationKey).toBe(`ipo_data_changed:${mockIpo.id}:${changeEvent.id}`);
      expect(result.metadata).toEqual({
        companyName: mockIpo.companyName,
        symbol: mockIpo.symbol,
        changeEventId: changeEvent.id,
        changeType: 'PRICE_BAND_CHANGED',
        fieldName: 'priceBandHigh',
        oldValue: '450.00',
        newValue: '500.00',
      });
    });
  });

  describe('E. Quality-Warning Notification', () => {
    it('generates IPO_DATA_QUALITY_WARNING for actionable quality conditions', () => {
      const result = generator.generateQualityWarningNotification(
        'user-1',
        mockIpo,
        'INCOMPLETE',
        'Missing price band high and lot size',
      );

      expect(result.type).toBe(NotificationType.IPO_DATA_QUALITY_WARNING);
      expect(result.title).toBe('IPO Data Quality Warning');
      expect(result.deduplicationKey).toBe(`ipo_quality_warning:${mockIpo.id}:INCOMPLETE`);
      expect(result.message).toContain('Missing price band high and lot size');
    });
  });

  describe('F, G, H. Allotment Notification & Exclusion Logic', () => {
    it('generates ALLOTTED_RESULT_AVAILABLE for definitive ALLOTTED status', () => {
      const observation = {
        id: 'job-item-1',
        jobId: 'job-1',
        ipoId: mockIpo.id,
        status: AllotmentResultStatus.ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 100,
        maskedId: 'ABCDE****F',
      };

      const result = generator.generateAllotmentResultNotification('user-1', mockIpo, observation);

      expect(result).not.toBeNull();
      expect(result?.type).toBe(NotificationType.ALLOTTED_RESULT_AVAILABLE);
      expect(result?.title).toContain('Allotted');
      expect(result?.deduplicationKey).toBe(`allotment_result:${mockIpo.id}:${observation.id}`);
      expect(result?.metadata).toEqual({
        companyName: mockIpo.companyName,
        symbol: mockIpo.symbol,
        status: AllotmentResultStatus.ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 100,
        maskedId: 'ABCDE****F',
      });
      // Sensitive fields verified absent
      expect(result?.metadata).not.toHaveProperty('pan');
      expect(result?.metadata).not.toHaveProperty('panHash');
      expect(result?.metadata).not.toHaveProperty('panEncrypted');
      expect(result?.metadata).not.toHaveProperty('identifierHash');
    });

    it('generates ALLOTTED_RESULT_AVAILABLE for definitive PARTIALLY_ALLOTTED status', () => {
      const observation = {
        id: 'job-item-2',
        jobId: 'job-1',
        ipoId: mockIpo.id,
        status: AllotmentResultStatus.PARTIALLY_ALLOTTED,
        sharesApplied: 200,
        sharesAllotted: 100,
        maskedId: 'ABCDE****F',
      };

      const result = generator.generateAllotmentResultNotification('user-1', mockIpo, observation);
      expect(result).not.toBeNull();
      expect(result?.title).toContain('Partially Allotted');
    });

    it('strictly suppresses notifications for NOT_ALLOTTED status (Requirement 9)', () => {
      const observation = {
        id: 'job-item-3',
        jobId: 'job-1',
        ipoId: mockIpo.id,
        status: AllotmentResultStatus.NOT_ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 0,
        maskedId: 'ABCDE****F',
      };

      const result = generator.generateAllotmentResultNotification('user-1', mockIpo, observation);
      expect(result).toBeNull();
    });

    it('G. Excludes UNKNOWN status', () => {
      const observation = {
        id: 'job-item-4',
        jobId: 'job-1',
        ipoId: mockIpo.id,
        status: AllotmentResultStatus.UNKNOWN,
        maskedId: 'ABCDE****F',
      };

      const result = generator.generateAllotmentResultNotification('user-1', mockIpo, observation);
      expect(result).toBeNull();
    });

    it('H. Excludes FAILED / non-definitive transient statuses', () => {
      const transientStatuses: AllotmentResultStatus[] = [
        AllotmentResultStatus.NOT_YET_AVAILABLE,
        AllotmentResultStatus.RATE_LIMITED,
        AllotmentResultStatus.TEMPORARY_ERROR,
        AllotmentResultStatus.SOURCE_UNAVAILABLE,
        AllotmentResultStatus.REGISTRAR_UNRESOLVED,
      ];

      for (const status of transientStatuses) {
        const obs = {
          id: `job-item-${status}`,
          jobId: 'job-1',
          ipoId: mockIpo.id,
          status,
          maskedId: 'ABCDE****F',
        };
        const res = generator.generateAllotmentResultNotification('user-1', mockIpo, obs);
        expect(res).toBeNull();
      }
    });
  });
});
