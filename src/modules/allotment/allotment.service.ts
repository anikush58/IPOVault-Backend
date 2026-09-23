import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../database/prisma.service';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';
import { PurvaRegistrarAdapter } from './adapters/purva-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import {
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from './allotment.types';
import { maskIdentifier } from './allotment.utils';
import { AllotmentRepository } from './allotment.repository';
import { RegistrarResolver } from './registrar.resolver';

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
  ) {
    this.registry.register(this.kfinAdapter);
    this.registry.register(this.mufgIntimeAdapter);
    this.registry.register(this.maashitlaAdapter);
    this.registry.register(this.skylineAdapter);
    this.registry.register(this.purvaAdapter);
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

    request.companyName = (ipo.company as { displayName?: string })?.displayName;
    request.companyLegalName = (ipo.company as { legalName?: string })?.legalName;
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
    request.registrarIpoCode = registrarIpoCode;

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

  getSupportedRegistrars() {
    return this.registry.getAll().map((a) => ({
      code: a.code,
      name: a.name,
      supportedIdentifiers: Array.from(a.supportedIdentifiers),
    }));
  }
}
