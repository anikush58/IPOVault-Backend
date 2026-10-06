import { Injectable } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { FieldProvenanceWithSource } from '../ipos/ipo.mapper';
import { FieldProvenanceVisualDto, ProvenanceStatus } from './admin-ipo.dto';

/**
 * Standard field name aliases map canonical camelCase keys to potential database snake_case or prefix variations.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  legalName: ['legalName', 'legal_name', 'company_name', 'name'],
  displayName: ['displayName', 'display_name'],
  cin: ['cin', 'company_cin'],
  symbol: ['symbol', 'trading_symbol', 'ticker'],
  marketSegment: ['marketSegment', 'market_segment', 'segment'],
  exchange: ['exchange', 'exchange_listing', 'exchangeListing'],
  status: ['status', 'lifecycle_status', 'lifecycleStatus'],
  publicationStatus: ['publicationStatus', 'publication_status'],
  priceBandLow: ['priceBandLow', 'price_band_low', 'min_price', 'priceLow'],
  priceBandHigh: ['priceBandHigh', 'price_band_high', 'max_price', 'priceHigh'],
  lotSize: ['lotSize', 'lot_size', 'minimum_lot', 'market_lot'],
  issueSize: ['issueSize', 'issue_size', 'total_issue_size'],
  freshIssueSize: ['freshIssueSize', 'fresh_issue_size', 'fresh_issue_rs'],
  ofsSize: ['ofsSize', 'ofs_size', 'offer_for_sale_size'],
  issueShareCount: ['issueShareCount', 'issue_share_count', 'total_shares'],
  freshIssueShareCount: ['freshIssueShareCount', 'fresh_issue_share_count', 'fresh_issue_shares'],
  ofsShareCount: ['ofsShareCount', 'ofs_share_count', 'ofs_shares'],
  faceValue: ['faceValue', 'face_value'],
  preIpoEps: ['preIpoEps', 'pre_ipo_eps', 'eps_pre_ipo'],
  postIpoEps: ['postIpoEps', 'post_ipo_eps', 'eps_post_ipo'],
  preIpoPe: ['preIpoPe', 'pre_ipo_pe', 'pe_pre_ipo', 'pe'],
  postIpoPe: ['postIpoPe', 'post_ipo_pe', 'pe_post_ipo'],
  preIpoPromoterHolding: ['preIpoPromoterHolding', 'pre_ipo_promoter_holding', 'promoter_holding_pre'],
  postIpoPromoterHolding: ['postIpoPromoterHolding', 'post_ipo_promoter_holding', 'promoter_holding_post'],
  preIpoMarketCap: ['preIpoMarketCap', 'pre_ipo_market_cap', 'market_cap_pre'],
  postIpoMarketCap: ['postIpoMarketCap', 'post_ipo_market_cap', 'market_cap_post', 'marketCap'],
  openDate: ['openDate', 'open_date', 'lifecycle.open_date', 'issue_open_date'],
  closeDate: ['closeDate', 'close_date', 'lifecycle.close_date', 'issue_close_date'],
  allotmentDate: ['allotmentDate', 'allotment_date', 'lifecycle.allotment_date', 'lifecycle.basis_of_allotment', 'basis_of_allotment_date'],
  refundDate: ['refundDate', 'refund_date', 'lifecycle.refund_date', 'lifecycle.refund_initiation', 'refund_initiation_date'],
  listingDate: ['listingDate', 'listing_date', 'lifecycle.listing_date', 'lifecycle.listing'],
  listingPrice: ['listingPrice', 'listing_price'],
  listingGainPct: ['listingGainPct', 'listing_gain_pct', 'listing_gain'],
  profitAmount: ['profitAmount', 'profit_amount', 'est_profit'],
  profitPercentage: ['profitPercentage', 'profit_percentage', 'est_profit_pct'],
  industry: ['industry', 'company_industry'],
  sector: ['sector', 'company_sector'],
  aboutDescription: ['aboutDescription', 'about_description', 'description', 'company_about'],
  website: ['website', 'company_website', 'url'],
  phone: ['phone', 'company_phone'],
  email: ['email', 'company_email'],
  contactPerson: ['contactPerson', 'contact_person'],
  logoUrl: ['logoUrl', 'logo_url'],
  registrarName: ['registrarName', 'registrar_name', 'registrar', 'allotment_registrar'],
  leadManagers: ['leadManagers', 'lead_managers', 'brlm', 'merchant_banker', 'lead_manager'],
  qibAllocationPct: ['qibAllocationPct', 'qib_allocation_pct', 'qib_pct', 'qib_allocation'],
  niiAllocationPct: ['niiAllocationPct', 'nii_allocation_pct', 'nii_pct', 'nii_allocation', 'hni_allocation'],
  retailAllocationPct: ['retailAllocationPct', 'retail_allocation_pct', 'retail_pct', 'retail_allocation'],
  financials: ['financials', 'companyFinancial', 'financial_ratios', 'financial_statements'],
  gmp: ['gmp', 'latestGmp', 'gmp_amount'],
  subscription: ['subscription', 'subscription_observations', 'total_subscription'],
};

/**
 * Normalizes values for comparison across sources.
 */
function normalizeVal(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return String(val);
  const s = String(val).trim();
  if (!s || s === 'null' || s === 'undefined') return '';
  return s.toLowerCase();
}

/**
 * Determines the ProvenanceStatus, sourceLabel, and display priority of a given Source record.
 */
function classifySource(source: {
  code: string;
  name?: string;
  sourceType?: SourceType | string;
}): {
  status: ProvenanceStatus;
  statusLabel: string;
  sourceLabel: string;
  priority: number;
} {
  const code = (source.code || '').toUpperCase();
  const lowerCode = (source.code || '').toLowerCase();
  const type = source.sourceType || '';

  // 1. Manual / Admin override (Highest precedence)
  if (code === 'ADMIN' || code === 'MANUAL' || code.includes('MANUAL')) {
    return {
      status: 'MANUAL',
      statusLabel: 'Manual Entry',
      sourceLabel: 'Admin Review / Override',
      priority: 1,
    };
  }

  // 2. Official statutory / exchange sources (Deterministic)
  if (
    code === 'NSE' ||
    code === 'BSE' ||
    code === 'SEBI' ||
    type === SourceType.EXCHANGE ||
    (type === SourceType.OFFICIAL_FILING && !code.includes('AI')) ||
    type === SourceType.REGISTRAR
  ) {
    let sourceLabel = source.name || code;
    if (code === 'NSE') sourceLabel = 'NSE';
    else if (code === 'BSE') sourceLabel = 'BSE';
    else if (code === 'SEBI') sourceLabel = 'SEBI Filing';
    else if (type === SourceType.REGISTRAR) sourceLabel = source.name ? `Registrar (${source.name})` : 'Registrar';

    return {
      status: 'OFFICIAL_SOURCE',
      statusLabel: 'Official Source',
      sourceLabel,
      priority: 2,
    };
  }

  // 3. IPOGuru feed
  if (lowerCode.includes('ipoguru') || type === SourceType.SECONDARY) {
    return {
      status: 'IPOGURU',
      statusLabel: 'IPOGuru',
      sourceLabel: 'IPOGuru Commercial Feed',
      priority: 3,
    };
  }

  // 4. AI Enriched (Gemini structured extraction over statutory document)
  if (
    code === 'SEBI_AI_EXTRACTED' ||
    code === 'BSE_SME_AI' ||
    code === 'NSE_EMERGE_AI' ||
    code.includes('AI')
  ) {
    let sourceDocLabel = 'SEBI Prospectus';
    if (code === 'BSE_SME_AI') sourceDocLabel = 'BSE SME Prospectus';
    else if (code === 'NSE_EMERGE_AI') sourceDocLabel = 'NSE Emerge RHP';
    else if (code === 'SEBI_AI_EXTRACTED') sourceDocLabel = 'SEBI Statutory Filing';

    return {
      status: 'AI_ENRICHED',
      statusLabel: 'AI Enriched',
      sourceLabel: sourceDocLabel,
      priority: 4,
    };
  }

  // Fallback official or secondary
  return {
    status: 'OFFICIAL_SOURCE',
    statusLabel: 'Official Source',
    sourceLabel: source.name || code,
    priority: 5,
  };
}

/**
 * Extracts URL, Section, and Document Hash from a sourceReference string.
 */
function parseSourceReference(ref?: string | null): {
  sourceUrl: string | null;
  section: string | null;
  documentHash: string | null;
} {
  if (!ref || typeof ref !== 'string') {
    return { sourceUrl: null, section: null, documentHash: null };
  }

  let sourceUrl: string | null = null;
  let section: string | null = null;
  let documentHash: string | null = null;

  // Pattern: "https://... | Hash: abc1234"
  if (ref.includes('http://') || ref.includes('https://')) {
    const parts = ref.split('|').map((p) => p.trim());
    for (const p of parts) {
      if (p.startsWith('http://') || p.startsWith('https://')) {
        sourceUrl = p;
      } else if (p.toLowerCase().startsWith('hash:')) {
        documentHash = p.substring(5).trim();
      } else if (p.toLowerCase().startsWith('section:')) {
        section = p.substring(8).trim();
      }
    }
  } else if (ref.toLowerCase().startsWith('section:')) {
    section = ref.substring(8).trim();
  } else if (ref.toLowerCase().startsWith('hash:')) {
    documentHash = ref.substring(5).trim();
  }

  return { sourceUrl, section, documentHash };
}

@Injectable()
export class AdminProvenanceResolver {
  /**
   * Resolves visual provenance for a single field given the canonical value and provenance records.
   */
  resolveField(
    fieldKey: string,
    canonicalValue: any,
    allProvenances: FieldProvenanceWithSource[] = [],
  ): FieldProvenanceVisualDto {
    const aliases = FIELD_ALIASES[fieldKey] || [fieldKey];
    const matchingProvs = allProvenances.filter((p) => {
      const pName = p.fieldName || '';
      return (
        aliases.includes(pName) ||
        aliases.some((a) => a.toLowerCase() === pName.toLowerCase())
      );
    });

    // 1. If no matching provenance records exist:
    if (matchingProvs.length === 0) {
      const hasVal = canonicalValue !== null && canonicalValue !== undefined && String(canonicalValue).trim() !== '';
      if (!hasVal) {
        return {
          fieldName: fieldKey,
          fieldKey,
          value: null,
          status: 'NO_VERIFIED_DATA',
          statusLabel: 'No verified data',
          sourceLabel: 'Not available',
          sourceCode: 'NONE',
          hasConflict: false,
        };
      }

      // Value exists canonically but no explicit provenance was captured (e.g. legacy/initial seed or direct edit)
      return {
        fieldName: fieldKey,
        fieldKey,
        value: canonicalValue,
        status: 'MANUAL',
        statusLabel: 'Manual Entry',
        sourceLabel: 'Admin / System Seed',
        sourceCode: 'ADMIN',
        confidence: 1.0,
        hasConflict: false,
      };
    }

    // 2. Classify each active observation per distinct source
    const bySource = new Map<
      string,
      {
        prov: FieldProvenanceWithSource;
        classification: ReturnType<typeof classifySource>;
      }
    >();

    for (const p of matchingProvs) {
      const classification = classifySource(p.source);
      const existing = bySource.get(p.sourceId);
      if (
        !existing ||
        p.retrievedAt > existing.prov.retrievedAt ||
        (p.retrievedAt.getTime() === existing.prov.retrievedAt.getTime() &&
          p.createdAt > existing.prov.createdAt)
      ) {
        bySource.set(p.sourceId, { prov: p, classification });
      }
    }

    const activeObservations = Array.from(bySource.values());

    // 3. Detect Conflicts among active observations
    const nonManualObs = activeObservations.filter((o) => o.classification.status !== 'MANUAL');
    let hasConflict = false;
    const conflictingSources: { sourceName: string; value: string }[] = [];

    if (nonManualObs.length >= 2) {
      const firstNorm = normalizeVal(nonManualObs[0].prov.value);
      for (const obs of nonManualObs) {
        const norm = normalizeVal(obs.prov.value);
        if (norm && firstNorm && norm !== firstNorm) {
          hasConflict = true;
        }
        conflictingSources.push({
          sourceName: obs.classification.sourceLabel || obs.prov.source?.name || obs.prov.source?.code,
          value: obs.prov.value,
        });
      }
    }

    // 4. Select winning observation by Precedence:
    // Manual/Admin (1) > Official (2) > IPOGuru (3) > AI Enriched (4)
    // Secondary sort: most recent retrievedAt DESC
    activeObservations.sort((a, b) => {
      if (a.classification.priority !== b.classification.priority) {
        return a.classification.priority - b.classification.priority;
      }
      return b.prov.retrievedAt.getTime() - a.prov.retrievedAt.getTime();
    });

    const winner = activeObservations[0];
    const { sourceUrl, section, documentHash } = parseSourceReference(winner.prov.sourceReference);

    let status = winner.classification.status;
    let statusLabel = winner.classification.statusLabel;

    // If there is an unresolved conflict and no manual admin resolution exists:
    if (hasConflict && status !== 'MANUAL') {
      status = 'CONFLICT_REVIEW';
      statusLabel = 'Conflict / Review';
    }

    const confidenceNum = winner.prov.confidence ? Number(winner.prov.confidence) : 1.0;

    return {
      fieldName: fieldKey,
      fieldKey,
      value: canonicalValue !== undefined ? canonicalValue : winner.prov.value,
      status,
      statusLabel,
      sourceLabel: winner.classification.sourceLabel,
      sourceCode: winner.prov.source?.code || 'UNKNOWN',
      sourceType: winner.prov.source?.sourceType,
      sourceUrl: sourceUrl || winner.prov.source?.baseUrl || null,
      confidence: confidenceNum,
      section: section || null,
      documentHash: documentHash || null,
      model: status === 'AI_ENRICHED' ? 'Gemini 3.5 Flash' : null,
      retrievedAt: winner.prov.retrievedAt.toISOString(),
      extractedAt: winner.prov.createdAt.toISOString(),
      hasConflict,
      conflictingSources: hasConflict ? conflictingSources : undefined,
    };
  }

  /**
   * Resolves visual provenance for all standard IPO form fields.
   */
  resolveAllFields(
    ipoData: any,
    allProvenances: FieldProvenanceWithSource[] = [],
  ): Record<string, FieldProvenanceVisualDto> {
    const result: Record<string, FieldProvenanceVisualDto> = {};

    const standardFields: (keyof typeof FIELD_ALIASES)[] = [
      'legalName',
      'displayName',
      'cin',
      'symbol',
      'marketSegment',
      'exchange',
      'status',
      'publicationStatus',
      'priceBandLow',
      'priceBandHigh',
      'lotSize',
      'issueSize',
      'freshIssueSize',
      'ofsSize',
      'issueShareCount',
      'freshIssueShareCount',
      'ofsShareCount',
      'faceValue',
      'preIpoEps',
      'postIpoEps',
      'preIpoPe',
      'postIpoPe',
      'preIpoPromoterHolding',
      'postIpoPromoterHolding',
      'preIpoMarketCap',
      'postIpoMarketCap',
      'openDate',
      'closeDate',
      'allotmentDate',
      'refundDate',
      'listingDate',
      'listingPrice',
      'listingGainPct',
      'profitAmount',
      'profitPercentage',
      'industry',
      'sector',
      'aboutDescription',
      'website',
      'phone',
      'email',
      'contactPerson',
      'logoUrl',
      'registrarName',
      'leadManagers',
      'qibAllocationPct',
      'niiAllocationPct',
      'retailAllocationPct',
      'financials',
      'gmp',
      'subscription',
    ];

    for (const key of standardFields) {
      let val = ipoData?.[key];
      if (val === undefined && ipoData?.company) {
        val = ipoData.company[key];
      }
      result[key] = this.resolveField(key, val, allProvenances);
    }

    return result;
  }
}
