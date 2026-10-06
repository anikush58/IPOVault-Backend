import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import { Env } from '../../../config/env';
import {
  AiExtractedIpoData,
  AiExtractionRequest,
} from '../enrichment.types';

export const financialPeriodSchema = z.object({
  fiscalPeriod: z.string().regex(/^(?:FY|Q[1-4]-FY)?\d{2,4}$/i),
  periodType: z.enum(['ANNUAL', 'QUARTERLY']).default('ANNUAL').optional(),
  totalRevenue: z.number().nullable().optional(),
  pat: z.number().nullable().optional(),
  ebitda: z.number().nullable().optional(),
  netWorth: z.number().nullable().optional(),
  totalAssets: z.number().nullable().optional(),
  eps: z.number().nullable().optional(),
  roePercentage: z.number().min(0).max(100).nullable().optional(),
  rocePercentage: z.number().min(0).max(100).nullable().optional(),
});

export const anchorInvestorSchema = z.object({
  anchorName: z.string().min(2),
  amtCr: z.number().positive().nullable().optional(),
  sharesAllotted: z.number().positive().nullable().optional(),
  pctAllocated: z.number().min(0).max(100).nullable().optional(),
});

export const aiExtractionSchema = z.object({
  aboutDescription: z.string().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  strengths: z.array(z.string().max(1500)).max(10).nullable().optional(),
  risks: z.array(z.string().max(1500)).max(10).nullable().optional(),
  financials: z.array(financialPeriodSchema).max(6).nullable().optional(),
  preIpoPe: z.number().positive().nullable().optional(),
  postIpoPe: z.number().positive().nullable().optional(),
  preIpoPromoterHolding: z.number().min(0).max(100).nullable().optional(),
  postIpoPromoterHolding: z.number().min(0).max(100).nullable().optional(),
  freshIssueShareCount: z.number().positive().nullable().optional(),
  ofsShareCount: z.number().min(0).nullable().optional(),
  freshIssueSize: z.number().positive().nullable().optional(),
  ofsSize: z.number().min(0).nullable().optional(),
  leadManagers: z.array(z.string()).max(10).nullable().optional(),
  anchorDetails: z
    .object({
      portion: z.number().positive().nullable().optional(),
      bidDate: z.string().nullable().optional(),
      details: z.string().nullable().optional(),
      investors: z.array(anchorInvestorSchema).max(30).optional(),
    })
    .nullable()
    .optional(),
  sourceConfidence: z.number().min(0).max(1).default(0.95).optional(),
  extractedSectionReferences: z.record(z.string(), z.string()).optional(),
});

@Injectable()
export class AiStructuredExtractorService {
  private readonly logger = new Logger(AiStructuredExtractorService.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  /**
   * Performs structured AI extraction on targeted statutory document sections.
   *
   * Enforces zero-hallucination rules and strict Zod schema validation.
   */
  async extract(
    request: AiExtractionRequest,
    customFetchImpl?: typeof fetch,
  ): Promise<AiExtractedIpoData | null> {
    const { companyName, missingFields, documentSections } = request;

    // 1. Check if any section content is available
    const sectionKeys = Object.keys(documentSections) as (keyof typeof documentSections)[];
    if (sectionKeys.length === 0) {
      this.logger.log(`No document sections provided for '${companyName}'. Skipping extraction.`);
      return null;
    }

    const availableSectionsSummary = sectionKeys.join(', ');
    this.logger.log(
      `Running structured extraction for '${companyName}' across sections [${availableSectionsSummary}] for missing fields [${missingFields.join(', ')}]`,
    );

    // 2. Build targeted prompt
    const prompt = this.buildPrompt(request);

    // 3. Dispatch to configured LLM provider or deterministic fallback
    const rawJsonResponse = await this.callLlmProvider(prompt, customFetchImpl);
    if (!rawJsonResponse) {
      this.logger.warn(`No valid JSON returned from LLM provider for '${companyName}'`);
      return null;
    }

    // 4. Validate with strict Zod schema
    const parseResult = aiExtractionSchema.safeParse(rawJsonResponse);
    if (!parseResult.success) {
      this.logger.warn(
        `AI output schema validation failed for '${companyName}': ${parseResult.error.message}`,
      );
      return null;
    }

    return parseResult.data as AiExtractedIpoData;
  }

  /**
   * Constructs the strict system & user prompt with document sections.
   */
  public buildPrompt(request: AiExtractionRequest): string {
    const MAX_SECTION_LENGTH = 6000;
    const sectionsText = Object.entries(request.documentSections)
      .filter(([_, content]) => content && content.trim().length > 0)
      .map(([key, content]) => {
        const trimmed = (content || '').length > MAX_SECTION_LENGTH
          ? (content || '').slice(0, MAX_SECTION_LENGTH) + '\n...[TRUNCATED]...'
          : (content || '');
        return `=== SECTION: ${key} ===\n${trimmed}`;
      })
      .join('\n\n');

    return `
You are a statutory financial disclosure extraction engine for Indian IPO Red Herring Prospectus (RHP) filings.
Company Name: "${request.companyName}"
Missing Fields Needed: ${request.missingFields.join(', ')}

MANDATORY RULES:
1. Extract values ONLY if explicitly stated in the provided text sections.
2. If a value or metric is not present or not mentioned, you MUST set it to null.
3. NEVER guess, estimate, extrapolate, calculate, or hallucinate values.
4. All financial numbers (Revenue, PAT, EBITDA, Net Worth, Total Assets) MUST be in INR Crores (₹ Cr). If reported in Millions, convert to Crores (1 Crore = 10 Million).
5. All percentages must be pure numbers between 0 and 100 (e.g. 85.5 for 85.5%).
6. Financials MUST be an array of objects for each annual period, e.g.:
   [
     { "fiscalPeriod": "FY24", "totalRevenue": 272.82, "pat": null, "ebitda": null, "netWorth": null, "totalAssets": null, "eps": null, "roePercentage": null, "rocePercentage": null }
   ]
7. Return a valid JSON object matching this structure:
{
  "aboutDescription": "string or null",
  "sector": "string or null",
  "industry": "string or null",
  "strengths": ["string"] or null,
  "risks": ["string"] or null,
  "financials": [{"fiscalPeriod": "FY24", "totalRevenue": 100.0, "pat": 10.0, "ebitda": 15.0, "netWorth": 50.0, "totalAssets": 80.0, "eps": 2.5, "roePercentage": 20.0, "rocePercentage": 22.0}],
  "preIpoPe": number or null,
  "postIpoPe": number or null,
  "preIpoPromoterHolding": number or null,
  "postIpoPromoterHolding": number or null,
  "freshIssueShareCount": number or null,
  "ofsShareCount": number or null,
  "freshIssueSize": number or null,
  "ofsSize": number or null,
  "leadManagers": ["string"] or null,
  "anchorDetails": {"portion": number, "bidDate": "string", "details": "string"} or null
}

PROVIDED DOCUMENT SECTIONS:
${sectionsText}
`.trim();
  }

  /**
   * Calls the configured LLM API (Gemini / OpenAI compatible) or offline mock.
   */
  private async callLlmProvider(
    prompt: string,
    customFetchImpl?: typeof fetch,
  ): Promise<Record<string, any> | null> {
    const fetchFn = customFetchImpl || fetch;
    const geminiKey =
      (this.configService as any)?.get?.('GEMINI_API_KEY') ||
      process.env.GEMINI_API_KEY ||
      (customFetchImpl ? 'custom-fetch-key' : undefined);
    const openAiKey =
      (this.configService as any)?.get?.('OPENAI_API_KEY') ||
      process.env.OPENAI_API_KEY;

    // A. Google Gemini (gemini-3.5-flash / gemini-3.6-flash / gemini-3.1-flash-lite / gemini-flash-lite-latest / gemini-3.8-flash)
    if (geminiKey && geminiKey.trim().length > 0) {
      const models = [
        'gemini-3.5-flash',
        'gemini-3.6-flash',
        'gemini-3.1-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3.8-flash',
      ];
      for (const model of models) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey.trim()}`;
            const resp = await fetchFn(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.0,
                  responseMimeType: 'application/json',
                },
              }),
            });

            if (resp.status === 429) {
              this.logger.warn(`Gemini (${model}, attempt ${attempt}) rate limited (HTTP 429). Retrying after backoff...`);
              await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
              continue;
            }

            if (resp.status === 503) {
              const errText = await resp.text();
              this.logger.warn(
                `Gemini (${model}, attempt ${attempt}) temporary 503 demand spike: ${errText.slice(0, 100)}`,
              );
              await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
              continue;
            }

            if (!resp.ok) {
              const errText = await resp.text();
              this.logger.warn(`Gemini API call failed (HTTP ${resp.status}): ${errText}`);
              break;
            }

            const data: any = await resp.json();
            const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawJsonText) {
              return JSON.parse(rawJsonText);
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Error calling Gemini API (${model}, attempt ${attempt}): ${msg}`);
          }
        }
      }
    }

    // B. OpenAI / Azure OpenAI
    if (openAiKey && openAiKey.trim().length > 0) {
      try {
        const endpoint = 'https://api.openai.com/v1/chat/completions';
        const resp = await fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey.trim()}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.0,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          this.logger.warn(`OpenAI API call failed (HTTP ${resp.status}): ${errText}`);
          return null;
        }

        const data: any = await resp.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          return JSON.parse(content);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Error calling OpenAI API: ${msg}`);
        return null;
      }
    }

    // C. Offline / Test fallback
    return null;
  }
}
