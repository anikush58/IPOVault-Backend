import {
  canonicalJsonStringify,
  computeCanonicalEtag,
  matchesIfNoneMatch,
  normalizeEtagValue,
  parseIfNoneMatchHeader,
  sendConditionalJson,
} from './etag.util';

describe('HTTP ETag Utility', () => {
  it('computes identical SHA-256 ETags regardless of object key insertion order', () => {
    const a = {
      meta: { total: 2, page: 1 },
      data: [{ id: '1', gmp: { amount: 120, percent: 25 } }],
    };
    const b = {
      data: [{ gmp: { percent: 25, amount: 120 }, id: '1' }],
      meta: { page: 1, total: 2 },
    };

    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    const etagA = computeCanonicalEtag(a);
    const etagB = computeCanonicalEtag(b);

    expect(etagA).toMatch(/^"[a-f0-9]{64}"$/);
    expect(etagA).toBe(etagB);
  });

  it('produces a different SHA-256 ETag when payload changes', () => {
    const base = { data: [{ id: '1', status: 'OPEN', gmpAmount: 50 }] };
    const updated = { data: [{ id: '1', status: 'OPEN', gmpAmount: 75 }] };

    expect(computeCanonicalEtag(base)).not.toBe(computeCanonicalEtag(updated));
  });

  it('parses and matches quoted, weak W/"...", multi-value, and wildcard If-None-Match headers', () => {
    const etag = '"abc123def456"';

    expect(normalizeEtagValue('W/"abc123def456"')).toBe('abc123def456');
    expect(parseIfNoneMatchHeader('"dead", W/"abc123def456"')).toEqual([
      '"dead"',
      'W/"abc123def456"',
    ]);

    expect(matchesIfNoneMatch('"abc123def456"', etag)).toBe(true);
    expect(matchesIfNoneMatch('W/"abc123def456"', etag)).toBe(true);
    expect(matchesIfNoneMatch('"other", W/"abc123def456"', etag)).toBe(true);
    expect(matchesIfNoneMatch('*', etag)).toBe(true);
    expect(matchesIfNoneMatch('"different"', etag)).toBe(false);
    expect(matchesIfNoneMatch(undefined, etag)).toBe(false);
  });

  it('returns 304 without serializing JSON when If-None-Match matches', () => {
    const payload = { data: [{ id: 'ipo-1' }], meta: { page: 1 } };
    const expectedEtag = computeCanonicalEtag(payload);

    const headers: Record<string, string> = {};
    let statusCode = 0;
    const jsonMock = jest.fn();
    const endMock = jest.fn();

    const mockRes: any = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      status: (code: number) => {
        statusCode = code;
        return mockRes;
      },
      json: jsonMock,
      end: endMock,
    };

    sendConditionalJson(
      { headers: { 'if-none-match': `W/${expectedEtag}` } },
      mockRes,
      payload,
    );

    expect(statusCode).toBe(304);
    expect(headers['ETag']).toBe(expectedEtag);
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(endMock).toHaveBeenCalledTimes(1);
    expect(jsonMock).not.toHaveBeenCalled();
  });
});
