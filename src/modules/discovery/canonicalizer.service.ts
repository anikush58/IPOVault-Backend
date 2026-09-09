import { Injectable } from '@nestjs/common';
import {
  IpoChangeType,
  LifecycleEventType,
  Prisma,
  ProvenanceEntityType,
  SourceType,
} from '@prisma/client';

import {
  DiscoveredIpo,
  DiscoveredLifecycle,
  MatchDecision,
} from './discovery.types';
import {
  applyIssueStructureFacts,
  emptyIssueStructure,
  factsFromDiscoveredIpo,
  issueStructureFactMatchesField,
  type IssueStructureField,
  type IssueStructureValues,
} from './issue-structure';

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
      const ipo = await this.createIpo(tx, companyId, discovered, sourceId);
      ipoId = ipo.id;
      created = true;
    } else if (match.decision === 'MATCH_COMPANY') {
      companyId = match.companyId;
      await this.updateCompany(tx, companyId, discovered);
      const ipo = await this.createIpo(tx, companyId, discovered, sourceId);
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

  private async resolveSourceType(
    tx: Tx,
    sourceId: string,
  ): Promise<SourceType> {
    const source = await tx.source.findUnique({ where: { id: sourceId } });
    return source?.sourceType ?? 'EXCHANGE';
  }

  private async issueStructureAuthority(
    tx: Tx,
    ipoId: string,
  ): Promise<Partial<Record<IssueStructureField, SourceType>>> {
    const fields = [
      'issue_size',
      'fresh_issue_size',
      'ofs_size',
      'issue_share_count',
      'fresh_issue_share_count',
      'ofs_share_count',
    ] as const satisfies readonly IssueStructureField[];
    const authority: Partial<Record<IssueStructureField, SourceType>> = {};

    for (const fieldName of fields) {
      const row = await tx.fieldProvenance.findFirst({
        where: {
          entityType: 'IPO',
          entityId: ipoId,
          fieldName,
        },
        orderBy: { retrievedAt: 'desc' },
      });

      if (!row) {
        continue;
      }

      const source = await tx.source.findUnique({
        where: { id: row.sourceId },
      });
      if (source?.sourceType) {
        authority[fieldName] = source.sourceType;
      }
    }

    return authority;
  }

  private async createIpo(
    tx: Tx,
    companyId: string,
    discovered: DiscoveredIpo,
    sourceId: string,
  ) {
    const incomingSourceType = await this.resolveSourceType(tx, sourceId);
    const applied = applyIssueStructureFacts({
      current: emptyIssueStructure(),
      facts: factsFromDiscoveredIpo(discovered.ipo),
      incomingSourceType,
      currentAuthority: {},
    });

    return tx.ipo.create({
      data: {
        companyId,
        marketSegment: discovered.ipo.marketSegment,
        exchange: discovered.ipo.exchange,
        status: discovered.ipo.status ?? 'DRAFT',
        symbol: discovered.ipo.symbol,
        issueSize: applied.next.issueSize,
        freshIssueSize: applied.next.freshIssueSize,
        ofsSize: applied.next.ofsSize,
        issueShareCount: applied.next.issueShareCount,
        freshIssueShareCount: applied.next.freshIssueShareCount,
        ofsShareCount: applied.next.ofsShareCount,
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

    const incomingSourceType = await this.resolveSourceType(tx, sourceId);
    const currentAuthority = await this.issueStructureAuthority(tx, ipoId);
    const applied = applyIssueStructureFacts({
      current: issueStructureFromIpo(ipo),
      facts: factsFromDiscoveredIpo(discovered.ipo),
      incomingSourceType,
      currentAuthority,
    });

    const isIncomingPreliminaryDrhp = discovered.source.filingType === 'DRHP';

    const next = {
      marketSegment: discovered.ipo.marketSegment,
      exchange: discovered.ipo.exchange,
      status: discovered.ipo.status ?? ipo.status,
      symbol: discovered.ipo.symbol ?? ipo.symbol,
      issueSize: applied.next.issueSize,
      freshIssueSize: applied.next.freshIssueSize,
      ofsSize: applied.next.ofsSize,
      issueShareCount: applied.next.issueShareCount,
      freshIssueShareCount: applied.next.freshIssueShareCount,
      ofsShareCount: applied.next.ofsShareCount,
      faceValue: coalesceDecimal(ipo.faceValue, discovered.ipo.faceValue),
      priceBandLow:
        isIncomingPreliminaryDrhp && ipo.priceBandLow !== null
          ? ipo.priceBandLow
          : coalesceDecimal(ipo.priceBandLow, discovered.ipo.priceBandLow),
      priceBandHigh:
        isIncomingPreliminaryDrhp && ipo.priceBandHigh !== null
          ? ipo.priceBandHigh
          : coalesceDecimal(ipo.priceBandHigh, discovered.ipo.priceBandHigh),
      lotSize:
        isIncomingPreliminaryDrhp && ipo.lotSize !== null
          ? ipo.lotSize
          : (discovered.ipo.lotSize ?? ipo.lotSize),
      minimumLots: discovered.ipo.minimumLots ?? ipo.minimumLots,
    };

    const before = {
      status: ipo.status,
      issueSize: ipo.issueSize,
      freshIssueSize: ipo.freshIssueSize,
      ofsSize: ipo.ofsSize,
      issueShareCount: ipo.issueShareCount,
      freshIssueShareCount: ipo.freshIssueShareCount,
      ofsShareCount: ipo.ofsShareCount,
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
      freshIssueSize: Prisma.Decimal | null;
      ofsSize: Prisma.Decimal | null;
      issueShareCount: Prisma.Decimal | null;
      freshIssueShareCount: Prisma.Decimal | null;
      ofsShareCount: Prisma.Decimal | null;
      lotSize: number | null;
      priceBandLow: Prisma.Decimal | null;
      priceBandHigh: Prisma.Decimal | null;
    },
    after: {
      status: string;
      issueSize: Prisma.Decimal | null;
      freshIssueSize: Prisma.Decimal | null;
      ofsSize: Prisma.Decimal | null;
      issueShareCount: Prisma.Decimal | null;
      freshIssueShareCount: Prisma.Decimal | null;
      ofsShareCount: Prisma.Decimal | null;
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
        oldValue: decimalText(before.issueSize, 2),
        newValue: decimalText(after.issueSize, 2),
        changeType: 'ISSUE_SIZE_CHANGED',
      });
    }

    if (decimalChanged(before.freshIssueSize, after.freshIssueSize)) {
      changes.push({
        fieldName: 'fresh_issue_size',
        oldValue: decimalText(before.freshIssueSize, 2),
        newValue: decimalText(after.freshIssueSize, 2),
        changeType: 'ISSUE_SIZE_CHANGED',
      });
    }

    if (decimalChanged(before.ofsSize, after.ofsSize)) {
      changes.push({
        fieldName: 'ofs_size',
        oldValue: decimalText(before.ofsSize, 2),
        newValue: decimalText(after.ofsSize, 2),
        changeType: 'ISSUE_SIZE_CHANGED',
      });
    }

    if (decimalChanged(before.issueShareCount, after.issueShareCount)) {
      changes.push({
        fieldName: 'issue_share_count',
        oldValue: decimalText(before.issueShareCount, 0),
        newValue: decimalText(after.issueShareCount, 0),
        changeType: 'FIELD_CHANGED',
      });
    }

    if (
      decimalChanged(before.freshIssueShareCount, after.freshIssueShareCount)
    ) {
      changes.push({
        fieldName: 'fresh_issue_share_count',
        oldValue: decimalText(before.freshIssueShareCount, 0),
        newValue: decimalText(after.freshIssueShareCount, 0),
        changeType: 'FIELD_CHANGED',
      });
    }

    if (decimalChanged(before.ofsShareCount, after.ofsShareCount)) {
      changes.push({
        fieldName: 'ofs_share_count',
        oldValue: decimalText(before.ofsShareCount, 0),
        newValue: decimalText(after.ofsShareCount, 0),
        changeType: 'FIELD_CHANGED',
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
        oldValue: decimalText(before.priceBandLow, 2),
        newValue: decimalText(after.priceBandLow, 2),
        changeType: 'PRICE_BAND_CHANGED',
      });
    }

    if (decimalChanged(before.priceBandHigh, after.priceBandHigh)) {
      changes.push({
        fieldName: 'price_band_high',
        oldValue: decimalText(before.priceBandHigh, 2),
        newValue: decimalText(after.priceBandHigh, 2),
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
      ...factsFromDiscoveredIpo(discovered.ipo)
        .filter(issueStructureFactMatchesField)
        .map((fact): [string, string | null] => [fact.field, fact.value]),
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

function issueStructureFromIpo(ipo: {
  issueSize: Prisma.Decimal | null;
  freshIssueSize: Prisma.Decimal | null;
  ofsSize: Prisma.Decimal | null;
  issueShareCount: Prisma.Decimal | null;
  freshIssueShareCount: Prisma.Decimal | null;
  ofsShareCount: Prisma.Decimal | null;
}): IssueStructureValues {
  return {
    issueSize: ipo.issueSize ?? null,
    freshIssueSize: ipo.freshIssueSize ?? null,
    ofsSize: ipo.ofsSize ?? null,
    issueShareCount: ipo.issueShareCount ?? null,
    freshIssueShareCount: ipo.freshIssueShareCount ?? null,
    ofsShareCount: ipo.ofsShareCount ?? null,
  };
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

function decimalText(
  value: Prisma.Decimal | null,
  scale: number,
): string | null {
  return value === null ? null : new Prisma.Decimal(value).toFixed(scale);
}
