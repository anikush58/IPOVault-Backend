import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { DiscoveredIpo, MatchDecision } from './discovery.types';

function canonicalNameKey(name: string): string {
  return name
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9]/g, '');
}

function evaluateSingleIpoMatch(
  existingIpo: {
    id: string;
    symbol: string | null;
    marketSegment: string | null;
    exchange: string | null;
  },
  discovered: DiscoveredIpo,
  companyId: string,
): MatchDecision {
  if (
    discovered.ipo.symbol &&
    existingIpo.symbol &&
    discovered.ipo.symbol.toUpperCase() !== existingIpo.symbol.toUpperCase()
  ) {
    return {
      decision: 'MATCH_COMPANY',
      confidence: 'HIGH',
      companyId,
    };
  }

  if (
    discovered.ipo.marketSegment &&
    existingIpo.marketSegment &&
    discovered.ipo.marketSegment !== existingIpo.marketSegment
  ) {
    return {
      decision: 'MATCH_COMPANY',
      confidence: 'HIGH',
      companyId,
    };
  }

  if (
    discovered.ipo.exchange &&
    existingIpo.exchange &&
    discovered.ipo.exchange !== 'BOTH' &&
    existingIpo.exchange !== 'BOTH' &&
    discovered.ipo.exchange !== existingIpo.exchange
  ) {
    return {
      decision: 'MATCH_COMPANY',
      confidence: 'HIGH',
      companyId,
    };
  }

  return {
    decision: 'MATCH_IPO',
    confidence: 'HIGH',
    ipoId: existingIpo.id,
    companyId,
  };
}

@Injectable()
export class MatchingService {
  constructor(private readonly prisma: PrismaService) {}

  async match(
    discovered: DiscoveredIpo,
    sourceId: string,
  ): Promise<MatchDecision> {
    const externalId = discovered.source.externalId?.trim() || null;
    const cin = discovered.company.cin?.trim() || null;
    const incomingLegalName = discovered.company.legalName?.trim() || '';
    const incomingKey = canonicalNameKey(incomingLegalName);

    // 0. Insufficient identity check (Required Fix 1 & 3)
    if (!cin && !externalId && incomingKey.length === 0) {
      return {
        decision: 'REJECT',
        confidence: 'LOW',
        reason: 'insufficient company identity attributes',
      };
    }

    // 1. Strongest Identifier: External Source Identity mapping
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

    // 2. Strong Identifier: CIN match
    if (cin) {
      const company = await this.prisma.company.findFirst({
        where: { cin },
        include: { ipos: true },
      });

      if (company) {
        const companyIpos = (company as { ipos?: typeof company.ipos }).ipos ?? [];
        if (companyIpos.length === 0) {
          return {
            decision: 'MATCH_COMPANY',
            confidence: 'HIGH',
            companyId: company.id,
          };
        }

        if (companyIpos.length === 1) {
          return evaluateSingleIpoMatch(companyIpos[0], discovered, company.id);
        }

        if (discovered.ipo.symbol) {
          const matchedIpo = companyIpos.find(
            (i) =>
              i.symbol &&
              i.symbol.toUpperCase() === discovered.ipo.symbol?.toUpperCase(),
          );
          if (matchedIpo) {
            return {
              decision: 'MATCH_IPO',
              confidence: 'HIGH',
              ipoId: matchedIpo.id,
              companyId: company.id,
            };
          }
          return {
            decision: 'MATCH_COMPANY',
            confidence: 'HIGH',
            companyId: company.id,
          };
        }

        return {
          decision: 'REJECT',
          confidence: 'MEDIUM',
          reason: 'ambiguous IPO match for company with multiple IPOs',
        };
      }
    }

    // 3. Fallback: Normalized Company Name + Supporting IPO attributes
    if (incomingKey.length > 0) {
      const allCompanies = await this.prisma.company.findMany({
        include: { ipos: true },
      });

      const matchingCompanies = allCompanies.filter((c) => {
        const legalKey = canonicalNameKey(c.legalName);
        const displayKey = c.displayName ? canonicalNameKey(c.displayName) : '';
        return (
          (legalKey.length > 0 && legalKey === incomingKey) ||
          (displayKey.length > 0 && displayKey === incomingKey)
        );
      });

      if (matchingCompanies.length > 1) {
        return {
          decision: 'REJECT',
          confidence: 'MEDIUM',
          reason: 'ambiguous company match: multiple companies share normalized name',
        };
      }

      if (matchingCompanies.length === 1) {
        const company = matchingCompanies[0];

        if (company.ipos.length === 0) {
          return {
            decision: 'MATCH_COMPANY',
            confidence: 'HIGH',
            companyId: company.id,
          };
        }

        if (company.ipos.length === 1) {
          return evaluateSingleIpoMatch(company.ipos[0], discovered, company.id);
        }

        if (discovered.ipo.symbol) {
          const matchedIpo = company.ipos.find(
            (i) =>
              i.symbol &&
              i.symbol.toUpperCase() === discovered.ipo.symbol?.toUpperCase(),
          );
          if (matchedIpo) {
            return {
              decision: 'MATCH_IPO',
              confidence: 'HIGH',
              ipoId: matchedIpo.id,
              companyId: company.id,
            };
          }
          return {
            decision: 'MATCH_COMPANY',
            confidence: 'HIGH',
            companyId: company.id,
          };
        }

        return {
          decision: 'REJECT',
          confidence: 'MEDIUM',
          reason: 'ambiguous IPO match for matched company',
        };
      }
    }

    // 4. Rule C: Symbol alone must never merge a different company
    if (discovered.ipo.symbol) {
      const existingIpoWithSymbol = await this.prisma.ipo.findFirst({
        where: { symbol: discovered.ipo.symbol },
        include: { company: true },
      });

      if (existingIpoWithSymbol) {
        const existingNameKey = canonicalNameKey(
          existingIpoWithSymbol.company.legalName,
        );
        if (incomingKey.length === 0 || existingNameKey !== incomingKey) {
          return {
            decision: 'REJECT',
            confidence: 'LOW',
            reason: 'symbol matches existing IPO but company name differs',
          };
        }
      }
    }

    // 5. Unambiguous new record creation
    return { decision: 'CREATE', confidence: 'HIGH' };
  }
}
