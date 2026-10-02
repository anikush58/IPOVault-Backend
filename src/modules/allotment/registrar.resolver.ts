import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { IRegistrarAdapter } from './allotment.types';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';

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
          const rawCode = config.registrarIpoCode?.trim();
          const isCodeUuid = rawCode
            ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                rawCode,
              )
            : false;
          let registrarIpoCode =
            rawCode && !isCodeUuid ? rawCode : undefined;

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
            if (kfinIdentity?.externalId) {
              const extCode = kfinIdentity.externalId.trim();
              const isExtUuid =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  extCode,
                );
              if (extCode && !isExtUuid) {
                registrarIpoCode = extCode;
              }
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
                      .filter(
                        (c): c is string =>
                          Boolean(c) &&
                          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                            c!,
                          ),
                      ),
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
        const rawCode = sourceIdentity.externalId?.trim();
        const isCodeUuid = rawCode
          ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              rawCode,
            )
          : false;
        const registrarIpoCode =
          rawCode && !isCodeUuid ? rawCode : undefined;

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

    // Return undefined when no registrar source identity is mapped
    this.logger.warn(
      `No registered registrar source identity found for IPO ${ipoId}`,
    );
    return undefined;
  }
}
