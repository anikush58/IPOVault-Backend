import { Injectable, Logger } from '@nestjs/common';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';
import { BaseRegistrarAdapter } from './base-registrar.adapter';

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
        : raw;

    if (!targetObj) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Check for error field in JSON response (e.g. {"error": "Record Not Found"})
    if (targetObj.error) {
      const errStr = String(targetObj.error);
      if (
        errStr.toLowerCase().includes('not found') ||
        errStr.toLowerCase().includes('no record')
      ) {
        return {
          status: AllotmentStatus.APPLICATION_NOT_FOUND,
          sourceCode: this.code,
          checkedAt,
        };
      }
      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage: errStr,
      };
    }

    const applied = Number(
      targetObj.App_Shares ??
        targetObj.applied_qty ??
        targetObj.All_Shares ??
        0,
    );
    const allotted = Number(
      targetObj.All_Shares ?? targetObj.allotted_qty ?? 0,
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

    return {
      status,
      sharesApplied: applied,
      sharesAllotted: allotted,
      applicantName: targetObj.Name ? String(targetObj.Name).trim() : undefined,
      sourceCode: this.code,
      checkedAt,
      rawResponseRef: targetObj.Appln_No
        ? String(targetObj.Appln_No)
        : undefined,
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
      return this.matchCompanyInList(list, request, checkedAt);
    } catch (err: unknown) {
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

  private async discoverCompanyListFromPortal(): Promise<
    Array<{ clientId: string; name: string }>
  > {
    const portalUrl =
      process.env.KFINTECH_PORTAL_URL || 'https://ipostatus.kfintech.com/';

    // Step 1: Fetch root portal HTML to find the active main JS bundle
    const htmlResponse = await this.fetchWithRetry(portalUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Origin: 'https://ipostatus.kfintech.com',
        Referer: 'https://ipostatus.kfintech.com/',
      },
    });

    if (!htmlResponse.ok) {
      throw new Error(`Portal HTML returned HTTP ${htmlResponse.status}`);
    }

    const html = await htmlResponse.text();
    const jsMatch = html.match(
      /src=["'](\.?\/static\/js\/main\.[a-f0-9]+\.js)["']/i,
    );

    let bundleUrl: string;
    if (jsMatch) {
      const relPath = jsMatch[1].replace(/^\.\//, '/');
      const base = portalUrl.endsWith('/') ? portalUrl.slice(0, -1) : portalUrl;
      bundleUrl = `${base}${relPath.startsWith('/') ? '' : '/'}${relPath}`;
    } else {
      const base = portalUrl.endsWith('/') ? portalUrl.slice(0, -1) : portalUrl;
      bundleUrl = `${base}/static/js/main.js`;
    }

    // Step 2: Fetch active JS bundle
    const bundleResponse = await this.fetchWithRetry(bundleUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
        Origin: 'https://ipostatus.kfintech.com',
        Referer: 'https://ipostatus.kfintech.com/',
      },
    });

    if (!bundleResponse.ok) {
      throw new Error(`Portal JS bundle returned HTTP ${bundleResponse.status}`);
    }

    const bundleCode = await bundleResponse.text();

    // Step 3: Extract embedded company JSON array from bundle
    const jsonRegex = /JSON\.parse\('(\[\s*\{[\s\S]*?\}\s*\])'\)/;
    const match = jsonRegex.exec(bundleCode);

    let rawList: unknown[] = [];
    if (match) {
      const rawJsonStr = match[1];
      try {
        const unescaped = rawJsonStr.replace(/\\'/g, "'").replace(/\\"/g, '"');
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
          // Ignore fallback error and throw main parse error below
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
  }

  public matchCompanyInList(
    items: unknown[],
    request: CheckAllotmentRequest,
    checkedAt: Date = new Date(),
  ): string | NormalizedAllotmentResult {
    const targetSymbol = request.symbol?.trim().toUpperCase();
    const targetLegalName = this.normalizeName(request.companyLegalName || '');
    const targetDisplayName = this.normalizeName(request.companyName || '');

    interface CompanyItem {
      code: string;
      name: string;
      symbol?: string;
    }

    const normalizedItems: CompanyItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const code = String(
        rec.clientId || rec.client_id || rec.id || rec.code || rec.value || '',
      ).trim();
      const name = String(
        rec.name ||
          rec.company_name ||
          rec.companyName ||
          rec.caption ||
          rec.text ||
          '',
      ).trim();
      const symbol = rec.symbol
        ? String(rec.symbol).trim().toUpperCase()
        : undefined;

      if (
        code &&
        name &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          code,
        )
      ) {
        normalizedItems.push({ code, name, symbol });
      }
    }

    // Rule 1: Prefer exact symbol where both sides provide symbol
    if (targetSymbol) {
      const symbolMatches = normalizedItems.filter(
        (i) => i.symbol && i.symbol === targetSymbol,
      );
      if (symbolMatches.length === 1) {
        return symbolMatches[0].code;
      }
      if (symbolMatches.length > 1) {
        return {
          status: AllotmentStatus.NEEDS_REVIEW,
          sourceCode: this.code,
          checkedAt,
          errorMessage: `Multiple ambiguous matches found by symbol '${targetSymbol}' in KFintech live list`,
        };
      }
    }

    // Rule 2: Exact normalized company/legal name match
    const nameMatches = normalizedItems.filter((i) => {
      const normName = this.normalizeName(i.name);
      return (
        (targetLegalName.length > 0 && normName === targetLegalName) ||
        (targetDisplayName.length > 0 && normName === targetDisplayName)
      );
    });

    if (nameMatches.length === 1) {
      return nameMatches[0].code;
    }

    if (nameMatches.length > 1) {
      return {
        status: AllotmentStatus.NEEDS_REVIEW,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `Multiple ambiguous matches found by company name in KFintech live list`,
      };
    }

    return {
      status: AllotmentStatus.NOT_YET_AVAILABLE,
      sourceCode: this.code,
      checkedAt,
      errorMessage: `IPO not found in KFintech live active list`,
    };
  }

  private normalizeName(name: string): string {
    let clean = name.toLowerCase().trim();

    // Repeatedly strip known trailing offering and corporate suffixes
    let changed = true;
    while (changed) {
      const prev = clean;
      clean = clean
        .replace(
          /[\s\-_,.]+(ipo|sme\s+ipo|sme|rights\s+issue|buyback|fpo|reit|invit)$/i,
          '',
        )
        .replace(
          /[\s\-_,.]+(private\s+limited|pvt\s*\.?\s*ltd\.?|limited|ltd\.?)$/i,
          '',
        )
        .trim();
      changed = clean !== prev;
    }

    return clean
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
}
