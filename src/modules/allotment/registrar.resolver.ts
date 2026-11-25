import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ParticipantRole, Prisma, SourceType } from '@prisma/client';
import {
  IRegistrarAdapter,
  isValidRegistrarIpoCode,
  sanitizeRegistrarIpoCode,
} from './allotment.types';
import {
  normalizeRegistrarCode,
  RegistrarAdapterRegistry,
} from './adapters/registrar-adapter.registry';

export const KNOWN_NON_KFIN_REGISTRAR_CODES = new Set<string>([
  'MUFG_INTIME',
  'BIGSHARE',
  'MAASHITLA',
  'SKYLINE',
  'PURVA',
  'CAMEO',
]);

export interface StoredRegistrarMetadata {
  disabledByConfig: boolean;
  recognizedCodes: Set<string>;
  hasUnrecognizedEntry: boolean;
  lookupFailed: boolean;
}

export interface RegistrarMetadataIpoRecord {
  id: string;
  allotmentResultAvailableAt?: Date | null;
  allotmentConfig?: {
    enabled?: boolean | null;
    registrar?: string | null;
    registrarIpoCode?: string | null;
  } | null;
  sourceIdentities?: Array<{
    source?: {
      code?: string | null;
      name?: string | null;
      sourceType?: string | null;
    } | null;
  }>;
  participants?: Array<{
    role?: string | null;
    name?: string | null;
    entityName?: string | null;
  }>;
}

export interface RegistrarMetadataLookupPrisma {
  ipoAllotmentConfig?: {
    findUnique?(args: {
      where: { ipoId: string };
    }): Promise<RegistrarMetadataIpoRecord['allotmentConfig'] | null>;
  };
  ipoSourceIdentity?: {
    findMany?(args: {
      where: {
        ipoId: string;
        source: { sourceType: SourceType };
      };
      include: { source: true };
    }): Promise<NonNullable<RegistrarMetadataIpoRecord['sourceIdentities']>>;
  };
  ipoParticipant?: {
    findMany?(args: {
      where: {
        ipoId: string;
        role: ParticipantRole;
      };
    }): Promise<NonNullable<RegistrarMetadataIpoRecord['participants']>>;
  };
}

export function normalizeKnownRegistrarCode(
  raw?: string | null,
  registry?: RegistrarAdapterRegistry,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = normalizeRegistrarCode(trimmed);
  if (normalized === 'KFINTECH') {
    return 'KFINTECH';
  }

  const registeredAdapter = registry?.get(trimmed);
  if (registeredAdapter) {
    const adapterNormalized = normalizeRegistrarCode(registeredAdapter.code);
    if (adapterNormalized === 'KFINTECH') {
      return 'KFINTECH';
    }
    return registeredAdapter.code.toUpperCase();
  }

  if (KNOWN_NON_KFIN_REGISTRAR_CODES.has(normalized)) {
    return normalized;
  }

  return undefined;
}

/**
 * Normalizes all raw strings from a single registrar record and adds
 * recognized canonical codes to `recognizedCodes`. Returns `true` when
 * the record contains any unrecognized non-empty companion field or is
 * unexpectedly empty.
 */
export function collectRegistrarCandidateValues(
  rawValues: Array<string | null | undefined>,
  recognizedCodes: Set<string>,
  treatEmptyAsUnrecognized: boolean,
  registry?: RegistrarAdapterRegistry,
): boolean {
  const nonEmptyValues = rawValues
    .map((val) => val?.trim())
    .filter((val): val is string => Boolean(val));

  if (nonEmptyValues.length === 0) {
    return treatEmptyAsUnrecognized;
  }

  let hasUnrecognizedValue = false;
  for (const val of nonEmptyValues) {
    const normalized = normalizeKnownRegistrarCode(val, registry);
    if (normalized) {
      recognizedCodes.add(normalized);
    } else {
      hasUnrecognizedValue = true;
    }
  }

  return hasUnrecognizedValue;
}

/**
 * Inspects stored registrar metadata across allotmentConfig, sourceIdentities,
 * and participants without short-circuiting so conflicts and unknown entries
 * are always visible to callers.
 */
export async function inspectStoredRegistrarMetadata(
  ipo: RegistrarMetadataIpoRecord,
  prisma?: RegistrarMetadataLookupPrisma,
  registry?: RegistrarAdapterRegistry,
  logger?: Logger,
): Promise<StoredRegistrarMetadata> {
  const recognizedCodes = new Set<string>();
  let hasUnrecognizedEntry = false;

  let allotmentConfig = ipo.allotmentConfig;
  if (
    !allotmentConfig &&
    typeof prisma?.ipoAllotmentConfig?.findUnique === 'function'
  ) {
    try {
      allotmentConfig = await prisma.ipoAllotmentConfig.findUnique({
        where: { ipoId: ipo.id },
      });
    } catch (err: unknown) {
      logger?.debug(
        `Fallback allotmentConfig lookup failed for ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return {
        disabledByConfig: false,
        recognizedCodes,
        hasUnrecognizedEntry,
        lookupFailed: true,
      };
    }
  }

  if (allotmentConfig?.enabled === false) {
    return {
      disabledByConfig: true,
      recognizedCodes,
      hasUnrecognizedEntry,
      lookupFailed: false,
    };
  }

  if (allotmentConfig?.registrar?.trim()) {
    if (
      collectRegistrarCandidateValues(
        [allotmentConfig.registrar],
        recognizedCodes,
        false,
        registry,
      )
    ) {
      hasUnrecognizedEntry = true;
    }
  }

  let sourceIdentities = ipo.sourceIdentities;
  if (
    !Array.isArray(sourceIdentities) &&
    typeof prisma?.ipoSourceIdentity?.findMany === 'function'
  ) {
    try {
      const queried = await prisma.ipoSourceIdentity.findMany({
        where: {
          ipoId: ipo.id,
          source: { sourceType: SourceType.REGISTRAR },
        },
        include: { source: true },
      });
      if (Array.isArray(queried)) {
        sourceIdentities = queried;
      }
    } catch (err: unknown) {
      logger?.debug(
        `Authoritative sourceIdentity lookup failed for ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return {
        disabledByConfig: false,
        recognizedCodes,
        hasUnrecognizedEntry,
        lookupFailed: true,
      };
    }
  }

  if (Array.isArray(sourceIdentities)) {
    for (const si of sourceIdentities) {
      if (si.source?.sourceType !== SourceType.REGISTRAR) {
        continue;
      }
      if (
        collectRegistrarCandidateValues(
          [si.source?.code, si.source?.name],
          recognizedCodes,
          true,
          registry,
        )
      ) {
        hasUnrecognizedEntry = true;
      }
    }
  }

  let participants = ipo.participants;
  if (
    !Array.isArray(participants) &&
    typeof prisma?.ipoParticipant?.findMany === 'function'
  ) {
    try {
      const queried = await prisma.ipoParticipant.findMany({
        where: {
          ipoId: ipo.id,
          role: ParticipantRole.REGISTRAR,
        },
      });
      if (Array.isArray(queried)) {
        participants = queried;
      }
    } catch (err: unknown) {
      logger?.debug(
        `Authoritative participant lookup failed for ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return {
        disabledByConfig: false,
        recognizedCodes,
        hasUnrecognizedEntry,
        lookupFailed: true,
      };
    }
  }

  if (Array.isArray(participants)) {
    for (const participant of participants) {
      if (
        participant.role &&
        participant.role !== ParticipantRole.REGISTRAR
      ) {
        continue;
      }
      if (
        collectRegistrarCandidateValues(
          [participant.name, participant.entityName],
          recognizedCodes,
          true,
          registry,
        )
      ) {
        hasUnrecognizedEntry = true;
      }
    }
  }

  return {
    disabledByConfig: false,
    recognizedCodes,
    hasUnrecognizedEntry,
    lookupFailed: false,
  };
}

/**
 * Reconciles stored registrar identities (and optional live/resolver adapter code).
 * Rejects disabled configs, lookup errors, unknown entries, and cross-source
 * registrar conflicts while allowing stale codes or legacy aliases that map to
 * the same authoritative registrar (or clean unpopulated metadata on a live probe).
 */
export function reconcileStoredRegistrarMetadata(
  metadata: StoredRegistrarMetadata,
  candidateAdapterCode?: string,
  registry?: RegistrarAdapterRegistry,
): string | undefined {
  if (
    metadata.disabledByConfig ||
    metadata.lookupFailed ||
    metadata.hasUnrecognizedEntry
  ) {
    return undefined;
  }

  const reconciledCodes = new Set(metadata.recognizedCodes);
  if (candidateAdapterCode?.trim()) {
    const normalizedCandidate = normalizeKnownRegistrarCode(
      candidateAdapterCode,
      registry,
    );
    if (!normalizedCandidate) {
      return undefined;
    }
    reconciledCodes.add(normalizedCandidate);
  }

  if (reconciledCodes.size !== 1) {
    return undefined;
  }

  return Array.from(reconciledCodes)[0];
}

export interface ResolvedRegistrar {
  adapter: IRegistrarAdapter;
  registrarIpoCode?: string;
}

@Injectable()
export class RegistrarResolver {
  private readonly logger = new Logger(RegistrarResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: RegistrarAdapterRegistry,
  ) {}

  /**
   * Resolves the appropriate IRegistrarAdapter and registrar-specific company code for an IPO ID.
   * Driven by database IpoAllotmentConfig or IpoSourceIdentity records with fallback resolution.
   */
  async resolveAdapter(
    ipoId: string,
    requestedCode?: string,
    probeOptions?: {
      skipForceRefresh?: boolean;
      requireLiveActiveList?: boolean;
      skipIdentityPersistence?: boolean;
    },
  ): Promise<ResolvedRegistrar | undefined> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        ipoId.trim(),
      );

    const orConditions: Prisma.IpoSourceIdentityWhereInput[] = [
      { ipo: { symbol: { equals: ipoId, mode: 'insensitive' } } },
      {
        ipo: {
          company: {
            displayName: { contains: ipoId, mode: 'insensitive' },
          },
        },
      },
      {
        ipo: {
          company: { legalName: { contains: ipoId, mode: 'insensitive' } },
        },
      },
    ];

    if (isUuid) {
      orConditions.unshift({ ipoId });
    }

    // 1. Check IpoAllotmentConfig table for admin-managed allotment configuration
    let targetIpoId = isUuid ? ipoId.trim() : null;
    if (!targetIpoId && typeof this.prisma.ipo?.findFirst === 'function') {
      const matchedIpo = await this.prisma.ipo.findFirst({
        where: {
          OR: [
            { symbol: { equals: ipoId, mode: 'insensitive' } },
            { company: { displayName: { contains: ipoId, mode: 'insensitive' } } },
            { company: { legalName: { contains: ipoId, mode: 'insensitive' } } },
          ],
        },
      });
      if (matchedIpo) {
        targetIpoId = matchedIpo.id;
      }
    }

    if (targetIpoId && typeof this.prisma.ipoAllotmentConfig?.findUnique === 'function') {
      const config = await this.prisma.ipoAllotmentConfig.findUnique({
        where: { ipoId: targetIpoId },
      });
      if (config && config.enabled && config.registrar) {
        const adapter = this.registry.get(config.registrar);
        if (adapter) {
          let registrarIpoCode = sanitizeRegistrarIpoCode(
            config.registrarIpoCode,
          );

          if (
            !registrarIpoCode &&
            adapter.code === 'KFINTECH' &&
            typeof this.prisma.ipoSourceIdentity?.findFirst === 'function'
          ) {
            const kfinIdentity = await this.prisma.ipoSourceIdentity.findFirst({
              where: {
                ipoId: targetIpoId,
                source: {
                  code: 'KFINTECH',
                  sourceType: 'REGISTRAR',
                },
              },
              include: {
                source: true,
              },
            });
            const extCode = sanitizeRegistrarIpoCode(kfinIdentity?.externalId);
            if (extCode) {
              registrarIpoCode = extCode;
            }

            // Fallback: If no direct identity on configured IPO, check sibling IPOs for the same company
            if (
              !registrarIpoCode &&
              typeof this.prisma.ipo?.findUnique === 'function' &&
              typeof this.prisma.ipoSourceIdentity?.findMany === 'function'
            ) {
              const currentIpo = await this.prisma.ipo.findUnique({
                where: { id: targetIpoId },
                include: { company: true },
              });

              if (currentIpo) {
                const sameCompanyConditions: Prisma.IpoWhereInput[] = [];
                if (currentIpo.companyId) {
                  sameCompanyConditions.push({
                    companyId: currentIpo.companyId,
                  });
                }
                if (currentIpo.company?.displayName) {
                  sameCompanyConditions.push({
                    company: {
                      displayName: {
                        equals: currentIpo.company.displayName,
                        mode: 'insensitive',
                      },
                    },
                  });
                  sameCompanyConditions.push({
                    company: {
                      legalName: {
                        equals: currentIpo.company.displayName,
                        mode: 'insensitive',
                      },
                    },
                  });
                }
                if (currentIpo.company?.legalName) {
                  sameCompanyConditions.push({
                    company: {
                      displayName: {
                        equals: currentIpo.company.legalName,
                        mode: 'insensitive',
                      },
                    },
                  });
                  sameCompanyConditions.push({
                    company: {
                      legalName: {
                        equals: currentIpo.company.legalName,
                        mode: 'insensitive',
                      },
                    },
                  });
                }

                const siblingIdentities =
                  await this.prisma.ipoSourceIdentity.findMany({
                    where: {
                      ipo: {
                        OR: sameCompanyConditions,
                      },
                      source: {
                        code: 'KFINTECH',
                        sourceType: 'REGISTRAR',
                      },
                    },
                    select: {
                      externalId: true,
                    },
                  });

                const validExtIds = Array.from(
                  new Set(
                    (siblingIdentities || [])
                      .map((s) => s.externalId?.trim())
                      .filter((c): c is string => isValidRegistrarIpoCode(c)),
                  ),
                );

                if (validExtIds.length === 1) {
                  registrarIpoCode = validExtIds[0];
                  this.logger.log(
                    `Resolved KFINTECH client ID '${registrarIpoCode}' for IPO ${targetIpoId} from same-company sibling identity`,
                  );
                } else if (validExtIds.length > 1) {
                  this.logger.warn(
                    `Multiple conflicting KFINTECH identities found for company of IPO ${targetIpoId}: [${validExtIds.join(', ')}]`,
                  );
                }
              }
            }
          }

          return {
            adapter,
            registrarIpoCode,
          };
        }
      }
    }

    // 2. Check direct match or flexible symbol/company name match in database IpoSourceIdentity
    const sourceIdentity = await this.prisma.ipoSourceIdentity.findFirst({
      where: {
        OR: orConditions,
        source: {
          sourceType: 'REGISTRAR',
          ...(requestedCode ? { code: requestedCode } : {}),
        },
      },
      include: {
        source: true,
      },
    });

    if (sourceIdentity?.source?.code) {
      const adapter = this.registry.get(sourceIdentity.source.code);
      if (adapter) {
        const registrarIpoCode = sanitizeRegistrarIpoCode(
          sourceIdentity.externalId,
        );

        return {
          adapter,
          registrarIpoCode,
        };
      }
    }

    // 3. Check ipoParticipant table for registrar participant attached to the IPO
    if (targetIpoId && typeof this.prisma.ipoParticipant?.findFirst === 'function') {
      const participant = await this.prisma.ipoParticipant.findFirst({
        where: {
          ipoId: targetIpoId,
          role: 'REGISTRAR' as any,
        },
      });
      if (participant && (participant.name || (participant as any).entityName)) {
        const rawName = participant.name || (participant as any).entityName;
        const adapter = this.registry.get(rawName);
        if (adapter) {
          return {
            adapter,
          };
        }
      }
    }

    // 4. Dynamic Discovery Fallback: Probe active registrar adapters by company name and symbol
    if (targetIpoId && typeof this.prisma.ipo?.findUnique === 'function') {
      const targetIpo = await this.prisma.ipo.findUnique({
        where: { id: targetIpoId },
        include: { company: true },
      });

      if (targetIpo) {
        const companyName = targetIpo.company?.displayName || targetIpo.company?.legalName;
        const companyLegalName = targetIpo.company?.legalName || undefined;
        const symbol = targetIpo.symbol || undefined;

        if (companyName || symbol) {
          const checkRequest = {
            ipoId: targetIpo.id,
            companyName,
            companyLegalName,
            symbol,
            identifierType: 'PAN' as any,
            identifierValue: '',
            ...(probeOptions?.skipForceRefresh
              ? { skipForceRefresh: true }
              : {}),
            ...(probeOptions?.requireLiveActiveList
              ? { requireLiveActiveList: true }
              : {}),
          };

          for (const candidateAdapter of this.registry.getAll()) {
            if (typeof candidateAdapter.resolveRegistrarIpoCode === 'function') {
              try {
                const probeResult = await candidateAdapter.resolveRegistrarIpoCode(checkRequest);
                const resolvedCode = sanitizeRegistrarIpoCode(probeResult);
                if (resolvedCode) {
                  this.logger.log(
                    `Dynamically discovered registrar '${candidateAdapter.code}' with code '${resolvedCode}' for IPO ${targetIpoId} (${companyName})`,
                  );

                  const suppressEagerPersistence =
                    Boolean(probeOptions?.requireLiveActiveList) ||
                    Boolean(probeOptions?.skipIdentityPersistence);

                  if (!suppressEagerPersistence) {
                    // Best-effort non-blocking persistence of dynamic discovery
                    this.persistDiscoveredRegistrarIdentity(
                      targetIpoId,
                      candidateAdapter.code,
                      resolvedCode,
                    ).catch((persistErr: unknown) => {
                      this.logger.debug(
                        `Failed to persist dynamic registrar identity for IPO ${targetIpoId}: ${(persistErr as Error)?.message || persistErr}`,
                      );
                    });
                  }

                  return {
                    adapter: candidateAdapter,
                    registrarIpoCode: resolvedCode,
                  };
                }
              } catch (probeErr: unknown) {
                // Contained: continue probing next candidate adapter
              }
            }
          }
        }
      }
    }

    // Return undefined when no registrar source identity is mapped
    this.logger.warn(
      `No registered registrar source identity found for IPO ${ipoId}`,
    );
    return undefined;
  }

  public async persistDiscoveredRegistrarIdentity(
    ipoId: string,
    registrarCode: string,
    externalId: string,
  ): Promise<boolean | void> {
    if (
      typeof this.prisma.source?.findUnique !== 'function' ||
      typeof this.prisma.ipoSourceIdentity?.upsert !== 'function'
    ) {
      return false;
    }
    const source = await this.prisma.source.findUnique({
      where: { code: registrarCode },
    });
    if (!source) return false;

    await this.prisma.ipoSourceIdentity.upsert({
      where: {
        ipoId_sourceId: {
          ipoId,
          sourceId: source.id,
        },
      },
      create: {
        ipoId,
        sourceId: source.id,
        externalId,
      },
      update: {
        externalId,
      },
    });

    if (typeof this.prisma.ipoAllotmentConfig?.upsert === 'function') {
      try {
        await this.prisma.ipoAllotmentConfig.upsert({
          where: { ipoId },
          create: {
            ipoId,
            registrar: registrarCode,
            registrarIpoCode: externalId,
            enabled: true,
          },
          update: {
            registrar: registrarCode,
            registrarIpoCode: externalId,
            enabled: true,
          },
        });
      } catch {
        // Non-blocking
      }
    }
    return true;
  }
}

export interface PersistRegistrarCodeOptions {
  prisma: {
    source?: { findUnique?: (args: any) => Promise<any> };
    ipoSourceIdentity?: { upsert?: (args: any) => Promise<any> };
    ipoAllotmentConfig?: {
      findUnique?: (args: any) => Promise<any>;
      upsert?: (args: any) => Promise<any>;
    };
    ipoParticipant?: {
      findFirst?: (args: any) => Promise<any>;
      create?: (args: any) => Promise<any>;
    };
  };
  resolver?: {
    persistDiscoveredRegistrarIdentity?: (
      ipoId: string,
      registrarCode: string,
      externalId: string,
    ) => Promise<boolean | void>;
  };
  ipoId: string;
  registrarCode: string;
  discoveredCode?: string | null;
  allowRegistrarWithoutCode?: boolean;
  preserveExistingCode?: boolean;
  ensureParticipant?: boolean;
  context?: string;
  logger?: Logger;
}

/**
 * Deduplicated helper to persist verified registrar code and identity across modules.
 * Attempts persistence via RegistrarResolver first; falls back to direct ipoAllotmentConfig upsert.
 * Supports persisting canonical registrar without a registrarIpoCode when `allowRegistrarWithoutCode` is true.
 */
export async function persistRegistrarCode(
  options: PersistRegistrarCodeOptions,
): Promise<boolean> {
  const {
    prisma,
    resolver,
    ipoId,
    registrarCode,
    discoveredCode,
    allowRegistrarWithoutCode = false,
    preserveExistingCode = false,
    ensureParticipant = false,
    context = 'registrar code persistence',
    logger,
  } = options;

  const cleanCode = sanitizeRegistrarIpoCode(discoveredCode);
  if (!cleanCode && !allowRegistrarWithoutCode) {
    return false;
  }

  const normalized = normalizeKnownRegistrarCode(registrarCode);
  const cleanRegistrar = normalized || registrarCode?.trim();
  if (!cleanRegistrar) {
    logger?.warn(
      `Cannot persist registrar '${cleanCode || 'UNKNOWN'}' for IPO ${ipoId} (${context}): registrar code is empty`,
    );
    return false;
  }

  let effectiveCode = cleanCode;
  if (preserveExistingCode && typeof prisma?.ipoAllotmentConfig?.findUnique === 'function') {
    try {
      const existing = await prisma.ipoAllotmentConfig.findUnique({
        where: { ipoId },
      });
      const existingValidCode = sanitizeRegistrarIpoCode(existing?.registrarIpoCode);
      if (existingValidCode) {
        effectiveCode = existingValidCode;
      }
    } catch {
      // Fall through cleanly
    }
  }

  let persistedByResolver = false;
  if (effectiveCode && typeof resolver?.persistDiscoveredRegistrarIdentity === 'function') {
    try {
      const res = await resolver.persistDiscoveredRegistrarIdentity(
        ipoId,
        cleanRegistrar,
        effectiveCode,
      );
      if (res !== false) {
        persistedByResolver = true;
      }
    } catch (persistErr: unknown) {
      logger?.warn(
        `Failed to persist registrar identity via resolver for IPO ${ipoId} (${context}): ${(persistErr as Error)?.message || persistErr}`,
      );
    }
  }

  if (
    !persistedByResolver &&
    typeof prisma?.ipoAllotmentConfig?.upsert === 'function'
  ) {
    try {
      await prisma.ipoAllotmentConfig.upsert({
        where: { ipoId },
        create: {
          ipoId,
          registrar: cleanRegistrar,
          ...(effectiveCode ? { registrarIpoCode: effectiveCode } : {}),
          enabled: true,
        },
        update: {
          registrar: cleanRegistrar,
          ...(effectiveCode ? { registrarIpoCode: effectiveCode } : {}),
          enabled: true,
        },
      });
    } catch (upsertErr: unknown) {
      logger?.warn(
        `Failed to upsert ipoAllotmentConfig for IPO ${ipoId} (${context}): ${(upsertErr as Error)?.message || upsertErr}`,
      );
      return false;
    }
  }

  if (
    ensureParticipant &&
    typeof prisma?.ipoParticipant?.findFirst === 'function' &&
    typeof prisma?.ipoParticipant?.create === 'function'
  ) {
    try {
      const existingParticipant = await prisma.ipoParticipant.findFirst({
        where: { ipoId, role: ParticipantRole.REGISTRAR },
      });
      if (!existingParticipant) {
        await prisma.ipoParticipant.create({
          data: {
            ipoId,
            role: ParticipantRole.REGISTRAR,
            name: cleanRegistrar,
          },
        });
      }
    } catch (partErr: unknown) {
      logger?.debug(
        `Non-blocking participant create skipped for IPO ${ipoId} (${context}): ${(partErr as Error)?.message || partErr}`,
      );
    }
  }

  return true;
}

export interface PartialRegistrarSourceIdentityRecord {
  externalId?: string | null;
  source?: {
    code?: string | null;
    name?: string | null;
    sourceType?: string | null;
  } | null;
}

export interface PartialRegistrarIpoRecord extends RegistrarMetadataIpoRecord {
  sourceIdentities?: PartialRegistrarSourceIdentityRecord[];
}

export interface PartialRegistrarReconcilePlan {
  ipoId: string;
  action: 'RECONCILE' | 'SKIP_ALREADY_CONFIGURED' | 'SKIP_DISABLED' | 'SKIP_CONFLICT' | 'SKIP_NO_REGISTRAR';
  registrar?: string;
  registrarIpoCode?: string | null;
  reason?: string;
}

/**
 * Computes a safe reconciliation plan for an IPO that has a REGISTRAR IpoSourceIdentity
 * or REGISTRAR IpoParticipant without a populated IpoAllotmentConfig (or missing registrarIpoCode).
 * Fails closed on disabled configs or conflicting registrars.
 */
export function buildPartialRegistrarReconcilePlan(
  ipo: PartialRegistrarIpoRecord,
  registry?: RegistrarAdapterRegistry,
): PartialRegistrarReconcilePlan {
  const cfg = ipo.allotmentConfig;
  if (cfg?.enabled === false) {
    return {
      ipoId: ipo.id,
      action: 'SKIP_DISABLED',
      reason: 'allotmentConfig.enabled is false',
    };
  }

  const rawCfgRegistrar = cfg?.registrar?.trim();
  const hasUsableCfgRegistrar =
    Boolean(rawCfgRegistrar) &&
    rawCfgRegistrar!.toUpperCase() !== 'UNKNOWN' &&
    Boolean(normalizeKnownRegistrarCode(rawCfgRegistrar, registry) || rawCfgRegistrar!.length >= 2);
  const existingCfgCode = sanitizeRegistrarIpoCode(cfg?.registrarIpoCode) ?? null;

  const registrarSourceIdentities = (ipo.sourceIdentities || []).filter(
    (si) => si.source?.sourceType === SourceType.REGISTRAR,
  );
  const registrarParticipants = (ipo.participants || []).filter(
    (p) => !p.role || p.role === ParticipantRole.REGISTRAR,
  );

  const recognizedCodes = new Set<string>();
  const rawNames: string[] = [];

  for (const si of registrarSourceIdentities) {
    const code = normalizeKnownRegistrarCode(
      si.source?.code || si.source?.name,
      registry,
    );
    if (code) {
      recognizedCodes.add(code);
    } else if (si.source?.name?.trim()) {
      rawNames.push(si.source.name.trim());
    }
  }

  for (const p of registrarParticipants) {
    const raw = (p.name || p.entityName || '').trim();
    if (!raw || ['tbd', 'tba', 'n/a', 'na', 'none', 'unknown', '-'].includes(raw.toLowerCase())) {
      continue;
    }
    const code = normalizeKnownRegistrarCode(raw, registry);
    if (code) {
      recognizedCodes.add(code);
    } else {
      rawNames.push(raw);
    }
  }

  if (recognizedCodes.size > 1 || (recognizedCodes.size >= 1 && rawNames.length > 0)) {
    return {
      ipoId: ipo.id,
      action: 'SKIP_CONFLICT',
      reason: 'Conflicting or mixed registrar entries across sources/participants',
    };
  }

  const derivedRegistrar =
    recognizedCodes.size === 1
      ? Array.from(recognizedCodes)[0]
      : rawNames.length === 1
        ? rawNames[0]
        : undefined;

  if (!derivedRegistrar) {
    return {
      ipoId: ipo.id,
      action: hasUsableCfgRegistrar ? 'SKIP_ALREADY_CONFIGURED' : 'SKIP_NO_REGISTRAR',
      reason: hasUsableCfgRegistrar
        ? 'Already configured'
        : 'No usable registrar in sourceIdentities or participants',
    };
  }

  // Extract unambiguous externalId from matching REGISTRAR sourceIdentity if cfg lacks code
  let derivedCode: string | null = existingCfgCode;
  if (!derivedCode) {
    const validIds = Array.from(
      new Set(
        registrarSourceIdentities
          .map((si) => sanitizeRegistrarIpoCode(si.externalId))
          .filter((c): c is string => Boolean(c)),
      ),
    );
    if (validIds.length === 1) {
      derivedCode = validIds[0];
    }
  }

  if (hasUsableCfgRegistrar) {
    const cfgNormalized = normalizeKnownRegistrarCode(rawCfgRegistrar, registry);
    if (
      cfgNormalized &&
      recognizedCodes.size === 1 &&
      cfgNormalized !== derivedRegistrar
    ) {
      return {
        ipoId: ipo.id,
        action: 'SKIP_CONFLICT',
        reason: `Existing allotmentConfig registrar '${cfgNormalized}' conflicts with '${derivedRegistrar}'`,
      };
    }

    // Only reconcile if allotmentConfig is missing registrarIpoCode while sourceIdentity has one
    if (existingCfgCode || !derivedCode) {
      return {
        ipoId: ipo.id,
        action: 'SKIP_ALREADY_CONFIGURED',
        reason: 'Already configured',
      };
    }
  }

  return {
    ipoId: ipo.id,
    action: 'RECONCILE',
    registrar: hasUsableCfgRegistrar ? rawCfgRegistrar! : derivedRegistrar,
    registrarIpoCode: derivedCode,
  };
}
