import { Injectable, Logger } from '@nestjs/common';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';
import { BaseRegistrarAdapter } from './base-registrar.adapter';
import { matchRegistrarCompany } from '../allotment.matching';

export interface SkylineCompanyOption {
  code: string;
  name: string;
}

@Injectable()
export class SkylineRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'SKYLINE';
  readonly name = 'Skyline Financial Services';
  override readonly defaultConcurrency = 3;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(SkylineRegistrarAdapter.name);

  // Cached company list with 10-minute TTL
  private cachedCompanies: SkylineCompanyOption[] | null = null;
  private cacheExpiry: number = 0;

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking Skyline allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by Skyline Financial Services`,
      );
    }

    let companyCode = request.registrarIpoCode?.trim();
    if (
      companyCode &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        companyCode,
      )
    ) {
      companyCode = undefined;
    }

    if (!companyCode) {
      const resolved = await this.resolveRegistrarIpoCode(request);
      if (typeof resolved !== 'string') {
        return resolved;
      }
      companyCode = resolved;
    }

    try {
      return await this.querySkylineHtml(request, companyCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Skyline fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `Skyline rate limit encountered`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `Skyline service unavailable: ${msg}`,
      );
    }
  }

  /**
   * Resolves the company ID for Skyline Financial Services using fuzzy matching.
   */
  async resolveRegistrarIpoCode(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult> {
    const checkedAt = new Date();
    try {
      const companies = await this.fetchCompanyList();
      if (!companies || companies.length === 0) {
        return this.createErrorResult(
          request,
          AllotmentStatus.REGISTRAR_UNRESOLVED,
          'No active IPO issues found on Skyline Financial Services',
        );
      }

      return matchRegistrarCompany(
        companies,
        request,
        this.code,
        this.name,
        checkedAt,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `Failed to discover active issues from Skyline: ${msg}`,
      );
    }
  }

  /**
   * Fetches and parses the list of companies from Skyline's IPO portal.
   */
  async fetchCompanyList(): Promise<SkylineCompanyOption[]> {
    const now = Date.now();
    if (this.cachedCompanies && this.cacheExpiry > now) {
      return this.cachedCompanies;
    }

    const baseUrl =
      process.env.SKYLINE_BASE_URL || 'https://www.skylinerta.com';
    const response = await this.fetchWithRetry(`${baseUrl}/ipo.php`, {
      method: 'GET',
      headers: {
        Referer: `${baseUrl}/`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Skyline company list: HTTP ${response.status}`);
    }

    const html = await response.text();
    const companies = this.parseCompanyOptions(html);

    if (companies.length > 0) {
      this.cachedCompanies = companies;
      this.cacheExpiry = now + 210_000; // 3.5 minutes TTL (3-4 min window to prevent per-IPO HTTP flood)
    }

    return companies;
  }

  /**
   * Parses `<select name="company" ...>` options from Skyline HTML.
   */
  parseCompanyOptions(html: string): SkylineCompanyOption[] {
    const options: SkylineCompanyOption[] = [];
    const selectMatch = html.match(
      /<select[^>]+name=["']company["'][\s\S]*?<\/select>/i,
    );
    if (!selectMatch) return options;

    const regex = /<option\s+value=["']([^"']*)["'][^>]*>([^<]+)<\/option>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(selectMatch[0])) !== null) {
      const code = m[1]?.trim();
      const name = m[2]?.trim();
      if (code && code !== '0' && code !== '' && !code.toLowerCase().includes('select')) {
        options.push({ code, name });
      }
    }

    return options;
  }

  /**
   * Executes the 2-step search flow against Skyline Financial Services:
   * 1. Initialize session and obtain CSRF token.
   * 2. Submit allotment search request.
   */
  private async querySkylineHtml(
    request: CheckAllotmentRequest,
    companyCode: string,
  ): Promise<NormalizedAllotmentResult> {
    const baseUrl =
      process.env.SKYLINE_BASE_URL || 'https://www.skylinerta.com';

    // Step 1: Initialize session & CSRF token for the selected company
    const initResponse = await this.fetchWithRetry(
      `${baseUrl}/display_application.php`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: baseUrl,
          Referer: `${baseUrl}/ipo.php`,
        },
        body: `company=${encodeURIComponent(companyCode)}`,
      },
    );

    const initHtml = await initResponse.text();
    const csrfMatch =
      initHtml.match(/name=["']csrf_token["'][^>]*value=["']([^"']+)["']/i) ||
      initHtml.match(/value=["']([^"']+)["'][^>]*name=["']csrf_token["']/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    // Extract cookie from init response if provided
    const setCookie = initResponse.headers.get('set-cookie');
    const cookieHeader = setCookie ? setCookie.split(';')[0] : '';

    // Step 2: Prepare search parameters
    const val = request.identifierValue.trim();
    const searchParams = new URLSearchParams();
    searchParams.append('company', companyCode);
    searchParams.append('csrf_token', csrfToken);
    searchParams.append('action', 'search');

    if (request.identifierType === AllotmentIdentifierType.PAN) {
      searchParams.append('pan', val.toUpperCase());
      searchParams.append('application_no', '');
      searchParams.append('client_id', '');
    } else if (
      request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER
    ) {
      searchParams.append('pan', '');
      searchParams.append('application_no', val);
      searchParams.append('client_id', '');
    } else {
      searchParams.append('pan', '');
      searchParams.append('application_no', '');
      searchParams.append('client_id', val);
    }

    const searchResponse = await this.fetchWithRetry(
      `${baseUrl}/display_application.php`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          Origin: baseUrl,
          Referer: `${baseUrl}/display_application.php`,
        },
        body: searchParams.toString(),
      },
    );

    const checkedAt = new Date();

    if (searchResponse.status === 404) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    if (searchResponse.status === 429) {
      return {
        status: AllotmentStatus.RATE_LIMITED,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'Skyline rate limit exceeded',
      };
    }

    if (!searchResponse.ok) {
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `Skyline returned HTTP status ${searchResponse.status}`,
      };
    }

    const searchHtml = await searchResponse.text();
    return this.parseAllotmentResultHtml(searchHtml, checkedAt);
  }

  /**
   * Parses the HTML result section from Skyline allotment search.
   */
  parseAllotmentResultHtml(
    html: string,
    checkedAt: Date,
  ): NormalizedAllotmentResult {
    // Check if result section or table is present
    const hasResultSection =
      html.includes('resultsec') ||
      html.includes('<table') ||
      html.includes('dtl_list');

    if (!hasResultSection) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Check for explicit "No record found" or invalid application markers
    if (
      /no\s+record\s+found/i.test(html) ||
      /no\s+data\s+found/i.test(html) ||
      /record\s+not\s+found/i.test(html)
    ) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    let applicantName: string | undefined;
    let applicationNumber: string | undefined;
    let sharesApplied: number = 0;
    let sharesAllotted: number = 0;
    let amountRefunded: number | undefined;
    let matchedData = false;

    // Pattern 1: Table-based result
    const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
    if (tableMatch) {
      const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(
        (m) => m[0],
      );
      if (rows.length >= 2) {
        // Parse headers from row 0
        const headers = [
          ...rows[0].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi),
        ].map((m) => m[1].replace(/<[^>]+>/g, '').trim().toUpperCase());

        // Parse data from row 1
        const cells = [
          ...rows[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
        ].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

        if (cells.length > 0) {
          matchedData = true;
          headers.forEach((h, idx) => {
            const val = cells[idx] || '';
            if (h.includes('APPLIED')) {
              const parsed = parseInt(val.replace(/[^0-9]/g, ''), 10);
              if (!isNaN(parsed)) sharesApplied = parsed;
            } else if (h.includes('ALLOT')) {
              const parsed = parseInt(val.replace(/[^0-9]/g, ''), 10);
              if (!isNaN(parsed)) sharesAllotted = parsed;
            } else if (h.includes('NAME')) {
              applicantName = val;
            } else if (h.includes('APP') || h.includes('APPLICATION')) {
              applicationNumber = val;
            } else if (h.includes('REFUND') || h.includes('AMOUNT')) {
              const parsed = parseFloat(val.replace(/[^0-9.]/g, ''));
              if (!isNaN(parsed)) amountRefunded = parsed;
            }
          });
        }
      }
    }

    // Pattern 2: List / div-based result (`.resultsec` or `.dtl_list`)
    if (!matchedData && html.includes('resultsec')) {
      const listItems = [
        ...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi),
      ].map((m) => m[1]);

      for (const item of listItems) {
        const cleanText = item.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (/name/i.test(cleanText)) {
          const parts = cleanText.split(/:\s*/);
          if (parts[1]) {
            applicantName = parts[1].trim();
            matchedData = true;
          }
        }
        if (/app(?:lication)?\s*(?:no|number)?/i.test(cleanText)) {
          const parts = cleanText.split(/:\s*/);
          if (parts[1]) {
            applicationNumber = parts[1].trim();
            matchedData = true;
          }
        }
        if (/applied/i.test(cleanText)) {
          const num = parseInt(cleanText.replace(/[^0-9]/g, ''), 10);
          if (!isNaN(num)) {
            sharesApplied = num;
            matchedData = true;
          }
        }
        if (/allot(?:ted)?/i.test(cleanText)) {
          const num = parseInt(cleanText.replace(/[^0-9]/g, ''), 10);
          if (!isNaN(num)) {
            sharesAllotted = num;
            matchedData = true;
          }
        }
      }
    }

    if (!matchedData) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Determine normalized status
    let status = AllotmentStatus.NOT_ALLOTTED;
    if (sharesAllotted > 0) {
      status =
        sharesApplied > 0 && sharesAllotted < sharesApplied
          ? AllotmentStatus.PARTIALLY_ALLOTTED
          : AllotmentStatus.ALLOTTED;
    }

    return {
      status,
      sourceCode: this.code,
      checkedAt,
      sharesApplied: sharesApplied || undefined,
      sharesAllotted,
      applicantName,
      rawResponseRef: applicationNumber,
      amountRefunded,
    };
  }
}
