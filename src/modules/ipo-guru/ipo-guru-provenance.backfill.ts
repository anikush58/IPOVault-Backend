import { PrismaClient, Prisma, IpoStatus } from '@prisma/client';

export interface FieldBackfillPlan {
  fieldKey: string;
  entityType?: 'IPO' | 'COMPANY';
  entityId?: string;
  canonicalValue: any;
  existingProvenance: string;
  proposedProvenance: string;
  action: 'PRESERVE' | 'ADD' | 'SKIP';
  reason: string;
}

export interface IpoBackfillSummary {
  ipoId: string;
  companyName: string;
  preserved: number;
  added: number;
  skipped: number;
  details: FieldBackfillPlan[];
}

/**
 * Plans and optionally executes field-level additive provenance backfill for a single IPO.
 *
 * Rules:
 * 1. NEVER overwrite or delete an existing provenance record.
 * 2. If a field already has provenance (ADMIN, OFFICIAL, etc.), PRESERVE it untouched.
 * 3. If a field has NO provenance and demonstrably originated from IPOGuru, ADD IPOGURU provenance.
 * 4. Fields not populated by IPOGuru (CIN, publicationStatus, financials, ratios, etc.) are SKIPPED.
 */
export async function backfillSingleIpoProvenance(
  prisma: PrismaClient | Prisma.TransactionClient,
  ipoId: string,
  options: { dryRun?: boolean } = {},
): Promise<IpoBackfillSummary> {
  const dryRun = options.dryRun ?? false;

  const ipo = await prisma.ipo.findUnique({
    where: { id: ipoId },
    include: {
      company: true,
      sourceIdentities: { include: { source: true } },
      lifecycleEvents: { include: { source: true } },
      allotmentConfig: true,
    },
  });

  if (!ipo) {
    throw new Error(`IPO with ID '${ipoId}' not found`);
  }

  const isGuruIpo = ipo.sourceIdentities.some((s) => s.source.code.toUpperCase() === 'IPOGURU');
  if (!isGuruIpo) {
    throw new Error(`IPO '${ipo.company.displayName}' (${ipoId}) does not have an IPOGURU source identity`);
  }

  const guruSource = await prisma.source.findUnique({ where: { code: 'IPOGURU' } });
  if (!guruSource) {
    throw new Error(`Source 'IPOGURU' not found in database`);
  }

  const existingProvs = await prisma.fieldProvenance.findMany({
    where: {
      OR: [
        { entityType: 'IPO', entityId: ipo.id },
        { entityType: 'COMPANY', entityId: ipo.companyId },
      ],
    },
    include: { source: true },
  });

  const existingByField = new Map<string, typeof existingProvs[0]>();
  for (const p of existingProvs) {
    existingByField.set(p.fieldName.toLowerCase(), p);
  }

  const guruIdentity = ipo.sourceIdentities.find((s) => s.source.code.toUpperCase() === 'IPOGURU');
  const sourceRef = guruIdentity && guruIdentity.externalId
    ? `https://www.ipoguru.in/api/v2/ipos/${guruIdentity.externalId}`
    : 'https://www.ipoguru.in/api/v2';

  const openEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'OPEN');
  const closeEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'CLOSE');
  const allotEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'BASIS_OF_ALLOTMENT');
  const listEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'LISTING');

  const candidateFields: Array<{
    fieldKey: string;
    entityType: 'IPO' | 'COMPANY';
    entityId: string;
    canonicalValue: any;
    supportedByGuru: boolean;
  }> = [
    {
      fieldKey: 'company.legal_name',
      entityType: 'COMPANY',
      entityId: ipo.companyId,
      canonicalValue: ipo.company.legalName,
      supportedByGuru: Boolean(ipo.company.legalName),
    },
    {
      fieldKey: 'company.display_name',
      entityType: 'COMPANY',
      entityId: ipo.companyId,
      canonicalValue: ipo.company.displayName,
      supportedByGuru: Boolean(ipo.company.displayName),
    },
    {
      fieldKey: 'company.cin',
      entityType: 'COMPANY',
      entityId: ipo.companyId,
      canonicalValue: ipo.company.cin,
      supportedByGuru: false, // IPOGuru feed does not provide CIN
    },
    {
      fieldKey: 'market_segment',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.marketSegment,
      supportedByGuru: Boolean(ipo.marketSegment),
    },
    {
      fieldKey: 'exchange',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.exchange,
      supportedByGuru: Boolean(ipo.exchange),
    },
    {
      fieldKey: 'status',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.status,
      // Only attach IPOGuru status if canonical status is one of the base feed statuses, not dynamic lifecycle overrides
      supportedByGuru: ([IpoStatus.UPCOMING, IpoStatus.OPEN, IpoStatus.CLOSED, IpoStatus.LISTED] as IpoStatus[]).includes(ipo.status),
    },
    {
      fieldKey: 'publication_status',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.publicationStatus,
      supportedByGuru: false, // Admin workflow state
    },
    {
      fieldKey: 'symbol',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.symbol,
      supportedByGuru: Boolean(ipo.symbol),
    },
    {
      fieldKey: 'isin',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.isin,
      supportedByGuru: Boolean(ipo.isin),
    },
    {
      fieldKey: 'price_band_low',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.priceBandLow != null ? String(ipo.priceBandLow) : null,
      supportedByGuru: ipo.priceBandLow != null,
    },
    {
      fieldKey: 'price_band_high',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.priceBandHigh != null ? String(ipo.priceBandHigh) : null,
      supportedByGuru: ipo.priceBandHigh != null,
    },
    {
      fieldKey: 'lot_size',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.lotSize != null ? String(ipo.lotSize) : null,
      supportedByGuru: ipo.lotSize != null,
    },
    {
      fieldKey: 'face_value',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.faceValue != null ? String(ipo.faceValue) : null,
      supportedByGuru: ipo.faceValue != null,
    },
    {
      fieldKey: 'issue_size',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.issueSize != null ? String(ipo.issueSize) : null,
      supportedByGuru: ipo.issueSize != null,
    },
    {
      fieldKey: 'fresh_issue_size',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.freshIssueSize != null ? String(ipo.freshIssueSize) : null,
      supportedByGuru: ipo.freshIssueSize != null,
    },
    {
      fieldKey: 'ofs_size',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.ofsSize != null ? String(ipo.ofsSize) : null,
      supportedByGuru: ipo.ofsSize != null,
    },
    {
      fieldKey: 'listing_price',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.listingPrice != null ? String(ipo.listingPrice) : null,
      supportedByGuru: ipo.listingPrice != null && ipo.status === IpoStatus.LISTED,
    },
    {
      fieldKey: 'open_date',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: openEvent ? openEvent.eventDate.toISOString().slice(0, 10) : null,
      supportedByGuru: Boolean(openEvent),
    },
    {
      fieldKey: 'close_date',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: closeEvent ? closeEvent.eventDate.toISOString().slice(0, 10) : null,
      supportedByGuru: Boolean(closeEvent),
    },
    {
      fieldKey: 'allotment_date',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: allotEvent ? allotEvent.eventDate.toISOString().slice(0, 10) : null,
      supportedByGuru: Boolean(allotEvent),
    },
    {
      fieldKey: 'listing_date',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: listEvent ? listEvent.eventDate.toISOString().slice(0, 10) : null,
      supportedByGuru: Boolean(listEvent),
    },
    {
      fieldKey: 'registrar_name',
      entityType: 'IPO',
      entityId: ipo.id,
      canonicalValue: ipo.allotmentConfig?.registrar || null,
      supportedByGuru: Boolean(ipo.allotmentConfig?.registrar),
    },
  ];

  const details: FieldBackfillPlan[] = [];
  const toInsert: Array<{
    entityType: 'IPO' | 'COMPANY';
    entityId: string;
    fieldName: string;
    value: string;
    sourceId: string;
    sourceReference: string;
    retrievedAt: Date;
    confidence: Prisma.Decimal;
  }> = [];

  for (const c of candidateFields) {
    const existing = existingByField.get(c.fieldKey.toLowerCase());
    if (existing) {
      details.push({
        fieldKey: c.fieldKey,
        entityType: c.entityType,
        entityId: c.entityId,
        canonicalValue: c.canonicalValue,
        existingProvenance: `${existing.source.code} (${existing.sourceReference || 'N/A'}) = "${existing.value}"`,
        proposedProvenance: 'N/A (Preserved)',
        action: 'PRESERVE',
        reason: `Existing ${existing.source.code} provenance row preserved`,
      });
      continue;
    }

    if (!c.supportedByGuru || c.canonicalValue == null || String(c.canonicalValue).trim() === '') {
      details.push({
        fieldKey: c.fieldKey,
        entityType: c.entityType,
        entityId: c.entityId,
        canonicalValue: c.canonicalValue,
        existingProvenance: 'None',
        proposedProvenance: 'None',
        action: 'SKIP',
        reason: !c.supportedByGuru ? 'Field not provided/supported by IPOGuru' : 'Canonical value is null/empty',
      });
      continue;
    }

    details.push({
      fieldKey: c.fieldKey,
      entityType: c.entityType,
      entityId: c.entityId,
      canonicalValue: c.canonicalValue,
      existingProvenance: 'None',
      proposedProvenance: `IPOGURU (${sourceRef}) = "${c.canonicalValue}"`,
      action: 'ADD',
      reason: 'IPOGuru-originated field without existing provenance',
    });

    toInsert.push({
      entityType: c.entityType,
      entityId: c.entityId,
      fieldName: c.fieldKey,
      value: String(c.canonicalValue),
      sourceId: guruSource.id,
      sourceReference: sourceRef,
      retrievedAt: ipo.createdAt || new Date(),
      confidence: new Prisma.Decimal(1.0),
    });
  }

  if (!dryRun && toInsert.length > 0) {
    for (const r of toInsert) {
      await prisma.fieldProvenance.create({
        data: r,
      });
    }
  }

  return {
    ipoId: ipo.id,
    companyName: ipo.company.displayName,
    preserved: details.filter((d) => d.action === 'PRESERVE').length,
    added: details.filter((d) => d.action === 'ADD').length,
    skipped: details.filter((d) => d.action === 'SKIP').length,
    details,
  };
}
