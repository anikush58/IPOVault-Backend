import { Injectable, Logger } from '@nestjs/common';
import { IpoStatus, ParticipantRole } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { EnrichableField, MissingFieldReport } from './enrichment.types';

@Injectable()
export class MissingFieldDetectorService {
  private readonly logger = new Logger(MissingFieldDetectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Detects genuinely missing or incomplete fields for an IPO and its associated Company.
   */
  async detect(ipoId: string): Promise<MissingFieldReport | null> {
    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: {
        company: {
          include: {
            financials: true,
          },
        },
        participants: true,
        documents: true,
      },
    });

    if (!ipo) {
      this.logger.warn(`IPO '${ipoId}' not found for missing-field detection`);
      return null;
    }

    const missingFields: EnrichableField[] = [];
    const company = ipo.company;

    // 1. Company Overview
    if (!company.aboutDescription || company.aboutDescription.trim() === '') {
      missingFields.push('aboutDescription');
    }

    // 2. Sector & Industry
    if (!company.sector || company.sector.trim() === '') {
      missingFields.push('sector');
    }
    if (!company.industry || company.industry.trim() === '') {
      missingFields.push('industry');
    }

    // 3. Multi-year Financial History (Expect at least 2 annual fiscal periods)
    const annualFinancials = (company.financials ?? []).filter(
      (f) => f.periodType === 'ANNUAL' || !f.periodType,
    );
    if (annualFinancials.length < 2) {
      missingFields.push('financials');
    }

    // 4. Strengths & Key Risks
    const rhpDoc = ipo.documents.find(
      (d) => d.documentType === 'RHP' || d.documentType === 'DRHP',
    );
    const rhpExt = (rhpDoc?.extractionData as Record<string, any>) || {};
    const hasStrengthsOrRisks =
      Array.isArray(rhpExt.strengths) &&
      rhpExt.strengths.length > 0 &&
      Array.isArray(rhpExt.risks) &&
      rhpExt.risks.length > 0;
    if (!hasStrengthsOrRisks) {
      missingFields.push('strengthsAndRisks');
    }

    // 5. Valuation (Pre / Post IPO P/E)
    if (ipo.preIpoPe === null && ipo.postIpoPe === null) {
      missingFields.push('preIpoPe');
      missingFields.push('postIpoPe');
    }

    // 6. Promoter Shareholding
    if (
      ipo.preIpoPromoterHolding === null &&
      ipo.postIpoPromoterHolding === null
    ) {
      missingFields.push('preIpoPromoterHolding');
      missingFields.push('postIpoPromoterHolding');
    }

    // 7. Issue Share Composition (Fresh vs OFS)
    if (
      ipo.issueSize !== null &&
      ipo.freshIssueShareCount === null &&
      ipo.ofsShareCount === null
    ) {
      missingFields.push('freshIssueShareCount');
      missingFields.push('ofsShareCount');
    }

    // 8. Issue Size Composition (Fresh vs OFS INR)
    if (
      ipo.issueSize !== null &&
      ipo.freshIssueSize === null &&
      ipo.ofsSize === null
    ) {
      missingFields.push('freshIssueSize');
      missingFields.push('ofsSize');
    }

    // 9. Lead Managers (BRLMs)
    const leadManagers = (ipo.participants ?? []).filter(
      (p) =>
        p.role === ParticipantRole.BRLM || p.role === ParticipantRole.CO_BRLM,
    );
    if (leadManagers.length === 0) {
      missingFields.push('leadManagers');
    }

    // 10. Anchor Information (Mainboard IPOs)
    if (ipo.marketSegment === 'MAINBOARD') {
      const anchorDoc = ipo.documents.find(
        (d) => d.documentType === 'ANCHOR_LIST',
      );
      const anchorExt = (anchorDoc?.extractionData as Record<string, any>) || {};
      const hasAnchorInfo =
        anchorDoc && (anchorExt.anchorInvestors || anchorExt.portion || anchorExt.details);
      if (!hasAnchorInfo) {
        missingFields.push('anchorDetails');
      }
    }

    return {
      ipoId: ipo.id,
      companyId: company.id,
      companyName: company.displayName || company.legalName,
      missingFields,
      hasMissingFields: missingFields.length > 0,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Identifies existing IPOs eligible for backfill enrichment.
   */
  async findIposEligibleForEnrichment(limit = 20): Promise<string[]> {
    const eligibleIpos = await this.prisma.ipo.findMany({
      where: {
        status: {
          notIn: [IpoStatus.CANCELLED, IpoStatus.WITHDRAWN],
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: limit * 2,
    });

    const results: string[] = [];
    for (const item of eligibleIpos) {
      const report = await this.detect(item.id);
      if (report && report.hasMissingFields) {
        results.push(item.id);
        if (results.length >= limit) break;
      }
    }

    return results;
  }
}
