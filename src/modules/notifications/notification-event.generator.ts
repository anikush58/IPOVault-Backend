import { Injectable } from '@nestjs/common';
import {
  AllotmentResultStatus,
  IpoChangeEvent,
  IpoLifecycleEvent,
} from '@prisma/client';
import {
  buildAllotmentResultDeduplicationKey,
  buildIpoAllotmentOutDeduplicationKey,
  buildIpoClosedDeduplicationKey,
  buildIpoDataChangedDeduplicationKey,
  buildIpoDataQualityWarningDeduplicationKey,
  buildIpoListingSoonDeduplicationKey,
  buildIpoOpenedDeduplicationKey,
  CreateNotificationInput,
  LISTING_SOON_WINDOW_DAYS,
  NotificationType,
} from './notification.types';

export interface IpoNotificationContext {
  id: string;
  companyName: string;
  symbol?: string | null;
  status?: string | null;
  lotSize?: number | null;
  priceBandHigh?: number | null;
}

export interface AllotmentObservationContext {
  id: string; // AllotmentCheckJobItem ID
  jobId: string;
  ipoId: string;
  status: AllotmentResultStatus;
  sharesApplied?: number | null;
  sharesAllotted?: number | null;
  maskedId: string;
}

@Injectable()
export class NotificationEventGenerator {
  /**
   * Generates a lifecycle notification input for a specific IPO and lifecycle event.
   */
  generateLifecycleNotification(
    userId: string,
    ipo: IpoNotificationContext,
    event: IpoLifecycleEvent,
    evaluationDate: Date = new Date(),
  ): CreateNotificationInput | null {
    const symbolText = ipo.symbol ? ` (${ipo.symbol})` : '';

    if (event.eventType === 'OPEN') {
      return {
        userId,
        type: NotificationType.IPO_OPENED,
        title: 'IPO Subscription Opened',
        message: `Subscription for ${ipo.companyName}${symbolText} is now open.`,
        relatedEntityType: 'IPO',
        relatedEntityId: ipo.id,
        metadata: {
          companyName: ipo.companyName,
          symbol: ipo.symbol,
          eventDate: event.eventDate.toISOString(),
        },
        deduplicationKey: buildIpoOpenedDeduplicationKey(ipo.id, event.id),
      };
    }

    if (event.eventType === 'CLOSE') {
      return {
        userId,
        type: NotificationType.IPO_CLOSED,
        title: 'IPO Subscription Closed',
        message: `Subscription for ${ipo.companyName}${symbolText} has closed.`,
        relatedEntityType: 'IPO',
        relatedEntityId: ipo.id,
        metadata: {
          companyName: ipo.companyName,
          symbol: ipo.symbol,
          eventDate: event.eventDate.toISOString(),
        },
        deduplicationKey: buildIpoClosedDeduplicationKey(ipo.id, event.id),
      };
    }

    if (event.eventType === 'LISTING') {
      const isListingSoon = this.isWithinListingSoonWindow(
        event.eventDate,
        evaluationDate,
      );

      if (isListingSoon) {
        const eventDateIso = event.eventDate.toISOString().split('T')[0];
        return {
          userId,
          type: NotificationType.IPO_LISTING_SOON,
          title: 'IPO Listing Soon',
          message: `${ipo.companyName}${symbolText} is scheduled to list soon on ${eventDateIso}.`,
          relatedEntityType: 'IPO',
          relatedEntityId: ipo.id,
          metadata: {
            companyName: ipo.companyName,
            symbol: ipo.symbol,
            eventDate: event.eventDate.toISOString(),
            windowDays: LISTING_SOON_WINDOW_DAYS,
          },
          deduplicationKey: buildIpoListingSoonDeduplicationKey(
            ipo.id,
            eventDateIso,
          ),
        };
      }
    }

    return null;
  }

  /**
   * Deterministic evaluation if eventDate is within LISTING_SOON_WINDOW_DAYS (3 days).
   */
  public isWithinListingSoonWindow(
    eventDate: Date,
    evaluationDate: Date,
  ): boolean {
    const evalStart = new Date(evaluationDate);
    evalStart.setHours(0, 0, 0, 0);

    const listingDate = new Date(eventDate);
    listingDate.setHours(0, 0, 0, 0);

    const diffTime = listingDate.getTime() - evalStart.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays >= 0 && diffDays <= LISTING_SOON_WINDOW_DAYS;
  }

  /**
   * Generates notification input for an IPO change event.
   */
  generateDataChangeNotification(
    userId: string,
    ipo: IpoNotificationContext,
    changeEvent: IpoChangeEvent,
  ): CreateNotificationInput {
    const symbolText = ipo.symbol ? ` (${ipo.symbol})` : '';
    const fieldName = changeEvent.fieldName;
    const oldVal = changeEvent.oldValue ?? 'N/A';
    const newVal = changeEvent.newValue ?? 'N/A';

    return {
      userId,
      type: NotificationType.IPO_DATA_CHANGED,
      title: 'IPO Data Updated',
      message: `Data updated for ${ipo.companyName}${symbolText}: ${fieldName} changed from "${oldVal}" to "${newVal}".`,
      relatedEntityType: 'IPO',
      relatedEntityId: ipo.id,
      metadata: {
        companyName: ipo.companyName,
        symbol: ipo.symbol,
        changeEventId: changeEvent.id,
        changeType: changeEvent.changeType,
        fieldName: changeEvent.fieldName,
        oldValue: changeEvent.oldValue,
        newValue: changeEvent.newValue,
      },
      deduplicationKey: buildIpoDataChangedDeduplicationKey(
        ipo.id,
        changeEvent.id,
      ),
    };
  }

  /**
   * Generates notification input for actionable IPO data quality warnings.
   */
  generateQualityWarningNotification(
    userId: string,
    ipo: IpoNotificationContext,
    qualityCondition: 'NEEDS_REVIEW' | 'INCOMPLETE',
    reason: string,
  ): CreateNotificationInput {
    const symbolText = ipo.symbol ? ` (${ipo.symbol})` : '';

    return {
      userId,
      type: NotificationType.IPO_DATA_QUALITY_WARNING,
      title: 'IPO Data Quality Warning',
      message: `Data quality warning for ${ipo.companyName}${symbolText}: ${reason}.`,
      relatedEntityType: 'IPO',
      relatedEntityId: ipo.id,
      metadata: {
        companyName: ipo.companyName,
        symbol: ipo.symbol,
        qualityCondition,
        reason,
      },
      deduplicationKey: buildIpoDataQualityWarningDeduplicationKey(
        ipo.id,
        qualityCondition,
      ),
    };
  }

  /**
   * Generates notification input for definitive allotment observations.
   * Excludes UNKNOWN, FAILED, and transient statuses.
   * Strips all raw PAN, encrypted PAN, and hash information.
   */
  generateAllotmentResultNotification(
    userId: string,
    ipo: IpoNotificationContext,
    observation: AllotmentObservationContext,
  ): CreateNotificationInput | null {
    const status = observation.status;

    // Strict exclusion of non-allotted & transient statuses:
    // Per Requirement 9: Only send notifications when the user received allotment.
    // Do NOT send notifications for NOT_ALLOTTED or non-definitive states.
    const definitiveStatuses: AllotmentResultStatus[] = [
      AllotmentResultStatus.ALLOTTED,
      AllotmentResultStatus.PARTIALLY_ALLOTTED,
    ];

    if (!definitiveStatuses.includes(status)) {
      return null;
    }

    const symbolText = ipo.symbol ? ` (${ipo.symbol})` : '';
    let title = 'Allotment Status: Allotted';
    let message = `Allotment received for ${ipo.companyName}${symbolText}.`;

    if (status === AllotmentResultStatus.ALLOTTED) {
      title = 'Allotment Status: Allotted';
      message = `Congratulations! Allotment received for ${ipo.companyName}${symbolText} (${observation.sharesAllotted ?? 'N/A'} shares).`;
    } else if (status === AllotmentResultStatus.PARTIALLY_ALLOTTED) {
      title = 'Allotment Status: Partially Allotted';
      message = `Partial allotment received for ${ipo.companyName}${symbolText} (${observation.sharesAllotted ?? 'N/A'} shares).`;
    }

    return {
      userId,
      type: NotificationType.ALLOTTED_RESULT_AVAILABLE,
      title,
      message,
      relatedEntityType: 'IPO',
      relatedEntityId: ipo.id,
      metadata: {
        companyName: ipo.companyName,
        symbol: ipo.symbol,
        status: observation.status,
        sharesApplied: observation.sharesApplied ?? null,
        sharesAllotted: observation.sharesAllotted ?? null,
        maskedId: observation.maskedId, // Safe masked identifier only (e.g. ABCDE****F)
      },
      deduplicationKey: buildAllotmentResultDeduplicationKey(
        ipo.id,
        observation.id,
      ),
    };
  }

  /**
   * Generates system notification when an IPO's allotment result availability is first detected.
   * Format:
   * Title: "IPO Allotment Out"
   * Body: "The allotment status for {companyName} is now available. Check your allotment status."
   */
  generateAllotmentOutNotification(
    userId: string,
    ipo: IpoNotificationContext,
  ): CreateNotificationInput {
    return {
      userId,
      type: NotificationType.ALLOTTED_RESULT_AVAILABLE,
      title: 'IPO Allotment Out',
      message: `${ipo.companyName} allotment is now available. Check your allotment status.`,
      relatedEntityType: 'IPO',
      relatedEntityId: ipo.id,
      metadata: {
        ipoId: ipo.id,
        companyName: ipo.companyName,
        symbol: ipo.symbol ?? null,
      },
      deduplicationKey: buildIpoAllotmentOutDeduplicationKey(ipo.id),
    };
  }
}
