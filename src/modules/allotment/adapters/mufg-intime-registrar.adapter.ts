import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CategoryAllotmentResult,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';
import {
  matchRegistrarCompany,
  normalizeName,
} from '../allotment.matching';
import { BaseRegistrarAdapter } from './base-registrar.adapter';
import {
  mapRegistrarCategory,
  deduplicateCategoryRecords,
  deriveOverallAllotment,
} from '../allotment-category.utils';

interface MufgCompanyListItem {
  clientid: string;
  companyname: string;
  symbol?: string;
}

class MufgCompanyListHttpError extends Error {
  constructor(readonly status: number) {
    super(`MUFG Intime company list returned HTTP status ${status}`);
    this.name = 'MufgCompanyListHttpError';
  }
}

@Injectable()
export class MufgIntimeRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'MUFG_INTIME';
  readonly name = 'MUFG Intime India (formerly Link Intime)';
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private static readonly DEFAULT_COMPANY_LIST_CACHE_TTL_MS = 210_000; // 3.5 minutes TTL (3-4 min window to prevent per-IPO HTTP flood)

  private readonly logger = new Logger(MufgIntimeRegistrarAdapter.name);
  private cachedCompanyList: {
    items: MufgCompanyListItem[];
    fetchedAt: number;
  } | null = null;
  private inFlightCompanyListPromise: Promise<MufgCompanyListItem[]> | null =
    null;

  async checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult> {
    const masked = maskIdentifier(
      request.identifierValue,
      request.identifierType,
    );
    this.logger.log(
      `Checking MUFG Intime allotment for IPO ${request.ipoId} (Identifier: ${masked})`,
    );

    if (!this.supportsIdentifier(request.identifierType)) {
      return this.createErrorResult(
        request,
        AllotmentStatus.UNSUPPORTED_IDENTIFIER,
        `Identifier type ${request.identifierType} is not supported by MUFG Intime`,
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
      const rawResponse = await this.queryMufgEndpoint(request, clientId);
      return this.normalizeMufgResponse(rawResponse, request);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`MUFG Intime fetch failure for ${masked}: ${msg}`);

      if (msg.includes('429')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.RATE_LIMITED,
          `MUFG Intime rate limit encountered`,
        );
      }

      if (msg.includes('JSON') || msg.includes('parse')) {
        return this.createErrorResult(
          request,
          AllotmentStatus.SOURCE_RESPONSE_INVALID,
          `Invalid response format from MUFG Intime portal`,
        );
      }

      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `MUFG Intime portal unavailable: ${msg}`,
      );
    }
  }

  public encryptToken(token: string | number): string {
    const key = Buffer.from('8080808080808080', 'utf8');
    const iv = Buffer.from('8080808080808080', 'utf8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(String(token), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  public extractSessionId(response: Response): string | undefined {
    if (response?.headers && typeof (response.headers as any).getSetCookie === 'function') {
      const cookies = (response.headers as any).getSetCookie();
      if (Array.isArray(cookies) && cookies.length > 0) {
        for (const c of cookies) {
          const match = /ASP\.NET_SessionId=([^;]+)/i.exec(c);
          if (match) return match[1];
        }
      }
    }
    const rawCookie = response?.headers?.get ? response.headers.get('set-cookie') : undefined;
    if (rawCookie) {
      const match = /ASP\.NET_SessionId=([^;]+)/i.exec(rawCookie);
      if (match) return match[1];
    }
    return undefined;
  }

  private async queryMufgEndpoint(
    request: CheckAllotmentRequest,
    clientId: string,
  ): Promise<Record<string, unknown>> {
    const baseHost =
      process.env.MUFG_INTIME_BASE_URL || 'https://in.mpms.mufg.com';

    // Step 1: generateToken
    const tokenUrl = `${baseHost}/Initial_Offer/IPO.aspx/generateToken`;
    const tokenResponse = await this.fetchWithRetry(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: baseHost,
        Referer: `${baseHost}/Initial_Offer/public-issues.html`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({}),
    });

    if (tokenResponse.status === 429) {
      return { status: 'RATE_LIMITED' };
    }

    if (!tokenResponse.ok) {
      throw new Error(
        `MUFG Intime token endpoint returned HTTP ${tokenResponse.status}`,
      );
    }

    const sessionId = this.extractSessionId(tokenResponse);
    let tokenVal: string | number | undefined;
    try {
      const tokenJson = (await tokenResponse.json()) as {
        d?: string | number;
      };
      tokenVal = tokenJson?.d;
    } catch {
      throw new Error('Failed to parse token response from MUFG Intime');
    }

    if (tokenVal === undefined || tokenVal === null || tokenVal === '') {
      throw new Error('MUFG Intime token generation returned empty token');
    }

    // Step 2: Encrypt token
    const encryptedToken = this.encryptToken(tokenVal);

    // Step 3: SearchOnPan
    const searchUrl = `${baseHost}/Initial_Offer/IPO.aspx/SearchOnPan`;
    const pan = request.identifierValue.trim().toUpperCase();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Origin: baseHost,
      Referer: `${baseHost}/Initial_Offer/public-issues.html`,
      'X-Requested-With': 'XMLHttpRequest',
    };

    if (sessionId) {
      headers['Cookie'] = `ASP.NET_SessionId=${sessionId}`;
    }

    const payload = {
      clientid: clientId,
      PAN: pan,
      IFSC: '',
      CHKVAL: '1',
      token: encryptedToken,
    };

    const response = await this.fetchWithRetry(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      return { status: 'NOT_FOUND' };
    }

    if (response.status === 429) {
      return { status: 'RATE_LIMITED' };
    }

    if (!response.ok) {
      throw new Error(`MUFG Intime search returned HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error('Failed to parse JSON response from MUFG Intime portal');
    }
  }

  public parseXmlDataSet(xml: string): Array<Record<string, string>> {
    const records: Array<Record<string, string>> = [];
    if (!xml || typeof xml !== 'string') return records;

    const tableRegex = /<Table[\s\S]*?>([\s\S]*?)<\/Table>/gi;
    let tableMatch: RegExpExecArray | null;

    while ((tableMatch = tableRegex.exec(xml)) !== null) {
      const tableContent = tableMatch[1];
      const record: Record<string, string> = {};
      const fieldRegex = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/gi;
      let fieldMatch: RegExpExecArray | null;
      while ((fieldMatch = fieldRegex.exec(tableContent)) !== null) {
        const tag = fieldMatch[1];
        const val = fieldMatch[2].trim();
        record[tag] = val;
      }
      if (Object.keys(record).length > 0) {
        records.push(record);
      }
    }
    return records;
  }

  public normalizeMufgResponse(
    raw: Record<string, unknown>,
    _request?: CheckAllotmentRequest,
  ): NormalizedAllotmentResult {
    const checkedAt = new Date();

    if (!raw || typeof raw !== 'object') {
      return {
        status: AllotmentStatus.UNKNOWN,
        sourceCode: this.code,
        checkedAt,
      };
    }

    // Handle XML string in raw.d if returned from ASP.NET PageMethods
    if (typeof raw.d === 'string') {
      const xml = raw.d.trim();

      // Check for empty dataset: <NewDataSet /> or <NewDataSet/> or <NewDataSet></NewDataSet>
      if (
        xml === '<NewDataSet />' ||
        xml === '<NewDataSet/>' ||
        xml === '<NewDataSet></NewDataSet>' ||
        xml === '<NewDataSet />\r\n' ||
        (xml.startsWith('<NewDataSet') && !xml.includes('<Table'))
      ) {
        return {
          status: AllotmentStatus.APPLICATION_NOT_FOUND,
          sourceCode: this.code,
          checkedAt,
        };
      }

      if (xml.includes('<Table')) {
        const records = this.parseXmlDataSet(xml);
        if (records.length === 0) {
          return {
            status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
            sourceCode: this.code,
            checkedAt,
            errorMessage:
              'Unable to parse records from MUFG Intime XML response',
          };
        }

        const categoryResults: CategoryAllotmentResult[] = [];
        let firstApplicantName: string | undefined;
        let firstAppNo: string | undefined;
        let firstPrice: number | undefined;

        for (const rec of records) {
          const allotStr =
            rec.ALLOT ?? rec.allot ?? rec.allotted_shares ?? rec.ashares;
          const sharesStr =
            rec.SHARES ?? rec.shares ?? rec.applied_shares ?? rec.nshares;
          const priceStr = rec.offer_price ?? rec.price ?? rec.issue_price;
          const nameStr = rec.name ?? rec.invname ?? rec.applicantName;
          const appNoStr = rec.app_no ?? rec.appno ?? rec.Appln_No;
          const rawCat =
            rec.CAT ??
            rec.cat ??
            rec.CATEGORY ??
            rec.category ??
            rec.cat_desc ??
            rec.allot_cat ??
            rec.b_type;

          if (allotStr === undefined && sharesStr === undefined && !nameStr) {
            continue;
          }

          const allotted = Number(allotStr ?? 0);
          const applied = Number(sharesStr ?? 0);
          const price = priceStr ? Number(priceStr) : undefined;
          const rawCategoryStr =
            rawCat !== undefined && rawCat !== null ? String(rawCat).trim() : undefined;
          const canonicalCategory = mapRegistrarCategory(rawCategoryStr);

          if (!firstApplicantName && nameStr) {
            firstApplicantName = nameStr.trim();
          }
          if (!firstAppNo && appNoStr) {
            firstAppNo = String(appNoStr).trim();
          }
          if (!firstPrice && price && price > 0) {
            firstPrice = price;
          }

          let catStatus: AllotmentStatus;
          if (allotted > 0) {
            catStatus =
              applied > 0 && allotted < applied
                ? AllotmentStatus.PARTIALLY_ALLOTTED
                : AllotmentStatus.ALLOTTED;
          } else {
            catStatus = AllotmentStatus.NOT_ALLOTTED;
          }

          categoryResults.push({
            category: canonicalCategory,
            rawCategory: rawCategoryStr,
            status: catStatus,
            sharesApplied: applied > 0 ? applied : undefined,
            sharesAllotted: allotted,
            allotmentPrice: price && price > 0 ? price : undefined,
            applicationNumber: appNoStr ? String(appNoStr).trim() : undefined,
          });
        }

        if (categoryResults.length === 0) {
          return {
            status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
            sourceCode: this.code,
            checkedAt,
            errorMessage: 'Unrecognized MUFG Intime XML table format',
          };
        }

        const deduped = deduplicateCategoryRecords(categoryResults);
        const overall = deriveOverallAllotment(deduped);

        return {
          status: overall.status,
          sharesApplied:
            overall.sharesApplied > 0 ? overall.sharesApplied : undefined,
          sharesAllotted: overall.sharesAllotted,
          allotmentPrice: firstPrice,
          applicantName: firstApplicantName,
          sourceCode: this.code,
          checkedAt,
          rawResponseRef: firstAppNo,
          categoryResults: deduped,
        };
      }

      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage:
          'Invalid or unexpected XML format in MUFG Intime response',
      };
    }

    const statusStr = String(raw.status || raw.Status || '').toUpperCase();
    const resultStr = String(raw.result || raw.Result || '').toUpperCase();
    const messageStr = String(raw.message || raw.Message || raw.error || '');

    if (
      statusStr === 'CAPTCHA_REQUIRED' ||
      Boolean(raw.require_captcha) ||
      Boolean(raw.requireCaptcha)
    ) {
      return {
        status: AllotmentStatus.CAPTCHA_REQUIRED,
        sourceCode: this.code,
        checkedAt,
        captchaChallenge: {
          challengeType: 'IMAGE_CAPTCHA',
          challengeId: String(raw.sessionId || `mufg_${Date.now()}`),
          challengeData: raw.captchaUrl
            ? { captchaImageUrl: String(raw.captchaUrl) }
            : undefined,
        },
      };
    }

    if (statusStr === 'RATE_LIMITED' || raw.status === 429) {
      return {
        status: AllotmentStatus.RATE_LIMITED,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'MUFG Intime rate limit exceeded',
      };
    }

    if (
      statusStr === 'NOT_FOUND' ||
      resultStr === 'RECORD_NOT_FOUND' ||
      messageStr.toLowerCase().includes('no data found') ||
      messageStr.toLowerCase().includes('record not found') ||
      messageStr.toLowerCase().includes('no record')
    ) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    if (
      statusStr === 'INVALID_IDENTIFIER' ||
      messageStr.toLowerCase().includes('invalid pan') ||
      messageStr.toLowerCase().includes('invalid application') ||
      messageStr.toLowerCase().includes('invalid dp') ||
      messageStr.toLowerCase().includes('invalid search')
    ) {
      return {
        status: AllotmentStatus.INVALID_IDENTIFIER,
        sourceCode: this.code,
        checkedAt,
        errorMessage: messageStr || 'Invalid identifier supplied',
      };
    }

    if (
      statusStr === 'PENDING' ||
      messageStr.toLowerCase().includes('basis of allotment under process') ||
      messageStr.toLowerCase().includes('under process') ||
      messageStr.toLowerCase().includes('not finalized')
    ) {
      return {
        status: AllotmentStatus.NOT_YET_AVAILABLE,
        sourceCode: this.code,
        checkedAt,
      };
    }

    if (
      statusStr === 'TEMPORARY_ERROR' ||
      messageStr.toLowerCase().includes('try again later') ||
      messageStr.toLowerCase().includes('service temporarily unavailable')
    ) {
      return {
        status: AllotmentStatus.TEMPORARY_ERROR,
        sourceCode: this.code,
        checkedAt,
        errorMessage: messageStr,
      };
    }

    if (statusStr === 'ERROR' || raw.success === false) {
      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage: messageStr || 'MUFG Intime returned error response',
      };
    }

    const appliedKey = [
      'applied_shares',
      'nshares',
      'applied',
      'shares_applied',
      'sharesApplied',
      'SHARES',
    ].find((k) => k in raw);
    const allottedKey = [
      'allotted_shares',
      'ashares',
      'allotted',
      'shares_allotted',
      'sharesAllotted',
      'ALLOT',
    ].find((k) => k in raw);

    const hasExplicitShareInfo =
      appliedKey !== undefined || allottedKey !== undefined;
    const hasApplicantInfo =
      'name' in raw ||
      'applicantName' in raw ||
      'invname' in raw ||
      'app_no' in raw;

    if (!hasExplicitShareInfo && !hasApplicantInfo) {
      return {
        status: AllotmentStatus.SOURCE_RESPONSE_INVALID,
        sourceCode: this.code,
        checkedAt,
        errorMessage: 'Unrecognized MUFG Intime response format',
      };
    }

    const applied = Number(raw[appliedKey || ''] ?? 0);
    const allotted = Number(raw[allottedKey || ''] ?? 0);
    const price = Number(
      raw.price ??
        raw.issue_price ??
        raw.allotmentPrice ??
        raw.offer_price ??
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
      sharesApplied: applied > 0 ? applied : undefined,
      sharesAllotted: allotted,
      allotmentPrice: price > 0 ? price : undefined,
      applicantName: raw.name
        ? String(raw.name).trim()
        : raw.applicantName
          ? String(raw.applicantName).trim()
          : raw.invname
            ? String(raw.invname).trim()
            : undefined,
      sourceCode: this.code,
      checkedAt,
      rawResponseRef: raw.app_no ? String(raw.app_no) : undefined,
    };
  }

  public async resolveRegistrarIpoCode(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult> {
    const checkedAt = new Date();
    try {
      const forceRefresh = Boolean(
        request.requireLiveActiveList && !request.skipForceRefresh,
      );
      const list = await this.getActiveCompanyList(forceRefresh);
      return this.matchCompanyInList([...list], request, checkedAt);
    } catch (err: unknown) {
      if (err instanceof MufgCompanyListHttpError) {
        return {
          status: AllotmentStatus.SOURCE_UNAVAILABLE,
          sourceCode: this.code,
          checkedAt,
          errorMessage: err.message,
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        sourceCode: this.code,
        checkedAt,
        errorMessage: `MUFG Intime company list unavailable: ${msg}`,
      };
    }
  }

  private getCompanyListCacheTtlMs(): number {
    const raw = process.env.MUFG_INTIME_COMPANY_LIST_CACHE_TTL_MS;
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return MufgIntimeRegistrarAdapter.DEFAULT_COMPANY_LIST_CACHE_TTL_MS;
  }

  private async getActiveCompanyList(forceRefresh = false): Promise<MufgCompanyListItem[]> {
    const now = Date.now();
    const ttlMs = this.getCompanyListCacheTtlMs();
    if (!forceRefresh && this.cachedCompanyList) {
      if (now - this.cachedCompanyList.fetchedAt < ttlMs) {
        return [...this.cachedCompanyList.items];
      }
      this.cachedCompanyList = null;
    }

    if (!forceRefresh && this.inFlightCompanyListPromise) {
      return this.inFlightCompanyListPromise;
    }

    const fetchPromise = this.fetchAndCacheCompanyList();
    this.inFlightCompanyListPromise = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this.inFlightCompanyListPromise === fetchPromise) {
        this.inFlightCompanyListPromise = null;
      }
    }
  }

  private async fetchAndCacheCompanyList(): Promise<MufgCompanyListItem[]> {
    const baseHost =
      process.env.MUFG_INTIME_BASE_URL || 'https://in.mpms.mufg.com';
    const companyListUrl =
      process.env.MUFG_INTIME_COMPANY_LIST_URL ||
      `${baseHost}/Initial_Offer/IPO.aspx/GetDetails`;

    const response = await this.fetchWithRetry(companyListUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: baseHost,
        Referer: `${baseHost}/Initial_Offer/public-issues.html`,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new MufgCompanyListHttpError(response.status);
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (parseErr: unknown) {
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      throw new Error(`Invalid JSON response: ${msg}`);
    }

    const list = this.parseCompanyListPayload(rawJson);
    if (list.length > 0) {
      this.cachedCompanyList = {
        items: list,
        fetchedAt: Date.now(),
      };
    }

    return [...list];
  }

  private parseCompanyListPayload(rawJson: unknown): MufgCompanyListItem[] {
    if (!rawJson || typeof rawJson !== 'object') {
      throw new Error('Unexpected company list payload from MUFG Intime');
    }

    // Support legacy JSON array fallback if GetDetails returns array in tests
    if (Array.isArray(rawJson)) {
      if (rawJson.length === 0) {
        return [];
      }
      const fallbackList: MufgCompanyListItem[] = [];
      for (const entry of rawJson) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const rec = entry as Record<string, unknown>;
        const code = String(
          rec.company_id ??
            rec.clientid ??
            rec.id ??
            rec.clientId ??
            rec.code ??
            '',
        ).trim();
        const name = String(
          rec.companyname ?? rec.company_name ?? rec.name ?? '',
        ).trim();
        const symbol =
          typeof rec.symbol === 'string' && rec.symbol.trim()
            ? rec.symbol.trim()
            : undefined;
        if (code && name) {
          fallbackList.push({ clientid: code, companyname: name, symbol });
        }
      }
      if (fallbackList.length === 0) {
        throw new Error(
          'MUFG Intime company list contained incomplete company records',
        );
      }
      return fallbackList;
    }

    const envelope = rawJson as { d?: unknown };
    if (typeof envelope.d !== 'string') {
      throw new Error('Invalid company list envelope from MUFG Intime');
    }

    const xmlString = envelope.d.trim();
    if (!xmlString) {
      return [];
    }

    if (
      /<(!doctype|html|head|body)\b/i.test(xmlString) ||
      (!xmlString.includes('<NewDataSet') && !xmlString.includes('<Table'))
    ) {
      throw new Error('Invalid XML company list payload from MUFG Intime');
    }

    const parsedRecords = this.parseXmlDataSet(xmlString);
    const list: MufgCompanyListItem[] = [];
    for (const rec of parsedRecords) {
      const code = rec.company_id || rec.clientid || rec.id || '';
      const name = rec.companyname || rec.company_name || rec.name || '';
      if (code && name) {
        list.push({
          clientid: code,
          companyname: name,
          symbol: rec.symbol,
        });
      }
    }

    if (parsedRecords.length > 0 && list.length === 0) {
      throw new Error(
        'MUFG Intime company list contained incomplete company records',
      );
    }

    return list;
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
