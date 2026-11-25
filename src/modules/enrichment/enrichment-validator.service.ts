import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  AiExtractedIpoData,
  ExtractedFinancialPeriod,
} from './enrichment.types';
import { sanitizeAndNormalizeRegistrar } from './registrar-extractor.util';

export interface ValidatedEnrichmentPayload {
  aboutDescription?: string | null;
  sector?: string | null;
  industry?: string | null;
  strengths?: string[];
  risks?: string[];
  financials?: ExtractedFinancialPeriod[];
  preIpoPe?: number | null;
  postIpoPe?: number | null;
  preIpoPromoterHolding?: number | null;
  postIpoPromoterHolding?: number | null;
  freshIssueShareCount?: number | null;
  ofsShareCount?: number | null;
  freshIssueSize?: number | null;
  ofsSize?: number | null;
  leadManagers?: string[];
  registrar?: string | null;
  anchorDetails?: any;
  derivedMetrics?: {
    revenueCagrPct?: number | null;
    patCagrPct?: number | null;
    yearsAnalyzed?: number;
  };
  validationWarnings: string[];
}

@Injectable()
export class EnrichmentValidatorService {
  private readonly logger = new Logger(EnrichmentValidatorService.name);

  /**
   * Calculates compound annual growth rate deterministically.
   */
  public calculateCagr(
    startVal: number,
    endVal: number,
    periods: number,
  ): number | null {
    if (startVal <= 0 || endVal <= 0 || periods <= 0) {
      return null;
    }
    const cagr = (Math.pow(endVal / startVal, 1 / periods) - 1) * 100;
    return !isNaN(cagr) && isFinite(cagr) ? Number(cagr.toFixed(2)) : null;
  }

  /**
   * Performs rigorous deterministic validation and calculates derived metrics.
   */
  validate(
    extracted: AiExtractedIpoData,
    existingIpo?: {
      issueSize?: Prisma.Decimal | number | null;
      issueShareCount?: Prisma.Decimal | number | null;
    },
  ): ValidatedEnrichmentPayload {
    const warnings: string[] = [];
    const result: ValidatedEnrichmentPayload = {
      validationWarnings: warnings,
    };

    // 1. Text Fields Sanitization
    if (extracted.aboutDescription && typeof extracted.aboutDescription === 'string') {
      const clean = this.sanitizeText(extracted.aboutDescription);
      if (clean.length > 20) {
        result.aboutDescription = clean.slice(0, 3000);
      }
    }

    if (extracted.sector && typeof extracted.sector === 'string') {
      const clean = this.sanitizeText(extracted.sector);
      if (clean.length > 2) {
        result.sector = clean.slice(0, 100);
      }
    }

    if (extracted.industry && typeof extracted.industry === 'string') {
      const clean = this.sanitizeText(extracted.industry);
      if (clean.length > 2) {
        result.industry = clean.slice(0, 100);
      }
    }

    // 2. Strengths & Risks (Max 5 bullets each, max 250 chars per bullet)
    if (Array.isArray(extracted.strengths) && extracted.strengths.length > 0) {
      result.strengths = extracted.strengths
        .map((s) => this.sanitizeText(s))
        .filter((s) => s.length > 5)
        .slice(0, 5)
        .map((s) => s.slice(0, 250));
    }

    if (Array.isArray(extracted.risks) && extracted.risks.length > 0) {
      result.risks = extracted.risks
        .map((r) => this.sanitizeText(r))
        .filter((r) => r.length > 5)
        .slice(0, 5)
        .map((r) => r.slice(0, 250));
    }

    // 3. Multi-year Financials & Backend CAGR Calculation
    if (Array.isArray(extracted.financials) && extracted.financials.length > 0) {
      const validFinancials: ExtractedFinancialPeriod[] = [];

      for (const fin of extracted.financials) {
        if (!fin.fiscalPeriod || typeof fin.fiscalPeriod !== 'string') continue;

        const period = fin.fiscalPeriod.toUpperCase().trim();
        const totalRevenue = fin.totalRevenue != null && fin.totalRevenue >= 0 ? Number(fin.totalRevenue) : null;
        const pat = fin.pat != null ? Number(fin.pat) : null;
        const ebitda = fin.ebitda != null ? Number(fin.ebitda) : null;
        const netWorth = fin.netWorth != null ? Number(fin.netWorth) : null;
        const totalAssets = fin.totalAssets != null ? Number(fin.totalAssets) : null;
        const eps = fin.eps != null ? Number(fin.eps) : null;
        const roe = fin.roePercentage != null && fin.roePercentage >= 0 && fin.roePercentage <= 100 ? Number(fin.roePercentage) : null;
        const roce = fin.rocePercentage != null && fin.rocePercentage >= 0 && fin.rocePercentage <= 100 ? Number(fin.rocePercentage) : null;

        validFinancials.push({
          fiscalPeriod: period,
          periodType: fin.periodType || 'ANNUAL',
          totalRevenue,
          pat,
          ebitda,
          netWorth,
          totalAssets,
          eps,
          roePercentage: roe,
          rocePercentage: roce,
        });
      }

      if (validFinancials.length > 0) {
        // Sort chronologically ascending
        validFinancials.sort((a, b) => a.fiscalPeriod.localeCompare(b.fiscalPeriod));
        result.financials = validFinancials;

        // Calculate Deterministic CAGR in backend code
        const annuals = validFinancials.filter((f) => f.periodType === 'ANNUAL' || !f.periodType);
        if (annuals.length >= 2) {
          const earliest = annuals[0];
          const latest = annuals[annuals.length - 1];
          const periods = annuals.length - 1;

          let revCagr: number | null = null;
          if (
            earliest.totalRevenue != null &&
            latest.totalRevenue != null &&
            earliest.totalRevenue > 0 &&
            latest.totalRevenue > 0
          ) {
            revCagr = this.calculateCagr(earliest.totalRevenue, latest.totalRevenue, periods);
          }

          let patCagr: number | null = null;
          if (
            earliest.pat != null &&
            latest.pat != null &&
            earliest.pat > 0 &&
            latest.pat > 0
          ) {
            patCagr = this.calculateCagr(earliest.pat, latest.pat, periods);
          }

          result.derivedMetrics = {
            revenueCagrPct: revCagr,
            patCagrPct: patCagr,
            yearsAnalyzed: annuals.length,
          };
        }
      }
    }

    // 4. Valuation (P/E ratios)
    if (extracted.preIpoPe != null && extracted.preIpoPe > 0 && extracted.preIpoPe < 1000) {
      result.preIpoPe = Number(extracted.preIpoPe.toFixed(2));
    }
    if (extracted.postIpoPe != null && extracted.postIpoPe > 0 && extracted.postIpoPe < 1000) {
      result.postIpoPe = Number(extracted.postIpoPe.toFixed(2));
    }

    // 5. Promoter Holding & Invariant Checks
    const preHold = extracted.preIpoPromoterHolding;
    const postHold = extracted.postIpoPromoterHolding;

    if (preHold != null && preHold >= 0 && preHold <= 100) {
      result.preIpoPromoterHolding = Number(preHold.toFixed(2));
    }
    if (postHold != null && postHold >= 0 && postHold <= 100) {
      result.postIpoPromoterHolding = Number(postHold.toFixed(2));
    }

    if (result.preIpoPromoterHolding != null && result.postIpoPromoterHolding != null) {
      // Invariant: In an IPO dilution, pre-IPO holding must be >= post-IPO holding
      if (result.preIpoPromoterHolding < result.postIpoPromoterHolding) {
        warnings.push(
          `Promoter holding invariant violated: pre (${result.preIpoPromoterHolding}%) < post (${result.postIpoPromoterHolding}%). Discarding promoter holding.`,
        );
        result.preIpoPromoterHolding = null;
        result.postIpoPromoterHolding = null;
      }
    }

    // 6. Share counts & Issue Size Reconciliation
    if (extracted.freshIssueShareCount != null && extracted.freshIssueShareCount > 0) {
      result.freshIssueShareCount = Math.round(extracted.freshIssueShareCount);
    }
    if (extracted.ofsShareCount != null && extracted.ofsShareCount >= 0) {
      result.ofsShareCount = Math.round(extracted.ofsShareCount);
    }

    if (extracted.freshIssueSize != null && extracted.freshIssueSize > 0) {
      result.freshIssueSize = Number(extracted.freshIssueSize.toFixed(2));
    }
    if (extracted.ofsSize != null && extracted.ofsSize >= 0) {
      result.ofsSize = Number(extracted.ofsSize.toFixed(2));
    }

    if (existingIpo?.issueSize != null && result.freshIssueSize != null && result.ofsSize != null) {
      const totalExtractedSize = result.freshIssueSize + result.ofsSize;
      const expectedSize = Number(existingIpo.issueSize);
      if (expectedSize > 0 && Math.abs(totalExtractedSize - expectedSize) / expectedSize > 0.25) {
        this.logger.debug(
          `Fresh+OFS size (${totalExtractedSize} Cr) deviates >25% from registered issue size (${expectedSize} Cr)`,
        );
      }
    }

    // 7. Lead Managers
    if (Array.isArray(extracted.leadManagers) && extracted.leadManagers.length > 0) {
      result.leadManagers = extracted.leadManagers
        .map((m) => this.sanitizeText(m))
        .filter((m) => m.length > 2)
        .slice(0, 10);
    }

    // 7b. Registrar
    const normalizedRegistrar = sanitizeAndNormalizeRegistrar(extracted.registrar);
    if (normalizedRegistrar) {
      result.registrar = normalizedRegistrar;
    }

    // 8. Anchor Details
    if (extracted.anchorDetails && typeof extracted.anchorDetails === 'object') {
      result.anchorDetails = extracted.anchorDetails;
    }

    return result;
  }

  private sanitizeText(raw: string): string {
    if (!raw) return '';
    return raw
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .replace(/```[a-z]*\n?/gi, '') // Strip code blocks
      .replace(/[\r\n\t]+/g, ' ') // Standardize whitespace
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
}
