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

export interface BigshareCompanyOption {
  code: string;
  name: string;
}

@Injectable()
export class BigshareRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'BIGSHARE';
  readonly name = 'Bigshare Services';
  override readonly defaultConcurrency = 3;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(BigshareRegistrarAdapter.name);

  // Cached company list with 10-minute TTL
  private cachedCompanies: BigshareCompanyOption[] | null = null;
  private cacheExpiry: number = 0;

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking Bigshare allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by Bigshare Services`,
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
      return await this.queryBigshare(request, companyCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Bigshare fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `Bigshare rate limit encountered`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `Bigshare service unavailable: ${msg}`,
      );
    }
  }

  /**
   * Resolves the company ID for Bigshare Services using fuzzy matching.
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
          'No active IPO issues found on Bigshare Services',
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
        `Failed to discover active issues from Bigshare Services: ${msg}`,
      );
    }
  }

  /**
   * Fetches and parses active company list from Bigshare portal.
   */
  async fetchCompanyList(): Promise<BigshareCompanyOption[]> {
    const now = Date.now();
    if (this.cachedCompanies && this.cacheExpiry > now) {
      return this.cachedCompanies;
    }

    const baseUrl =
      process.env.BIGSHARE_BASE_URL || 'https://www.bigshareonline.com';
    const response = await this.fetchWithRetry(
      `${baseUrl}/ipo_allotment.html`,
      {
        method: 'GET',
        headers: {
          Referer: `${baseUrl}/`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Bigshare company list: HTTP ${response.status}`,
      );
    }

    const html = await response.text();
    const companies = this.parseCompanyOptions(html);

    if (companies.length > 0) {
      this.cachedCompanies = companies;
      this.cacheExpiry = now + 10 * 60 * 1000; // 10 min TTL
    }

    return companies;
  }

  parseCompanyOptions(html: string): BigshareCompanyOption[] {
    const options: BigshareCompanyOption[] = [];
    const selectMatch =
      html.match(/<select[^>]+(?:id|name)=["'](?:Company|ddlCompany|company_id)["'][\s\S]*?<\/select>/i) ||
      html.match(/<select[\s\S]*?<\/select>/i);
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
        !code.toLowerCase().includes('select') &&
        !code.toLowerCase().includes('choose') &&
        !name.toLowerCase().includes('select company')
      ) {
        options.push({ code, name });
      }
    }

    return options;
  }

  private async queryBigshare(
    request: CheckAllotmentRequest,
    companyCode: string,
  ): Promise<NormalizedAllotmentResult> {
    const checkedAt = new Date();
    const baseUrl =
      process.env.BIGSHARE_BASE_URL || 'https://www.bigshareonline.com';
    const targetUrl = `${baseUrl}/ipo_allotment.html`;

    const val = request.identifierValue.trim();

    // Check if CAPTCHA is present on Bigshare page
    const pageResponse = await this.fetchWithRetry(targetUrl, {
      method: 'GET',
    });

    const pageHtml = await pageResponse.text();
    const hasCaptcha =
      /<img[^>]+(?:captcha|CaptchaImage)[^>]*>/i.test(pageHtml) ||
      /<input[^>]+(?:name|id)=["'](?:captcha|txtCaptcha)["']/i.test(pageHtml) ||
      /CAPTCHA_DETECTED/i.test(pageHtml);

    if (hasCaptcha) {
      return this.createErrorResult(
        request,
        AllotmentStatus.CAPTCHA_REQUIRED,
        'Bigshare CAPTCHA is active; user manual verification required',
      );
    }

    // When CAPTCHA is absent, query direct endpoint
    const postBody = new URLSearchParams();
    postBody.append('Company', companyCode);
    if (request.identifierType === AllotmentIdentifierType.PAN) {
      postBody.append('SelectionType', 'PAN');
      postBody.append('txtPanNo', val.toUpperCase());
    } else if (request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER) {
      postBody.append('SelectionType', 'AppNo');
      postBody.append('txtAppNo', val);
    } else {
      postBody.append('SelectionType', 'DPID');
      postBody.append('txtDPID', val);
    }

    const postResponse = await this.fetchWithRetry(
      `${baseUrl}/Data.aspx`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: targetUrl,
        },
        body: postBody.toString(),
      },
    );

    const resultText = await postResponse.text();
    return this.parseAllotmentResult(resultText, request, checkedAt);
  }

  parseAllotmentResult(
    text: string,
    _request: CheckAllotmentRequest,
    checkedAt: Date,
  ): NormalizedAllotmentResult {
    const clean = text.toLowerCase();

    if (clean.includes('no record') || clean.includes('not found') || clean.includes('no data found')) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
        sharesAllotted: 0,
        sharesApplied: 0,
      };
    }

    const allottedMatch = text.match(/(?:allotted|allotment\s*shares?|no\s*of\s*shares\s*allotted)[:\s]+([0-9]+)/i);
    const appliedMatch = text.match(/(?:applied|shares\s*applied)[:\s]+([0-9]+)/i);

    const sharesAllotted = allottedMatch ? parseInt(allottedMatch[1], 10) : 0;
    const sharesApplied = appliedMatch ? parseInt(appliedMatch[1], 10) : 0;

    if (sharesAllotted > 0) {
      return {
        status: AllotmentStatus.ALLOTTED,
        sourceCode: this.code,
        checkedAt,
        sharesAllotted,
        sharesApplied,
      };
    }

    if (clean.includes('allotted') || clean.includes('allotment')) {
      return {
        status: AllotmentStatus.NOT_ALLOTTED,
        sourceCode: this.code,
        checkedAt,
        sharesAllotted: 0,
        sharesApplied,
      };
    }

    return {
      status: AllotmentStatus.APPLICATION_NOT_FOUND,
      sourceCode: this.code,
      checkedAt,
      sharesAllotted: 0,
      sharesApplied: 0,
    };
  }
}
