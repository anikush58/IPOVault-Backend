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

  public async resolveRegistrarIpoCode(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult> {
    const checkedAt = new Date();
    try {
      const companyListUrl =
        process.env.KFINTECH_COMPANY_LIST_URL ||
        process.env.KFINTECH_API_URL ||
        'https://0uz601ms56.execute-api.ap-south-1.amazonaws.com/prod/api/query?type=company';

      const url = companyListUrl.includes('?')
        ? companyListUrl
        : `${companyListUrl}?type=company`;

      const response = await this.fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Origin: 'https://ipostatus.kfintech.com',
          Referer: 'https://ipostatus.kfintech.com/',
          Accept: 'application/json, text/plain, */*',
        },
      });

      if (!response.ok) {
        return {
          status: AllotmentStatus.SOURCE_UNAVAILABLE,
          sourceCode: this.code,
          checkedAt,
          errorMessage: `KFintech company list returned HTTP status ${response.status}`,
        };
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        return {
          status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
          sourceCode: this.code,
          checkedAt,
          errorMessage: 'Failed to parse JSON response from KFintech company list',
        };
      }

      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as Record<string, unknown>)?.data)
          ? ((raw as Record<string, unknown>).data as unknown[])
          : [];

      return this.matchCompanyInList(list, request, checkedAt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `KFintech company list unavailable: ${msg}`,
      };
    }
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
      const code = String(rec.client_id || rec.id || rec.code || rec.value || '').trim();
      const name = String(rec.company_name || rec.name || rec.caption || rec.text || '').trim();
      const symbol = rec.symbol ? String(rec.symbol).trim().toUpperCase() : undefined;

      if (code && name) {
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
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
}
