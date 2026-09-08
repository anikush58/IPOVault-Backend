import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
  RegistrarSourceIdentitySyncSummary,
  SourceIdentitySyncRecordResult,
  SourceIdentitySyncStatus,
} from './registrar-identity-discovery.types';

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

    const source = await this.prisma.source.findUnique({
      where: { code: adapter.registrarCode },
    });

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

      const matchResult = this.findMatchingCanonicalIpo(issue, canonicalIpos);

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
          unresolvedCount++;
          syncRecords.push({
            status: SourceIdentitySyncStatus.UNRESOLVED,
            registrarCode: adapter.registrarCode,
            externalId: issue.externalId,
            externalName: issue.externalName,
            reason: `Conflict: externalId '${issue.externalId}' is already mapped to a different canonical IPO (${existingMappingByExternalId.ipoId})`,
          });
        }
        continue;
      }

      const existingIdentityOnIpo = ipo.sourceIdentities.find(
        (identity) => !identity.sourceId || identity.sourceId === source.id,
      );

      if (existingIdentityOnIpo) {
        // Update stale identity on matched IPO
        const previousExternalId = existingIdentityOnIpo.externalId ?? undefined;
        await this.prisma.ipoSourceIdentity.update({
          where: { id: existingIdentityOnIpo.id },
          data: { externalId: issue.externalId },
        });

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
        // Create new IpoSourceIdentity
        await this.prisma.ipoSourceIdentity.create({
          data: {
            ipoId: ipo.id,
            sourceId: source.id,
            externalId: issue.externalId,
          },
        });

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

    return {
      registrarCode: adapter.registrarCode,
      totalDiscovered: discoveredIssues.length,
      noChangeCount,
      discoveredCount,
      changedCount,
      unresolvedCount,
      syncRecords,
      executedAt: startTime,
    };
  }

  /**
   * Deterministically matches a discovered issue against the list of canonical IPOs.
   */
  private findMatchingCanonicalIpo(
    issue: DiscoveredRegistrarIssue,
    canonicalIpos: Array<{
      id: string;
      symbol: string | null;
      company: { displayName: string; legalName: string };
      sourceIdentities: Array<{ id: string; externalId: string | null; sourceId?: string }>;
    }>,
  ): {
    status: SourceIdentitySyncStatus;
    ipo?: (typeof canonicalIpos)[0];
    reason?: string;
  } {
    const issueNormalizedName = this.normalizeCompanyName(issue.externalName);

    const matches: Array<{
      ipo: (typeof canonicalIpos)[0];
      confidence: number;
      reason: string;
    }> = [];

    for (const ipo of canonicalIpos) {
      // Rule 1: Exact symbol match (if issue name contains symbol or symbol matches)
      if (
        ipo.symbol &&
        issue.externalName.toUpperCase().includes(ipo.symbol.toUpperCase())
      ) {
        matches.push({
          ipo,
          confidence: 0.95,
          reason: `Symbol match on '${ipo.symbol}'`,
        });
        continue;
      }

      // Rule 2: Normalized name match on displayName or legalName
      const normDisplay = this.normalizeCompanyName(ipo.company.displayName);
      const normLegal = this.normalizeCompanyName(ipo.company.legalName);

      if (
        normDisplay === issueNormalizedName ||
        normLegal === issueNormalizedName ||
        (normDisplay.length >= 4 &&
          issueNormalizedName.includes(normDisplay)) ||
        (normLegal.length >= 4 && issueNormalizedName.includes(normLegal))
      ) {
        matches.push({
          ipo,
          confidence: 0.9,
          reason: `Name match ('${ipo.company.displayName}')`,
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

    // Check for ambiguity: if top two matches have equal high confidence, reject match
    if (
      matches.length > 1 &&
      matches[0]!.confidence === matches[1]!.confidence &&
      matches[0]!.ipo.id !== matches[1]!.ipo.id
    ) {
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
