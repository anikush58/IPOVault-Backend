import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import {
  IpoGuruFetchResult,
  IpoGuruV1Ipo,
  IpoGuruV1Response,
} from './ipo-guru.types';

/**
 * IPO Guru v1 Service
 *
 * READ-ONLY. Fetches from https://www.ipoguru.in/api/v1/ipos using the
 * IPOGURU_API_KEY backend environment variable.
 *
 * Rate limits: 10 requests/day, 1 request/minute — manual fetch only.
 *
 * Isolated so v1 can be replaced with v2 without touching other modules.
 * Does NOT write to the database or touch any IPO sync pipeline.
 */
@Injectable()
export class IpoGuruService {
  private readonly logger = new Logger(IpoGuruService.name);
  private readonly BASE_URL = 'https://www.ipoguru.in/api/v1';

  constructor(
    private readonly configService: ConfigService<Env, true>,
  ) {}

  /**
   * Manually fetch IPO data from IPO Guru v1 API.
   *
   * The API key is read from IPOGURU_API_KEY environment variable and sent
   * as an X-API-KEY header. It is never included in the returned result.
   *
   * @throws Error if the API key is not configured
   */
  async fetchIpos(): Promise<IpoGuruFetchResult> {
    const apiKey = this.configService.get('IPOGURU_API_KEY' as keyof Env, {
      infer: true,
    }) as string | undefined;

    if (!apiKey) {
      this.logger.error(
        'IPOGURU_API_KEY is not configured — cannot fetch IPO Guru data.',
      );
      throw new Error(
        'IPOGURU_API_KEY is not configured in the backend environment.',
      );
    }

    const url = `${this.BASE_URL}/ipos`;
    this.logger.log(`IPO Guru v1 manual fetch: GET ${url}`);

    let httpStatus = 0;
    let rawBody: IpoGuruV1Response = {};

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'IPOVault-AdminConsole/1.0',
        },
      });

      httpStatus = response.status;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        this.logger.error(
          `IPO Guru API error: HTTP ${httpStatus} — ${errText.substring(0, 200)}`,
        );
        return {
          httpStatus,
          ipos: [],
          total: 0,
          fetchedAt: new Date().toISOString(),
          responseKeys: [],
        };
      }

      rawBody = (await response.json()) as IpoGuruV1Response;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`IPO Guru network/parse error: ${msg}`);
      throw new Error(`IPO Guru API request failed: ${msg}`);
    }

    // Normalize IPO array — support multiple envelope shapes
    const ipos: IpoGuruV1Ipo[] = this.extractIpos(rawBody);
    const total =
      rawBody.total ??
      rawBody.count ??
      (Array.isArray(ipos) ? ipos.length : 0);

    // Return ONLY safe fields — never include the apiKey
    const responseKeys = Object.keys(rawBody).filter(
      (k) => !['token', 'key', 'api_key', 'secret'].includes(k),
    );

    this.logger.log(
      `IPO Guru v1 fetch complete: ${ipos.length} IPOs returned (HTTP ${httpStatus})`,
    );

    return {
      httpStatus,
      ipos,
      total: Number(total) || ipos.length,
      fetchedAt: new Date().toISOString(),
      responseKeys,
    };
  }

  /**
   * Extract IPO array from various API envelope shapes.
   * Supports: { data: [...] }, { ipos: [...] }, or top-level array.
   */
  private extractIpos(body: IpoGuruV1Response): IpoGuruV1Ipo[] {
    if (Array.isArray(body)) {
      return body as IpoGuruV1Ipo[];
    }
    if (Array.isArray(body.data)) {
      return body.data;
    }
    if (Array.isArray(body.ipos)) {
      return body.ipos;
    }
    // Try any array-valued key
    for (const key of Object.keys(body)) {
      if (Array.isArray((body as Record<string, unknown>)[key])) {
        return (body as Record<string, unknown>)[key] as IpoGuruV1Ipo[];
      }
    }
    return [];
  }
}
