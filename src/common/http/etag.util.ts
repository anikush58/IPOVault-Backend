import { createHash } from 'crypto';
import type { Request, Response } from 'express';

/**
 * Recursively produces a canonical JSON string with deterministically sorted object keys.
 * Matches JSON.stringify semantics (omits undefined object properties, serializes Date via toISOString).
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'number') {
    return Number.isFinite(value as number) ? String(value) : 'null';
  }
  if (type === 'boolean' || type === 'string') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) =>
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : canonicalJsonStringify(item),
    );
    return `[${parts.join(',')}]`;
  }
  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof (obj as { toJSON?: () => unknown }).toJSON === 'function') {
      return canonicalJsonStringify(
        (obj as { toJSON: () => unknown }).toJSON(),
      );
    }
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const prop = obj[key];
      if (
        prop === undefined ||
        typeof prop === 'function' ||
        typeof prop === 'symbol'
      ) {
        continue;
      }
      entries.push(`${JSON.stringify(key)}:${canonicalJsonStringify(prop)}`);
    }
    return `{${entries.join(',')}}`;
  }

  return 'null';
}

/**
 * Computes a strong quoted SHA-256 ETag (`"<hex>"`) over a canonicalized payload.
 */
export function computeCanonicalEtag(payload: unknown): string {
  const canonical = canonicalJsonStringify(payload);
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return `"${hash}"`;
}

/**
 * Normalizes a strong or weak ETag token (e.g. `W/"abc"`, `"abc"`, `abc`)
 * to its opaque unquoted value for comparison.
 */
export function normalizeEtagValue(token: string): string {
  let trimmed = token.trim();
  if (/^W\//i.test(trimmed)) {
    trimmed = trimmed.slice(2).trim();
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Parses an HTTP `If-None-Match` header value into candidate ETag tokens,
 * respecting quoted strings that may contain commas.
 */
export function parseIfNoneMatchHeader(
  headerValue: string | string[] | undefined,
): string[] {
  if (!headerValue) return [];
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      const candidate = current.trim();
      if (candidate) tokens.push(candidate);
      current = '';
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) tokens.push(tail);
  return tokens;
}

/**
 * Returns true if the incoming `If-None-Match` header matches `currentEtag`
 * (supports `"<hash>"`, `W/"<hash>"`, unquoted hashes, comma lists, and `*`).
 */
export function matchesIfNoneMatch(
  headerValue: string | string[] | undefined,
  currentEtag: string,
): boolean {
  const candidates = parseIfNoneMatchHeader(headerValue);
  if (candidates.length === 0) return false;

  const targetNormalized = normalizeEtagValue(currentEtag);
  for (const candidate of candidates) {
    if (candidate === '*') return true;
    if (normalizeEtagValue(candidate) === targetNormalized) {
      return true;
    }
  }
  return false;
}

/**
 * Sends a conditional JSON response with deterministic SHA-256 ETag and `Cache-Control: no-cache`.
 * Returns HTTP 304 Not Modified with empty body when `If-None-Match` matches.
 */
export function sendConditionalJson<T>(
  req: Pick<Request, 'headers'>,
  res: Pick<Response, 'setHeader' | 'status' | 'end' | 'json'>,
  payload: T,
): void {
  const etag = computeCanonicalEtag(payload);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');

  if (matchesIfNoneMatch(req?.headers?.['if-none-match'], etag)) {
    res.status(304).end();
    return;
  }

  res.status(200).json(payload);
}
