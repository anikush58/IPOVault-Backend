import { Injectable, Logger } from '@nestjs/common';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CategoryAllotmentResult,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';
import { BaseRegistrarAdapter } from './base-registrar.adapter';
import {
  matchRegistrarCompany,
  normalizeName,
} from '../allotment.matching';
import {
  mapRegistrarCategory,
  deduplicateCategoryRecords,
  deriveOverallAllotment,
} from '../allotment-category.utils';

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
   * Queries Maashitla's allotment status.
   * Primary: AWS API Gateway (used by live official portal https://maashitla.com/allotment-status/public-issues)
   * Fallback: Legacy REST search endpoint (/public-issue/search)
   */
  private async queryMaashitlaApi(
    request: CheckAllotmentRequest,
    companyIdentifier: string,
  ): Promise<NormalizedAllotmentResult> {
    const checkedAt = new Date();
    const awsBaseUrl =
      process.env.MAASHITLA_AWS_API_URL ||
      'https://pnjbvxj6md.execute-api.ap-south-1.amazonaws.com/prod/check';

    const slug = this.toSlug(companyIdentifier);
    const paramKey =
      request.identifierType === AllotmentIdentifierType.PAN
        ? 'pan'
        : request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER
          ? 'application_no'
          : 'dpid_client_id';
    const paramVal =
      request.identifierType === AllotmentIdentifierType.PAN
        ? request.identifierValue.trim().toUpperCase()
        : request.identifierValue.trim();

    try {
      const awsUrl = `${awsBaseUrl}/${encodeURIComponent(slug)}?${encodeURIComponent(paramKey)}=${encodeURIComponent(paramVal)}`;
      const response = await this.fetchWithRetry(awsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Origin: 'https://maashitla.com',
          Referer: 'https://maashitla.com/',
        },
      });

      if (response.status === 429) {
        return {
          status: AllotmentStatus.RATE_LIMITED,
          sourceCode: this.code,
          checkedAt,
          errorMessage: 'Maashitla API rate limit exceeded',
        };
      }

      if (response.status === 404) {
        return {
          status: AllotmentStatus.APPLICATION_NOT_FOUND,
          sourceCode: this.code,
          checkedAt,
        };
      }

      if (response.ok) {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = (await response.json()) as Record<string, unknown>;
        } catch {
          return {
            status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
            sourceCode: this.code,
            checkedAt,
            errorMessage: 'Failed to parse JSON response from Maashitla AWS gateway',
          };
        }

        if (
          !parsed ||
          Object.keys(parsed).length === 0 ||
          parsed.name == null
        ) {
          return {
            status: AllotmentStatus.APPLICATION_NOT_FOUND,
            sourceCode: this.code,
            checkedAt,
          };
        }

        return this.normalizeMaashitlaResponse(parsed, checkedAt);
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Maashitla AWS gateway check failed, attempting fallback to legacy API: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.queryLegacyMaashitlaApi(
      request,
      companyIdentifier,
      checkedAt,
    );
  }

  /**
   * Fallback for older offerings or legacy environments.
   * Endpoint: GET https://api.maashitla.com/api/public-issue/search?company_name=...
   */
  private async queryLegacyMaashitlaApi(
    request: CheckAllotmentRequest,
    companyName: string,
    checkedAt: Date,
  ): Promise<NormalizedAllotmentResult> {
    const baseUrl =
      process.env.MAASHITLA_API_URL || 'https://api.maashitla.com/api';

    const params = new URLSearchParams({
      company_name: companyName.trim().toUpperCase(),
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
   * Resolves or converts a company identifier into Maashitla's official slug.
   * Example: "WISCON INDUSTRIES LIMITED" -> "wiscon-industries-limited"
   */
  public toSlug(companyIdentifier: string): string {
    const trimmed = companyIdentifier.trim();
    if (!trimmed) return '';

    // If it already matches a kebab-case slug format
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(trimmed)) {
      return trimmed;
    }

    // Check if we have an exact match in our cached directory
    if (this.cachedCompanyList?.items) {
      const match = this.cachedCompanyList.items.find(
        (c) =>
          c.name.toLowerCase() === trimmed.toLowerCase() ||
          c.code.toLowerCase() === trimmed.toLowerCase(),
      );
      if (match && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(match.code)) {
        return match.code;
      }
    }

    return trimmed
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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

    const rawList: Record<string, unknown>[] = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : Array.isArray((raw as Record<string, unknown>).data)
        ? ((raw as Record<string, unknown>).data as Record<string, unknown>[])
        : Array.isArray((raw as Record<string, unknown>).result)
          ? ((raw as Record<string, unknown>).result as Record<string, unknown>[])
          : [];

    const parseRecord = (obj: Record<string, unknown>) => {
      const rawMsg = String(
        obj.detail || obj.error || obj.message || obj.msg || '',
      );
      const rawStatus = String(
        obj.status || obj.allotment_status || obj.allotmentStatus || '',
      ).toUpperCase();

      if (rawMsg || rawStatus) {
        const lowerMsg = rawMsg.toLowerCase();
        if (
          lowerMsg.includes('not declared') ||
          lowerMsg.includes('not finalized') ||
          lowerMsg.includes('in process') ||
          lowerMsg.includes('under process') ||
          lowerMsg.includes('basis of allotment') ||
          rawStatus === 'NOT_DECLARED' ||
          rawStatus === 'AWAITED'
        ) {
          return { errorStatus: AllotmentStatus.NOT_YET_AVAILABLE, rawMsg };
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
          return { errorStatus: AllotmentStatus.APPLICATION_NOT_FOUND, rawMsg };
        }

        if (
          rawMsg &&
          obj.shares_applied === undefined &&
          obj.shares_alloted === undefined &&
          obj.shares_allotted === undefined &&
          obj.sharesApplied === undefined &&
          obj.sharesAllotted === undefined
        ) {
          return { errorStatus: AllotmentStatus.SOURCE_RESPONSE_INVALID, rawMsg };
        }
      }

      if (
        !obj.name &&
        !obj.applicant_name &&
        !obj.client_name &&
        !obj.shareholder_name &&
        !obj.investor_name &&
        !obj.holder_name &&
        obj.shares_applied === undefined &&
        obj.sharesApplied === undefined &&
        obj.shares_allotted === undefined &&
        obj.shares_alloted === undefined
      ) {
        return {
          errorStatus: AllotmentStatus.APPLICATION_NOT_FOUND,
          rawMsg: 'No allotment record found',
        };
      }

      const applied = Number(
        obj.shares_applied ??
          obj.sharesApplied ??
          obj.shares_app ??
          obj.applied_shares ??
          obj.applied ??
          obj.shares_hold ??
          obj.app_shares ??
          obj.applied_qty ??
          obj.no_of_shares_applied ??
          0,
      );
      const allotted = Number(
        obj.shares_alloted ??
          obj.shares_allotted ??
          obj.sharesAllotted ??
          obj.alloted_shares ??
          obj.allotted_shares ??
          obj.allot_shares ??
          obj.alloted ??
          obj.allotted ??
          obj.allotted_qty ??
          obj.no_of_shares_allotted ??
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

      const rawCat =
        obj.Category ??
        obj.category ??
        obj.CAT ??
        obj.category_type ??
        obj.applied_category;
      const rawCategoryStr =
        rawCat !== undefined && rawCat !== null ? String(rawCat).trim() : undefined;
      const canonicalCategory = mapRegistrarCategory(rawCategoryStr);

      const applicantName =
        obj.name ||
        obj.applicant_name ||
        obj.client_name ||
        obj.shareholder_name ||
        obj.investor_name ||
        obj.holder_name
          ? String(
              obj.name ||
                obj.applicant_name ||
                obj.client_name ||
                obj.shareholder_name ||
                obj.investor_name ||
                obj.holder_name,
            ).trim()
          : undefined;

      const rawResponseRef =
        obj.application_no ||
        obj.app_no ||
        obj.appno ||
        obj.appl_no ||
        obj.application_number
          ? String(
              obj.application_no ||
                obj.app_no ||
                obj.appno ||
                obj.appl_no ||
                obj.application_number,
            ).trim()
          : undefined;

      const categoryResult: CategoryAllotmentResult = {
        category: canonicalCategory,
        rawCategory: rawCategoryStr,
        status,
        sharesApplied: applied > 0 ? applied : undefined,
        sharesAllotted: allotted,
        applicationNumber: rawResponseRef,
      };

      return {
        categoryResult,
        applicantName,
        rawResponseRef,
      };
    };

    if (rawList.length > 0) {
      const parsedItems = rawList.map(parseRecord);
      const errorItem = parsedItems.find((p) => Boolean(p.errorStatus));
      if (errorItem && errorItem.errorStatus && parsedItems.length === 1) {
        return {
          status: errorItem.errorStatus,
          sourceCode: this.code,
          checkedAt,
          errorMessage: errorItem.rawMsg,
        };
      }

      const validCategories: CategoryAllotmentResult[] = [];
      let applicantName: string | undefined;
      let rawResponseRef: string | undefined;

      for (const p of parsedItems) {
        if (p.categoryResult) {
          validCategories.push(p.categoryResult);
          if (!applicantName && p.applicantName) applicantName = p.applicantName;
          if (!rawResponseRef && p.rawResponseRef) rawResponseRef = p.rawResponseRef;
        } else if (p.errorStatus) {
          validCategories.push({
            status: p.errorStatus,
            sharesAllotted: 0,
          });
        }
      }

      if (validCategories.length === 0) {
        return {
          status: errorItem?.errorStatus || AllotmentStatus.APPLICATION_NOT_FOUND,
          sourceCode: this.code,
          checkedAt,
          errorMessage: errorItem?.rawMsg,
        };
      }

      const deduped = deduplicateCategoryRecords(validCategories);
      const overall = deriveOverallAllotment(deduped);

      return {
        status: overall.status,
        sharesApplied:
          overall.sharesApplied > 0 ? overall.sharesApplied : undefined,
        sharesAllotted: overall.sharesAllotted,
        applicantName,
        sourceCode: this.code,
        checkedAt,
        rawResponseRef,
        categoryResults: deduped,
      };
    }

    const targetObj =
      (raw as Record<string, unknown>).data &&
      typeof (raw as Record<string, unknown>).data === 'object'
        ? ((raw as Record<string, unknown>).data as Record<string, unknown>)
        : (raw as Record<string, unknown>).result &&
            typeof (raw as Record<string, unknown>).result === 'object'
          ? ((raw as Record<string, unknown>).result as Record<string, unknown>)
          : (raw as Record<string, unknown>);

    if (!targetObj || Object.keys(targetObj).length === 0) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const parsed = parseRecord(targetObj);
    if (parsed.errorStatus) {
      return {
        status: parsed.errorStatus,
        sourceCode: this.code,
        checkedAt,
        errorMessage: parsed.rawMsg,
      };
    }

    if (parsed.categoryResult) {
      return {
        status: parsed.categoryResult.status,
        sharesApplied: parsed.categoryResult.sharesApplied,
        sharesAllotted: parsed.categoryResult.sharesAllotted,
        applicantName: parsed.applicantName,
        sourceCode: this.code,
        checkedAt,
        rawResponseRef: parsed.rawResponseRef,
        categoryResults: [parsed.categoryResult],
      };
    }

    return {
      status: AllotmentStatus.APPLICATION_NOT_FOUND,
      sourceCode: this.code,
      checkedAt,
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
   * Endpoints: GET https://api.maashitla.com/api/public-issue/companies & /api/companies
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
    const endpoints = [
      '/company-directory',
      '/public-issue/companies',
      '/companies',
    ];
    const validated: Array<{ code: string; name: string }> = [];
    const seen = new Set<string>();

    for (const endpoint of endpoints) {
      try {
        const response = await this.fetchWithRetry(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            Origin: 'https://maashitla.com',
            Referer: 'https://maashitla.com/',
            Accept: 'application/json, text/plain, */*',
          },
        });

        if (!response.ok) continue;

        let parsed: unknown;
        try {
          parsed = await response.json();
        } catch {
          continue;
        }

        const rawList = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as Record<string, unknown>)?.companies)
            ? ((parsed as Record<string, unknown>).companies as unknown[])
            : Array.isArray((parsed as Record<string, unknown>)?.data)
              ? ((parsed as Record<string, unknown>).data as unknown[])
              : Array.isArray((parsed as Record<string, unknown>)?.result)
                ? ((parsed as Record<string, unknown>).result as unknown[])
                : [];

        for (const item of rawList) {
          if (!item || typeof item !== 'object') continue;
          const rec = item as Record<string, unknown>;
          const name = String(
            rec.company_name || rec.companyName || rec.name || '',
          ).trim();
          const slug = String(
            rec.company_slug || rec.slug || rec.company_id || '',
          ).trim();

          const candidateCode = slug || name;

          if (name && !seen.has(name.toLowerCase())) {
            seen.add(name.toLowerCase());
            validated.push({ code: candidateCode, name });
          }
        }
      } catch {
        // Continue to next endpoint
      }
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
