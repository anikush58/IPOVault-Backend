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
   * Driven by database IpoSourceIdentity records with fallback resolution by symbol/company name.
   */
  async resolveAdapter(
    ipoId: string,
    requestedCode?: string,
  ): Promise<ResolvedRegistrar | undefined> {
    // 1. Check direct match or flexible symbol/company name match in database
    const sourceIdentity = await this.prisma.ipoSourceIdentity.findFirst({
      where: {
        OR: [
          { ipoId },
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
        ],
        source: {
          sourceType: 'REGISTRAR',
          ...(requestedCode ? { code: requestedCode } : {}),
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

    // Return undefined when no registrar source identity is mapped
    this.logger.warn(
      `No registered registrar source identity found for IPO ${ipoId}`,
    );
    return undefined;
  }
}
