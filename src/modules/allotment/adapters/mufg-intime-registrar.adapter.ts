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
export class MufgIntimeRegistrarAdapter extends BaseRegistrarAdapter {
  readonly code = 'MUFG_INTIME';
  readonly name = 'MUFG Intime India (formerly Link Intime)';
  readonly supportedIdentifiers = new Set<AllotmentIdentifierType>([
    AllotmentIdentifierType.PAN,
    AllotmentIdentifierType.APPLICATION_NUMBER,
    AllotmentIdentifierType.DP_CLIENT_ID,
  ]);

  private readonly logger = new Logger(MufgIntimeRegistrarAdapter.name);

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

    const clientId = request.registrarIpoCode;
    if (!clientId) {
      return this.createErrorResult(
        request,
        AllotmentStatus.REGISTRAR_UNRESOLVED,
        `Missing registrar company client_id for MUFG Intime allotment check`,
      );
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

  private async queryMufgEndpoint(
    request: CheckAllotmentRequest,
    clientId: string,
  ): Promise<Record<string, unknown>> {
    const baseUrl =
      process.env.MUFG_INTIME_API_URL ||
      'https://in.mpms.mufg.com/Initial_Offer/public-issues.html';

    const searchType =
      request.identifierType === AllotmentIdentifierType.PAN
        ? 'PAN'
        : request.identifierType === AllotmentIdentifierType.APPLICATION_NUMBER
          ? 'APP'
          : 'DPID';

    const payload = {
      clientid: clientId,
      searchtype: searchType,
      searchValue: request.identifierValue.trim().toUpperCase(),
    };

    const response = await this.fetchWithRetry(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://in.mpms.mufg.com',
        Referer: 'https://in.mpms.mufg.com/Initial_Offer/public-issues.html',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 404) {
      return { status: 'NOT_FOUND' };
    }

    if (response.status === 429) {
      return { status: 'RATE_LIMITED' };
    }

    if (!response.ok) {
      throw new Error(`MUFG Intime returned HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new Error('Failed to parse JSON response from MUFG Intime portal');
    }
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
    ].find((k) => k in raw);
    const allottedKey = [
      'allotted_shares',
      'ashares',
      'allotted',
      'shares_allotted',
      'sharesAllotted',
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
      raw.price ?? raw.issue_price ?? raw.allotmentPrice ?? 0,
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
}
