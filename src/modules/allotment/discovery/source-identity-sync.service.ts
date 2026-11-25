import { Injectable, Logger } from '@nestjs/common';
import {
  IpoStatus,
  LifecycleEventType,
  ParticipantRole,
  PublicationStatus,
  SourceType,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { normalizeRegistrarCode } from '../adapters/registrar-adapter.registry';
import { sanitizeRegistrarIpoCode } from '../allotment.types';
import {
  buildPartialRegistrarReconcilePlan,
  normalizeKnownRegistrarCode,
  persistRegistrarCode,
} from '../registrar.resolver';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
  RegistrarSourceIdentitySyncSummary,
  SourceIdentitySyncRecordResult,
  SourceIdentitySyncStatus,
} from './registrar-identity-discovery.types';

export interface PartialRegistrarReconcileSummary {
  dryRun: boolean;
  scannedCount: number;
  reconciledCount: number;
  skippedConflictCount: number;
  skippedDisabledCount: number;
  skippedAlreadyConfiguredCount: number;
  items: Array<{
    ipoId: string;
    companyName: string;
    action: string;
    registrar?: string;
    registrarIpoCode?: string | null;
    reason?: string;
  }>;
}

export interface RegistrarCoverageAuditReport {
  generatedAt: string;
  summary: {
    totalPublished: number;
    hasAllotmentConfigRegistrar: number;
    hasParticipantRegistrar: number;
    hasSourceIdentityRegistrar: number;
    hasAnyRegistrar: number;
    missingAllRegistrars: number;
    partialRecordsMissingConfig: number;
  };
  byStatus: Array<{
    status: IpoStatus;
    marketSegment: string;
    total: number;
    hasAnyRegistrar: number;
    missingAllRegistrars: number;
    activeWindowMissingCount: number;
  }>;
  activeMissingRegistrars: Array<{
    ipoId: string;
    companyName: string;
    status: IpoStatus;
    marketSegment: string;
    listingDate: string | null;
    closeDate: string | null;
    partialSources: string[];
  }>;
  duplicatePublishedGroups: Array<{
    normalizedCompanyName: string;
    marketSegment: string;
    count: number;
    records: Array<{
      id: string;
      displayName: string;
      status: IpoStatus;
      symbol: string | null;
      createdAt: string;
      openDate: string | null;
      listingDate: string | null;
      hasRegistrar: boolean;
    }>;
  }>;
}

@Injectable()
export class SourceIdentitySyncService {
  private readonly logger = new Logger(SourceIdentitySyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalizes company names for deterministic comparison by removing common corporate suffixes,
   * punctuation, and noise tokens.
   */
  public normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(limited|ltd|sme|ipo|ncds?|ncd|invit|reit|trust)\b/gi, '')
      .replace(/\bmanagment\b/gi, 'management')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Runs source-identity discovery and synchronization for a registrar adapter.
   */
  async syncRegistrarIdentities(
    adapter: IRegistrarIdentityDiscoveryAdapter,
    filterIpoId?: string,
  ): Promise<RegistrarSourceIdentitySyncSummary> {
    this.logger.log(
      `Starting source identity sync for registrar '${adapter.registrarCode}'...`,
    );

    const startTime = new Date();
    const discoveredIssues = await adapter.discoverIssues();
    this.logger.log(
      `Discovered ${discoveredIssues.length} issues from registrar ${adapter.registrarCode}`,
    );

    let source = await this.prisma.source.findUnique({
      where: { code: adapter.registrarCode },
    });

    if (!source && typeof this.prisma.source?.upsert === 'function') {
      source = await this.prisma.source.upsert({
        where: { code: adapter.registrarCode },
        update: {},
        create: {
          code: adapter.registrarCode,
          name: adapter.name || adapter.registrarCode,
          sourceType: SourceType.REGISTRAR,
          priority: 80,
          enabled: true,
        },
      });
    }

    if (!source) {
      throw new Error(
        `Registrar source with code '${adapter.registrarCode}' not found in database`,
      );
    }

    // Fetch candidate canonical IPOs from DB
    const canonicalIpos = await this.prisma.ipo.findMany({
      where: filterIpoId ? { id: filterIpoId } : {},
      include: {
        company: true,
        allotmentConfig: true,
        sourceIdentities: {
          where: { sourceId: source.id },
        },
      },
    });

    const syncRecords: SourceIdentitySyncRecordResult[] = [];
    let noChangeCount = 0;
    let discoveredCount = 0;
    let changedCount = 0;
    let unresolvedCount = 0;
    let skippedCount = 0;

    for (const issue of discoveredIssues) {
      if (!issue.externalId?.trim() || !issue.externalName?.trim()) {
        unresolvedCount++;
        syncRecords.push({
          status: SourceIdentitySyncStatus.UNRESOLVED,
          registrarCode: adapter.registrarCode,
          externalId: issue.externalId || '',
          externalName: issue.externalName || '',
          reason: 'Malformed or empty externalId or externalName',
        });
        continue;
      }

      const matchResult = this.findMatchingCanonicalIpo(
        issue,
        canonicalIpos,
        adapter.registrarCode,
      );

      if (
        matchResult.status === SourceIdentitySyncStatus.UNRESOLVED ||
        !matchResult.ipo
      ) {
        unresolvedCount++;
        syncRecords.push({
          status: SourceIdentitySyncStatus.UNRESOLVED,
          registrarCode: adapter.registrarCode,
          externalId: issue.externalId,
          externalName: issue.externalName,
          reason:
            matchResult.reason || 'No unambiguous canonical IPO match found',
        });
        continue;
      }

      const ipo = matchResult.ipo;
      const isStale = Boolean(issue.isStale || issue.rawPayload?.isStale);

      // Check if externalId is already mapped to any canonical IPO
      const existingMappingByExternalId =
        await this.prisma.ipoSourceIdentity.findFirst({
          where: {
            sourceId: source.id,
            externalId: issue.externalId,
          },
        });

      if (existingMappingByExternalId) {
        if (existingMappingByExternalId.ipoId === ipo.id) {
          noChangeCount++;
          if (!isStale) {
            await this.ensureAllotmentConfigForLiveMatch(
              ipo,
              adapter.registrarCode,
              issue.externalId,
              false,
            );
          }
          syncRecords.push({
            status: SourceIdentitySyncStatus.NO_CHANGE,
            registrarCode: adapter.registrarCode,
            externalId: issue.externalId,
            externalName: issue.externalName,
            ipoId: ipo.id,
            companyName: ipo.company.displayName,
            previousExternalId: issue.externalId,
            newExternalId: issue.externalId,
          });
        } else {
          // If the existing mapping is on an unconfigured duplicate and the new match is an active configured IPO,
          // re-link the identity to the configured canonical IPO.
          const existingIpo = canonicalIpos.find(
            (c) => c.id === existingMappingByExternalId.ipoId,
          );
          const isSameCompany =
            existingIpo &&
            this.normalizeCompanyName(existingIpo.company.displayName) ===
              this.normalizeCompanyName(ipo.company.displayName);

          if (isSameCompany) {
            if (isStale) {
              skippedCount++;
              syncRecords.push({
                status: SourceIdentitySyncStatus.SKIPPED,
                registrarCode: adapter.registrarCode,
                externalId: issue.externalId,
                externalName: issue.externalName,
                ipoId: ipo.id,
                companyName: ipo.company.displayName,
                previousExternalId: issue.externalId,
                newExternalId: issue.externalId,
                reason:
                  'Skipped: stale cached registrar issue cannot relink existing identity',
              });
              continue;
            }

            await this.prisma.ipoSourceIdentity.update({
              where: { id: existingMappingByExternalId.id },
              data: { ipoId: ipo.id },
            });
            await this.ensureAllotmentConfigForLiveMatch(
              ipo,
              adapter.registrarCode,
              issue.externalId,
              false,
            );
            changedCount++;
            this.logger.log(
              `Relinked externalId '${issue.externalId}' from unconfigured sibling (${existingMappingByExternalId.ipoId}) to configured IPO (${ipo.id})`,
            );
            syncRecords.push({
              status: SourceIdentitySyncStatus.EXTERNAL_ID_CHANGED,
              registrarCode: adapter.registrarCode,
              externalId: issue.externalId,
              externalName: issue.externalName,
              ipoId: ipo.id,
              companyName: ipo.company.displayName,
              previousExternalId: issue.externalId,
              newExternalId: issue.externalId,
            });
          } else {
            unresolvedCount++;
            syncRecords.push({
              status: SourceIdentitySyncStatus.UNRESOLVED,
              registrarCode: adapter.registrarCode,
              externalId: issue.externalId,
              externalName: issue.externalName,
              reason: `Conflict: externalId '${issue.externalId}' is already mapped to a different canonical IPO (${existingMappingByExternalId.ipoId})`,
            });
          }
        }
        continue;
      }

      const existingIdentityOnIpo = ipo.sourceIdentities.find(
        (identity) => !identity.sourceId || identity.sourceId === source.id,
      );

      if (existingIdentityOnIpo) {
        if (isStale) {
          skippedCount++;
          syncRecords.push({
            status: SourceIdentitySyncStatus.SKIPPED,
            registrarCode: adapter.registrarCode,
            externalId: issue.externalId,
            externalName: issue.externalName,
            ipoId: ipo.id,
            companyName: ipo.company.displayName,
            previousExternalId: existingIdentityOnIpo.externalId ?? undefined,
            newExternalId: issue.externalId,
            reason:
              'Skipped: stale cached registrar issue cannot update existing identity',
          });
          continue;
        }

        // Update stale identity on matched IPO
        const previousExternalId = existingIdentityOnIpo.externalId ?? undefined;
        await this.prisma.ipoSourceIdentity.update({
          where: { id: existingIdentityOnIpo.id },
          data: { externalId: issue.externalId },
        });
        await this.ensureAllotmentConfigForLiveMatch(
          ipo,
          adapter.registrarCode,
          issue.externalId,
          true,
        );

        changedCount++;
        this.logger.warn(
          `EXTERNAL_ID_CHANGED for IPO ${ipo.company.displayName} (${ipo.id}): ${previousExternalId} -> ${issue.externalId}`,
        );

        syncRecords.push({
          status: SourceIdentitySyncStatus.EXTERNAL_ID_CHANGED,
          registrarCode: adapter.registrarCode,
          externalId: issue.externalId,
          externalName: issue.externalName,
          ipoId: ipo.id,
          companyName: ipo.company.displayName,
          previousExternalId,
          newExternalId: issue.externalId,
        });
      } else {
        if (isStale) {
          skippedCount++;
          syncRecords.push({
            status: SourceIdentitySyncStatus.SKIPPED,
            registrarCode: adapter.registrarCode,
            externalId: issue.externalId,
            externalName: issue.externalName,
            ipoId: ipo.id,
            companyName: ipo.company.displayName,
            newExternalId: issue.externalId,
            reason:
              'Skipped: stale cached registrar issue cannot be persisted as new live identity',
          });
          continue;
        }

        // Create new IpoSourceIdentity
        await this.prisma.ipoSourceIdentity.create({
          data: {
            ipoId: ipo.id,
            sourceId: source.id,
            externalId: issue.externalId,
          },
        });
        await this.ensureAllotmentConfigForLiveMatch(
          ipo,
          adapter.registrarCode,
          issue.externalId,
          false,
        );

        discoveredCount++;
        syncRecords.push({
          status: SourceIdentitySyncStatus.DISCOVERED,
          registrarCode: adapter.registrarCode,
          externalId: issue.externalId,
          externalName: issue.externalName,
          ipoId: ipo.id,
          companyName: ipo.company.displayName,
          newExternalId: issue.externalId,
        });
      }
    }

    const isSummaryStale =
      discoveredIssues.length > 0 &&
      discoveredIssues.some((i) => i.isStale || Boolean(i.rawPayload?.isStale));

    return {
      registrarCode: adapter.registrarCode,
      totalDiscovered: discoveredIssues.length,
      noChangeCount,
      discoveredCount,
      changedCount,
      unresolvedCount,
      skippedCount,
      isStale: isSummaryStale,
      syncRecords,
      executedAt: startTime,
    };
  }

  /**
   * Ensures ipoAllotmentConfig and REGISTRAR participant exist for a live matched registrar issue,
   * preserving existing verified registrarIpoCode values (unless explicitly rotated) and respecting disabled/conflicting configs.
   */
  private async ensureAllotmentConfigForLiveMatch(
    ipo: {
      id: string;
      allotmentConfig?: {
        enabled?: boolean | null;
        registrar?: string | null;
        registrarIpoCode?: string | null;
      } | null;
    },
    registrarCode: string,
    externalId: string,
    allowReplaceExistingCode: boolean,
  ): Promise<boolean> {
    if (ipo.allotmentConfig?.enabled === false) {
      return false;
    }

    const canonicalTarget =
      normalizeKnownRegistrarCode(registrarCode) || registrarCode.trim();
    const existingRawReg = ipo.allotmentConfig?.registrar?.trim();
    const existingNormalizedReg = existingRawReg
      ? normalizeKnownRegistrarCode(existingRawReg)
      : undefined;

    if (
      existingRawReg &&
      existingRawReg.toUpperCase() !== 'UNKNOWN' &&
      existingNormalizedReg &&
      existingNormalizedReg !== canonicalTarget
    ) {
      this.logger.warn(
        `Skipping allotmentConfig sync for IPO ${ipo.id}: existing registrar '${existingNormalizedReg}' conflicts with '${canonicalTarget}'`,
      );
      return false;
    }

    const cleanExternalId = sanitizeRegistrarIpoCode(externalId);
    const existingValidCode = sanitizeRegistrarIpoCode(
      ipo.allotmentConfig?.registrarIpoCode,
    );

    // Skip DB write if config already has canonical registrar and valid code (and code didn't change)
    if (
      existingNormalizedReg === canonicalTarget &&
      existingValidCode &&
      (!allowReplaceExistingCode || existingValidCode === cleanExternalId)
    ) {
      return false;
    }

    const persisted = await persistRegistrarCode({
      prisma: this.prisma,
      ipoId: ipo.id,
      registrarCode: canonicalTarget,
      discoveredCode: cleanExternalId,
      allowRegistrarWithoutCode: true,
      preserveExistingCode: !allowReplaceExistingCode,
      ensureParticipant: true,
      context: 'SourceIdentitySyncService live match',
      logger: this.logger,
    });

    if (persisted) {
      ipo.allotmentConfig = {
        enabled: true,
        registrar: canonicalTarget,
        registrarIpoCode: allowReplaceExistingCode
          ? cleanExternalId || existingValidCode || null
          : existingValidCode || cleanExternalId || null,
      };
    }

    return persisted;
  }

  /**
   * Reconciles partial IPO records that already have a REGISTRAR IpoSourceIdentity or
   * REGISTRAR IpoParticipant but lack a populated IpoAllotmentConfig (or lack registrarIpoCode).
   * Supports dry-run auditing before applying updates.
   */
  public async reconcilePartialRegistrarRecords(
    options: { dryRun?: boolean; ipoId?: string; limit?: number } = {},
  ): Promise<PartialRegistrarReconcileSummary> {
    const dryRun = options.dryRun !== false;
    const ipos = await this.prisma.ipo.findMany({
      where: {
        publicationStatus: PublicationStatus.PUBLISHED,
        ...(options.ipoId ? { id: options.ipoId } : {}),
        OR: [
          { allotmentConfig: null },
          { allotmentConfig: { registrar: '' } },
          { allotmentConfig: { registrar: 'UNKNOWN' } },
          { allotmentConfig: { registrarIpoCode: null } },
        ],
      },
      include: {
        company: true,
        allotmentConfig: true,
        participants: {
          where: { role: ParticipantRole.REGISTRAR },
        },
        sourceIdentities: {
          include: { source: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(options.limit ? { take: options.limit } : {}),
    });

    const summary: PartialRegistrarReconcileSummary = {
      dryRun,
      scannedCount: ipos.length,
      reconciledCount: 0,
      skippedConflictCount: 0,
      skippedDisabledCount: 0,
      skippedAlreadyConfiguredCount: 0,
      items: [],
    };

    for (const ipo of ipos) {
      const plan = buildPartialRegistrarReconcilePlan(ipo);
      if (plan.action === 'SKIP_CONFLICT') {
        summary.skippedConflictCount++;
      } else if (plan.action === 'SKIP_DISABLED') {
        summary.skippedDisabledCount++;
      } else if (plan.action === 'SKIP_ALREADY_CONFIGURED') {
        summary.skippedAlreadyConfiguredCount++;
      } else if (plan.action === 'RECONCILE' && plan.registrar) {
        if (!dryRun) {
          const ok = await persistRegistrarCode({
            prisma: this.prisma,
            ipoId: ipo.id,
            registrarCode: plan.registrar,
            discoveredCode: plan.registrarIpoCode,
            allowRegistrarWithoutCode: true,
            preserveExistingCode: true,
            ensureParticipant: true,
            context: 'reconcilePartialRegistrarRecords',
            logger: this.logger,
          });
          if (!ok) continue;
        }
        summary.reconciledCount++;
      }

      if (plan.action !== 'SKIP_NO_REGISTRAR' && plan.action !== 'SKIP_ALREADY_CONFIGURED') {
        summary.items.push({
          ipoId: ipo.id,
          companyName: ipo.company?.displayName || ipo.company?.legalName || ipo.id,
          action: plan.action,
          registrar: plan.registrar,
          registrarIpoCode: plan.registrarIpoCode,
          reason: plan.reason,
        });
      }
    }

    return summary;
  }

  /**
   * Read-only audit report summarizing registrar coverage across PUBLISHED IPOs by status and active window,
   * plus duplicate PUBLISHED company groups for manual review without mutating or deleting records.
   */
  public async generateRegistrarCoverageAuditReport(
    now: Date = new Date(),
  ): Promise<RegistrarCoverageAuditReport> {
    const publishedIpos = await this.prisma.ipo.findMany({
      where: { publicationStatus: PublicationStatus.PUBLISHED },
      include: {
        company: true,
        allotmentConfig: true,
        lifecycleEvents: true,
        participants: {
          where: { role: ParticipantRole.REGISTRAR },
        },
        sourceIdentities: {
          include: { source: true },
        },
      },
    });

    const thirtyDaysMs = 30 * 86_400_000;
    const nowMs = now.getTime();
    const activeStatuses = new Set<IpoStatus>([
      IpoStatus.UPCOMING,
      IpoStatus.OPEN,
      IpoStatus.CLOSING_TODAY,
      IpoStatus.CLOSED,
      IpoStatus.ALLOTMENT_PENDING,
    ]);

    let hasAllotmentConfigRegistrar = 0;
    let hasParticipantRegistrar = 0;
    let hasSourceIdentityRegistrar = 0;
    let hasAnyRegistrar = 0;
    let missingAllRegistrars = 0;
    let partialRecordsMissingConfig = 0;

    const statusBuckets = new Map<
      string,
      {
        status: IpoStatus;
        marketSegment: string;
        total: number;
        hasAnyRegistrar: number;
        missingAllRegistrars: number;
        activeWindowMissingCount: number;
      }
    >();

    const activeMissingRegistrars: RegistrarCoverageAuditReport['activeMissingRegistrars'] = [];
    const duplicateGroupsMap = new Map<
      string,
      {
        normalizedCompanyName: string;
        marketSegment: string;
        records: RegistrarCoverageAuditReport['duplicatePublishedGroups'][0]['records'];
      }
    >();

    for (const ipo of publishedIpos) {
      const cfgReg = ipo.allotmentConfig?.registrar?.trim();
      const hasCfg = Boolean(cfgReg && cfgReg.toUpperCase() !== 'UNKNOWN');
      const hasPart = (ipo.participants || []).some((p) => Boolean(p.name?.trim()));
      const regSourceIdentities = (ipo.sourceIdentities || []).filter(
        (si) => si.source?.sourceType === SourceType.REGISTRAR,
      );
      const hasSrc = regSourceIdentities.length > 0;
      const hasAny = hasCfg || hasPart || hasSrc;

      if (hasCfg) hasAllotmentConfigRegistrar++;
      if (hasPart) hasParticipantRegistrar++;
      if (hasSrc) hasSourceIdentityRegistrar++;
      if (hasAny) hasAnyRegistrar++;
      else missingAllRegistrars++;
      if (!hasCfg && (hasPart || hasSrc)) partialRecordsMissingConfig++;

      const listingEv = (ipo.lifecycleEvents || []).find(
        (e) => e.eventType === LifecycleEventType.LISTING,
      );
      const closeEv = (ipo.lifecycleEvents || []).find(
        (e) => e.eventType === LifecycleEventType.CLOSE,
      );
      const openEv = (ipo.lifecycleEvents || []).find(
        (e) => e.eventType === LifecycleEventType.OPEN,
      );

      const listingDateStr = listingEv?.eventDate
        ? new Date(listingEv.eventDate).toISOString().slice(0, 10)
        : null;
      const closeDateStr = closeEv?.eventDate
        ? new Date(closeEv.eventDate).toISOString().slice(0, 10)
        : null;
      const openDateStr = openEv?.eventDate
        ? new Date(openEv.eventDate).toISOString().slice(0, 10)
        : null;

      const isWithin30DaysListed =
        ipo.status === IpoStatus.LISTED &&
        Boolean(listingEv?.eventDate) &&
        nowMs - new Date(listingEv!.eventDate).getTime() <= thirtyDaysMs;
      const inActiveWindow = activeStatuses.has(ipo.status) || isWithin30DaysListed;

      const bucketKey = `${ipo.status}:${ipo.marketSegment}`;
      const bucket = statusBuckets.get(bucketKey) || {
        status: ipo.status,
        marketSegment: String(ipo.marketSegment),
        total: 0,
        hasAnyRegistrar: 0,
        missingAllRegistrars: 0,
        activeWindowMissingCount: 0,
      };
      bucket.total++;
      if (hasAny) bucket.hasAnyRegistrar++;
      else {
        bucket.missingAllRegistrars++;
        if (inActiveWindow) bucket.activeWindowMissingCount++;
      }
      statusBuckets.set(bucketKey, bucket);

      if (!hasAny && inActiveWindow) {
        const partialSources = (ipo.sourceIdentities || [])
          .map((si) => si.source?.code)
          .filter((c): c is string => Boolean(c));
        activeMissingRegistrars.push({
          ipoId: ipo.id,
          companyName: ipo.company?.displayName || ipo.company?.legalName || ipo.id,
          status: ipo.status,
          marketSegment: String(ipo.marketSegment),
          listingDate: listingDateStr,
          closeDate: closeDateStr,
          partialSources,
        });
      }

      const normName = this.normalizeCompanyName(
        ipo.company?.displayName || ipo.company?.legalName || '',
      );
      if (normName) {
        const dupKey = `${normName}:${ipo.marketSegment}`;
        const group = duplicateGroupsMap.get(dupKey) || {
          normalizedCompanyName: normName,
          marketSegment: String(ipo.marketSegment),
          records: [],
        };
        group.records.push({
          id: ipo.id,
          displayName: ipo.company?.displayName || ipo.company?.legalName || ipo.id,
          status: ipo.status,
          symbol: ipo.symbol || null,
          createdAt: ipo.createdAt ? new Date(ipo.createdAt).toISOString() : '',
          openDate: openDateStr,
          listingDate: listingDateStr,
          hasRegistrar: hasAny,
        });
        duplicateGroupsMap.set(dupKey, group);
      }
    }

    const duplicatePublishedGroups = Array.from(duplicateGroupsMap.values())
      .filter((g) => g.records.length > 1)
      .map((g) => ({
        ...g,
        count: g.records.length,
      }));

    return {
      generatedAt: now.toISOString(),
      summary: {
        totalPublished: publishedIpos.length,
        hasAllotmentConfigRegistrar,
        hasParticipantRegistrar,
        hasSourceIdentityRegistrar,
        hasAnyRegistrar,
        missingAllRegistrars,
        partialRecordsMissingConfig,
      },
      byStatus: Array.from(statusBuckets.values()),
      activeMissingRegistrars,
      duplicatePublishedGroups,
    };
  }

  /**
   * Deterministically matches a discovered issue against the list of canonical IPOs.
   * Prefers active configured IPOs for the registrar when multiple candidates exist for the same company.
   */
  public findMatchingCanonicalIpo(
    issue: DiscoveredRegistrarIssue,
    canonicalIpos: Array<{
      id: string;
      symbol: string | null;
      company: { displayName: string; legalName: string };
      allotmentConfig?: { enabled: boolean; registrar?: string | null } | null;
      sourceIdentities: Array<{ id: string; externalId: string | null; sourceId?: string }>;
    }>,
    registrarCode?: string,
  ): {
    status: SourceIdentitySyncStatus;
    ipo?: (typeof canonicalIpos)[0];
    reason?: string;
  } {
    const issueNormalizedName = this.normalizeCompanyName(issue.externalName);

    const matches: Array<{
      ipo: (typeof canonicalIpos)[0];
      confidence: number;
      hasMatchingConfig: boolean;
      reason: string;
    }> = [];

    for (const ipo of canonicalIpos) {
      let isMatch = false;
      let baseConfidence = 0;
      let reason = '';

      // Rule 1: Exact symbol match (if issue name contains symbol or symbol matches)
      if (
        ipo.symbol &&
        issue.externalName.toUpperCase().includes(ipo.symbol.toUpperCase())
      ) {
        isMatch = true;
        baseConfidence = 0.95;
        reason = `Symbol match on '${ipo.symbol}'`;
      } else {
        // Rule 2: Normalized name match on displayName or legalName
        const normDisplay = this.normalizeCompanyName(ipo.company.displayName);
        const normLegal = this.normalizeCompanyName(ipo.company.legalName);

        if (
          normDisplay === issueNormalizedName ||
          normLegal === issueNormalizedName
        ) {
          isMatch = true;
          baseConfidence = 0.92;
          reason = `Exact name match ('${ipo.company.displayName}')`;
        } else if (
          (normDisplay.length >= 4 &&
            issueNormalizedName.includes(normDisplay)) ||
          (normLegal.length >= 4 && issueNormalizedName.includes(normLegal))
        ) {
          isMatch = true;
          baseConfidence = 0.90;
          reason = `Name match ('${ipo.company.displayName}')`;
        }
      }

      if (isMatch) {
        const hasMatchingConfig =
          ipo.allotmentConfig?.enabled &&
          normalizeRegistrarCode(ipo.allotmentConfig.registrar) ===
            registrarCode;

        const confidence = hasMatchingConfig
          ? baseConfidence + 0.05
          : baseConfidence;

        matches.push({
          ipo,
          confidence,
          hasMatchingConfig: Boolean(hasMatchingConfig),
          reason: hasMatchingConfig
            ? `${reason} (preferred: active allotment config)`
            : reason,
        });
      }
    }

    if (matches.length === 0) {
      return {
        status: SourceIdentitySyncStatus.UNRESOLVED,
        reason: 'No matching canonical IPO found for discovered issue',
      };
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence);

    // Check for ambiguity across distinct companies
    if (
      matches.length > 1 &&
      Math.abs(matches[0]!.confidence - matches[1]!.confidence) < 0.001 &&
      matches[0]!.ipo.id !== matches[1]!.ipo.id
    ) {
      const normComp0 = this.normalizeCompanyName(
        matches[0]!.ipo.company.displayName,
      );
      const normComp1 = this.normalizeCompanyName(
        matches[1]!.ipo.company.displayName,
      );

      if (normComp0 === normComp1) {
        if (matches[0]!.hasMatchingConfig && !matches[1]!.hasMatchingConfig) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[0]!.ipo,
            reason: matches[0]!.reason,
          };
        }
        if (!matches[0]!.hasMatchingConfig && matches[1]!.hasMatchingConfig) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[1]!.ipo,
            reason: matches[1]!.reason,
          };
        }

        // Prefer PUBLISHED over DRAFT
        const isPub0 = (matches[0]!.ipo as any).publicationStatus === 'PUBLISHED';
        const isPub1 = (matches[1]!.ipo as any).publicationStatus === 'PUBLISHED';
        if (isPub0 && !isPub1) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[0]!.ipo,
            reason: `${matches[0]!.reason} (preferred: published status)`,
          };
        }
        if (!isPub0 && isPub1) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[1]!.ipo,
            reason: `${matches[1]!.reason} (preferred: published status)`,
          };
        }

        // Prefer record with matching non-empty symbol
        if (matches[0]!.ipo.symbol && !matches[1]!.ipo.symbol) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[0]!.ipo,
            reason: `${matches[0]!.reason} (preferred: non-empty symbol)`,
          };
        }
        if (!matches[0]!.ipo.symbol && matches[1]!.ipo.symbol) {
          return {
            status: SourceIdentitySyncStatus.DISCOVERED,
            ipo: matches[1]!.ipo,
            reason: `${matches[1]!.reason} (preferred: non-empty symbol)`,
          };
        }

        // If neither has distinguishing criteria, remain unresolved without arbitrary selection
        return {
          status: SourceIdentitySyncStatus.UNRESOLVED,
          reason: `Ambiguous match between multiple IPOs for company '${matches[0]!.ipo.company.displayName}'`,
        };
      }

      return {
        status: SourceIdentitySyncStatus.UNRESOLVED,
        reason: `Ambiguous match between IPOs '${matches[0]!.ipo.company.displayName}' and '${matches[1]!.ipo.company.displayName}'`,
      };
    }

    return {
      status: SourceIdentitySyncStatus.DISCOVERED,
      ipo: matches[0]!.ipo,
      reason: matches[0]!.reason,
    };
  }
}
