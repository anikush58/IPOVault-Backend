import { Injectable } from '@nestjs/common';
import { Prisma, SourceType } from '@prisma/client';

import { DiscoveredIpo } from './discovery.types';

type Tx = Prisma.TransactionClient;

export type SourceValueObservation = {
  sourceId: string;
  sourceCode: string;
  sourceType: SourceType;
  sourceReference: string | null;
  value: string;
  retrievedAt: Date;
};

export type FieldConflict = {
  fieldName: string;
  canonicalValue: string | null;
  hasConflict: boolean;
  observations: SourceValueObservation[];
};

export type IpoReconciliationReport = {
  ipoId: string;
  hasAnyConflict: boolean;
  conflicts: FieldConflict[];
};

export type FieldComparisonOutcome =
  | 'MATCH'
  | 'CONFLICT'
  | 'SEBI_ONLY'
  | 'EXCHANGE_ONLY'
  | 'UNRESOLVED';

export type FieldComparison = {
  fieldName: string;
  sebiValue: string | null;
  exchangeValue: string | null;
  outcome: FieldComparisonOutcome;
};

export type ObservationReconciliationResult = {
  hasConflict: boolean;
  comparisons: FieldComparison[];
};

@Injectable()
export class ReconciliationService {
  /**
   * Pure deterministic comparison of two normalized observations (e.g. SEBI vs EXCHANGE).
   */
  reconcileObservations(
    sebi: DiscoveredIpo,
    exchange: DiscoveredIpo,
  ): ObservationReconciliationResult {
    const fieldsToCompare: Array<{
      fieldName: string;
      sebiVal: string | null;
      exchangeVal: string | null;
    }> = [
      {
        fieldName: 'issue_size',
        sebiVal: sebi.ipo.issueSize,
        exchangeVal: exchange.ipo.issueSize,
      },
      {
        fieldName: 'fresh_issue_size',
        sebiVal: sebi.ipo.freshIssueSize,
        exchangeVal: exchange.ipo.freshIssueSize,
      },
      {
        fieldName: 'ofs_size',
        sebiVal: sebi.ipo.ofsSize,
        exchangeVal: exchange.ipo.ofsSize,
      },
      {
        fieldName: 'issue_share_count',
        sebiVal: sebi.ipo.issueShareCount,
        exchangeVal: exchange.ipo.issueShareCount,
      },
      {
        fieldName: 'fresh_issue_share_count',
        sebiVal: sebi.ipo.freshIssueShareCount,
        exchangeVal: exchange.ipo.freshIssueShareCount,
      },
      {
        fieldName: 'ofs_share_count',
        sebiVal: sebi.ipo.ofsShareCount,
        exchangeVal: exchange.ipo.ofsShareCount,
      },
      {
        fieldName: 'price_band_low',
        sebiVal: sebi.ipo.priceBandLow,
        exchangeVal: exchange.ipo.priceBandLow,
      },
      {
        fieldName: 'price_band_high',
        sebiVal: sebi.ipo.priceBandHigh,
        exchangeVal: exchange.ipo.priceBandHigh,
      },
      {
        fieldName: 'lot_size',
        sebiVal: sebi.ipo.lotSize === null ? null : String(sebi.ipo.lotSize),
        exchangeVal:
          exchange.ipo.lotSize === null ? null : String(exchange.ipo.lotSize),
      },
      {
        fieldName: 'lifecycle.open_date',
        sebiVal: sebi.lifecycle.openDate,
        exchangeVal: exchange.lifecycle.openDate,
      },
      {
        fieldName: 'lifecycle.close_date',
        sebiVal: sebi.lifecycle.closeDate,
        exchangeVal: exchange.lifecycle.closeDate,
      },
      {
        fieldName: 'lifecycle.listing_date',
        sebiVal: sebi.lifecycle.listingDate,
        exchangeVal: exchange.lifecycle.listingDate,
      },
    ];

    const comparisons: FieldComparison[] = fieldsToCompare.map(
      ({ fieldName, sebiVal, exchangeVal }) => {
        let outcome: FieldComparisonOutcome;

        if (sebiVal !== null && exchangeVal !== null) {
          outcome = sebiVal === exchangeVal ? 'MATCH' : 'CONFLICT';
        } else if (sebiVal !== null && exchangeVal === null) {
          outcome = 'SEBI_ONLY';
        } else if (sebiVal === null && exchangeVal !== null) {
          outcome = 'EXCHANGE_ONLY';
        } else {
          outcome = 'UNRESOLVED';
        }

        return {
          fieldName,
          sebiValue: sebiVal,
          exchangeValue: exchangeVal,
          outcome,
        };
      },
    );

    const hasConflict = comparisons.some((c) => c.outcome === 'CONFLICT');

    return {
      hasConflict,
      comparisons,
    };
  }

  /**
   * Database-backed reconciliation analysis querying field provenance for a given canonical IPO.
   */
  async detectConflicts(
    tx: Tx,
    ipoId: string,
  ): Promise<IpoReconciliationReport> {
    const ipo = await tx.ipo.findUnique({ where: { id: ipoId } });
    if (!ipo) {
      return {
        ipoId,
        hasAnyConflict: false,
        conflicts: [],
      };
    }

    const provenances = await tx.fieldProvenance.findMany({
      where: { entityType: 'IPO', entityId: ipoId },
      include: { source: true },
      orderBy: { retrievedAt: 'asc' },
    });

    const groupedByField = new Map<string, SourceValueObservation[]>();
    for (const prov of provenances) {
      const list = groupedByField.get(prov.fieldName) ?? [];
      list.push({
        sourceId: prov.sourceId,
        sourceCode: prov.source.code,
        sourceType: prov.source.sourceType,
        sourceReference: prov.sourceReference,
        value: prov.value,
        retrievedAt: prov.retrievedAt,
      });
      groupedByField.set(prov.fieldName, list);
    }

    const canonicalMap: Record<string, string | null> = {
      market_segment: ipo.marketSegment,
      exchange: ipo.exchange,
      status: ipo.status,
      symbol: ipo.symbol,
      issue_size: ipo.issueSize ? ipo.issueSize.toFixed(2) : null,
      fresh_issue_size: ipo.freshIssueSize
        ? ipo.freshIssueSize.toFixed(2)
        : null,
      ofs_size: ipo.ofsSize ? ipo.ofsSize.toFixed(2) : null,
      issue_share_count: ipo.issueShareCount
        ? ipo.issueShareCount.toString()
        : null,
      fresh_issue_share_count: ipo.freshIssueShareCount
        ? ipo.freshIssueShareCount.toString()
        : null,
      ofs_share_count: ipo.ofsShareCount ? ipo.ofsShareCount.toString() : null,
      price_band_low: ipo.priceBandLow ? ipo.priceBandLow.toFixed(2) : null,
      price_band_high: ipo.priceBandHigh ? ipo.priceBandHigh.toFixed(2) : null,
      lot_size: ipo.lotSize ? String(ipo.lotSize) : null,
    };

    const conflicts: FieldConflict[] = [];
    for (const [fieldName, obsList] of groupedByField.entries()) {
      const distinctValues = new Set(obsList.map((o) => o.value));
      const hasConflict = distinctValues.size > 1;

      conflicts.push({
        fieldName,
        canonicalValue: canonicalMap[fieldName] ?? null,
        hasConflict,
        observations: obsList,
      });
    }

    const hasAnyConflict = conflicts.some((c) => c.hasConflict);

    return {
      ipoId,
      hasAnyConflict,
      conflicts,
    };
  }
}
