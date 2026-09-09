import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Env } from '../../../../config/env';
import {
  SebiDownloadDocumentResult,
  SebiFetchOptions,
  SebiHttpDocument,
} from './sebi.types';

export const SEBI_DEFAULT_ENDPOINT =
  'https://www.sebi.gov.in/sebiweb/ajax/home/getnewslistinfo.jsp';

export const SEBI_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const SEBI_HTTP_TIMEOUT_MS = 15_000;

export const DEFAULT_SEBI_MAX_PDF_SIZE_BYTES = 50_000_000;

export class SebiFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SebiFetchError';
  }
}

export class SebiPdfSizeExceededError extends SebiFetchError {
  constructor(message: string) {
    super(message);
    this.name = 'SebiPdfSizeExceededError';
  }
}

export function isOfficialSebiUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (hostname === 'www.sebi.gov.in' ||
        hostname === 'sebi.gov.in' ||
        hostname.endsWith('.sebi.gov.in'))
    );
  } catch {
    return false;
  }
}

export async function fetchSebiListing(
  options: SebiFetchOptions,
): Promise<SebiHttpDocument> {
  const endpoint = options.endpoint.trim() || SEBI_DEFAULT_ENDPOINT;
  const page = options.page ?? 1;
  const timeoutMs = options.timeoutMs ?? SEBI_HTTP_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const params = new URLSearchParams({
    nextValue: String(page),
    next: 's',
    search: '',
    fromDate: '',
    toDate: '',
    fromYear: '',
    toYear: '',
    deptId: '-1',
    sid: '3',
    ssid: '15',
    smid: '0',
    ssidhidden: '0',
    intmid: '-1',
    doDirect: '-1',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': SEBI_BROWSER_USER_AGENT,
        Referer:
          'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&smid=31',
      },
      body: params.toString(),
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    const msg = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      throw new SebiFetchError('SEBI request timed out');
    }
    throw new SebiFetchError(`SEBI request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status > 299) {
    throw new SebiFetchError(
      `SEBI request failed with status ${response.status}`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SebiFetchError(`SEBI response body could not be read: ${msg}`);
  }

  if (!text || text.trim().length === 0) {
    throw new SebiFetchError('SEBI response was empty');
  }

  return { status: response.status, body: text };
}

export async function downloadSebiDocument(
  urlStr: string,
  fetchImpl?: typeof fetch,
  timeoutMs = SEBI_HTTP_TIMEOUT_MS,
  maxSizeBytes = DEFAULT_SEBI_MAX_PDF_SIZE_BYTES,
): Promise<SebiDownloadDocumentResult> {
  if (!isOfficialSebiUrl(urlStr)) {
    throw new SebiFetchError(
      `Security error: Rejecting download from non-SEBI URL '${urlStr}'`,
    );
  }

  const fetcher = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetcher(urlStr, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': SEBI_BROWSER_USER_AGENT,
        Referer: 'https://www.sebi.gov.in/',
      },
    });
  } catch (error: unknown) {
    clearTimeout(timer);
    const msg = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      throw new SebiFetchError('SEBI document download timed out');
    }
    throw new SebiFetchError(`SEBI document download failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status > 299) {
    throw new SebiFetchError(
      `SEBI document download failed with status ${response.status}`,
    );
  }

  // A. Check Content-Length header before reading body
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const headerBytes = parseInt(contentLengthHeader, 10);
    if (!isNaN(headerBytes) && headerBytes > maxSizeBytes) {
      throw new SebiPdfSizeExceededError(
        `SEBI document size (${headerBytes} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
      );
    }
  }

  const contentType = response.headers.get('content-type') || 'unknown';
  let buffer: Buffer;

  // B. Streaming / chunk byte count protection when Content-Length is absent or when reading stream
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxSizeBytes) {
            await reader.cancel();
            throw new SebiPdfSizeExceededError(
              `SEBI document stream size (${totalBytes} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
            );
          }
          chunks.push(value);
        }
      }
      buffer = Buffer.concat(chunks);
    } catch (err: unknown) {
      if (err instanceof SebiPdfSizeExceededError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new SebiFetchError(`SEBI document stream read failed: ${msg}`);
    }
  } else {
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > maxSizeBytes) {
      throw new SebiPdfSizeExceededError(
        `SEBI document size (${arrayBuf.byteLength} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
      );
    }
    buffer = Buffer.from(arrayBuf);
  }

  return {
    status: response.status,
    contentType,
    contentLength: buffer.length,
    documentBuffer: buffer,
  };
}

@Injectable()
export class SebiHttpClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async fetchListing(
    page = 1,
    fetchImpl?: typeof fetch,
  ): Promise<SebiHttpDocument> {
    const endpoint =
      this.config.get('SEBI_IPO_ENDPOINT', { infer: true }) ||
      SEBI_DEFAULT_ENDPOINT;

    return fetchSebiListing({
      endpoint,
      page,
      timeoutMs: SEBI_HTTP_TIMEOUT_MS,
      fetchImpl,
    });
  }

  async downloadDocument(
    documentUrl: string,
    fetchImpl?: typeof fetch,
  ): Promise<SebiDownloadDocumentResult> {
    const maxSizeBytes =
      this.config.get('SEBI_MAX_PDF_SIZE_BYTES', { infer: true }) ||
      DEFAULT_SEBI_MAX_PDF_SIZE_BYTES;
    return downloadSebiDocument(
      documentUrl,
      fetchImpl,
      SEBI_HTTP_TIMEOUT_MS,
      maxSizeBytes,
    );
  }
}
