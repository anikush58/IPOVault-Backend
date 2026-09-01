import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { DiscoveredIpo, MatchDecision } from './discovery.types';

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async match(
    discovered: DiscoveredIpo,
    sourceId: string,
  ): Promise<MatchDecision> {
    const externalId = discovered.source.externalId;

    if (externalId) {
      const identity = await this.prisma.ipoSourceIdentity.findFirst({
        where: { sourceId, externalId },
        include: { ipo: true },
      });

      if (identity) {
        return {
          decision: 'MATCH_IPO',
          confidence: 'HIGH',
          ipoId: identity.ipoId,
          companyId: identity.ipo.companyId,
        };
      }
    }

    if (discovered.company.cin) {
      const company = await this.prisma.company.findFirst({
        where: { cin: discovered.company.cin },
      });

      if (company) {
        const ipoCount = await this.prisma.ipo.count({
          where: { companyId: company.id },
        });

        if (ipoCount === 0) {
          return {
            decision: 'MATCH_COMPANY',
            confidence: 'HIGH',
            companyId: company.id,
          };
        }

        return {
          decision: 'REJECT',
          confidence: 'MEDIUM',
          reason: 'insufficient IPO identity',
        };
      }
    }

    if (!discovered.company.cin && !externalId) {
      return {
        decision: 'REJECT',
        confidence: 'LOW',
        reason: 'insufficient match confidence',
      };
    }

    return { decision: 'CREATE', confidence: 'HIGH' };
  }
}
