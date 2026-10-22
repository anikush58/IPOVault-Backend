import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { Env } from '../../../config/env';
import {
  IpoResearchCandidates,
  SourceAuthorityTier,
} from './research.types';

export const candidateFieldSchema = z.object({
  value: z.any().nullable().optional(),
  sourceUrl: z.string().optional().default(''),
  evidence: z.string().optional().default(''),
  confidence: z.number().min(0).max(1).optional().default(0.9),
});

export const researchResponseSchema = z.object({
  company: z
    .object({
      legalName: candidateFieldSchema.optional(),
      displayName: candidateFieldSchema.optional(),
      cin: candidateFieldSchema.optional(),
      website: candidateFieldSchema.optional(),
      aboutDescription: candidateFieldSchema.optional(),
      sector: candidateFieldSchema.optional(),
      industry: candidateFieldSchema.optional(),
      phone: candidateFieldSchema.optional(),
      email: candidateFieldSchema.optional(),
      contactPerson: candidateFieldSchema.optional(),
    })
    .optional(),

  ipoParameters: z
    .object({
      marketSegment: candidateFieldSchema.optional(),
      exchange: candidateFieldSchema.optional(),
      status: candidateFieldSchema.optional(),
      symbol: candidateFieldSchema.optional(),
      isin: candidateFieldSchema.optional(),
      nseSymbol: candidateFieldSchema.optional(),
      bseSymbol: candidateFieldSchema.optional(),
    })
    .optional(),

  pricingAndIssue: z
    .object({
      priceBandLow: candidateFieldSchema.optional(),
      priceBandHigh: candidateFieldSchema.optional(),
      lotSize: candidateFieldSchema.optional(),
      minimumLots: candidateFieldSchema.optional(),
      faceValue: candidateFieldSchema.optional(),
      issueSize: candidateFieldSchema.optional(),
      freshIssueSize: candidateFieldSchema.optional(),
      ofsSize: candidateFieldSchema.optional(),
      issueShareCount: candidateFieldSchema.optional(),
      freshIssueShareCount: candidateFieldSchema.optional(),
      ofsShareCount: candidateFieldSchema.optional(),
    })
    .optional(),

  dates: z
    .object({
      openDate: candidateFieldSchema.optional(),
      closeDate: candidateFieldSchema.optional(),
      allotmentDate: candidateFieldSchema.optional(),
      refundDate: candidateFieldSchema.optional(),
      listingDate: candidateFieldSchema.optional(),
    })
    .optional(),

  allotmentAndRegistrar: z
    .object({
      registrarName: candidateFieldSchema.optional(),
      registrarIpoCode: candidateFieldSchema.optional(),
      allotmentSourceUrl: candidateFieldSchema.optional(),
    })
    .optional(),

  listingPerformance: z
    .object({
      listingPrice: candidateFieldSchema.optional(),
      listingGainPct: candidateFieldSchema.optional(),
    })
    .optional(),

  valuationAndHoldings: z
    .object({
      preIpoPe: candidateFieldSchema.optional(),
      postIpoPe: candidateFieldSchema.optional(),
      preIpoEps: candidateFieldSchema.optional(),
      postIpoEps: candidateFieldSchema.optional(),
      preIpoPromoterHolding: candidateFieldSchema.optional(),
      postIpoPromoterHolding: candidateFieldSchema.optional(),
      preIpoMarketCap: candidateFieldSchema.optional(),
      postIpoMarketCap: candidateFieldSchema.optional(),
    })
    .optional(),

  leadManagers: candidateFieldSchema.optional(),
  financials: candidateFieldSchema.optional(),
  strengths: candidateFieldSchema.optional(),
  risks: candidateFieldSchema.optional(),
});

@Injectable()
export class AiResearchAgentService {
  private readonly logger = new Logger(AiResearchAgentService.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  /**
   * Researches current IPO information from live sources using AI search grounding.
   */
  async researchIpo(
    ipo: any,
    options?: {
      customFetchImpl?: typeof fetch;
      timeoutMs?: number;
      retryDelayMs?: number;
    },
  ): Promise<IpoResearchCandidates> {
    const companyName = ipo.company?.displayName || ipo.company?.legalName || 'Unknown IPO';
    const symbol = ipo.symbol || ipo.nseSymbol || ipo.bseSymbol || '';

    this.logger.log(`Starting live AI research for '${companyName}' (Symbol: '${symbol}')...`);

    const prompt = this.buildResearchPrompt(ipo);
    const { data: rawResult, diagnostics } = await this.callGeminiWithSearch(
      prompt,
      options?.customFetchImpl,
      options?.timeoutMs || 60000,
      options?.retryDelayMs,
    );

    if (!rawResult) {
      this.logger.warn(`No valid research data returned for '${companyName}': ${diagnostics.errorMessage || diagnostics.diagnosticCode}`);
      return { diagnostics };
    }

    const parsed = researchResponseSchema.safeParse(rawResult);
    if (!parsed.success) {
      this.logger.warn(
        `Research output schema validation warning for '${companyName}': ${parsed.error.message}`,
      );
    }

    const data = parsed.success ? parsed.data : (rawResult as any);
    const candidates = this.mapToCandidates(data, companyName, diagnostics.groundingUrls, ipo);
    candidates.diagnostics = diagnostics;
    return candidates;
  }

  /**
   * Classifies source URL into strict authority tiers.
   */
  public classifySourceAuthority(
    url: string,
    issuerDomain?: string,
  ): {
    tier: SourceAuthorityTier;
    domain: string;
    sourceName: string;
  } {
    if (!url || typeof url !== 'string' || !url.trim()) {
      return { tier: 'TIER_4_SECONDARY', domain: 'unknown', sourceName: 'Unknown Source' };
    }

    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      let host = parsed.hostname.toLowerCase();

      if (!host.includes('.')) {
        return { tier: 'TIER_4_SECONDARY', domain: 'unknown', sourceName: 'Unknown Source' };
      }

      // Check Google search redirect domain
      if (host.includes('vertexaisearch.cloud.google.com') || host.includes('google.com')) {
        const targetUrl = parsed.searchParams.get('url') || parsed.searchParams.get('q');
        if (targetUrl) {
          try {
            const innerParsed = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
            host = innerParsed.hostname.toLowerCase();
          } catch {}
        }
      }

      // Tier 1: Statutory & Stock Exchanges
      if (host.includes('sebi.gov.in')) {
        return { tier: 'TIER_1_STATUTORY', domain: host, sourceName: 'SEBI Official' };
      }
      if (host.includes('nseindia.com')) {
        return { tier: 'TIER_1_STATUTORY', domain: host, sourceName: 'NSE Official' };
      }
      if (host.includes('bseindia.com')) {
        return { tier: 'TIER_1_STATUTORY', domain: host, sourceName: 'BSE Official' };
      }
      if (host.includes('mca.gov.in')) {
        return { tier: 'TIER_1_STATUTORY', domain: host, sourceName: 'MCA Official' };
      }

      // Tier 2: Official Registrars
      const registrars: Record<string, string> = {
        'linkintime.co.in': 'Link Intime',
        'kfintech.com': 'KFin Technologies',
        'bigshareonline.com': 'Bigshare Services',
        'skylinerta.com': 'Skyline Financial',
        'cameoindia.com': 'Cameo Corporate',
        'maashitla.com': 'Maashitla Securities',
        'purvashare.com': 'Purva Sharegistry',
        'integratedindia.in': 'Integrated Registry',
      };
      for (const [domainSub, regName] of Object.entries(registrars)) {
        if (host.includes(domainSub)) {
          return { tier: 'TIER_2_REGISTRAR', domain: host, sourceName: regName };
        }
      }

      // Tier 3: Issuer/Company portals
      if (
        url.includes('/drhp') ||
        url.includes('/rhp') ||
        url.includes('/prospectus') ||
        host.includes('investor') ||
        (issuerDomain && (host === issuerDomain || host.endsWith(`.${issuerDomain}`)))
      ) {
        return { tier: 'TIER_3_ISSUER', domain: host, sourceName: 'Issuer Filing' };
      }

      // Tier 4: Secondary market data
      return { tier: 'TIER_4_SECONDARY', domain: host, sourceName: 'Secondary Source' };
    } catch {
      return { tier: 'TIER_4_SECONDARY', domain: 'unknown', sourceName: 'Secondary Source' };
    }
  }

  /**
   * Constructs the live research prompt enforcing strict priority ranking and evidence citation.
   */
  public buildResearchPrompt(ipo: any, missingFieldNames: string[] = []): string {
    const comp = ipo.company || {};
    const existingSummary = [
      `Company Legal Name: ${comp.legalName || 'N/A'}`,
      `Company Display Name: ${comp.displayName || 'N/A'}`,
      `Corporate Identity Number (CIN): ${comp.cin || 'N/A'}`,
      `Website: ${comp.website || 'N/A'}`,
      `Symbol: ${ipo.symbol || ipo.nseSymbol || ipo.bseSymbol || 'N/A'}`,
      `Market Segment: ${ipo.marketSegment || 'N/A'}`,
      `Exchange: ${ipo.exchange || 'N/A'}`,
      `Price Band: ₹${ipo.priceBandLow ?? 'N/A'} - ₹${ipo.priceBandHigh ?? 'N/A'}`,
      `Lot Size: ${ipo.lotSize ?? 'N/A'}`,
      `Issue Size: ${ipo.issueSize ? `₹${ipo.issueSize} Cr` : 'N/A'}`,
    ];

    if (missingFieldNames && missingFieldNames.length > 0) {
      existingSummary.push(`GENUINELY MISSING FIELDS REQUIRING DISCOVERY: ${missingFieldNames.join(', ')}`);
    }

    return `
You are an expert Indian Capital Markets Research Engine specializing in SEBI filings, NSE, BSE, and Registrar IPO disclosures.

TARGET IPO:
${existingSummary.join('\n')}

TASK:
Research the latest official statutory data for this IPO using real-time search and official Indian market repositories.

AUTHORITY RANKING (MANDATORY PRIORITY):
1. SEBI (sebi.gov.in), NSE (nseindia.com), and BSE (bseindia.com) circulars, press releases, and filing databases.
2. Official issuer website and statutory Red Herring Prospectus (RHP) or Draft Red Herring Prospectus (DRHP).
3. Official IPO Registrars (Link Intime, KFin Technologies, Bigshare Services, Skyline, Cameo, Maashitla, Purva Sharegistry) for allotment status, registrar IPO codes, and dates.
4. Secondary sources (Chittorgarh, IPOWatch, Moneycontrol, Economic Times) ONLY for corroboration or discovery of official links.

RULES:
1. Every field you report MUST include the exact source URL where you retrieved it and a short verbatim excerpt/evidence quote confirming the value.
2. If a field cannot be confirmed with reliable official evidence, return null for its value. NEVER guess, estimate, or extrapolate.
3. Currency/Size formatting:
   - Issue sizes, fresh issue size, OFS size, market cap must be in INR Crores (₹ Cr).
   - Price band and face value must be in ₹ per share.
   - All percentages (promoter holding, gain pct, allocations) must be pure numbers between 0 and 100.
   - Dates must be strictly in YYYY-MM-DD format.
4. Return ONLY a single valid JSON object strictly conforming to the following structure:

{
  "company": {
    "legalName": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "displayName": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "cin": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "website": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "aboutDescription": { "value": "concise 2-4 sentence summary or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "sector": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "industry": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "ipoParameters": {
    "marketSegment": { "value": "MAINBOARD or SME or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "exchange": { "value": "NSE or BSE or BOTH or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "status": { "value": "UPCOMING or OPEN or CLOSED or LISTED or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "symbol": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "isin": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "pricingAndIssue": {
    "priceBandLow": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "priceBandHigh": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "lotSize": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "faceValue": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "issueSize": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "freshIssueSize": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "ofsSize": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "issueShareCount": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "freshIssueShareCount": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "ofsShareCount": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "dates": {
    "openDate": { "value": "YYYY-MM-DD or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "closeDate": { "value": "YYYY-MM-DD or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "allotmentDate": { "value": "YYYY-MM-DD or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "refundDate": { "value": "YYYY-MM-DD or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "listingDate": { "value": "YYYY-MM-DD or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "allotmentAndRegistrar": {
    "registrarName": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "registrarIpoCode": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "allotmentSourceUrl": { "value": "string or null", "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "listingPerformance": {
    "listingPrice": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "listingGainPct": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "valuationAndHoldings": {
    "preIpoPe": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "postIpoPe": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "preIpoPromoterHolding": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "postIpoPromoterHolding": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
    "preIpoMarketCap": { "value": number or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
  },
  "leadManagers": { "value": ["string"] or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
  "strengths": { "value": ["string"] or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 },
  "risks": { "value": ["string"] or null, "sourceUrl": "url", "evidence": "quote", "confidence": 0.95 }
}
`.trim();
  }

  /**
   * Helper to parse JSON from direct text, markdown code blocks, or outermost curly braces.
   */
  public extractJson(text: string): any {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed);
    } catch {}

    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {}
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {}
    }

    return null;
  }

  /**
   * Calls Gemini REST API with Google Search grounding tool enabled.
   */
  public async callGeminiWithSearch(
    prompt: string,
    customFetchImpl?: typeof fetch,
    timeoutMs = 60000,
    retryDelayMs?: number,
  ): Promise<{
    data: Record<string, any> | null;
    diagnostics: {
      status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
      diagnosticCode?: any;
      errorMessage?: string;
      modelUsed?: string;
      searchQueries?: string[];
      groundingUrls?: string[];
      groundingSourcesCount?: number;
    };
  }> {
    const fetchFn = customFetchImpl || fetch;
    const geminiKey =
      (this.configService as any)?.get?.('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY ||
      (customFetchImpl ? 'mock-key-for-test' : undefined);

    if (!geminiKey || !geminiKey.trim()) {
      this.logger.warn('No GEMINI_API_KEY configured for live AI research');
      return {
        data: null,
        diagnostics: {
          status: 'FAILED',
          diagnosticCode: 'API_KEY_MISSING',
          errorMessage: 'No GEMINI_API_KEY configured for live AI research',
        },
      };
    }

    const configuredModel =
      (this.configService as any)?.get?.('GEMINI_MODEL') ||
      process.env.GEMINI_MODEL;

    // Prioritize configured model, then latest active models
    const models = configuredModel
      ? [configuredModel, 'gemini-3.8-flash', 'gemini-flash-latest']
      : ['gemini-3.8-flash', 'gemini-flash-latest'];

    const effectiveDelay = retryDelayMs !== undefined ? retryDelayMs : 1500;
    const sanitize = (msg: string) => (msg ? String(msg).replace(/key=[a-zA-Z0-9_\-\.]+/gi, 'key=***') : '');

    let lastError: { code: any; message: string } = {
      code: 'NO_DATA_RETURNED',
      message: 'No response returned from Gemini API',
    };

    for (const model of models) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        let timer: any = null;
        try {
          const controller = new AbortController();
          timer = setTimeout(() => controller.abort(), timeoutMs);
          if (timer?.unref) timer.unref();

          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey.trim()}`;
          const resp = await fetchFn(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              tools: [{ google_search: {} }], // Enable Google Search grounding
              generationConfig: {
                temperature: 0.1,
              },
            }),
          });

          if (timer) clearTimeout(timer);

          if (resp.status === 429) {
            this.logger.warn(`Gemini (${model}) rate limited / quota exceeded (429).`);
            lastError = {
              code: 'API_RATE_LIMIT_EXCEEDED',
              message: `Gemini API rate limit or quota exceeded (HTTP 429) on model ${model}`,
            };
            if (effectiveDelay > 0) {
              await new Promise((r) => setTimeout(r, effectiveDelay * attempt));
            }
            continue;
          }
          if (resp.status === 503) {
            this.logger.warn(`Gemini (${model}) 503 temporary error. Retrying...`);
            lastError = {
              code: 'UPSTREAM_API_ERROR',
              message: `Gemini service temporarily unavailable (HTTP 503) on model ${model}`,
            };
            if (effectiveDelay > 0) {
              await new Promise((r) => setTimeout(r, effectiveDelay * attempt));
            }
            continue;
          }
          if (resp.status === 404) {
            this.logger.warn(`Gemini model '${model}' not found (HTTP 404).`);
            if (lastError.code !== 'API_RATE_LIMIT_EXCEEDED' && lastError.code !== 'UPSTREAM_API_ERROR') {
              lastError = {
                code: 'MODEL_NOT_AVAILABLE',
                message: `Gemini model '${model}' is unavailable or deprecated (HTTP 404)`,
              };
            }
            break; // Try next model in chain
          }
          if (!resp.ok) {
            let errBody = '';
            if (typeof resp.text === 'function') {
              errBody = await resp.text();
            }
            this.logger.warn(`Gemini research call failed (HTTP ${resp.status}): ${sanitize(errBody.slice(0, 150))}`);
            lastError = {
              code: 'UPSTREAM_API_ERROR',
              message: sanitize(`Gemini API call failed with HTTP ${resp.status}: ${errBody.slice(0, 120)}`),
            };
            break; // Try next model in chain
          }

          let data: any = null;
          if (typeof resp.json === 'function') {
            data = await resp.json();
          } else if (typeof resp.text === 'function') {
            data = JSON.parse(await resp.text());
          }

          const candidateObj = data?.candidates?.[0];
          const groundingMeta = candidateObj?.groundingMetadata;
          const searchQueries: string[] = groundingMeta?.webSearchQueries || [];
          const groundingUrls: string[] = [];
          if (Array.isArray(groundingMeta?.groundingChunks)) {
            for (const chunk of groundingMeta.groundingChunks) {
              if (chunk?.web?.uri) {
                groundingUrls.push(chunk.web.uri);
              }
            }
          }

          const text = candidateObj?.content?.parts?.[0]?.text;
          if (text) {
            const parsedJson = this.extractJson(text);
            if (parsedJson) {
              return {
                data: parsedJson,
                diagnostics: {
                  status: 'SUCCESS',
                  diagnosticCode: 'SUCCESS',
                  modelUsed: model,
                  searchQueries,
                  groundingUrls,
                  groundingSourcesCount: groundingUrls.length,
                },
              };
            } else {
              lastError = {
                code: 'SCHEMA_PARSE_ERROR',
                message: `Model response could not be parsed as valid JSON: ${text.slice(0, 100)}...`,
              };
            }
          } else {
            lastError = {
              code: 'NO_DATA_RETURNED',
              message: 'Gemini returned response without candidate text parts',
            };
          }
        } catch (err: any) {
          if (timer) clearTimeout(timer);
          if (err.name === 'AbortError') {
            this.logger.error(`Gemini research timed out after ${timeoutMs}ms for model ${model}`);
            lastError = {
              code: 'NETWORK_TIMEOUT',
              message: `Gemini research timed out after ${timeoutMs}ms for model ${model}`,
            };
            return {
              data: null,
              diagnostics: {
                status: 'FAILED',
                diagnosticCode: 'NETWORK_TIMEOUT',
                errorMessage: lastError.message,
                modelUsed: model,
              },
            };
          }
          this.logger.error(`Error invoking Gemini research (${model}, attempt ${attempt}): ${sanitize(err.message)}`);
          lastError = {
            code: 'UPSTREAM_API_ERROR',
            message: sanitize(err.message),
          };
        }
      }
    }

    return {
      data: null,
      diagnostics: {
        status: 'FAILED',
        diagnosticCode: lastError.code,
        errorMessage: sanitize(lastError.message),
      },
    };
  }

  /**
   * Transforms raw model response into ResearchedCandidateField dictionary.
   */
  private mapToCandidates(
    data: any,
    companyName: string,
    groundingUrls: string[] = [],
    ipo?: any,
  ): IpoResearchCandidates {
    const candidates: IpoResearchCandidates = {};
    const nowIso = new Date().toISOString();

    let issuerDomain = '';
    const issuerWebsite = ipo?.company?.website || '';
    if (issuerWebsite) {
      try {
        const u = new URL(issuerWebsite.startsWith('http') ? issuerWebsite : `https://${issuerWebsite}`);
        issuerDomain = u.hostname.toLowerCase().replace(/^www\./, '');
      } catch {}
    }

    const addField = (
      key: keyof IpoResearchCandidates,
      rawItem: any,
    ) => {
      if (!rawItem || rawItem.value === null || rawItem.value === undefined) return;
      if (typeof rawItem.value === 'string' && rawItem.value.trim() === '') return;

      let sourceUrl = rawItem.sourceUrl || '';
      // If model omitted sourceUrl but search grounding returned authoritative URLs, enrich
      if (!sourceUrl && groundingUrls.length > 0) {
        const authoritative = groundingUrls.find(
          (u) => u.includes('bseindia.com') || u.includes('nseindia.com') || u.includes('sebi.gov.in'),
        );
        sourceUrl = authoritative || groundingUrls[0];
      }

      const auth = this.classifySourceAuthority(sourceUrl, issuerDomain);

      candidates[key] = {
        fieldKey: String(key),
        rawValue: rawItem.value,
        normalizedValue: rawItem.value,
        sourceUrl,
        sourceDomain: auth.domain,
        sourceAuthority: auth.tier,
        sourceName: auth.sourceName,
        evidence: rawItem.evidence || `Researched for ${companyName}`,
        confidence: typeof rawItem.confidence === 'number' ? rawItem.confidence : 0.9,
        retrievedAt: nowIso,
      } as any;
    };

    // Flatten nested objects
    if (data.company) {
      for (const [k, v] of Object.entries(data.company)) addField(k as any, v);
    }
    if (data.ipoParameters) {
      for (const [k, v] of Object.entries(data.ipoParameters)) addField(k as any, v);
    }
    if (data.pricingAndIssue) {
      for (const [k, v] of Object.entries(data.pricingAndIssue)) addField(k as any, v);
    }
    if (data.dates) {
      for (const [k, v] of Object.entries(data.dates)) addField(k as any, v);
    }
    if (data.allotmentAndRegistrar) {
      for (const [k, v] of Object.entries(data.allotmentAndRegistrar)) addField(k as any, v);
    }
    if (data.listingPerformance) {
      for (const [k, v] of Object.entries(data.listingPerformance)) addField(k as any, v);
    }
    if (data.valuationAndHoldings) {
      for (const [k, v] of Object.entries(data.valuationAndHoldings)) addField(k as any, v);
    }
    if (data.leadManagers) addField('leadManagers', data.leadManagers);
    if (data.financials) addField('financials', data.financials);
    if (data.strengths) addField('strengths', data.strengths);
    if (data.risks) addField('risks', data.risks);

    return candidates;
  }
}
