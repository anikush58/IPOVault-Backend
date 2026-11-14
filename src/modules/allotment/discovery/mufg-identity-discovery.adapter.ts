import { Injectable, Logger } from '@nestjs/common';
import {
  DiscoveredRegistrarIssue,
  IRegistrarIdentityDiscoveryAdapter,
} from './registrar-identity-discovery.types';

export const DEFAULT_MUFG_INTIME_BASE_URL = 'https://in.mpms.mufg.com';
export const DEFAULT_MUFG_INTIME_COMPANY_LIST_URL = `${DEFAULT_MUFG_INTIME_BASE_URL}/Initial_Offer/IPO.aspx/GetDetails`;
export const DEFAULT_MUFG_DISCOVERY_TIMEOUT_MS = 8000;
export const DEFAULT_MUFG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_MUFG_MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Decodes standard named XML entities, numeric character references, and extracts CDATA.
 */
export function decodeXmlEntities(val: string): string {
  if (!val) return '';

  // 1. Extract and unwrap CDATA sections if present
  let decoded = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');

  // 2. Named entities
  decoded = decoded
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");

  // 3. Numeric decimal character references (e.g. &#38; -> &)
  decoded = decoded.replace(/&#([0-9]+);/g, (_, dec) => {
    const code = parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
  });

  // 4. Numeric hex character references (e.g. &#x26; -> &)
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
  });

  return decoded.trim();
}

/**
 * Validates company ID and name for registrar issue discovery.
 * Filters out dummy IDs (0, -1, placeholders), UUIDs, select prompts, and empty strings.
 */
export function isValidMufgCompanyRecord(id: string, name: string): boolean {
  if (!id || !name) {
    return false;
  }
  const trimmedId = id.trim();
  const trimmedName = name.trim();
  if (!trimmedId || !trimmedName) {
    return false;
  }

  const idLower = trimmedId.toLowerCase();
  if (
    trimmedId === '0' ||
    trimmedId === '-1' ||
    ['tbd', 'na', 'n/a', 'none', 'null', 'undefined'].includes(idLower)
  ) {
    return false;
  }

  // Reject internal UUIDs mistakenly used as registrar client IDs
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmedId,
    )
  ) {
    return false;
  }

  const nameLower = trimmedName.toLowerCase();
  if (
    nameLower.includes('--select--') ||
    nameLower.includes('select company') ||
    ['tbd', 'na', 'n/a', 'none', 'null', 'undefined'].includes(nameLower)
  ) {
    return false;
  }

  return true;
}

/**
 * Parses the MUFG / Link Intime GetDetails response payload.
 * Accepts either a parsed JSON object { d: string } or raw string.
 * Extracts each <Table> record's company_id and companyname.
 * Validates IDs and names, and deduplicates by company_id.
 * Rejects truncated XML, unclosed Table tags, and missing closing </NewDataSet> roots.
 */
export function parseMufgGetDetailsPayload(
  rawInput: unknown,
  registrarCode = 'MUFG_INTIME',
): DiscoveredRegistrarIssue[] {
  if (rawInput === null || rawInput === undefined) {
    throw new Error('MUFG company list payload is null or undefined');
  }

  let parsedJson: unknown = rawInput;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return [];
    }
    try {
      parsedJson = JSON.parse(trimmed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Malformed JSON payload from MUFG endpoint: ${msg}`);
    }
  }

  if (!parsedJson || typeof parsedJson !== 'object') {
    throw new Error(
      'Unexpected company list payload structure from MUFG Intime',
    );
  }

  // Support direct array format if returned by mocks or alternate APIs
  if (Array.isArray(parsedJson)) {
    return parseMufgArrayPayload(parsedJson, registrarCode);
  }

  const envelope = parsedJson as { d?: unknown };
  if (envelope.d === undefined || envelope.d === null) {
    throw new Error('Missing "d" property in MUFG company list response');
  }

  if (typeof envelope.d !== 'string') {
    throw new Error(
      'Invalid "d" property type in MUFG company list response (expected string)',
    );
  }

  const xmlString = envelope.d.trim();
  if (!xmlString) {
    return [];
  }

  // Reject HTML error pages
  if (/<(!doctype|html|head|body)\b/i.test(xmlString)) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: received HTML document',
    );
  }

  // Must contain NewDataSet root
  if (!xmlString.includes('<NewDataSet')) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: missing NewDataSet root element',
    );
  }

  // Check for legitimate self-closing empty NewDataSet: <NewDataSet />, <NewDataSet/>, etc.
  if (
    /^<NewDataSet(?:\s+[^>]*?)?\s*\/>$/i.test(xmlString) ||
    /^<NewDataSet(?:\s+[^>]*?)?>\s*<\/NewDataSet>$/i.test(xmlString)
  ) {
    return [];
  }

  // For non-empty responses, require complete properly closed </NewDataSet> root
  if (!xmlString.includes('</NewDataSet>')) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: missing closing </NewDataSet> root tag (truncated XML)',
    );
  }

  // Verify that </NewDataSet> appears at the end of the content
  if (!/<\/NewDataSet>\s*$/i.test(xmlString)) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: trailing content after closing </NewDataSet> tag',
    );
  }

  // Check Table opening vs closing tag counts to catch any truncation or unclosed Table tag
  const openTableMatches = xmlString.match(/<Table\b/gi) || [];
  const closeTableMatches = xmlString.match(/<\/Table>/gi) || [];
  if (openTableMatches.length !== closeTableMatches.length) {
    throw new Error(
      `Malformed XML payload from MUFG endpoint: mismatched Table tags (${openTableMatches.length} opening vs ${closeTableMatches.length} closing; truncated XML)`,
    );
  }

  // Ensure last <Table tag is followed by its </Table> closing tag
  if (xmlString.lastIndexOf('<Table') > xmlString.lastIndexOf('</Table>')) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: unclosed Table element (truncated XML)',
    );
  }

  // Ensure closing </NewDataSet> appears after the last </Table> tag
  if (
    openTableMatches.length > 0 &&
    xmlString.indexOf('</NewDataSet>') < xmlString.lastIndexOf('</Table>')
  ) {
    throw new Error(
      'Malformed XML payload from MUFG endpoint: closing </NewDataSet> tag precedes Table records',
    );
  }

  const tableRegex = /<Table[\s\S]*?>([\s\S]*?)<\/Table>/gi;
  let tableMatch: RegExpExecArray | null;
  const issues: DiscoveredRegistrarIssue[] = [];
  const seenIds = new Set<string>();
  const now = new Date();

  while ((tableMatch = tableRegex.exec(xmlString)) !== null) {
    const tableContent = tableMatch[1];
    const record: Record<string, string> = {};
    const fieldRegex = /<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/gi;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(tableContent)) !== null) {
      const tag = fieldMatch[1];
      const val = decodeXmlEntities(fieldMatch[2]);
      record[tag] = val;
    }

    const companyId = (
      record.company_id ??
      record.clientid ??
      record.id ??
      record.clientId ??
      record.code ??
      ''
    ).trim();

    const companyName = (
      record.companyname ??
      record.company_name ??
      record.name ??
      ''
    ).trim();

    if (isValidMufgCompanyRecord(companyId, companyName)) {
      if (!seenIds.has(companyId)) {
        seenIds.add(companyId);
        issues.push({
          externalId: companyId,
          externalName: companyName,
          registrarCode,
          discoveredAt: now,
          isStale: false,
          rawPayload: record,
        });
      }
    }
  }

  return issues;
}

function parseMufgArrayPayload(
  arr: unknown[],
  registrarCode: string,
): DiscoveredRegistrarIssue[] {
  const issues: DiscoveredRegistrarIssue[] = [];
  const seenIds = new Set<string>();
  const now = new Date();

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = String(
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

    if (isValidMufgCompanyRecord(id, name) && !seenIds.has(id)) {
      seenIds.add(id);
      issues.push({
        externalId: id,
        externalName: name,
        registrarCode,
        discoveredAt: now,
        isStale: false,
        rawPayload: rec,
      });
    }
  }

  return issues;
}

@Injectable()
export class MufgIdentityDiscoveryAdapter
  implements IRegistrarIdentityDiscoveryAdapter
{
  readonly registrarCode = 'MUFG_INTIME';
  readonly name = 'MUFG Intime Identity Discovery Adapter';

  private readonly logger = new Logger(MufgIdentityDiscoveryAdapter.name);
  private cachedIssues: DiscoveredRegistrarIssue[] = [];
  private cachedAt: number | null = null;

  public getCacheTtlMs(): number {
    const raw = process.env.MUFG_INTIME_CACHE_TTL_MS;
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return DEFAULT_MUFG_CACHE_TTL_MS;
  }

  /**
   * Resolves the company list endpoint URL, supporting MUFG_INTIME_COMPANY_LIST_URL
   * and MUFG_INTIME_BASE_URL environment overrides.
   */
  public getCompanyListUrl(): string {
    if (process.env.MUFG_INTIME_COMPANY_LIST_URL?.trim()) {
      return process.env.MUFG_INTIME_COMPANY_LIST_URL.trim();
    }
    const baseHost =
      process.env.MUFG_INTIME_BASE_URL?.trim() || DEFAULT_MUFG_INTIME_BASE_URL;
    return `${baseHost}/Initial_Offer/IPO.aspx/GetDetails`;
  }

  /**
   * Returns a snapshot of the current cached registry.
   */
  public getCachedIssues(): DiscoveredRegistrarIssue[] {
    return [...this.cachedIssues];
  }

  /**
   * Returns timestamp when cache was populated.
   */
  public getCachedAt(): number | null {
    return this.cachedAt;
  }

  /**
   * Sets cached issues explicitly (primarily for unit testing and state initialization).
   */
  public setCachedIssues(
    issues: DiscoveredRegistrarIssue[],
    cachedAt: number = Date.now(),
  ): void {
    this.cachedIssues = [...issues];
    this.cachedAt = cachedAt;
  }

  public clearCache(): void {
    this.cachedIssues = [];
    this.cachedAt = null;
  }

  /**
   * Discovers active IPO issues from MUFG Intime.
   * Performs POST request to GetDetails with {} payload.
   * Maintains a bounded in-memory cached registry (24h TTL).
   * In transient failures, serves stale cache marked with isStale: true without updating cachedAt.
   * If cache is expired or empty, fails closed with an error.
   */
  async discoverIssues(): Promise<DiscoveredRegistrarIssue[]> {
    const companyListUrl = this.getCompanyListUrl();
    const baseHost =
      process.env.MUFG_INTIME_BASE_URL?.trim() || DEFAULT_MUFG_INTIME_BASE_URL;

    this.logger.log(`Fetching MUFG Intime company list from ${companyListUrl}...`);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, DEFAULT_MUFG_DISCOVERY_TIMEOUT_MS);

    try {
      const response = await fetch(companyListUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
          Origin: baseHost,
          Referer: `${baseHost}/Initial_Offer/public-issues.html`,
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `MUFG Intime company list returned HTTP status ${response.status}`,
        );
      }

      // Check Content-Type: reject HTML without rejecting omitted or generic application/json
      const contentType = response.headers.get('content-type')?.toLowerCase();
      if (
        contentType &&
        (contentType.includes('text/html') ||
          contentType.includes('application/xhtml+xml'))
      ) {
        throw new Error(
          `MUFG Intime endpoint returned HTML content-type (${contentType}) instead of JSON`,
        );
      }

      // Check Content-Length if provided
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (
          Number.isFinite(contentLength) &&
          contentLength > DEFAULT_MUFG_MAX_RESPONSE_BYTES
        ) {
          throw new Error(
            `MUFG Intime response Content-Length (${contentLength} bytes) exceeds maximum limit (${DEFAULT_MUFG_MAX_RESPONSE_BYTES} bytes)`,
          );
        }
      }

      const rawText = await response.text();
      if (rawText.length > DEFAULT_MUFG_MAX_RESPONSE_BYTES) {
        throw new Error(
          `MUFG Intime response payload size (${rawText.length} bytes) exceeds maximum limit (${DEFAULT_MUFG_MAX_RESPONSE_BYTES} bytes)`,
        );
      }

      let rawJson: unknown;
      try {
        rawJson = JSON.parse(rawText);
      } catch (parseErr: unknown) {
        const msg =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        throw new Error(`Failed to parse JSON response from MUFG Intime: ${msg}`);
      }

      const issues = parseMufgGetDetailsPayload(rawJson, this.registrarCode);

      if (issues.length > 0) {
        this.cachedIssues = [...issues];
        this.cachedAt = Date.now();
        this.logger.log(
          `Successfully discovered and cached ${issues.length} issues from MUFG Intime`,
        );
        return [...issues];
      }

      // Empty response (e.g. <NewDataSet />)
      return this.handleFallback(
        'Empty company list received from MUFG Intime endpoint',
      );
    } catch (err: unknown) {
      const isAbort =
        (err as Error)?.name === 'AbortError' ||
        (err as Error)?.message?.includes('aborted');
      const errorMsg = isAbort
        ? `MUFG Intime discovery request timed out after ${DEFAULT_MUFG_DISCOVERY_TIMEOUT_MS}ms`
        : (err as Error)?.message || String(err);

      return this.handleFallback(errorMsg);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * Recovers from cache if valid and within TTL, marking issues explicitly as stale.
   * If cache is expired or empty, fails closed by throwing an error.
   */
  private handleFallback(reason: string): DiscoveredRegistrarIssue[] {
    const now = Date.now();
    const ttlMs = this.getCacheTtlMs();

    if (
      this.cachedIssues.length > 0 &&
      this.cachedAt !== null &&
      now - this.cachedAt <= ttlMs
    ) {
      // Valid cache within TTL: DO NOT refresh this.cachedAt!
      this.logger.warn(
        `[REGISTRAR_ALERT:STALE_REGISTRY] Serving stale in-memory MUFG Intime registry (${this.cachedIssues.length} items, cachedAt: ${new Date(this.cachedAt).toISOString()}, reason: ${reason})`,
      );

      return this.cachedIssues.map((issue) => ({
        ...issue,
        isStale: true,
        rawPayload: {
          ...issue.rawPayload,
          isStale: true,
          cachedAt: this.cachedAt,
          staleReason: reason,
        },
      }));
    }

    // Cache expired or unavailable: fail closed
    const isExpired = this.cachedAt !== null && now - this.cachedAt > ttlMs;
    const detail = isExpired
      ? `cached registry expired (${Math.round((now - this.cachedAt!) / 1000)}s old > ${Math.round(ttlMs / 1000)}s TTL)`
      : 'no cached registry available';

    this.logger.error(
      `[REGISTRAR_ALERT:DISCOVERY_FAILURE] MUFG Intime discovery failed (${detail}): ${reason}`,
    );

    throw new Error(`MUFG Intime discovery failed (${detail}): ${reason}`);
  }
}
