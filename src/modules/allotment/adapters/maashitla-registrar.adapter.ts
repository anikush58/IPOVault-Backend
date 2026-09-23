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

@Injectable()
export class MaashitlaRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'MAASHITLA';
  readonly name = 'Maashitla Securities';
  override readonly defaultConcurrency = 3;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(MaashitlaRegistrarAdapter.name);

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking Maashitla allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by Maashitla Securities`,
      );
    }

    let companyName = request.registrarIpoCode?.trim();
    if (
      companyName &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        companyName,
      )
    ) {
      companyName = undefined;
    }

    if (!companyName) {
      const resolved = await this.resolveRegistrarIpoCode(request);
      if (typeof resolved !== 'string') {
        return resolved;
      }
      companyName = resolved;
    }

    try {
      return await this.queryMaashitlaApi(request, companyName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Maashitla fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `Maashitla rate limit encountered`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `Maashitla API unavailable: ${msg}`,
      );
    }
  }

  /**
   * Queries Maashitla's official REST API search endpoint.
   * Endpoint: GET https://api.maashitla.com/api/public-issue/search?company_name=...&pan=...
   */
  private async queryMaashitlaApi(
    request: CheckAllotmentRequest,
    companyName: string,
  ): Promise<NormalizedAllotmentResult> {
    const baseUrl =
      process.env.MAASHITLA_API_URL || 'https://api.maashitla.com/api';

    const params = new URLSearchParams({
      company_name: companyName,
    });

    const val = request.identifierValue.trim();
    if (request.identifierType === AllotmentIdentifierType.PAN) {
      params.set('pan', val.toUpperCase());
    } else if (
      request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER
    ) {
      params.set('application_no', val);
    } else {
      params.set('dpid_client_id', val);
    }

    const fullUrl = `${baseUrl}/public-issue/search?${params.toString()}`;

    const response = await this.fetchWithRetry(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        Origin: 'https://maashitla.com',
        Referer: 'https://maashitla.com/',
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
        errorMessage: 'Maashitla API rate limit exceeded',
      };
    }

    if (!response.ok) {
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `Maashitla returned HTTP status ${response.status}`,
      };
    }

    let parsed: Record<string, unknown> | Record<string, unknown>[];
    try {
      parsed = (await response.json()) as
        | Record<string, unknown>
        | Record<string, unknown>[];
    } catch {
      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'Failed to parse JSON response from Maashitla API',
      };
    }

    return this.normalizeMaashitlaResponse(parsed, checkedAt);
  }

  /**
   * Normalizes raw Maashitla API JSON payload into NormalizedAllotmentResult.
   */
  public normalizeMaashitlaResponse(
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

    if (targetObj.detail || targetObj.error || targetObj.message) {
      const errStr = String(
        targetObj.detail || targetObj.error || targetObj.message,
      );
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
      targetObj.shares_applied ??
        targetObj.sharesApplied ??
        targetObj.shares_hold ??
        0,
    );
    const allotted = Number(
      targetObj.shares_alloted ??
        targetObj.shares_allotted ??
        targetObj.sharesAllotted ??
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

    return {
      status,
      sharesApplied: applied,
      sharesAllotted: allotted,
      applicantName: targetObj.name
        ? String(targetObj.name).trim()
        : undefined,
      sourceCode: this.code,
      checkedAt,
      rawResponseRef: targetObj.application_no
        ? String(targetObj.application_no).trim()
        : undefined,
    };
  }

  private readonly CACHE_TTL_MS = 3600 * 1000; // 1 hour
  private cachedCompanyList: {
    items: Array<{ code: string; name: string }>;
    fetchedAt: number;
  } | null = null;
  private inFlightDiscovery: Promise<
    Array<{ code: string; name: string }>
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
      if (msg.includes('JSON') || msg.includes('parse')) {
        return {
          status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
          sourceCode: this.code,
          checkedAt,
          errorMessage: `Failed to parse Maashitla company list: ${msg}`,
        };
      }
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `Maashitla portal unavailable: ${msg}`,
      };
    }
  }

  /**
   * Fetches live active public issues list from Maashitla API, cached for 1 hour.
   * Endpoint: GET https://api.maashitla.com/api/public-issue/companies
   */
  public async fetchActiveCompanyList(): Promise<
    Array<{ code: string; name: string }>
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

    this.inFlightDiscovery = this.discoverCompanyListFromApi();
    try {
      const items = await this.inFlightDiscovery;
      this.cachedCompanyList = { items, fetchedAt: Date.now() };
      return items;
    } finally {
      this.inFlightDiscovery = null;
    }
  }

  private async discoverCompanyListFromApi(): Promise<
    Array<{ code: string; name: string }>
  > {
    const baseUrl =
      process.env.MAASHITLA_API_URL || 'https://api.maashitla.com/api';
    const companiesUrl = `${baseUrl}/public-issue/companies`;

    const response = await this.fetchWithRetry(companiesUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        Origin: 'https://maashitla.com',
        Referer: 'https://maashitla.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Maashitla companies endpoint returned HTTP ${response.status}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (err: unknown) {
      throw new Error(
        `Failed to parse JSON response from Maashitla companies API: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        'Expected an array of companies from Maashitla companies API',
      );
    }

    const validated: Array<{ code: string; name: string }> = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const name = String(
        rec.company_name || rec.companyName || rec.name || '',
      ).trim();

      if (name) {
        // Use company_name as both code (for query param) and name (for matching)
        validated.push({ code: name, name });
      }
    }

    if (validated.length === 0) {
      throw new Error('No valid company entries found in Maashitla response');
    }

    return validated;
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
