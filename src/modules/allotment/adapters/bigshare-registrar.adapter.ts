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
  serverUrl?: string;
  captchaDetected?: boolean;
}

const DEFAULT_BIGSHARE_SERVERS = [
  'https://ipo1.bigshareonline.com',
  'https://ipo.bigshareonline.com',
  'https://ipo2.bigshareonline.com',
];

@Injectable()
export class BigshareRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'BIGSHARE';
  readonly name = 'Bigshare Services';
  override readonly defaultConcurrency = 1;
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(BigshareRegistrarAdapter.name);

  // Cached company list with 10-minute TTL
  private cachedCompanies: BigshareCompanyOption[] | null = null;
  private cacheExpiry: number = 0;
  private serverCaptchaMap = new Map<string, boolean>();

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

    let targetServerUrl: string | undefined;

    if (!companyCode) {
      const resolved = await this.resolveRegistrarIpoCode(request);
      if (typeof resolved !== 'string') {
        return resolved;
      }
      companyCode = resolved;
    }

    // Look up known server for this company if available in cache
    if (this.cachedCompanies) {
      const found = this.cachedCompanies.find((c) => c.code === companyCode);
      if (found?.serverUrl) {
        targetServerUrl = found.serverUrl;
      }
    }

    try {
      return await this.queryBigshare(request, companyCode, targetServerUrl);
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
   * Resolves the company ID for Bigshare Services using fuzzy matching across servers.
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
   * Fetches and parses active company lists and detects CAPTCHA state across Bigshare server pool.
   */
  async fetchCompanyList(): Promise<BigshareCompanyOption[]> {
    const now = Date.now();
    if (this.cachedCompanies && this.cacheExpiry > now) {
      return this.cachedCompanies;
    }

    const configuredBase = process.env.BIGSHARE_BASE_URL?.trim();
    const servers = configuredBase
      ? [configuredBase, ...DEFAULT_BIGSHARE_SERVERS]
      : DEFAULT_BIGSHARE_SERVERS;

    const allOptionsMap = new Map<string, BigshareCompanyOption>();

    for (const server of servers) {
      try {
        const response = await this.fetchWithRetry(
          `${server}/ipo_status.html`,
          {
            method: 'GET',
            timeoutMs: 6000,
            maxRetries: 1,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          },
        );

        if (response.ok) {
          const html = await response.text();
          const hasCaptcha =
            /<img[^>]+(?:captcha|CaptchaImage)[^>]*>/i.test(html) ||
            /<input[^>]+(?:name|id)=["'](?:captcha|txtCaptcha)["']/i.test(html) ||
            /CAPTCHA_DETECTED/i.test(html);

          this.serverCaptchaMap.set(server, hasCaptcha);

          const options = this.parseCompanyOptions(html, server);
          for (const opt of options) {
            opt.captchaDetected = hasCaptcha;
            if (!allOptionsMap.has(opt.code)) {
              allOptionsMap.set(opt.code, opt);
            }
          }
        }
      } catch (err) {
        this.logger.warn(
          `Failed to fetch company list from Bigshare server ${server}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const companies = Array.from(allOptionsMap.values());

    if (companies.length > 0) {
      this.cachedCompanies = companies;
      this.cacheExpiry = now + 10 * 60 * 1000; // 10 min TTL
    }

    return companies;
  }

  parseCompanyOptions(html: string, serverUrl?: string): BigshareCompanyOption[] {
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
        options.push({ code, name, serverUrl });
      }
    }

    return options;
  }

  private async queryBigshare(
    request: CheckAllotmentRequest,
    companyCode: string,
    targetServerUrl?: string,
  ): Promise<NormalizedAllotmentResult> {
    const checkedAt = new Date();
    const serverUrl =
      targetServerUrl ||
      process.env.BIGSHARE_BASE_URL ||
      'https://ipo1.bigshareonline.com';
    const pageUrl = `${serverUrl}/ipo_status.html`;
    const fetchUrl = `${serverUrl}/Data.aspx/FetchIpodetails`;

    const val = request.identifierValue.trim();

    // Check cached CAPTCHA state for target server
    if (this.serverCaptchaMap.get(serverUrl) === true) {
      return this.createErrorResult(
        request,
        AllotmentStatus.CAPTCHA_REQUIRED,
        'Bigshare CAPTCHA is active; user manual verification required',
      );
    }

    // Determine selection type and field mappings
    const isPan = request.identifierType === AllotmentIdentifierType.PAN;
    const isAppNo =
      request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER;

    const payload = {
      Applicationno: isAppNo ? val : '',
      Company: String(companyCode),
      SelectionType: isPan ? 'PN' : isAppNo ? 'AP' : 'BN',
      PanNo: isPan ? val.toUpperCase() : '',
      txtcsdl: !isPan && !isAppNo ? val : '',
      txtDPID: '',
      txtClId: '',
      ddlType: '0',
      lang: 'en',
    };

    // Politeness delay between sequential items
    await new Promise((resolve) => setTimeout(resolve, 150));

    const postResponse = await this.fetchWithRetry(fetchUrl, {
      method: 'POST',
      timeoutMs: 8000,
      maxRetries: 1,
      retryDelayMs: 400,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: serverUrl,
        Referer: pageUrl,
      },
      body: JSON.stringify(payload),
    });

    const resultText = await postResponse.text();
    return this.parseAllotmentResult(resultText, request, checkedAt);
  }

  parseAllotmentResult(
    text: string,
    _request: CheckAllotmentRequest,
    checkedAt: Date,
  ): NormalizedAllotmentResult {
    try {
      const json = JSON.parse(text);
      const comp = json?.d || json;

      if (comp) {
        if (comp.Status === 'RATELIMIT') {
          return {
            status: AllotmentStatus.RATE_LIMITED,
            sourceCode: this.code,
            checkedAt,
            sharesAllotted: 0,
            sharesApplied: 0,
            errorMessage: comp.Message || 'Bigshare rate limit encountered',
          };
        }

        if (comp.Status === 'WARMING') {
          return {
            status: AllotmentStatus.SOURCE_UNAVAILABLE,
            sourceCode: this.code,
            checkedAt,
            sharesAllotted: 0,
            sharesApplied: 0,
            errorMessage: comp.Message || 'Bigshare service warming up',
          };
        }

        const dpidStr = String(comp.DPID || '').toLowerCase();
        const msgStr = String(comp.Message || '').toLowerCase();

        if (
          comp.Status === 'NOTFOUND' ||
          dpidStr.includes('no data found') ||
          dpidStr.includes('no record') ||
          dpidStr.includes('valid pan') ||
          dpidStr.includes('valid application') ||
          dpidStr.includes('valid beneficiary') ||
          dpidStr.includes('valid clid') ||
          dpidStr.includes('valid dpid') ||
          msgStr.includes('no data found') ||
          msgStr.includes('no record')
        ) {
          return {
            status: AllotmentStatus.APPLICATION_NOT_FOUND,
            sourceCode: this.code,
            checkedAt,
            sharesAllotted: 0,
            sharesApplied: 0,
          };
        }

        const applicantName =
          comp.Name?.trim() ||
          comp.NAME?.trim() ||
          comp.ApplicantName?.trim() ||
          comp.InvestorName?.trim() ||
          undefined;

        const allottedRaw =
          comp.ALLOTED !== undefined
            ? String(comp.ALLOTED).trim()
            : comp.ALLOTTED !== undefined
              ? String(comp.ALLOTTED).trim()
              : comp.Alloted !== undefined
                ? String(comp.Alloted).trim()
                : comp.Allotted !== undefined
                  ? String(comp.Allotted).trim()
                  : comp.SharesAllotted !== undefined
                    ? String(comp.SharesAllotted).trim()
                    : comp.shares_allotted !== undefined
                      ? String(comp.shares_allotted).trim()
                      : '';

        const appliedRaw =
          comp.APPLIED !== undefined
            ? String(comp.APPLIED).trim()
            : comp.Applied !== undefined
              ? String(comp.Applied).trim()
              : comp.SharesApplied !== undefined
                ? String(comp.SharesApplied).trim()
                : comp.shares_applied !== undefined
                  ? String(comp.shares_applied).trim()
                  : '';

        const sharesAllotted = parseInt(allottedRaw, 10);
        const sharesApplied = parseInt(appliedRaw, 10);

        if (!isNaN(sharesAllotted) && sharesAllotted > 0) {
          return {
            status: AllotmentStatus.ALLOTTED,
            sourceCode: this.code,
            checkedAt,
            applicantName,
            sharesAllotted,
            sharesApplied: !isNaN(sharesApplied) ? sharesApplied : 0,
          };
        }

        if (!isNaN(sharesAllotted) && sharesAllotted === 0) {
          return {
            status: AllotmentStatus.NOT_ALLOTTED,
            sourceCode: this.code,
            checkedAt,
            applicantName,
            sharesAllotted: 0,
            sharesApplied: !isNaN(sharesApplied) ? sharesApplied : 0,
          };
        }

        // Check if multiple records returned in comp.Records
        if (Array.isArray(comp.Records) && comp.Records.length > 0) {
          const rec = comp.Records[0];
          const recAllotted = parseInt(
            String(rec.ALLOTED ?? rec.ALLOTTED ?? rec.Alloted ?? rec.Allotted ?? 0),
            10,
          );
          const recApplied = parseInt(
            String(rec.APPLIED ?? rec.Applied ?? 0),
            10,
          );
          return {
            status:
              !isNaN(recAllotted) && recAllotted > 0
                ? AllotmentStatus.ALLOTTED
                : AllotmentStatus.NOT_ALLOTTED,
            sourceCode: this.code,
            checkedAt,
            applicantName: rec.Name?.trim() || rec.NAME?.trim() || applicantName,
            sharesAllotted: !isNaN(recAllotted) ? recAllotted : 0,
            sharesApplied: !isNaN(recApplied) ? recApplied : 0,
          };
        }
      }
    } catch {
      // Fall through to text-based parsing if response wasn't JSON
    }

    const clean = text.toLowerCase();

    if (
      clean.includes('no record') ||
      clean.includes('not found') ||
      clean.includes('no data found') ||
      clean.includes('valid pan')
    ) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
        sharesAllotted: 0,
        sharesApplied: 0,
      };
    }

    const allottedMatch = text.match(
      /(?:allotted|allotment\s*shares?|no\s*of\s*shares\s*allotted)[:\s]+([0-9]+)/i,
    );
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
