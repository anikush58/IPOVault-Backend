import { PrismaClient, Prisma } from '@prisma/client';

export interface IpoRefundBackfillDetail {
  ipoId: string;
  companyName: string;
  slug: string;
  guruRefundDate: string | null;
  existingDbRefundDate: string | null;
  existingProvenanceSource?: string;
  classification:
    | 'ELIGIBLE_TO_CREATE'
    | 'PRESERVE_EXISTING'
    | 'PROTECTED_MANUAL'
    | 'NO_IPOGURU_DATE'
    | 'CONFLICT_REVIEW';
  action: 'CREATE' | 'PRESERVE' | 'SKIP';
  reason: string;
}

export interface IpoRefundBackfillSummary {
  evaluated: number;
  created: number;
  preserved: number;
  protectedManual: number;
  noIpoguruDate: number;
  conflicts: number;
  errors: Array<{ ipoId: string; companyName?: string; error: string }>;
  details: IpoRefundBackfillDetail[];
}

export interface BackfillRefundOptions {
  dryRun?: boolean;
  batchSize?: number;
  apiKey?: string;
  rawGuruMap?: Map<string, any>;
  fetcher?: (slug: string) => Promise<any>;
}

/**
 * Parses date string (YYYY-MM-DD or DD-MM-YYYY) into UTC Date at midnight.
 */
function parseRefundDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'N/A' || trimmed === '-') return null;

  // DD-MM-YYYY or DD/MM/YYYY
  const ddmmyyyy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
  const m1 = trimmed.match(ddmmyyyy);
  if (m1) {
    const d = parseInt(m1[1], 10);
    const m = parseInt(m1[2], 10) - 1;
    const y = parseInt(m1[3], 10);
    const date = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    return isNaN(date.getTime()) ? null : date;
  }

  // YYYY-MM-DD
  const yyyymmdd = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
  const m2 = trimmed.match(yyyymmdd);
  if (m2) {
    const y = parseInt(m2[1], 10);
    const m = parseInt(m2[2], 10) - 1;
    const d = parseInt(m2[3], 10);
    const date = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    return isNaN(date.getTime()) ? null : date;
  }

  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Plans and optionally applies canonical Refund Initiation Date backfill for a single IPO.
 */
export async function backfillSingleIpoRefundInitiation(
  prisma: PrismaClient | Prisma.TransactionClient,
  ipoId: string,
  options: BackfillRefundOptions = {},
): Promise<IpoRefundBackfillDetail> {
  const dryRun = options.dryRun ?? false;

  const ipo = await prisma.ipo.findUnique({
    where: { id: ipoId },
    include: {
      company: true,
      sourceIdentities: { include: { source: true } },
      lifecycleEvents: { include: { source: true } },
    },
  });

  if (!ipo) {
    throw new Error(`IPO with ID '${ipoId}' not found`);
  }

  const guruIdentity = ipo.sourceIdentities.find(
    (s) => s.source.code.toUpperCase() === 'IPOGURU',
  );
  if (!guruIdentity) {
    throw new Error(`IPO '${ipo.company.displayName}' (${ipoId}) does not have an IPOGURU source identity`);
  }

  const slug = guruIdentity.externalId || '';
  const companyName = ipo.company.displayName || ipo.company.legalName;

  // Retrieve field provenance for refund_date
  const provs = await prisma.fieldProvenance.findMany({
    where: {
      entityType: 'IPO',
      entityId: ipo.id,
      fieldName: { in: ['refund_date', 'refunddate', 'lifecycle.refund_date', 'lifecycle.refund_initiation'], mode: 'insensitive' },
    },
    include: { source: true },
  });
  const refundProv = provs[0];

  // Retrieve existing REFUND_INITIATION lifecycle event
  const refundEvent = ipo.lifecycleEvents.find((e) => e.eventType === 'REFUND_INITIATION');
  const dbRefundDate = refundEvent ? refundEvent.eventDate.toISOString().slice(0, 10) : null;

  // Determine IPOGuru data
  let guruData: any = null;
  if (options.rawGuruMap && slug) {
    guruData = options.rawGuruMap.get(slug.toLowerCase().trim());
  }
  if (!guruData && options.fetcher && slug) {
    guruData = await options.fetcher(slug);
  }
  if (!guruData && !options.rawGuruMap && !options.fetcher && slug && options.apiKey) {
    try {
      const res = await fetch(`https://www.ipoguru.in/api/v2/ipos/${encodeURIComponent(slug)}`, {
        headers: {
          'X-API-KEY': options.apiKey,
          Accept: 'application/json',
          'User-Agent': 'IPOVault-Backfill/1.0',
        },
      });
      if (res.ok) {
        const json = await res.json();
        guruData = json.data || json.ipo || json;
      }
    } catch {
      // Ignored: network failure will result in null guruData
    }
  }

  let guruRefundDate: string | null = null;
  if (guruData) {
    const rawVal = guruData.refund_date || guruData.timeline?.refund_date;
    if (rawVal && typeof rawVal === 'string' && rawVal.trim() && rawVal.trim() !== 'null') {
      guruRefundDate = rawVal.trim();
    }
  }

  // Determine provenance source priority
  const provSource = refundProv?.source?.code
    ? refundProv.source.code.toUpperCase()
    : refundEvent?.source?.code
    ? refundEvent.source.code.toUpperCase()
    : dbRefundDate
    ? 'SYSTEM'
    : undefined;

  const isManual = provSource === 'ADMIN' || provSource === 'MANUAL';

  // Classification & Decision
  let classification: IpoRefundBackfillDetail['classification'];
  let action: IpoRefundBackfillDetail['action'];
  let reason: string;

  if (isManual) {
    classification = 'PROTECTED_MANUAL';
    action = 'PRESERVE';
    reason = `Protected by ADMIN/manual provenance (${provSource}: ${dbRefundDate}). Must never be overwritten.`;
  } else if (refundEvent) {
    if (guruRefundDate && guruRefundDate !== dbRefundDate) {
      classification = 'CONFLICT_REVIEW';
      action = 'PRESERVE';
      reason = `Conflict: existing canonical date (${dbRefundDate}) differs from IPOGuru feed (${guruRefundDate}). Existing value preserved.`;
    } else {
      classification = 'PRESERVE_EXISTING';
      action = 'PRESERVE';
      reason = `Existing canonical REFUND_INITIATION event (${dbRefundDate}) preserved.`;
    }
  } else if (!guruRefundDate) {
    classification = 'NO_IPOGURU_DATE';
    action = 'SKIP';
    reason = 'IPOGuru feed has no refund_date for this IPO.';
  } else {
    classification = 'ELIGIBLE_TO_CREATE';
    action = 'CREATE';
    reason = `Missing canonical event; creating REFUND_INITIATION with IPOGuru date ${guruRefundDate}.`;
  }

  // Apply writes if not dry-run and action is CREATE
  if (!dryRun && action === 'CREATE' && guruRefundDate) {
    const parsedDate = parseRefundDate(guruRefundDate);
    if (parsedDate) {
      const guruSource = await prisma.source.upsert({
        where: { code: 'IPOGURU' },
        update: {},
        create: {
          code: 'IPOGURU',
          name: 'IPO Guru v2',
          sourceType: 'SECONDARY',
          priority: 50,
        },
      });

      // 1. Upsert lifecycle event (idempotent)
      await prisma.ipoLifecycleEvent.upsert({
        where: {
          ipoId_eventType: {
            ipoId: ipo.id,
            eventType: 'REFUND_INITIATION',
          },
        },
        update: {}, // do not overwrite if concurrent process created it
        create: {
          ipoId: ipo.id,
          eventType: 'REFUND_INITIATION',
          eventDate: parsedDate,
          sourceId: guruSource.id,
        },
      });

      // 2. Add field provenance if missing
      const existingP = await prisma.fieldProvenance.findFirst({
        where: {
          entityType: 'IPO',
          entityId: ipo.id,
          fieldName: 'refund_date',
        },
      });

      if (!existingP) {
        const sourceRef = slug ? `https://www.ipoguru.in/api/v2/ipos/${slug}` : 'https://www.ipoguru.in/api/v2';
        await prisma.fieldProvenance.create({
          data: {
            entityType: 'IPO',
            entityId: ipo.id,
            fieldName: 'refund_date',
            value: guruRefundDate,
            sourceId: guruSource.id,
            sourceReference: sourceRef,
            retrievedAt: ipo.createdAt || new Date(),
            confidence: new Prisma.Decimal(1.0),
          },
        });
      }
    }
  }

  return {
    ipoId: ipo.id,
    companyName,
    slug,
    guruRefundDate,
    existingDbRefundDate: dbRefundDate,
    existingProvenanceSource: provSource,
    classification,
    action,
    reason,
  };
}

/**
 * Plans and optionally executes canonical Refund Initiation Date backfill for all IPOGuru IPOs.
 */
export async function backfillAllRefundInitiations(
  prisma: PrismaClient | Prisma.TransactionClient,
  options: BackfillRefundOptions = {},
): Promise<IpoRefundBackfillSummary> {
  const eligibleIpos = await prisma.ipo.findMany({
    where: {
      sourceIdentities: {
        some: {
          source: {
            code: {
              equals: 'IPOGURU',
              mode: 'insensitive',
            },
          },
        },
      },
    },
    select: {
      id: true,
      company: { select: { displayName: true, legalName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const details: IpoRefundBackfillDetail[] = [];
  const errors: Array<{ ipoId: string; companyName?: string; error: string }> = [];

  let created = 0;
  let preserved = 0;
  let protectedManual = 0;
  let noIpoguruDate = 0;
  let conflicts = 0;

  for (const item of eligibleIpos) {
    try {
      const detail = await backfillSingleIpoRefundInitiation(prisma, item.id, options);
      details.push(detail);

      if (detail.classification === 'ELIGIBLE_TO_CREATE') {
        created++;
      } else if (detail.classification === 'PRESERVE_EXISTING') {
        preserved++;
      } else if (detail.classification === 'PROTECTED_MANUAL') {
        protectedManual++;
      } else if (detail.classification === 'NO_IPOGURU_DATE') {
        noIpoguruDate++;
      } else if (detail.classification === 'CONFLICT_REVIEW') {
        conflicts++;
      }
    } catch (err: any) {
      errors.push({
        ipoId: item.id,
        companyName: item.company?.displayName || item.company?.legalName || 'Unknown',
        error: err.message || String(err),
      });
    }
  }

  return {
    evaluated: eligibleIpos.length,
    created,
    preserved,
    protectedManual,
    noIpoguruDate,
    conflicts,
    errors,
    details,
  };
}
