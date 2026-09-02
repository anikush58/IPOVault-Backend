import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from '../../../../config/env';
import { NseFetchError } from './nse-fetch.error';

export const NSE_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const NSE_HTTP_TIMEOUT_MS = 10_000;

export type NseHttpDocument = {
  status: number;
  body: unknown;
};

export type NseFetchOptions = {
  endpoint: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchNseDocument(
  options: NseFetchOptions,
): Promise<NseHttpDocument> {
  const endpoint = options.endpoint.trim();
  if (endpoint.length === 0) {
    throw new NseFetchError('NSE_IPO_ENDPOINT is not configured');
  }

  const timeoutMs = options.timeoutMs ?? NSE_HTTP_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': NSE_BROWSER_USER_AGENT,
      },
    });
  } catch (error) {
    if (isAbortError(error) || controller.signal.aborted) {
      throw new NseFetchError('NSE request timed out');
    }

    throw new NseFetchError(`NSE request failed: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status > 299) {
    throw new NseFetchError(
      `NSE request failed with status ${response.status}`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new NseFetchError(
      `NSE response body could not be read: ${errorMessage(error)}`,
    );
  }

  if (text.trim().length === 0) {
    throw new NseFetchError('NSE response was empty');
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new NseFetchError('NSE response was not valid JSON');
  }

  if (body === null) {
    throw new NseFetchError('NSE response was empty');
  }

  return { status: response.status, body };
}

@Injectable()
export class NseHttpClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  fetchIpoDocument(fetchImpl?: typeof fetch): Promise<NseHttpDocument> {
    const endpoint = this.config.get('NSE_IPO_ENDPOINT', { infer: true }) ?? '';

    return fetchNseDocument({
      endpoint,
      timeoutMs: NSE_HTTP_TIMEOUT_MS,
      fetchImpl,
    });
  }
}
