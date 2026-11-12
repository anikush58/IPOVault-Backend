import { Injectable, Logger } from '@nestjs/common';
import { IpoStatus, ParticipantRole, Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../database/prisma.service';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';
import { PurvaRegistrarAdapter } from './adapters/purva-registrar.adapter';
import { BigshareRegistrarAdapter } from './adapters/bigshare-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
  isValidRegistrarIpoCode,
  NormalizedAllotmentResult,
  sanitizeRegistrarIpoCode,
} from './allotment.types';
import { maskIdentifier } from './allotment.utils';
import { AllotmentRepository } from './allotment.repository';
import {
  inspectStoredRegistrarMetadata,
  reconcileStoredRegistrarMetadata,
  RegistrarMetadataIpoRecord,
  RegistrarResolver,
  StoredRegistrarMetadata,
} from './registrar.resolver';

type AvailabilityIpoRecord = RegistrarMetadataIpoRecord;

@Injectable()
export class AllotmentService {
  private readonly logger = new Logger(AllotmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: RegistrarResolver,
    private readonly registry: RegistrarAdapterRegistry,
    private readonly repository: AllotmentRepository,
    private readonly kfinAdapter: KfinRegistrarAdapter,
    private readonly mufgIntimeAdapter: MufgIntimeRegistrarAdapter,
    private readonly maashitlaAdapter: MaashitlaRegistrarAdapter,
    private readonly skylineAdapter: SkylineRegistrarAdapter,
    private readonly purvaAdapter: PurvaRegistrarAdapter,
    private readonly bigshareAdapter: BigshareRegistrarAdapter,
  ) {
    this.registry.register(this.kfinAdapter);
    this.registry.register(this.mufgIntimeAdapter);
    this.registry.register(this.maashitlaAdapter);
    this.registry.register(this.skylineAdapter);
    this.registry.register(this.purvaAdapter);
    this.registry.register(this.bigshareAdapter);
  }

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    const startTime = Date.now();

    this.logger.log(
      `Initiating allotment check for IPO ID: ${request.ipoId} (Type: ${request.identifierType}, ID: ${masked})`,
    );

    const ipo = await this.prisma.ipo.findUnique({
      where: { id: request.ipoId },
      include: { company: true },
    });

    if (!ipo) {
      throw new AppException(
        ErrorCode.IPO_NOT_FOUND,
        `IPO with ID '${request.ipoId}' was not found`,
        404,
      );
    }

    request.companyName =
      (ipo.company as { displayName?: string })?.displayName ||
      (ipo.company as { legalName?: string })?.legalName ||
      ipo.symbol ||
      undefined;
    request.companyLegalName =
      (ipo.company as { legalName?: string })?.legalName || undefined;
    request.symbol = ipo.symbol || undefined;

    const resolved = await this.resolver.resolveAdapter(request.ipoId);

    if (!resolved) {
      const unresolvedResult: NormalizedAllotmentResult = {
        status: AllotmentStatus.REGISTRAR_UNRESOLVED,
        sourceCode: 'UNRESOLVED',
        checkedAt: new Date(),
        errorMessage: 'No active registrar adapter is mapped to this IPO issue',
      };
      await this.repository.logCheckAttempt(
        request.ipoId,
        request.identifierType,
        request.identifierValue,
        unresolvedResult,
        Date.now() - startTime,
      );
      return unresolvedResult;
    }

    const { adapter, registrarIpoCode } = resolved;
    const sanitizedInitialCode = sanitizeRegistrarIpoCode(registrarIpoCode);
    request.registrarIpoCode = sanitizedInitialCode;

    if (!adapter.supportsIdentifier(request.identifierType)) {
      const unsupportedResult: NormalizedAllotmentResult = {
        status: AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        sourceCode: adapter.code,
        checkedAt: new Date(),
        errorMessage: `Registrar ${adapter.name} does not support identifier type '${request.identifierType}'`,
      };
      await this.repository.logCheckAttempt(
        request.ipoId,
        request.identifierType,
        request.identifierValue,
        unsupportedResult,
        Date.now() - startTime,
      );
      return unsupportedResult;
    }

    try {
      const result = await adapter.checkAllotment(request);
      const latencyMs = Date.now() - startTime;

      await this.repository.logCheckAttempt(
        request.ipoId,
        request.identifierType,
        request.identifierValue,
        result,
        latencyMs,
      );

      const sanitizedResolvedCode = sanitizeRegistrarIpoCode(
        request.registrarIpoCode,
      );

      if (
        sanitizedResolvedCode &&
        (!sanitizedInitialCode ||
          sanitizedInitialCode !== sanitizedResolvedCode)
      ) {
        Promise.resolve(
          this.resolver.persistDiscoveredRegistrarIdentity?.(
            request.ipoId,
            adapter.code,
            sanitizedResolvedCode,
          ),
        ).catch((persistErr: unknown) => {
          this.logger.debug(
            `Failed to persist dynamically discovered registrar code: ${(persistErr as Error)?.message || persistErr}`,
          );
        });
      }

      // If registrar explicitly confirms an allotment result (ALLOTTED, PARTIALLY_ALLOTTED, or NOT_ALLOTTED),
      // this is authoritative proof that allotment has been declared for this IPO.
      // Transition IPO from CLOSED or ALLOTMENT_PENDING to ALLOTMENT_COMPLETED, and backfill
      // allotmentResultAvailableAt for later stages (e.g., LISTED) when it is still null.
      // Notice: APPLICATION_NOT_FOUND, TEMPORARY_ERROR, or NOT_YET_AVAILABLE NEVER alter the IPO declaration status.
      if (
        result.status === AllotmentStatus.ALLOTTED ||
        result.status === AllotmentStatus.PARTIALLY_ALLOTTED ||
        result.status === AllotmentStatus.NOT_ALLOTTED
      ) {
        try {
          const isPostAllotmentStage =
            ipo.status === IpoStatus.ALLOTMENT_COMPLETED ||
            ipo.status === IpoStatus.LISTING_PENDING ||
            ipo.status === IpoStatus.LISTED;

          if (isPostAllotmentStage) {
            if (!ipo.allotmentResultAvailableAt) {
              const backfilled = await this.prisma.ipo.updateMany({
                where: {
                  id: request.ipoId,
                  allotmentResultAvailableAt: null,
                },
                data: { allotmentResultAvailableAt: new Date() },
              });
              if (backfilled?.count > 0) {
                this.logger.log(
                  `[Allotment] Backfilled allotmentResultAvailableAt via checkAllotment for ${ipo.status} IPO '${request.ipoId}'`,
                );
              }
            }
          } else {
            const updatePayload: Prisma.IpoUpdateManyMutationInput = {
              status: IpoStatus.ALLOTMENT_COMPLETED,
            };
            if (!ipo.allotmentResultAvailableAt) {
              updatePayload.allotmentResultAvailableAt = new Date();
            }
            const updated = await this.prisma.ipo.updateMany({
              where: {
                id: request.ipoId,
                status: { in: [IpoStatus.CLOSED, IpoStatus.ALLOTMENT_PENDING] },
              },
              data: updatePayload,
            });
            if (updated?.count > 0) {
              this.logger.log(
                `[Allotment] Confirmed allotment live via checkAllotment for IPO '${request.ipoId}'. Transitioned to ALLOTMENT_COMPLETED`,
              );
            }
          }
        } catch (transErr: unknown) {
          this.logger.error(
            `Failed to transition IPO ${request.ipoId} status on confirmed allotment: ${(transErr as Error)?.message}`,
          );
        }
      }

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorResult: NormalizedAllotmentResult = {
        status: AllotmentStatus.TEMPORARY_ERROR,
        sourceCode: adapter.code,
        checkedAt: new Date(),
        errorMessage: `Unexpected error during ${adapter.name} lookup: ${msg}`,
      };

      await this.repository.logCheckAttempt(
        request.ipoId,
        request.identifierType,
        request.identifierValue,
        errorResult,
        Date.now() - startTime,
      );

      return errorResult;
    }
  }

  /**
   * Fast real-time registrar availability probe:
   * Checks whether the registrar has published allotment results for the given IPO.
   * If newly detected live, automatically transitions IPO status to ALLOTMENT_COMPLETED.
   */
  async checkIpoAllotmentAvailability(
    ipoId: string,
  ): Promise<{ available: boolean; status: string; registrarCode?: string }> {
    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: {
        company: true,
        lifecycleEvents: true,
        allotmentConfig: true,
        sourceIdentities: {
          include: {
            source: true,
          },
        },
        participants: {
          where: {
            role: ParticipantRole.REGISTRAR,
          },
        },
      },
    });

    if (!ipo) {
      throw new AppException(ErrorCode.IPO_NOT_FOUND, 'IPO not found');
    }

    if (ipo.allotmentConfig?.enabled === false) {
      return {
        available: false,
        status: ipo.status,
      };
    }

    const isPostAllotmentStage =
      ipo.status === IpoStatus.ALLOTMENT_COMPLETED ||
      ipo.status === IpoStatus.LISTING_PENDING ||
      ipo.status === IpoStatus.LISTED;

    // Post-allotment IPOs (ALLOTMENT_COMPLETED, LISTING_PENDING, LISTED):
    // fast-path when verified non-placeholder code & availability timestamp already exist;
    // otherwise live-probe and fail closed unless reconciled or positively non-KFin.
    if (isPostAllotmentStage) {
      const rawConfigCode = ipo.allotmentConfig?.registrarIpoCode?.trim();
      let registrarCode = sanitizeRegistrarIpoCode(rawConfigCode);
      const needsTimestampBackfill = !ipo.allotmentResultAvailableAt;

      if (registrarCode && !needsTimestampBackfill) {
        return {
          available: true,
          status: ipo.status,
          registrarCode,
        };
      }

      let confirmedByAdapter = false;
      let resolvedAdapterCode: string | undefined;
      let candidateRegistrarCode: string | undefined;
      let storedMetadata: StoredRegistrarMetadata | undefined;

      try {
        const resolved = await this.resolver.resolveAdapter(ipo.id, undefined, {
          requireLiveActiveList: true,
          skipIdentityPersistence: true,
        });
        if (resolved?.adapter) {
          resolvedAdapterCode = resolved.adapter.code;
          candidateRegistrarCode = sanitizeRegistrarIpoCode(
            resolved.registrarIpoCode,
          );

          if (typeof resolved.adapter.resolveRegistrarIpoCode === 'function') {
            const probeResult = await resolved.adapter.resolveRegistrarIpoCode({
              ipoId: ipo.id,
              registrarIpoCode:
                registrarCode ?? candidateRegistrarCode ?? undefined,
              identifierType: AllotmentIdentifierType.PAN,
              identifierValue: '',
              companyName: ipo.company.displayName,
              companyLegalName: ipo.company.legalName,
              symbol: ipo.symbol || undefined,
              requireLiveActiveList: true,
            });

            const liveProbeCode = sanitizeRegistrarIpoCode(probeResult);
            if (liveProbeCode) {
              storedMetadata = await this.inspectStoredRegistrarMetadata(ipo);
              const reconciledRegistrar = this.reconcileStoredRegistrarMetadata(
                storedMetadata,
                resolved.adapter.code,
              );

              if (reconciledRegistrar) {
                registrarCode = liveProbeCode;
                confirmedByAdapter = true;

                // Persist discovered code only when live-verified and reconciled
                // against stored registrar metadata.
                if (registrarCode !== rawConfigCode) {
                  await this.persistVerifiedRegistrarCode(
                    ipo.id,
                    resolved.adapter.code,
                    registrarCode,
                    'availability backfill',
                  );
                }

                if (needsTimestampBackfill) {
                  await this.prisma.ipo.updateMany({
                    where: {
                      id: ipo.id,
                      allotmentResultAvailableAt: null,
                    },
                    data: { allotmentResultAvailableAt: new Date() },
                  });
                }
              } else {
                this.logger.warn(
                  `[Allotment Availability Probe] Rejected live '${resolved.adapter.code}' match for ${ipo.status} IPO ${ipo.id} due to disabled config or conflicting/unknown stored registrar metadata`,
                );
              }
            }
          }
        }
      } catch (err: unknown) {
        this.logger.debug(
          `Best-effort backfill during checkIpoAllotmentAvailability failed for ${ipo.id}: ${(err as Error)?.message || err}`,
        );
      }

      if (storedMetadata?.disabledByConfig) {
        return {
          available: false,
          status: ipo.status,
        };
      }

      if (!needsTimestampBackfill || confirmedByAdapter) {
        return {
          available: true,
          status: ipo.status,
          registrarCode,
        };
      }

      const metadata =
        storedMetadata ?? (await this.inspectStoredRegistrarMetadata(ipo));
      const authoritativeRegistrar = this.reconcileStoredRegistrarMetadata(
        metadata,
        resolvedAdapterCode,
      );
      const isConfirmedNonKfin = Boolean(
        authoritativeRegistrar && authoritativeRegistrar !== 'KFINTECH',
      );

      if (isConfirmedNonKfin) {
        return {
          available: true,
          status: ipo.status,
          registrarCode: registrarCode ?? candidateRegistrarCode,
        };
      }

      return {
        available: false,
        status: ipo.status,
      };
    }

    try {
      const resolved = await this.resolver.resolveAdapter(ipo.id, undefined, {
        requireLiveActiveList: true,
        skipIdentityPersistence: true,
      });
      if (!resolved || !resolved.adapter) {
        return {
          available: false,
          status: ipo.status,
        };
      }

      const { adapter, registrarIpoCode } = resolved;
      const sanitizedConfigCode = sanitizeRegistrarIpoCode(registrarIpoCode);

      if (typeof adapter.resolveRegistrarIpoCode === 'function') {
        const checkRequest: CheckAllotmentRequest = {
          ipoId: ipo.id,
          registrarIpoCode: sanitizedConfigCode,
          identifierType: AllotmentIdentifierType.PAN,
          identifierValue: '',
          companyName: ipo.company.displayName,
          companyLegalName: ipo.company.legalName,
          symbol: ipo.symbol || undefined,
          requireLiveActiveList: true,
        };

        const result = await adapter.resolveRegistrarIpoCode(checkRequest);
        const liveProbeCode = sanitizeRegistrarIpoCode(result);

        if (liveProbeCode) {
          const storedMetadata = await this.inspectStoredRegistrarMetadata(ipo);
          const reconciledRegistrar = this.reconcileStoredRegistrarMetadata(
            storedMetadata,
            adapter.code,
          );

          if (!reconciledRegistrar) {
            this.logger.warn(
              `[Allotment Availability Probe] Rejected pre-allotment live '${adapter.code}' match for IPO ${ipo.id} due to disabled config or conflicting/unknown stored registrar metadata`,
            );
            return {
              available: false,
              status: ipo.status,
            };
          }

          const now = new Date();
          const updatePayload: Prisma.IpoUpdateManyMutationInput = {
            status: IpoStatus.ALLOTMENT_COMPLETED,
          };
          if (!ipo.allotmentResultAvailableAt) {
            updatePayload.allotmentResultAvailableAt = now;
          }

          await this.prisma.ipo.updateMany({
            where: {
              id: ipo.id,
              status: {
                in: [
                  IpoStatus.CLOSED,
                  IpoStatus.ALLOTMENT_PENDING,
                  IpoStatus.OPEN,
                  IpoStatus.CLOSING_TODAY,
                ],
              },
            },
            data: updatePayload,
          });

          const rawConfigCode = ipo.allotmentConfig?.registrarIpoCode?.trim();
          if (liveProbeCode !== rawConfigCode) {
            await this.persistVerifiedRegistrarCode(
              ipo.id,
              adapter.code,
              liveProbeCode,
              'availability probe',
            );
          }

          this.logger.log(
            `[Allotment Availability Probe] Live availability confirmed for IPO '${ipo.company.displayName}' (${ipo.id}). Transitioned to ALLOTMENT_COMPLETED`,
          );

          return {
            available: true,
            status: IpoStatus.ALLOTMENT_COMPLETED,
            registrarCode: liveProbeCode,
          };
        }
      }

      return {
        available: false,
        status: ipo.status,
      };
    } catch (err: unknown) {
      this.logger.warn(
        `Registrar availability probe failed for IPO ${ipo.id}: ${(err as Error)?.message || err}`,
      );
      return {
        available: false,
        status: ipo.status,
      };
    }
  }

  private async persistVerifiedRegistrarCode(
    ipoId: string,
    adapterCode: string,
    registrarCode: string,
    context: string,
  ): Promise<void> {
    if (!isValidRegistrarIpoCode(registrarCode)) {
      return;
    }

    await Promise.resolve(
      this.resolver.persistDiscoveredRegistrarIdentity?.(
        ipoId,
        adapterCode,
        registrarCode,
      ),
    ).catch((persistErr: unknown) => {
      this.logger.debug(
        `Failed to persist registrar identity during ${context} for ${ipoId}: ${(persistErr as Error)?.message || persistErr}`,
      );
    });

    if (this.prisma.ipoAllotmentConfig?.updateMany) {
      await this.prisma.ipoAllotmentConfig.updateMany({
        where: { ipoId },
        data: { registrarIpoCode: registrarCode },
      });
    }
  }

  private inspectStoredRegistrarMetadata(
    ipo: AvailabilityIpoRecord,
  ): Promise<StoredRegistrarMetadata> {
    return inspectStoredRegistrarMetadata(
      ipo,
      this.prisma,
      this.registry,
      this.logger,
    );
  }

  private reconcileStoredRegistrarMetadata(
    metadata: StoredRegistrarMetadata,
    candidateAdapterCode?: string,
  ): string | undefined {
    return reconcileStoredRegistrarMetadata(
      metadata,
      candidateAdapterCode,
      this.registry,
    );
  }

  getSupportedRegistrars() {
    return this.registry.getAll().map((a) => ({
      code: a.code,
      name: a.name,
      supportedIdentifiers: Array.from(a.supportedIdentifiers),
    }));
  }
}
