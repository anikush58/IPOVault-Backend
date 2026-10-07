import * as https from 'https';
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

function extractDomain(rawUrlOrHost: string): string | null {
  try {
    let str = rawUrlOrHost.trim().toLowerCase();
    if (!str.startsWith('http://') && !str.startsWith('https://')) {
      str = 'https://' + str;
    }
    const u = new URL(str);
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return host || null;
  } catch {
    return null;
  }
}

function isDomainMatch(docHostname: string, issuerDomain: string): boolean {
  let docHost = docHostname.toLowerCase();
  if (docHost.startsWith('www.')) {
    docHost = docHost.slice(4);
  }
  return docHost === issuerDomain || docHost.endsWith('.' + issuerDomain);
}

function isProspectusDocumentPath(pathname: string, search: string): boolean {
  const full = (pathname + search).toLowerCase();
  const hasPdfOrDoc =
    full.includes('.pdf') || full.includes('.doc') || full.includes('.docx');
  const hasProspectusKeyword =
    full.includes('drhp') ||
    full.includes('rhp') ||
    full.includes('prospectus') ||
    full.includes('draft') ||
    full.includes('offer-document') ||
    full.includes('offer_document') ||
    full.includes('offer-doc') ||
    full.includes('offer_doc') ||
    full.includes('filing');
  return hasPdfOrDoc && hasProspectusKeyword;
}

export function isAuthoritativeDocumentUrl(
  urlStr: string,
  companyWebsite?: string | null,
): boolean {
  try {
    if (!urlStr || typeof urlStr !== 'string' || urlStr.trim().length === 0) {
      return false;
    }

    const parsed = new URL(urlStr.trim());
    const hostname = parsed.hostname.toLowerCase();
    const isHttps = parsed.protocol === 'https:';
    const isHttpTest =
      parsed.protocol === 'http:' &&
      (hostname === 'nse.test' ||
        hostname.endsWith('.nse.test') ||
        hostname === 'bse.test' ||
        hostname.endsWith('.bse.test') ||
        hostname === 'sebi.test' ||
        hostname.endsWith('.sebi.test') ||
        hostname === 'issuer.test' ||
        hostname.endsWith('.issuer.test'));

    if (!isHttps && !isHttpTest) {
      return false;
    }

    // 1. SEBI (Highest trust regulatory)
    if (
      hostname === 'sebi.gov.in' ||
      hostname === 'www.sebi.gov.in' ||
      hostname.endsWith('.sebi.gov.in') ||
      hostname === 'sebi.test' ||
      hostname.endsWith('.sebi.test')
    ) {
      return true;
    }

    // 2. BSE / BSE SME (Highest trust exchange)
    if (
      hostname === 'bseindia.com' ||
      hostname === 'www.bseindia.com' ||
      hostname === 'api.bseindia.com' ||
      hostname.endsWith('.bseindia.com') ||
      hostname === 'bsesme.com' ||
      hostname === 'www.bsesme.com' ||
      hostname.endsWith('.bsesme.com') ||
      hostname === 'bse.test' ||
      hostname.endsWith('.bse.test')
    ) {
      return true;
    }

    // 3. NSE / NSE Emerge (Highest trust exchange)
    if (
      hostname === 'nseindia.com' ||
      hostname === 'www.nseindia.com' ||
      hostname === 'emerge.nseindia.com' ||
      hostname === 'nsearchives.nseindia.com' ||
      hostname.endsWith('.nseindia.com') ||
      hostname === 'nse.test' ||
      hostname.endsWith('.nse.test')
    ) {
      return true;
    }

    // 4. Verified Issuer / Company Domain Fallback (when official website matches and path is clearly an RHP/DRHP/Prospectus)
    if (
      companyWebsite &&
      typeof companyWebsite === 'string' &&
      companyWebsite.trim().length > 0
    ) {
      const issuerDomain = extractDomain(companyWebsite);
      if (issuerDomain && isDomainMatch(hostname, issuerDomain)) {
        if (isProspectusDocumentPath(parsed.pathname, parsed.search)) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function isOfficialSebiUrl(
  urlStr: string,
  companyWebsite?: string | null,
): boolean {
  return isAuthoritativeDocumentUrl(urlStr, companyWebsite);
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

export function resolveSebiPdfUrlFromHtml(
  html: string,
  baseUrl: string,
): string | null {
  if (!html || typeof html !== 'string') {
    return null;
  }

  // 1. Try iframe src (supports optional spaces around = and single/double quotes)
  const iframeMatches = html.matchAll(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi);
  for (const match of iframeMatches) {
    if (match[1]) {
      const candidate = buildAndValidateSebiUrl(match[1], baseUrl);
      if (candidate) return candidate;
    }
  }

  // 2. Try anchor href (supports optional spaces around = and single/double quotes)
  const anchorMatches = html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["']/gi);
  for (const match of anchorMatches) {
    const href = match[1];
    if (
      href &&
      (href.toLowerCase().includes('.pdf') ||
        href.toLowerCase().includes('attachdocs') ||
        href.toLowerCase().includes('commondocs') ||
        href.toLowerCase().includes('file=') ||
        href.toLowerCase().includes('doc='))
    ) {
      const candidate = buildAndValidateSebiUrl(href, baseUrl);
      if (candidate) return candidate;
    }
  }

  // 3. Fallback regex for attachdocs/commondocs PDF in raw text/script
  const rawPdfMatch = html.match(
    /(?:https?:\/\/[^\s"'<>]*)?\/sebi_data\/(?:attachdocs|commondocs)\/[^\s"'<>]+\.pdf/i,
  );
  if (rawPdfMatch && rawPdfMatch[0]) {
    const candidate = buildAndValidateSebiUrl(rawPdfMatch[0], baseUrl);
    if (candidate) return candidate;
  }

  return null;
}

function extractTargetUrl(rawHref: string): string {
  try {
    const match = rawHref.match(/[?&](?:file|doc)=([^&"'>\s]+)/i);
    if (match && match[1]) {
      const decoded = decodeURIComponent(match[1]);
      if (decoded && decoded.trim().length > 0) {
        return decoded.trim();
      }
    }
  } catch {
    // Ignore decoding errors
  }
  return rawHref;
}

function buildAndValidateSebiUrl(
  href: string,
  baseUrl: string,
): string | null {
  try {
    const target = extractTargetUrl(href);
    const resolved = new URL(target, baseUrl).href;
    if (isOfficialSebiUrl(resolved)) {
      return resolved;
    }
  } catch {
    // Ignore invalid URL
  }
  return null;
}

async function downloadViaNodeHttps(
  urlStr: string,
  timeoutMs: number,
  maxSizeBytes: number,
): Promise<SebiDownloadDocumentResult> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout;
    const req = https.get(
      urlStr,
      {
        headers: {
          'User-Agent': SEBI_BROWSER_USER_AGENT,
          Referer: 'https://www.sebi.gov.in/',
          Accept: '*/*',
        },
      },
      (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode > 299) {
          clearTimeout(timer);
          reject(
            new SebiFetchError(`SEBI document download failed with status ${res.statusCode}`),
          );
          return;
        }

        const contentLengthHeader = res.headers['content-length'];
        if (contentLengthHeader) {
          const headerBytes = parseInt(contentLengthHeader, 10);
          if (!isNaN(headerBytes) && headerBytes > maxSizeBytes) {
            clearTimeout(timer);
            req.destroy();
            reject(
              new SebiPdfSizeExceededError(
                `SEBI document size (${headerBytes} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
              ),
            );
            return;
          }
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxSizeBytes) {
            clearTimeout(timer);
            req.destroy();
            reject(
              new SebiPdfSizeExceededError(
                `SEBI document stream size (${totalBytes} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
              ),
            );
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          clearTimeout(timer);
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode || 200,
            contentType: (res.headers['content-type'] as string) || 'unknown',
            contentLength: buffer.length,
            documentBuffer: buffer,
          });
        });
      },
    );

    timer = setTimeout(() => {
      req.destroy();
      reject(new SebiFetchError(`SEBI document download timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(new SebiFetchError(`SEBI document download failed: ${err.message}`));
    });
  });
}

export async function downloadSebiDocument(
  urlStr: string,
  fetchImpl?: typeof fetch,
  timeoutMs = SEBI_DOCUMENT_DOWNLOAD_TIMEOUT_MS,
  maxSizeBytes = DEFAULT_SEBI_MAX_PDF_SIZE_BYTES,
  companyWebsite?: string | null,
): Promise<SebiDownloadDocumentResult> {
  if (!isOfficialSebiUrl(urlStr, companyWebsite)) {
    throw new SebiFetchError(
      `Security error: Rejecting download from non-authoritative URL '${urlStr}'`,
    );
  }

  // For direct PDF downloads without custom fetcher injection, use node https
  const isDirectPdfUrl =
    urlStr.toLowerCase().endsWith('.pdf') ||
    urlStr.toLowerCase().includes('/sebi_data/attachdocs/') ||
    urlStr.toLowerCase().includes('/sebi_data/commondocs/');

  if (!fetchImpl && isDirectPdfUrl && urlStr.startsWith('https:')) {
    try {
      return await downloadViaNodeHttps(urlStr, timeoutMs, maxSizeBytes);
    } catch (httpsErr: unknown) {
      if (httpsErr instanceof SebiPdfSizeExceededError) {
        throw httpsErr;
      }
      // Fall through to standard fetch if https fails
    }
  }

  const fetcher = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let buffer: Buffer;
  let contentType = 'unknown';

  try {
    response = await fetcher(urlStr, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': SEBI_BROWSER_USER_AGENT,
        Referer: 'https://www.sebi.gov.in/',
      },
    });

    if (response.status < 200 || response.status > 299) {
      throw new SebiFetchError(
        `SEBI document download failed with status ${response.status}`,
      );
    }

    contentType = response.headers.get('content-type') || 'unknown';

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

    // B. Byte count protection when reading response buffer
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > maxSizeBytes) {
      throw new SebiPdfSizeExceededError(
        `SEBI document size (${arrayBuf.byteLength} bytes) exceeds maximum limit (${maxSizeBytes} bytes)`,
      );
    }
    buffer = Buffer.from(arrayBuf);
  } catch (error: unknown) {
    if (error instanceof SebiPdfSizeExceededError) {
      throw error;
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      throw new SebiFetchError(`SEBI document download timed out after ${timeoutMs}ms`);
    }
    throw new SebiFetchError(`SEBI document download failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  // C. PART A: HTML Detail Page -> PDF Resolution
  // If response is HTML, attempt to resolve the actual embedded PDF URL and download it.
  const lowerContentType = contentType.toLowerCase();
  const isHtmlResponse =
    lowerContentType.includes('text/html') ||
    buffer.slice(0, 200).toString('utf-8').toLowerCase().includes('<html') ||
    buffer.slice(0, 200).toString('utf-8').toLowerCase().includes('<!doctype');

  if (isHtmlResponse) {
    const htmlText = buffer.toString('utf-8');
    const resolvedPdfUrl = resolveSebiPdfUrlFromHtml(htmlText, urlStr);

    if (resolvedPdfUrl && resolvedPdfUrl !== urlStr) {
      try {
        const pdfResult = await downloadSebiDocument(
          resolvedPdfUrl,
          fetchImpl,
          timeoutMs,
          maxSizeBytes,
          companyWebsite,
        );
        const isPdf =
          pdfResult.documentBuffer &&
          (pdfResult.contentType.toLowerCase().includes('pdf') ||
            pdfResult.documentBuffer.slice(0, 4).toString('utf-8') === '%PDF');
        if (isPdf) {
          return pdfResult;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new SebiFetchError(
          `Failed to download resolved PDF from '${resolvedPdfUrl}': ${msg}`,
        );
      }
    }
  }

  return {
    status: response.status,
    contentType,
    contentLength: buffer.length,
    documentBuffer: buffer,
  };
}

export const SEBI_DOCUMENT_DOWNLOAD_TIMEOUT_MS = 120_000;

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
    companyWebsite?: string | null,
  ): Promise<SebiDownloadDocumentResult> {
    const maxSizeBytes =
      this.config.get('SEBI_MAX_PDF_SIZE_BYTES', { infer: true }) ||
      DEFAULT_SEBI_MAX_PDF_SIZE_BYTES;
    return downloadSebiDocument(
      documentUrl,
      fetchImpl,
      SEBI_DOCUMENT_DOWNLOAD_TIMEOUT_MS,
      maxSizeBytes,
      companyWebsite,
    );
  }
}

