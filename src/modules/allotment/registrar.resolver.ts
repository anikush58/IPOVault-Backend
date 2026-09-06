import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IRegistrarAdapter } from './allotment.types';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';

export interface ResolvedRegistrar {
  adapter: IRegistrarAdapter;
  registrarIpoCode: string;
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
   * Driven by database IpoSourceIdentity records (NEVER guesses an arbitrary registrar).
   */
  async resolveAdapter(
    ipoId: string,
    requestedCode?: string,
  ): Promise<ResolvedRegistrar | undefined> {
    if (requestedCode) {
      const adapter = this.registry.get(requestedCode);
      if (adapter) {
        return { adapter, registrarIpoCode: ipoId };
      }
    }

    // Check if source identity is registered for this IPO in database
    const sourceIdentity = await this.prisma.ipoSourceIdentity.findFirst({
      where: {
        ipoId,
        source: {
          sourceType: 'REGISTRAR',
        },
      },
      include: {
        source: true,
      },
    });

    if (sourceIdentity?.source?.code && sourceIdentity.externalId) {
      const adapter = this.registry.get(sourceIdentity.source.code);
      if (adapter) {
        return {
          adapter,
          registrarIpoCode: sourceIdentity.externalId,
        };
      }
    }

    // No guessing: return undefined when no registrar source identity is mapped
    this.logger.warn(
      `No registered registrar source identity found for IPO ${ipoId}`,
    );
    return undefined;
  }
}
