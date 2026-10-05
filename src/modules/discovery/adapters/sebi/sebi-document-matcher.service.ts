import { Injectable, Logger } from '@nestjs/common';
import { DocumentType, MarketSegment } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import { SEBI_SOURCE_CODE } from '../source-adapter';
import { MatchedOfficialDocument } from './sebi-section.types';
import { SmeDocumentMatcherService } from './sme-document-matcher.service';

@Injectable()
export class SebiDocumentMatcherService {
  private readonly logger = new Logger(SebiDocumentMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smeMatcher: SmeDocumentMatcherService,
  ) {}

  /**
   * Matches a canonical IPO to its authoritative official document (RHP / DRHP / Prospectus).
   * Supports both Mainboard (SEBI) and SME (BSE SME & NSE Emerge).
   */
  async findOfficialDocumentForIpo(
    ipoId: string,
  ): Promise<MatchedOfficialDocument | null> {
    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
      include: {
        company: true,
        documents: true,
        sourceIdentities: {
          include: { source: true },
        },
      },
    });

    if (!ipo) {
      this.logger.warn(`IPO with ID '${ipoId}' not found for document matching`);
      return null;
    }

    // 0. For SME IPOs, prioritize authoritative exchange document discovery (BSE SME / NSE Emerge)
    if (ipo.marketSegment === MarketSegment.SME || (ipo.marketSegment as string) === 'SME') {
      const smeDoc = await this.smeMatcher.findSmeOfficialDocument(ipoId);
      if (smeDoc) {
        return smeDoc;
      }
      this.logger.debug(
        `Exchange-hosted SME document not found for '${ipo.company.displayName || ipo.company.legalName}'. Falling back to SEBI records...`,
      );
    }

    const companyName = ipo.company.displayName || ipo.company.legalName;

    // 1. Check existing IpoDocument linked to this IPO
    // Prioritize RHP > PROSPECTUS > DRHP > OTHER
    const docPriority: Record<DocumentType, number> = {
      RHP: 1,
      PROSPECTUS: 2,
      DRHP: 3,
      ANCHOR_LIST: 4,
      BASIS_OF_ALLOTMENT: 5,
      OTHER: 6,
    };

    const validDocs = (ipo.documents ?? [])
      .filter((d) => d.sourceUrl && d.sourceUrl.trim().length > 0)
      .sort(
        (a, b) =>
          (docPriority[a.documentType] ?? 99) -
          (docPriority[b.documentType] ?? 99),
      );

    const primaryDoc = validDocs[0];
    if (primaryDoc && primaryDoc.sourceUrl) {
      return {
        documentId: primaryDoc.id,
        ipoId: ipo.id,
        companyId: ipo.company.id,
        companyName,
        documentType: primaryDoc.documentType,
        sourceUrl: primaryDoc.sourceUrl.trim(),
        fileName: primaryDoc.fileName ?? undefined,
        matchSource: 'IPO_DOCUMENT',
      };
    }

    // 2. Check SEBI Discovery Records for this Company CIN
    if (ipo.company.cin && ipo.company.cin.trim().length > 0) {
      const sebiSource = await this.prisma.source.findUnique({
        where: { code: SEBI_SOURCE_CODE },
      });

      if (sebiSource) {
        const cinRecords = await this.prisma.discoveryRecord.findMany({
          where: {
            sourceId: sebiSource.id,
          },
          orderBy: { discoveredAt: 'desc' },
          take: 50,
        });

        for (const rec of cinRecords) {
          const payload = (rec.rawPayload as Record<string, any>) || {};
          const meta = payload.source ? payload : (rec.rawPayload as Record<string, any>);
          const payloadCin = (payload.cin?.value || payload.company?.cin || meta.cin) as string | undefined;

          if (
            payloadCin &&
            payloadCin.toUpperCase().trim() === ipo.company.cin.toUpperCase().trim()
          ) {
            const docUrl =
              meta.documentUrl || meta.detailUrl || rec.sourceReference;
            if (docUrl && typeof docUrl === 'string' && docUrl.trim().length > 0) {
              const filingType = (meta.filingType as DocumentType) || 'RHP';
              return {
                ipoId: ipo.id,
                companyId: ipo.company.id,
                companyName,
                documentType: filingType,
                sourceUrl: docUrl.trim(),
                sourceReference: rec.sourceReference ?? undefined,
                filingTitle: meta.filingTitle,
                filingDate: meta.filingDate,
                matchSource: 'CIN_MATCH',
              };
            }
          }
        }
      }
    }

    // 3. Check SEBI Discovery Records by Normalized Company Name
    const sebiSource = await this.prisma.source.findUnique({
      where: { code: SEBI_SOURCE_CODE },
    });

    if (sebiSource) {
      const normTarget = this.normalizeName(companyName);
      const recentRecords = await this.prisma.discoveryRecord.findMany({
        where: {
          sourceId: sebiSource.id,
        },
        orderBy: { discoveredAt: 'desc' },
        take: 100,
      });

      for (const rec of recentRecords) {
        const recName = rec.companyName || '';
        const normRec = this.normalizeName(recName);

        if (
          normRec.length > 3 &&
          (normTarget.includes(normRec) || normRec.includes(normTarget))
        ) {
          const payload = (rec.rawPayload as Record<string, any>) || {};
          const meta = payload.source ? payload : (rec.rawPayload as Record<string, any>);
          const docUrl =
            meta.documentUrl || meta.detailUrl || rec.sourceReference;

          if (docUrl && typeof docUrl === 'string' && docUrl.trim().length > 0) {
            const filingType = (meta.filingType as DocumentType) || 'RHP';
            return {
              ipoId: ipo.id,
              companyId: ipo.company.id,
              companyName,
              documentType: filingType,
              sourceUrl: docUrl.trim(),
              sourceReference: rec.sourceReference ?? undefined,
              filingTitle: meta.filingTitle,
              filingDate: meta.filingDate,
              matchSource: 'NAME_MATCH',
            };
          }
        }
      }
    }

    return null;
  }

  private normalizeName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA|CORP|CORPORATION|INC)\b/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }
}
