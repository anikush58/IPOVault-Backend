import { Injectable, Logger } from '@nestjs/common';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';
import { BaseRegistrarAdapter } from './base-registrar.adapter';
import {
  matchRegistrarCompany,
  normalizeName,
} from '../allotment.matching';
import { KFIN_VERIFIED_FALLBACK_REGISTRY } from '../discovery/kfin-identity-discovery.adapter';

@Injectable()
export class KfinRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'KFINTECH';
  readonly name = 'KFin Technologies';
  override readonly defaultConcurrency = 5;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(KfinRegistrarAdapter.name);

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking KFintech allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by KFintech`,
      );
    }

    let clientId = request.registrarIpoCode?.trim();
    if (
      clientId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        clientId,
      )
    ) {
      clientId = undefined;
    }

    if (!clientId) {
      const resolved = await this.resolveRegistrarIpoCode(request);
      if (typeof resolved !== 'string') {
        return resolved;
      }
      clientId = resolved;
    }

    try {
      return await this.queryKfinApiGateway(request, clientId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`KFintech fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `KFintech rate limit encountered`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `KFintech API gateway unavailable: ${msg}`,
      );
    }
  }

  /**
   * Queries KFintech's official React SPA production API Gateway endpoint.
   * Endpoint: GET https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=...
   */
  private async queryKfinApiGateway(
    request: CheckAllotmentRequest,
    clientId: string,
  ): Promise<NormalizedAllotmentResult> {
    const baseUrl =
      process.env.KFINTECH_API_URL ||
      'https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query';

    const queryType =
      request.identifierType === AllotmentIdentifierType.PAN
        ? 'pan'
        : request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER
          ? 'appno'
          : 'dpclid';

    const reqParamValue = request.identifierValue.trim().toUpperCase();

    const fullUrl = `${baseUrl}?type=${queryType}`;

    const response = await this.fetchWithRetry(fullUrl, {
      method: 'GET',
      headers: {
        reqparam: reqParamValue,
        client_id: clientId,
        Origin: 'https://ipostatus.kfintech.com',
        Referer: 'https://ipostatus.kfintech.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });

    const checkedAt = new Date();

    if (response.status === 404) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    if (response.status === 429) {
      return {
        status: AllotmentStatus.RATE_LIMITED,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'KFintech API rate limit exceeded',
      };
    }

    if (!response.ok) {
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `KFintech returned HTTP status ${response.status}`,
      };
    }

    let parsed: Record<string, unknown> | Record<string, unknown>[];
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'Failed to parse JSON response from KFintech API',
      };
    }

    return this.normalizeKfinResponse(parsed, checkedAt);
  }

  /**
   * Normalizes raw KFintech API Gateway JSON payload into NormalizedAllotmentResult.
   */
  public normalizeKfinResponse(
    raw: Record<string, unknown> | Record<string, unknown>[],
    checkedAt: Date = new Date(),
  ): NormalizedAllotmentResult {
    if (!raw) {
      return {
        status: AllotmentStatus.UNKNOWN,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Handle array, wrapper object with data property, or single object structure
    const targetObj = Array.isArray(raw)
      ? raw[0]
      : Array.isArray((raw as Record<string, unknown>).data)
        ? (
            (raw as Record<string, unknown>).data as Record<string, unknown>[]
          )[0]
        : (raw as Record<string, unknown>).data &&
          typeof (raw as Record<string, unknown>).data === 'object'
          ? ((raw as Record<string, unknown>).data as Record<string, unknown>)
          : (raw as Record<string, unknown>).result &&
            typeof (raw as Record<string, unknown>).result === 'object'
            ? Array.isArray((raw as Record<string, unknown>).result)
              ? ((raw as Record<string, unknown>).result as Record<string, unknown>[])[0]
              : ((raw as Record<string, unknown>).result as Record<string, unknown>)
            : raw;

    if (!targetObj) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Check for error field in JSON response (e.g. {"error": "Record Not Found"})
    const rawMsg = String(
      targetObj.error ||
        targetObj.message ||
        targetObj.msg ||
        targetObj.detail ||
        '',
    );
    const rawStatus = String(
      targetObj.status || targetObj.STATUS || targetObj.res_code || '',
    ).toUpperCase();

    if (rawMsg || rawStatus) {
      const lowerMsg = rawMsg.toLowerCase();
      if (
        lowerMsg.includes('not declared') ||
        lowerMsg.includes('not finalized') ||
        lowerMsg.includes('in process') ||
        lowerMsg.includes('under process') ||
        lowerMsg.includes('allotment awaited') ||
        rawStatus === 'NOT_DECLARED' ||
        rawStatus === 'AWAITED'
      ) {
        return {
          status: AllotmentStatus.NOT_YET_AVAILABLE,
          sourceCode: this.code,
          checkedAt,
          errorMessage: rawMsg || 'Allotment is awaited from registrar',
        };
      }

      if (
        lowerMsg.includes('not found') ||
        lowerMsg.includes('no record') ||
        lowerMsg.includes('no data') ||
        lowerMsg.includes('invalid pan') ||
        lowerMsg.includes('not applied') ||
        rawStatus === 'NOT_FOUND' ||
        rawStatus === 'NO_RECORD'
      ) {
        return {
          status: AllotmentStatus.APPLICATION_NOT_FOUND,
          sourceCode: this.code,
          checkedAt,
        };
      }

      if (
        rawMsg &&
        targetObj.App_Shares === undefined &&
        targetObj.applied_qty === undefined &&
        targetObj.All_Shares === undefined &&
        targetObj.allotted_qty === undefined
      ) {
        return {
          status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
          sourceCode: this.code,
          checkedAt,
          errorMessage: rawMsg,
        };
      }
    }

    const applied = Number(
      targetObj.App_Shares ??
        targetObj.applied_qty ??
        targetObj.app_qty ??
        targetObj.shares_applied ??
        targetObj.sharesApplied ??
        targetObj.applied ??
        targetObj.All_Shares ??
        0,
    );
    const allotted = Number(
      targetObj.All_Shares ??
        targetObj.allotted_qty ??
        targetObj.allot_qty ??
        targetObj.shares_allotted ??
        targetObj.sharesAllotted ??
        targetObj.allotted ??
        0,
    );

    let status: AllotmentStatus;
    if (allotted > 0) {
      status =
        applied > 0 && allotted < applied
          ? AllotmentStatus.PARTIALLY_ALLOTTED
          : AllotmentStatus.ALLOTTED;
    } else {
      status = AllotmentStatus.NOT_ALLOTTED;
    }

    const applicantName =
      targetObj.Name ||
      targetObj.NAME ||
      targetObj.name ||
      targetObj.applicant_name ||
      targetObj.investor_name
        ? String(
            targetObj.Name ||
              targetObj.NAME ||
              targetObj.name ||
              targetObj.applicant_name ||
              targetObj.investor_name,
          ).trim()
        : undefined;

    const rawResponseRef =
      targetObj.Appln_No ||
      targetObj.appln_no ||
      targetObj.app_no ||
      targetObj.application_no ||
      targetObj.appno
        ? String(
            targetObj.Appln_No ||
              targetObj.appln_no ||
              targetObj.app_no ||
              targetObj.application_no ||
              targetObj.appno,
          ).trim()
        : undefined;

    return {
      status,
      sharesApplied: applied,
      sharesAllotted: allotted,
      applicantName,
      sourceCode: this.code,
      checkedAt,
      rawResponseRef,
    };
  }

  private readonly CACHE_TTL_MS = 3600 * 1000; // 1 hour
  private cachedCompanyList: {
    items: Array<{ clientId: string; name: string }>;
    fetchedAt: number;
  } | null = null;
  private inFlightDiscovery: Promise<
    Array<{ clientId: string; name: string }>
  > | null = null;

  public async resolveRegistrarIpoCode(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult> {
    const checkedAt = new Date();
    try {
      const list = await this.fetchActiveCompanyList();
      const matched = this.matchCompanyInList(list, request, checkedAt);
      if (typeof matched === 'string') {
        return matched;
      }

      // If active list did not yield a match, check verified fallback registry if different
      if (list !== KFIN_VERIFIED_FALLBACK_REGISTRY) {
        const fallbackMatch = this.matchCompanyInList(
          KFIN_VERIFIED_FALLBACK_REGISTRY,
          request,
          checkedAt,
        );
        if (typeof fallbackMatch === 'string') {
          return fallbackMatch;
        }
      }

      return matched;
    } catch (err: unknown) {
      // Attempt fallback matching before surfacing error
      const fallbackMatch = this.matchCompanyInList(
        KFIN_VERIFIED_FALLBACK_REGISTRY,
        request,
        checkedAt,
      );
      if (typeof fallbackMatch === 'string') {
        return fallbackMatch;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('JSON') ||
        msg.includes('parse') ||
        msg.includes('bundle')
      ) {
        return {
          status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
          sourceCode: this.code,
          checkedAt,
          errorMessage: `Failed to parse KFintech active company bundle: ${msg}`,
        };
      }
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `KFintech portal unavailable: ${msg}`,
      };
    }
  }

  /**
   * Fetches the live KFintech active issue dataset from ipostatus.kfintech.com SPA bundle,
   * cached in-memory with a 1-hour TTL.
   */
  public async fetchActiveCompanyList(): Promise<
    Array<{ clientId: string; name: string }>
  > {
    const now = Date.now();
    if (
      this.cachedCompanyList &&
      now - this.cachedCompanyList.fetchedAt < this.CACHE_TTL_MS
    ) {
      return this.cachedCompanyList.items;
    }

    if (this.inFlightDiscovery) {
      return this.inFlightDiscovery;
    }

    this.inFlightDiscovery = this.discoverCompanyListFromPortal();
    try {
      const items = await this.inFlightDiscovery;
      this.cachedCompanyList = { items, fetchedAt: Date.now() };
      return items;
    } finally {
      this.inFlightDiscovery = null;
    }
  }

  private isHtmlPayload(text: string): boolean {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    return (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      trimmed.startsWith('<HTML') ||
      trimmed.includes('<head>') ||
      trimmed.includes('<body>')
    );
  }

  private async discoverCompanyListFromPortal(): Promise<
    Array<{ clientId: string; name: string }>
  > {
    const portalUrl =
      process.env.KFINTECH_PORTAL_URL || 'https://ipostatus.kfintech.com/';

    const browserHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: '*/*',
      Origin: 'https://ipostatus.kfintech.com',
      Referer: 'https://ipostatus.kfintech.com/',
    };

    try {
      // Step 1: Fetch root portal HTML to find the active main JS bundle
      const htmlResponse = await this.fetchWithRetry(portalUrl, {
        method: 'GET',
        headers: browserHeaders,
      });

      if (!htmlResponse.ok) {
        throw new Error(`Portal HTML returned HTTP ${htmlResponse.status}`);
      }

      const html = await htmlResponse.text();
      const scriptMatch = html.match(/src=["']?(\.?\/static\/js\/[^"'\s>]+)/i);

      let bundleUrl: string;
      if (scriptMatch && scriptMatch[1]) {
        const cleanPath = scriptMatch[1].replace(/^\./, '');
        bundleUrl = new URL(cleanPath, portalUrl).toString();
      } else {
        const base = portalUrl.endsWith('/') ? portalUrl.slice(0, -1) : portalUrl;
        bundleUrl = `${base}/static/js/main.js`;
      }

      // Step 2: Fetch active JS bundle
      const bundleResponse = await this.fetchWithRetry(bundleUrl, {
        method: 'GET',
        headers: browserHeaders,
      });

      if (!bundleResponse.ok) {
        throw new Error(`Portal JS bundle returned HTTP ${bundleResponse.status}`);
      }

      const bundleCode = await bundleResponse.text();
      if (this.isHtmlPayload(bundleCode)) {
        throw new Error('Received HTML payload instead of JavaScript bundle');
      }

      // Step 3: Extract embedded company JSON array from bundle
      const jsonRegex = /JSON\.parse\((['"`])(\[\s*\{[\s\S]*?\}\s*\])\1\)/;
      const match = jsonRegex.exec(bundleCode);

      let rawList: unknown[] = [];
      if (match && match[2]) {
        const rawJsonStr = match[2];
        try {
          const unescaped = rawJsonStr
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          const parsed = JSON.parse(unescaped);
          if (Array.isArray(parsed)) {
            rawList = parsed;
          }
        } catch (err: unknown) {
          throw new Error(
            `Failed to parse JSON string in KFintech bundle: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else {
        // Fallback: try direct array matching in bundle
        const directArrayRegex =
          /\[\s*\{"clientId"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"[^"]+"\}[\s\S]*?\]/;
        const directMatch = directArrayRegex.exec(bundleCode);
        if (directMatch) {
          try {
            const parsed = JSON.parse(directMatch[0]);
            if (Array.isArray(parsed)) {
              rawList = parsed;
            }
          } catch {
            // Ignore fallback error
          }
        }
      }

      if (rawList.length === 0) {
        throw new Error('Unable to extract active company list from KFintech bundle');
      }

      // Step 4: Validate extracted items
      const validated: Array<{ clientId: string; name: string }> = [];
      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const code = String(rec.clientId || rec.client_id || '').trim();
        const name = String(rec.name || rec.company_name || '').trim();

        // Ensure valid non-empty string, not UUID
        if (
          code &&
          name &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            code,
          )
        ) {
          validated.push({ clientId: code, name });
        }
      }

      if (validated.length === 0) {
        throw new Error('No valid company entries found in KFintech bundle');
      }

      return validated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Live KFintech bundle discovery failed (${msg}); falling back to verified registry (${KFIN_VERIFIED_FALLBACK_REGISTRY.length} companies)`,
      );
      return KFIN_VERIFIED_FALLBACK_REGISTRY;
    }
  }

  public matchCompanyInList(
    items: unknown[],
    request: CheckAllotmentRequest,
    checkedAt: Date = new Date(),
  ): string | NormalizedAllotmentResult {
    return matchRegistrarCompany(
      items,
      request,
      this.code,
      this.name,
      checkedAt,
    );
  }

  public normalizeName(name: string): string {
    return normalizeName(name);
  }
}
