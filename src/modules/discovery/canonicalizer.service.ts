import { Injectable } from '@nestjs/common';
import {
  IpoChangeType,
  LifecycleEventType,
  Prisma,
  ProvenanceEntityType,
} from '@prisma/client';

import {
  DiscoveredIpo,
  DiscoveredLifecycle,
  MatchDecision,
} from './discovery.types';

type Tx = Prisma.TransactionClient;

type ApplyInput = {
  discovered: DiscoveredIpo;
  match: Exclude<MatchDecision, { decision: 'REJECT' }>;
  sourceId: string;
  sourceReference: string | null;
  retrievedAt: Date;
};

export type CanonicalizeResult = {
  created: boolean;
  ipoId: string;
  companyId: string;
};

const LIFECYCLE_TYPES: Array<{
  type: LifecycleEventType;
  field: keyof DiscoveredLifecycle;
  changeType: IpoChangeType;
  fieldName: string;
}> = [
  {
    type: 'OPEN',
    field: 'openDate',
    changeType: 'OPEN_DATE_CHANGED',
    fieldName: 'lifecycle.open_date',
  },
  {
    type: 'CLOSE',
    field: 'closeDate',
    changeType: 'CLOSE_DATE_CHANGED',
    fieldName: 'lifecycle.close_date',
  },
  {
    type: 'LISTING',
    field: 'listingDate',
    changeType: 'LISTING_DATE_CHANGED',
    fieldName: 'lifecycle.listing_date',
  },
  {
    type: 'DRHP',
    field: 'drhpDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.drhp_date',
  },
  {
    type: 'RHP',
    field: 'rhpDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.rhp_date',
  },
  {
    type: 'ANCHOR',
    field: 'anchorDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.anchor_date',
  },
  {
    type: 'BASIS_OF_ALLOTMENT',
    field: 'basisOfAllotmentDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.basis_of_allotment_date',
  },
  {
    type: 'REFUND_INITIATION',
    field: 'refundInitiationDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.refund_initiation_date',
  },
  {
    type: 'DEMAT_CREDIT',
    field: 'dematCreditDate',
    changeType: 'FIELD_CHANGED',
    fieldName: 'lifecycle.demat_credit_date',
  },
];

@Injectable()
export class CanonicalizerService {
  async apply(tx: Tx, input: ApplyInput): Promise<CanonicalizeResult> {
    const { discovered, match, sourceId, sourceReference, retrievedAt } = input;
    let created = false;
    let companyId: string;
    let ipoId: string;

    if (match.decision === 'CREATE') {
      const company = await tx.company.create({
        data: {
          legalName: discovered.company.legalName,
          displayName:
            discovered.company.displayName ?? discovered.company.legalName,
          cin: discovered.company.cin,
        },
      });
      companyId = company.id;
      const ipo = await this.createIpo(tx, companyId, discovered);
      ipoId = ipo.id;
      created = true;
    } else if (match.decision === 'MATCH_COMPANY') {
      companyId = match.companyId;
      await this.updateCompany(tx, companyId, discovered);
      const ipo = await this.createIpo(tx, companyId, discovered);
      ipoId = ipo.id;
      created = true;
    } else {
      companyId = match.companyId;
      ipoId = match.ipoId;
      await this.updateCompany(tx, companyId, discovered);
      await this.updateIpo(
        tx,
        ipoId,
        discovered,
        sourceId,
        sourceReference,
        retrievedAt,
      );
    }

    await this.upsertIdentity(tx, ipoId, sourceId, discovered);
    await this.upsertLifecycle(
      tx,
      ipoId,
      discovered,
      sourceId,
      sourceReference,
      retrievedAt,
      created,
    );
    await this.recordProvenance(
      tx,
      companyId,
      ipoId,
      discovered,
      sourceId,
      sourceReference,
      retrievedAt,
    );

    return { created, ipoId, companyId };
  }

  private async createIpo(
    tx: Tx,
    companyId: string,
    discovered: DiscoveredIpo,
  ) {
    return tx.ipo.create({
      data: {
        companyId,
        marketSegment: discovered.ipo.marketSegment,
        exchange: discovered.ipo.exchange,
        status: discovered.ipo.status ?? 'DRAFT',
        symbol: discovered.ipo.symbol,
        issueSize: toDecimal(discovered.ipo.issueSize),
        freshIssueSize: toDecimal(discovered.ipo.freshIssueSize),
        ofsSize: toDecimal(discovered.ipo.ofsSize),
        faceValue: toDecimal(discovered.ipo.faceValue),
        priceBandLow: toDecimal(discovered.ipo.priceBandLow),
        priceBandHigh: toDecimal(discovered.ipo.priceBandHigh),
        lotSize: discovered.ipo.lotSize,
        minimumLots: discovered.ipo.minimumLots,
      },
    });
  }

  private async updateCompany(
    tx: Tx,
    companyId: string,
    discovered: DiscoveredIpo,
  ) {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return;
    }

    await tx.company.update({
      where: { id: companyId },
      data: {
        legalName: discovered.company.legalName || company.legalName,
        displayName:
          discovered.company.displayName ??
          discovered.company.legalName ??
          company.displayName,
        cin: discovered.company.cin ?? company.cin,
      },
    });
  }

  private async updateIpo(
    tx: Tx,
    ipoId: string,
    discovered: DiscoveredIpo,
    sourceId: string,
    sourceReference: string | null,
    retrievedAt: Date,
  ) {
    const ipo = await tx.ipo.findUnique({ where: { id: ipoId } });
    if (!ipo) {
      return;
    }

    const next = {
      marketSegment: discovered.ipo.marketSegment,
      exchange: discovered.ipo.exchange,
      status: discovered.ipo.status ?? ipo.status,
      symbol: discovered.ipo.symbol ?? ipo.symbol,
      issueSize: coalesceDecimal(ipo.issueSize, discovered.ipo.issueSize),
      freshIssueSize: coalesceDecimal(
        ipo.freshIssueSize,
        discovered.ipo.freshIssueSize,
      ),
      ofsSize: coalesceDecimal(ipo.ofsSize, discovered.ipo.ofsSize),
      faceValue: coalesceDecimal(ipo.faceValue, discovered.ipo.faceValue),
      priceBandLow: coalesceDecimal(
        ipo.priceBandLow,
        discovered.ipo.priceBandLow,
      ),
      priceBandHigh: coalesceDecimal(
        ipo.priceBandHigh,
        discovered.ipo.priceBandHigh,
      ),
      lotSize: discovered.ipo.lotSize ?? ipo.lotSize,
      minimumLots: discovered.ipo.minimumLots ?? ipo.minimumLots,
    };

    const before = {
      status: ipo.status,
      issueSize: ipo.issueSize,
      lotSize: ipo.lotSize,
      priceBandLow: ipo.priceBandLow,
      priceBandHigh: ipo.priceBandHigh,
    };

    await tx.ipo.update({
      where: { id: ipoId },
      data: next,
    });

    await this.recordIpoChanges(
      tx,
      ipoId,
      before,
      next,
      sourceId,
      sourceReference,
      retrievedAt,
    );
  }

  private async recordIpoChanges(
    tx: Tx,
    ipoId: string,
    before: {
      status: string;
      issueSize: Prisma.Decimal | null;
      lotSize: number | null;
      priceBandLow: Prisma.Decimal | null;
      priceBandHigh: Prisma.Decimal | null;
    },
    after: {
      status: string;
      issueSize: Prisma.Decimal | null;
      lotSize: number | null;
      priceBandLow: Prisma.Decimal | null;
      priceBandHigh: Prisma.Decimal | null;
    },
    sourceId: string,
    sourceReference: string | null,
    retrievedAt: Date,
  ) {
    const changes: Array<{
      fieldName: string;
      oldValue: string | null;
      newValue: string | null;
      changeType: IpoChangeType;
    }> = [];

    if (before.status !== after.status) {
      changes.push({
        fieldName: 'status',
        oldValue: before.status,
        newValue: after.status,
        changeType: 'STATUS_CHANGED',
      });
    }

    if (decimalChanged(before.issueSize, after.issueSize)) {
      changes.push({
        fieldName: 'issue_size',
        oldValue: decimalText(before.issueSize),
        newValue: decimalText(after.issueSize),
        changeType: 'ISSUE_SIZE_CHANGED',
      });
    }

    if (before.lotSize !== after.lotSize) {
      changes.push({
        fieldName: 'lot_size',
        oldValue: before.lotSize === null ? null : String(before.lotSize),
        newValue: after.lotSize === null ? null : String(after.lotSize),
        changeType: 'LOT_SIZE_CHANGED',
      });
    }

    if (decimalChanged(before.priceBandLow, after.priceBandLow)) {
      changes.push({
        fieldName: 'price_band_low',
        oldValue: decimalText(before.priceBandLow),
        newValue: decimalText(after.priceBandLow),
        changeType: 'PRICE_BAND_CHANGED',
      });
    }

    if (decimalChanged(before.priceBandHigh, after.priceBandHigh)) {
      changes.push({
        fieldName: 'price_band_high',
        oldValue: decimalText(before.priceBandHigh),
        newValue: decimalText(after.priceBandHigh),
        changeType: 'PRICE_BAND_CHANGED',
      });
    }

    for (const change of changes) {
      await tx.ipoChangeEvent.create({
        data: {
          ipoId,
          fieldName: change.fieldName,
          oldValue: change.oldValue,
          newValue: change.newValue,
          sourceId,
          sourceReference,
          detectedAt: retrievedAt,
          changeType: change.changeType,
        },
      });
    }
  }

  private async upsertIdentity(
    tx: Tx,
    ipoId: string,
    sourceId: string,
    discovered: DiscoveredIpo,
  ) {
    const existing = await tx.ipoSourceIdentity.findFirst({
      where: { ipoId, sourceId },
    });

    if (existing) {
      await tx.ipoSourceIdentity.update({
        where: { id: existing.id },
        data: {
          externalId: discovered.source.externalId ?? existing.externalId,
          symbol: discovered.ipo.symbol ?? existing.symbol,
        },
      });
      return;
    }

    await tx.ipoSourceIdentity.create({
      data: {
        ipoId,
        sourceId,
        externalId: discovered.source.externalId,
        symbol: discovered.ipo.symbol,
      },
    });
  }

  private async upsertLifecycle(
    tx: Tx,
    ipoId: string,
    discovered: DiscoveredIpo,
    sourceId: string,
    sourceReference: string | null,
    retrievedAt: Date,
    created: boolean,
  ) {
    for (const item of LIFECYCLE_TYPES) {
      const nextDate = discovered.lifecycle[item.field];
      if (!nextDate) {
        continue;
      }

      const existing = await tx.ipoLifecycleEvent.findFirst({
        where: { ipoId, eventType: item.type },
      });

      if (!existing) {
        await tx.ipoLifecycleEvent.create({
          data: {
            ipoId,
            eventType: item.type,
            eventDate: new Date(`${nextDate}T00:00:00.000Z`),
            sourceId,
            sourceReference,
          },
        });
        continue;
      }

      const previous = existing.eventDate.toISOString().slice(0, 10);
      if (previous === nextDate) {
        continue;
      }

      await tx.ipoLifecycleEvent.update({
        where: { id: existing.id },
        data: {
          eventDate: new Date(`${nextDate}T00:00:00.000Z`),
          sourceId,
          sourceReference,
        },
      });

      if (!created) {
        await tx.ipoChangeEvent.create({
          data: {
            ipoId,
            fieldName: item.fieldName,
            oldValue: previous,
            newValue: nextDate,
            sourceId,
            sourceReference,
            detectedAt: retrievedAt,
            changeType: item.changeType,
          },
        });
      }
    }
  }

  private async recordProvenance(
    tx: Tx,
    companyId: string,
    ipoId: string,
    discovered: DiscoveredIpo,
    sourceId: string,
    sourceReference: string | null,
    retrievedAt: Date,
  ) {
    const rows: Array<{
      entityType: ProvenanceEntityType;
      entityId: string;
      fieldName: string;
      value: string;
    }> = [
      {
        entityType: 'COMPANY',
        entityId: companyId,
        fieldName: 'legal_name',
        value: discovered.company.legalName,
      },
    ];

    if (discovered.company.cin) {
      rows.push({
        entityType: 'COMPANY',
        entityId: companyId,
        fieldName: 'cin',
        value: discovered.company.cin,
      });
    }

    const ipoFields: Array<[string, string | null]> = [
      ['market_segment', discovered.ipo.marketSegment],
      ['exchange', discovered.ipo.exchange],
      ['status', discovered.ipo.status],
      ['symbol', discovered.ipo.symbol],
      ['issue_size', discovered.ipo.issueSize],
      ['price_band_low', discovered.ipo.priceBandLow],
      ['price_band_high', discovered.ipo.priceBandHigh],
      [
        'lot_size',
        discovered.ipo.lotSize === null ? null : String(discovered.ipo.lotSize),
      ],
    ];

    for (const [fieldName, value] of ipoFields) {
      if (value) {
        rows.push({
          entityType: 'IPO',
          entityId: ipoId,
          fieldName,
          value,
        });
      }
    }

    for (const [fieldName, value] of [
      ['lifecycle.open_date', discovered.lifecycle.openDate],
      ['lifecycle.close_date', discovered.lifecycle.closeDate],
      ['lifecycle.listing_date', discovered.lifecycle.listingDate],
    ] as const) {
      if (value) {
        rows.push({
          entityType: 'IPO',
          entityId: ipoId,
          fieldName,
          value,
        });
      }
    }

    for (const row of rows) {
      await tx.fieldProvenance.create({
        data: {
          ...row,
          sourceId,
          sourceReference,
          retrievedAt,
        },
      });
    }
  }
}

function toDecimal(value: string | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

function coalesceDecimal(
  current: Prisma.Decimal | null,
  incoming: string | null,
): Prisma.Decimal | null {
  if (incoming === null) {
    return current;
  }

  return new Prisma.Decimal(incoming);
}

function decimalChanged(
  current: Prisma.Decimal | null,
  next: Prisma.Decimal | null,
): boolean {
  if (current === null && next === null) {
    return false;
  }

  if (current === null || next === null) {
    return true;
  }

  return !new Prisma.Decimal(current).eq(new Prisma.Decimal(next));
}

function decimalText(value: Prisma.Decimal | null): string | null {
  return value === null ? null : new Prisma.Decimal(value).toFixed(2);
}
