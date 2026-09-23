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

export interface PurvaCompanyOption {
  code: string;
  name: string;
}

@Injectable()
export class PurvaRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'PURVA';
  readonly name = 'Purva Sharegistry';
  override readonly defaultConcurrency = 3;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
  ]);

  private readonly logger = new Logger(PurvaRegistrarAdapter.name);

  // Cached company list with 10-minute TTL
  private cachedCompanies: PurvaCompanyOption[] | null = null;
  private cacheExpiry: number = 0;

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking Purva Sharegistry allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by Purva Sharegistry (supports PAN and Application Number only)`,
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
      return await this.queryPurvaHtml(request, companyCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Purva Sharegistry fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `Purva Sharegistry rate limit encountered`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `Purva Sharegistry service unavailable: ${msg}`,
      );
    }
  }

  /**
   * Resolves the company ID for Purva Sharegistry using fuzzy matching.
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
          'No active IPO issues found on Purva Sharegistry',
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
        `Failed to discover active issues from Purva Sharegistry: ${msg}`,
      );
    }
  }

  /**
   * Fetches and parses the list of active companies from Purva's IPO query portal.
   */
  async fetchCompanyList(): Promise<PurvaCompanyOption[]> {
    const now = Date.now();
    if (this.cachedCompanies && this.cacheExpiry > now) {
      return this.cachedCompanies;
    }

    const baseUrl =
      process.env.PURVA_BASE_URL || 'https://www.purvashare.com';
    const response = await this.fetchWithRetry(
      `${baseUrl}/investor-service/ipo-query`,
      {
        method: 'GET',
        headers: {
          Referer: `${baseUrl}/`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Purva company list: HTTP ${response.status}`,
      );
    }

    const html = await response.text();
    const companies = this.parseCompanyOptions(html);

    if (companies.length > 0) {
      this.cachedCompanies = companies;
      this.cacheExpiry = now + 10 * 60 * 1000; // 10 minutes TTL
    }

    return companies;
  }

  /**
   * Parses `<select name="company_id" ...>` options from Purva HTML.
   */
  parseCompanyOptions(html: string): PurvaCompanyOption[] {
    const options: PurvaCompanyOption[] = [];
    const selectMatch = html.match(
      /<select[^>]+name=["']company_id["'][\s\S]*?<\/select>/i,
    );
    if (!selectMatch) return options;

    const regex = /<option\s+value=["']([^"']*)["'][^>]*>([^<]+)<\/option>/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(selectMatch[0])) !== null) {
      const code = m[1]?.trim();
      const name = m[2]?.trim();
      if (
        code &&
        code !== '0' &&
        code !== '' &&
        !code.toLowerCase().includes('choose') &&
        !code.toLowerCase().includes('select') &&
        !name.toLowerCase().includes('choose a company')
      ) {
        options.push({ code, name });
      }
    }

    return options;
  }

  /**
   * Executes the 2-step search flow against Purva Sharegistry:
   * 1. GET page to obtain CSRF middleware token and session cookie.
   * 2. POST allotment search request with CSRF token and form data.
   */
  private async queryPurvaHtml(
    request: CheckAllotmentRequest,
    companyCode: string,
  ): Promise<NormalizedAllotmentResult> {
    const baseUrl =
      process.env.PURVA_BASE_URL || 'https://www.purvashare.com';
    const targetUrl = `${baseUrl}/investor-service/ipo-query`;

    // Step 1: Obtain CSRF token and cookie from initial GET
    const initResponse = await this.fetchWithRetry(targetUrl, {
      method: 'GET',
      headers: {
        Referer: `${baseUrl}/`,
      },
    });

    const initHtml = await initResponse.text();
    const csrfMatch =
      initHtml.match(
        /name=["']csrfmiddlewaretoken["'][^>]*value=["']([^"']+)["']/i,
      ) ||
      initHtml.match(
        /value=["']([^"']+)["'][^>]*name=["']csrfmiddlewaretoken["']/i,
      );
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const setCookie = initResponse.headers.get('set-cookie');
    const cookieHeader = setCookie ? setCookie.split(';')[0] : '';

    // Step 2: Prepare POST body
    const val = request.identifierValue.trim();
    const searchParams = new URLSearchParams();
    searchParams.append('csrfmiddlewaretoken', csrfToken);
    searchParams.append('company_id', companyCode);

    if (request.identifierType === AllotmentIdentifierType.PAN) {
      searchParams.append('panNumber', val.toUpperCase());
      searchParams.append('applicationNumber', '');
    } else {
      searchParams.append('panNumber', '');
      searchParams.append('applicationNumber', val);
    }

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: baseUrl,
      Referer: targetUrl,
    };
    if (cookieHeader) {
      postHeaders['Cookie'] = cookieHeader;
    }

    const searchResponse = await this.fetchWithRetry(targetUrl, {
      method: 'POST',
      headers: postHeaders,
      body: searchParams.toString(),
      redirect: 'manual',
    });

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
        errorMessage: 'Purva Sharegistry rate limit exceeded',
      };
    }

    // Handle 302 Redirect (Django typical PRG pattern)
    if (
      searchResponse.status === 302 ||
      searchResponse.status === 301 ||
      searchResponse.status === 303 ||
      searchResponse.status === 307
    ) {
      const redirectLocation = searchResponse.headers.get('location') || targetUrl;
      const fullRedirectUrl = redirectLocation.startsWith('http')
        ? redirectLocation
        : `${baseUrl}${redirectLocation.startsWith('/') ? '' : '/'}${redirectLocation}`;

      const postSetCookie = searchResponse.headers.get('set-cookie');
      const combinedCookies = [cookieHeader, postSetCookie]
        .filter(Boolean)
        .map((c) => (c as string).split(';')[0])
        .join('; ');

      // Check messages cookie if present for direct error message
      if (postSetCookie && postSetCookie.includes('messages=')) {
        const msgCookieMatch = postSetCookie.match(/messages=([^;]+)/);
        if (msgCookieMatch) {
          try {
            const decoded = Buffer.from(msgCookieMatch[1], 'base64').toString('utf8');
            if (
              /no\s+record\s+found/i.test(decoded) ||
              /invalid/i.test(decoded) ||
              /error/i.test(decoded)
            ) {
              return {
                status: AllotmentStatus.APPLICATION_NOT_FOUND,
                sourceCode: this.code,
                checkedAt,
              };
            }
          } catch {
            // ignore cookie decode error and continue to fetch redirected page
          }
        }
      }

      const redirectResponse = await this.fetchWithRetry(fullRedirectUrl, {
        method: 'GET',
        headers: {
          Referer: targetUrl,
          ...(combinedCookies ? { Cookie: combinedCookies } : {}),
        },
      });

      if (!redirectResponse.ok) {
        return {
          status: AllotmentStatus.SOURCE_UNAVAILABLE,
          sourceCode: this.code,
          checkedAt,
          errorMessage: `Purva Sharegistry returned HTTP status ${redirectResponse.status}`,
        };
      }

      const redirectHtml = await redirectResponse.text();
      return this.parseAllotmentResultHtml(redirectHtml, checkedAt);
    }

    if (!searchResponse.ok) {
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `Purva Sharegistry returned HTTP status ${searchResponse.status}`,
      };
    }

    const searchHtml = await searchResponse.text();
    return this.parseAllotmentResultHtml(searchHtml, checkedAt);
  }

  /**
   * Parses the HTML result section from Purva Sharegistry allotment search.
   */
  parseAllotmentResultHtml(
    html: string,
    checkedAt: Date,
  ): NormalizedAllotmentResult {
    // Check for explicit "No record found" or invalid application markers
    if (
      /no\s+record\s+found/i.test(html) ||
      /no\s+data\s+found/i.test(html) ||
      /record\s+not\s+found/i.test(html) ||
      /error\s+processing\s+your\s+request/i.test(html)
    ) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const hasResultSection =
      html.includes('results-section') ||
      html.includes('results-table') ||
      html.includes('<table');

    if (!hasResultSection) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Extract table rows
    const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const tableContent = tableMatch[1];
    const headers: string[] = [];
    const headerRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
    let thMatch: RegExpExecArray | null;
    while ((thMatch = headerRegex.exec(tableContent)) !== null) {
      headers.push(
        thMatch[1]
          .replace(/<[^>]+>/g, '')
          .trim()
          .toLowerCase(),
      );
    }

    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = rowRegex.exec(tableContent)) !== null) {
      const rowContent = trMatch[1];
      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = cellRegex.exec(rowContent)) !== null) {
        cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
      }
      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    if (rows.length === 0) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const firstRow = rows[0];
    let applicantName: string | undefined;
    let sharesApplied: number | undefined;
    let sharesAllotted: number | undefined;

    if (headers.length > 0) {
      headers.forEach((header, idx) => {
        const val = firstRow[idx];
        if (!val) return;

        if (
          header.includes('name') ||
          header.includes('applicant') ||
          header.includes('investor')
        ) {
          applicantName = val;
        } else if (
          header.includes('applied') ||
          header.includes('bid') ||
          header.includes('shares applied')
        ) {
          const num = parseInt(val.replace(/,/g, ''), 10);
          if (!isNaN(num)) sharesApplied = num;
        } else if (
          header.includes('allot') ||
          header.includes('allotted') ||
          header.includes('shares allotted')
        ) {
          const num = parseInt(val.replace(/,/g, ''), 10);
          if (!isNaN(num)) sharesAllotted = num;
        }
      });
    }

    // Determine status based on sharesAllotted
    let status = AllotmentStatus.ALLOTTED;
    if (sharesAllotted !== undefined) {
      if (sharesAllotted === 0) {
        status = AllotmentStatus.NOT_ALLOTTED;
      } else if (
        sharesApplied !== undefined &&
        sharesAllotted < sharesApplied
      ) {
        status = AllotmentStatus.PARTIALLY_ALLOTTED;
      } else {
        status = AllotmentStatus.ALLOTTED;
      }
    }

    return {
      status,
      sharesApplied,
      sharesAllotted,
      applicantName,
      sourceCode: this.code,
      checkedAt,
    };
  }
}
