import { Injectable, Logger } from '@nestjs/common';
import { DocumentType, MarketSegment } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import { isAuthoritativeDocumentUrl } from './sebi.fetcher';
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
   * Supports Mainboard (SEBI), SME (BSE SME & NSE Emerge), and verified issuer-hosted fallback filings.
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

    const companyName = ipo.company.displayName || ipo.company.legalName;
    const companyWebsite = ipo.company.website;

    // 0. For SME IPOs, prioritize authoritative exchange document discovery (BSE SME / NSE Emerge)
    if (ipo.marketSegment === MarketSegment.SME || (ipo.marketSegment as string) === 'SME') {
      const smeDoc = await this.smeMatcher.findSmeOfficialDocument(ipoId);
      if (smeDoc) {
        return smeDoc;
      }
      this.logger.debug(
        `Exchange-hosted SME document not found for '${companyName}'. Falling back to SEBI/Discovery records...`,
      );
    }

    // 1. Check existing IpoDocument linked to this IPO
    // Prioritize PROSPECTUS > RHP > DRHP > OTHER
    const docPriority: Record<DocumentType, number> = {
      PROSPECTUS: 1,
      RHP: 2,
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
      const isIssuer = this.classifyDocMatchSource(primaryDoc.sourceUrl.trim()) === 'ISSUER_MATCH';
      return {
        documentId: primaryDoc.id,
        ipoId: ipo.id,
        companyId: ipo.company.id,
        companyName,
        companyWebsite,
        documentType: primaryDoc.documentType,
        sourceUrl: primaryDoc.sourceUrl.trim(),
        fileName: primaryDoc.fileName ?? undefined,
        matchSource: isIssuer ? 'ISSUER_MATCH' : 'IPO_DOCUMENT',
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
            const docUrl = this.extractFilingUrl(meta, payload, rec.sourceReference);
            if (docUrl && isAuthoritativeDocumentUrl(docUrl, companyWebsite)) {
              const filingType = this.resolveFilingType(meta, docUrl);
              return {
                ipoId: ipo.id,
                companyId: ipo.company.id,
                companyName,
                companyWebsite,
                documentType: filingType,
                sourceUrl: docUrl,
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

    // 3. Check Discovery Records across SEBI and IPOGuru by Normalized Company Name
    const candidateSources = await this.prisma.source.findMany({
      where: { code: { in: [SEBI_SOURCE_CODE, 'IPOGURU', 'ipoguru'] } },
    });

    if (candidateSources.length > 0) {
      const sourceIds = candidateSources.map((s) => s.id);
      const normTarget = this.normalizeName(companyName);
      const recentRecords = await this.prisma.discoveryRecord.findMany({
        where: {
          sourceId: { in: sourceIds },
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
          const docUrl = this.extractFilingUrl(meta, payload, rec.sourceReference);

          if (docUrl && isAuthoritativeDocumentUrl(docUrl, companyWebsite)) {
            const filingType = this.resolveFilingType(meta, docUrl);
            const matchSource = this.classifyDocMatchSource(docUrl);
            return {
              ipoId: ipo.id,
              companyId: ipo.company.id,
              companyName,
              companyWebsite,
              documentType: filingType,
              sourceUrl: docUrl,
              sourceReference: rec.sourceReference ?? undefined,
              filingTitle: meta.filingTitle,
              filingDate: meta.filingDate,
              matchSource,
            };
          }
        }
      }
    }

    return null;
  }

  private extractFilingUrl(
    meta: Record<string, any>,
    payload: Record<string, any>,
    sourceRef?: string | null,
  ): string | null {
    const raw =
      meta.documentUrl ||
      meta.detailUrl ||
      meta.prospectusUrl ||
      meta.rhpUrl ||
      meta.drhpUrl ||
      meta.prospectus_url ||
      meta.rhp_url ||
      meta.drhp_url ||
      meta.drhp_link ||
      meta.rhp_link ||
      meta.prospectus_link ||
      meta.document_url ||
      payload.documentUrl ||
      payload.drhpUrl ||
      payload.rhpUrl ||
      payload.prospectusUrl ||
      sourceRef;

    if (raw && typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
    return null;
  }

  private resolveFilingType(meta: Record<string, any>, url: string): DocumentType {
    const text = `${meta.filingType || ''} ${meta.filingTitle || ''} ${url}`.toUpperCase();
    if (text.includes('PROSPECTUS') && !text.includes('DRAFT') && !text.includes('DRHP')) {
      return DocumentType.PROSPECTUS;
    }
    if (text.includes('RHP') || text.includes('RED HERRING')) {
      return DocumentType.RHP;
    }
    if (text.includes('DRHP') || text.includes('DRAFT')) {
      return DocumentType.DRHP;
    }
    return (meta.filingType as DocumentType) || DocumentType.RHP;
  }

  private classifyDocMatchSource(
    url: string,
  ): MatchedOfficialDocument['matchSource'] {
    const lower = url.toLowerCase();
    if (lower.includes('bseindia') || lower.includes('bsesme') || lower.includes('bse.test')) {
      return 'BSE_SME_MATCH';
    }
    if (lower.includes('nseindia') || lower.includes('nse.test')) {
      return 'NSE_EMERGE_MATCH';
    }
    if (lower.includes('sebi.gov.in') || lower.includes('sebi.test')) {
      return 'NAME_MATCH';
    }
    return 'ISSUER_MATCH';
  }

  private normalizeName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\b(LIMITED|LTD|PRIVATE|PVT|INDIA|CORP|CORPORATION|INC)\b/g, '')
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }
}
