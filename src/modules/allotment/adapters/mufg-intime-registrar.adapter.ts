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

    try {
      const rawResponse = await this.queryMufgEndpoint(request);
      return this.normalizeMufgResponse(rawResponse, request);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`MUFG Intime fetch failure for ${masked}: ${msg}`);
      return this.createErrorResult(
        request,
        AllotmentStatus.SOURCE_UNAVAILABLE,
        `MUFG Intime portal unavailable: ${msg}`,
      );
    }
  }

  private async queryMufgEndpoint(
    request: CheckAllotmentRequest,
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
      clientid: request.registrarIpoCode || request.ipoId,
      searchtype: searchType,
      searchValue: request.identifierValue,
    };

    const response = await this.fetchWithRetry(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

    return (await response.json()) as Record<string, unknown>;
  }

  public normalizeMufgResponse(
    raw: Record<string, unknown>,
    _request: CheckAllotmentRequest,
  ): NormalizedAllotmentResult {
    const checkedAt = new Date();

    if (!raw) {
      return {
        status: AllotmentStatus.UNKNOWN,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const statusStr = String(raw.status || '');
    const resultStr = String(raw.result || '');
    const messageStr = String(raw.message || '');

    if (statusStr === 'CAPTCHA_REQUIRED' || raw.require_captcha) {
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

    if (statusStr === 'RATE_LIMITED') {
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
      messageStr.includes('No Data Found')
    ) {
      return {
        status: AllotmentStatus.APPLICATION_NOT_FOUND,
        sourceCode: this.code,
        checkedAt,
      };
    }

    if (
      statusStr === 'PENDING' ||
      messageStr.includes('Basis of allotment under process')
    ) {
      return {
        status: AllotmentStatus.NOT_YET_AVAILABLE,
        sourceCode: this.code,
        checkedAt,
      };
    }

    const applied = Number(raw.applied_shares ?? raw.nshares ?? 0);
    const allotted = Number(raw.allotted_shares ?? raw.ashares ?? 0);
    const price = Number(raw.price ?? raw.issue_price ?? 0);

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
      allotmentPrice: price > 0 ? price : undefined,
      applicantName: raw.name ? String(raw.name).trim() : undefined,
      sourceCode: this.code,
      checkedAt,
      rawResponseRef: raw.app_no ? String(raw.app_no) : undefined,
    };
  }
}
