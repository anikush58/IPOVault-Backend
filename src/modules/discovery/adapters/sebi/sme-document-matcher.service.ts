import { Injectable, Logger } from '@nestjs/common';
import { DocumentType } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import { isAuthoritativeDocumentUrl } from './sebi.fetcher';
import { MatchedOfficialDocument } from './sebi-section.types';

export const BSE_SME_SOURCE_CODE = 'bse_sme';
export const BSE_SOURCE_CODE = 'bse';
export const NSE_EMERGE_SOURCE_CODE = 'nse_emerge';
export const NSE_SOURCE_CODE = 'nse';
export const SEBI_SOURCE_CODE = 'sebi';

const DOC_TYPE_RANK: Record<DocumentType, number> = {
  PROSPECTUS: 1,
  RHP: 2,
  DRHP: 3,
  ANCHOR_LIST: 4,
  BASIS_OF_ALLOTMENT: 5,
  OTHER: 6,
};

@Injectable()
export class SmeDocumentMatcherService {
  private readonly logger = new Logger(SmeDocumentMatcherService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Discovers the authoritative official prospectus for an SME IPO (BSE SME or NSE Emerge).
   *
   * Enforces:
   * 1. Automatic exchange identification from IPO metadata
   * 2. Authoritative filing preference: PROSPECTUS > RHP > DRHP
   * 3. Ambiguity rejection (rejects multiple overlapping candidates for different companies)
   * 4. Strict domain whitelisting (bseindia.com, bsesme.com, nseindia.com)
   * 5. Zero hardcoding of IPO URLs
   */
  async findSmeOfficialDocument(ipoId: string): Promise<MatchedOfficialDocument | null> {
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
      this.logger.warn(`IPO '${ipoId}' not found for SME document discovery`);
      return null;
    }

    const companyName = ipo.company.displayName || ipo.company.legalName;
    const companyWebsite = ipo.company.website;

    // 1. Check existing IpoDocument linked to this IPO with authoritative exchange URL or verified issuer URL
    const validDocs = (ipo.documents ?? [])
      .filter(
        (d) =>
          d.sourceUrl &&
          d.sourceUrl.trim().length > 0 &&
          isAuthoritativeDocumentUrl(d.sourceUrl.trim(), companyWebsite),
      )
      .sort(
        (a, b) =>
          (DOC_TYPE_RANK[a.documentType] ?? 99) -
          (DOC_TYPE_RANK[b.documentType] ?? 99),
      );

    const primaryDoc = validDocs[0];
    if (primaryDoc && primaryDoc.sourceUrl) {
      const matchSource = this.classifyExchangeSource(primaryDoc.sourceUrl);
      return {
        documentId: primaryDoc.id,
        ipoId: ipo.id,
        companyId: ipo.company.id,
        companyName,
        companyWebsite,
        documentType: primaryDoc.documentType,
        sourceUrl: primaryDoc.sourceUrl.trim(),
        fileName: primaryDoc.fileName ?? undefined,
        matchSource,
      };
    }

    // 2. Identify target exchange(s) from IPO metadata
    const targetSourceCodes = this.determineTargetSources(ipo);

    // 3. Search Discovery Records for matching sources
    const sources = await this.prisma.source.findMany({
      where: { code: { in: targetSourceCodes } },
    });

    if (sources.length === 0) {
      this.logger.debug(
        `No configured sources found for codes [${targetSourceCodes.join(', ')}]`,
      );
    }

    const sourceIds = sources.map((s) => s.id);

    // Fetch candidate discovery records
    const candidateRecords = await this.prisma.discoveryRecord.findMany({
      where: {
        sourceId: { in: sourceIds },
      },
      orderBy: { discoveredAt: 'desc' },
      take: 200,
    });

    // 4. A: Try CIN Match
    if (ipo.company.cin && ipo.company.cin.trim().length > 0) {
      const targetCin = ipo.company.cin.toUpperCase().trim();
      for (const rec of candidateRecords) {
        const payload = (rec.rawPayload as Record<string, any>) || {};
        const meta = payload.source ? payload : (rec.rawPayload as Record<string, any>);
        const payloadCin = (
          payload.cin?.value ||
          payload.company?.cin ||
          meta.cin
        ) as string | undefined;

        if (payloadCin && payloadCin.toUpperCase().trim() === targetCin) {
          const docUrl = this.extractDocUrl(meta, payload, rec.sourceReference);

          if (
            docUrl &&
            isAuthoritativeDocumentUrl(docUrl, companyWebsite)
          ) {
            const filingType = this.resolveFilingType(meta, docUrl);
            return {
              ipoId: ipo.id,
              companyId: ipo.company.id,
              companyName,
              companyWebsite,
              documentType: filingType,
              sourceUrl: docUrl,
              sourceReference: rec.sourceReference ?? undefined,
              filingTitle: meta.filingTitle || meta.issueName,
              filingDate: meta.filingDate || meta.issueStartDate,
              matchSource: 'CIN_MATCH',
            };
          }
        }
      }
    }

    // 4. B: Try Symbol / Scrip Code Match
    const symbols = [
      ipo.symbol,
      ipo.bseSymbol,
      ipo.nseSymbol,
      ipo.company.displayName,
    ]
      .filter((s): s is string => !!s && s.trim().length > 1)
      .map((s) => s.toUpperCase().trim());

    if (symbols.length > 0) {
      for (const rec of candidateRecords) {
        const payload = (rec.rawPayload as Record<string, any>) || {};
        const meta = payload.source ? payload : (rec.rawPayload as Record<string, any>);
        const recSymbol = (
          rec.externalId ||
          payload.symbol?.value ||
          payload.ipo?.symbol ||
          meta.symbol ||
          meta.scripCode ||
          meta.securityId
        ) as string | undefined;

        if (recSymbol && symbols.includes(recSymbol.toUpperCase().trim())) {
          const docUrl = this.extractDocUrl(meta, payload, rec.sourceReference);

          if (
            docUrl &&
            isAuthoritativeDocumentUrl(docUrl, companyWebsite)
          ) {
            const filingType = this.resolveFilingType(meta, docUrl);
            const matchSource = this.classifyExchangeSource(docUrl);
            return {
              ipoId: ipo.id,
              companyId: ipo.company.id,
              companyName,
              companyWebsite,
              documentType: filingType,
              sourceUrl: docUrl,
              sourceReference: rec.sourceReference ?? undefined,
              filingTitle: meta.filingTitle || meta.issueName,
              filingDate: meta.filingDate || meta.issueStartDate,
              matchSource,
            };
          }
        }
      }
    }

    // 4. C: Normalized Company Name Matching with Ambiguity Rejection
    const normTarget = this.normalizeCompanyName(companyName);
    if (normTarget.length < 3) {
      return null;
    }

    const matchedCandidates: Array<{
      score: number;
      normalizedRecName: string;
      docUrl: string;
      filingType: DocumentType;
      rec: typeof candidateRecords[0];
      meta: Record<string, any>;
    }> = [];

    for (const rec of candidateRecords) {
      const recName = rec.companyName || '';
      const normRec = this.normalizeCompanyName(recName);
      if (normRec.length < 3) continue;

      const score = this.calculateNameSimilarity(normTarget, normRec);
      if (score >= 0.8) {
        const payload = (rec.rawPayload as Record<string, any>) || {};
        const meta = payload.source ? payload : (rec.rawPayload as Record<string, any>);
        const docUrl = this.extractDocUrl(meta, payload, rec.sourceReference);

        if (
          docUrl &&
          isAuthoritativeDocumentUrl(docUrl, companyWebsite)
        ) {
          const filingType = this.resolveFilingType(meta, docUrl);
          matchedCandidates.push({
            score,
            normalizedRecName: normRec,
            docUrl,
            filingType,
            rec,
            meta,
          });
        }
      }
    }

    if (matchedCandidates.length === 0) {
      return null;
    }

    // Check for Ambiguity: Are there multiple DISTINCT companies matching with high score?
    const uniqueDistinctCompanies = new Set(
      matchedCandidates.map((c) => c.normalizedRecName),
    );

    if (uniqueDistinctCompanies.size > 1) {
      // If the top score candidate is strictly dominant (> 0.95 and second < 0.85), accept top
      matchedCandidates.sort((a, b) => b.score - a.score);
      const top = matchedCandidates[0];
      const second = matchedCandidates[1];

      if (top.score < 0.95 || (second && top.score - second.score < 0.15)) {
        this.logger.warn(
          `Ambiguous SME document matches detected for '${companyName}' across [${Array.from(uniqueDistinctCompanies).join(', ')}]. Rejecting match for safety.`,
        );
        return null;
      }
    }

    // Sort matching documents for the same company by priority: PROSPECTUS > RHP > DRHP
    matchedCandidates.sort((a, b) => {
      const rankA = DOC_TYPE_RANK[a.filingType] ?? 99;
      const rankB = DOC_TYPE_RANK[b.filingType] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return b.score - a.score;
    });

    const best = matchedCandidates[0];
    const matchSource = this.classifyExchangeSource(best.docUrl);

    return {
      ipoId: ipo.id,
      companyId: ipo.company.id,
      companyName,
      companyWebsite,
      documentType: best.filingType,
      sourceUrl: best.docUrl,
      sourceReference: best.rec.sourceReference ?? undefined,
      filingTitle: best.meta.filingTitle || best.meta.issueName,
      filingDate: best.meta.filingDate || best.meta.issueStartDate,
      matchSource,
    };
  }

  private extractDocUrl(
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

  /**
   * Determines the priority source codes to search based on IPO exchange metadata.
   */
  private determineTargetSources(ipo: {
    exchange?: string;
    bseSymbol?: string | null;
    nseSymbol?: string | null;
  }): string[] {
    const exchange = ipo.exchange?.toUpperCase() || '';
    if (exchange === 'BSE' || (ipo.bseSymbol && !ipo.nseSymbol)) {
      return [
        BSE_SME_SOURCE_CODE,
        BSE_SOURCE_CODE,
        NSE_EMERGE_SOURCE_CODE,
        NSE_SOURCE_CODE,
        SEBI_SOURCE_CODE,
        'IPOGURU',
        'ipoguru',
      ];
    }
    if (exchange === 'NSE' || (ipo.nseSymbol && !ipo.bseSymbol)) {
      return [
        NSE_EMERGE_SOURCE_CODE,
        NSE_SOURCE_CODE,
        BSE_SME_SOURCE_CODE,
        BSE_SOURCE_CODE,
        SEBI_SOURCE_CODE,
        'IPOGURU',
        'ipoguru',
      ];
    }
    // BOTH or unspecified: check NSE, BSE, SEBI, then IPOGuru
    return [
      NSE_EMERGE_SOURCE_CODE,
      BSE_SME_SOURCE_CODE,
      NSE_SOURCE_CODE,
      BSE_SOURCE_CODE,
      SEBI_SOURCE_CODE,
      'IPOGURU',
      'ipoguru',
    ];
  }

  /**
   * Resolves the DocumentType from metadata and URL hints.
   */
  private resolveFilingType(meta: Record<string, any>, url: string): DocumentType {
    const text = `${meta.filingType || ''} ${meta.filingTitle || ''} ${meta.issueName || ''} ${url}`.toUpperCase();
    if (text.includes('PROSPECTUS') && !text.includes('DRAFT') && !text.includes('DRHP')) {
      return 'PROSPECTUS';
    }
    if (text.includes('RHP') || text.includes('RED HERRING')) {
      return 'RHP';
    }
    if (text.includes('DRHP') || text.includes('DRAFT')) {
      return 'DRHP';
    }
    return 'PROSPECTUS';
  }

  /**
   * Classifies matchSource by URL domain.
   */
  private classifyExchangeSource(
    url: string,
  ): 'BSE_SME_MATCH' | 'NSE_EMERGE_MATCH' | 'EXCHANGE_MATCH' | 'ISSUER_MATCH' {
    const lower = url.toLowerCase();
    if (lower.includes('bseindia') || lower.includes('bsesme') || lower.includes('bse.test')) {
      return 'BSE_SME_MATCH';
    }
    if (lower.includes('nseindia') || lower.includes('nse.test')) {
      return 'NSE_EMERGE_MATCH';
    }
    return 'ISSUER_MATCH';
  }

  /**
   * Normalizes company name for robust token-level matching.
   */
  public normalizeCompanyName(name: string): string {
    return name
      .toUpperCase()
      .replace(
        /\b(LIMITED|LTD|PRIVATE|PVT|INDIA|CORP|CORPORATION|INC|LLP|HOLDINGS|HOLDING|ENTERPRISES|ENTERPRISE|SERVICES|SERVICE|INDUSTRIES|INDUSTRY|SOLUTIONS|TECHNOLOGIES|TECH|COMPANY|CO)\b/g,
        '',
      )
      .replace(/[^A-Z0-9]/g, '')
      .trim();
  }

  /**
   * Calculates similarity between normalized company names.
   */
  public calculateNameSimilarity(target: string, candidate: string): number {
    if (target === candidate) return 1.0;
    if (target.length === 0 || candidate.length === 0) return 0.0;

    // Substring match
    if (target.includes(candidate) || candidate.includes(target)) {
      const minLen = Math.min(target.length, candidate.length);
      const maxLen = Math.max(target.length, candidate.length);
      return minLen / maxLen >= 0.7 ? 0.9 : 0.8;
    }

    // Bigram Dice similarity
    const targetBigrams = this.toBigrams(target);
    const candidateBigrams = this.toBigrams(candidate);

    let intersection = 0;
    for (const bg of targetBigrams) {
      if (candidateBigrams.has(bg)) {
        intersection++;
      }
    }

    const total = targetBigrams.size + candidateBigrams.size;
    return total > 0 ? (2.0 * intersection) / total : 0.0;
  }

  private toBigrams(str: string): Set<string> {
    const set = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      set.add(str.slice(i, i + 2));
    }
    return set;
  }
}
