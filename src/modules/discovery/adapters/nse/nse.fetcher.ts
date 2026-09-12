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

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  ) {
    return true;
  }
  if (host.startsWith('169.254.')) {
    return true;
  }
  if (host.startsWith('10.') || host.startsWith('192.168.')) {
    return true;
  }
  if (host.startsWith('172.')) {
    const parts = host.split('.');
    if (parts.length >= 2) {
      const secondOctet = parseInt(parts[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }
  }
  if (
    host.startsWith('fe80:') ||
    host.startsWith('fc00:') ||
    host.startsWith('fd00:')
  ) {
    return true;
  }
  return false;
}

function isAllowedNseHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'nseindia.com' || host.endsWith('.nseindia.com')) {
    return true;
  }
  if (host === 'nse.test' || host.endsWith('.nse.test')) {
    return true;
  }
  const configuredEnvEndpoint = process.env.NSE_IPO_ENDPOINT;
  if (configuredEnvEndpoint) {
    try {
      const envHost = new URL(configuredEnvEndpoint).hostname.toLowerCase();
      if (host === envHost) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export async function fetchNseDocument(
  options: NseFetchOptions,
): Promise<NseHttpDocument> {
  const endpoint = options.endpoint.trim();
  if (endpoint.length === 0) {
    throw new NseFetchError('NSE_IPO_ENDPOINT is not configured');
  }

  try {
    const parsedUrl = new URL(endpoint);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new NseFetchError(
        `Invalid NSE_IPO_ENDPOINT protocol '${parsedUrl.protocol}'`,
      );
    }
    if (isPrivateOrLocalHost(parsedUrl.hostname)) {
      throw new NseFetchError(
        `Blocked internal/loopback NSE_IPO_ENDPOINT host '${parsedUrl.hostname}'`,
      );
    }
    if (!isAllowedNseHost(parsedUrl.hostname)) {
      throw new NseFetchError(
        `Untrusted NSE_IPO_ENDPOINT destination host '${parsedUrl.hostname}'`,
      );
    }
  } catch (err) {
    if (err instanceof NseFetchError) throw err;
    throw new NseFetchError(`Invalid NSE_IPO_ENDPOINT URL '${endpoint}'`);
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
