import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
  IRegistrarAdapter,
  NormalizedAllotmentResult,
} from '../allotment.types';
import { maskIdentifier } from '../allotment.utils';

export interface BaseFetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export abstract class BaseRegistrarAdapter implements IRegistrarAdapter {
  abstract readonly code: string;
  abstract readonly name: string;
  abstract readonly supportedIdentifiers: Set<AllotmentIdentifierType>;
  readonly defaultConcurrency: number = 3;

  supportsIdentifier(type: AllotmentIdentifierType): boolean {
    return this.supportedIdentifiers.has(type);
  }

  abstract checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult>;

  abstract resolveRegistrarIpoCode(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult>;

  /**
   * Safe fetch utility with configurable request timeout, standard application User-Agent header,
   * bounded retries, and exponential backoff for transient network issues.
   */
  protected async fetchWithRetry(
    url: string,
    options: BaseFetchOptions = {},
  ): Promise<Response> {
    const {
      timeoutMs = 8000,
      maxRetries = 2,
      retryDelayMs = 500,
      headers: userHeaders,
      ...restOptions
    } = options;

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(userHeaders as Record<string, string>),
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...restOptions,
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (
          response.ok ||
          response.status === 404 ||
          response.status === 429 ||
          response.status === 403
        ) {
          return response;
        }

        throw new Error(
          `HTTP Error ${response.status}: ${response.statusText}`,
        );
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < maxRetries) {
          const delay = retryDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw (
      lastError ||
      new Error(
        `Failed to fetch from ${this.name} after ${maxRetries + 1} attempts`,
      )
    );
  }

  /**
   * Helper to format a safe fallback result when an adapter encounters external failures.
   */
  protected createErrorResult(
    request: CheckAllotmentRequest,
    status: AllotmentStatus,
    errorMessage: string,
  ): NormalizedAllotmentResult {
    return {
      status,
      sourceCode: this.code,
      checkedAt: new Date(),
      errorMessage: `[${this.code}] ${errorMessage} (ID: ${maskIdentifier(request.identifierValue, request.identifierType)})`,
    };
  }
}
