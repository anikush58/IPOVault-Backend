import { NseFetchError } from './nse-fetch.error';
import { NSE_BROWSER_USER_AGENT, fetchNseDocument } from './nse.fetcher';

const ENDPOINT = 'https://nse.test/api/ipo';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('NSE HTTP fetcher', () => {
  it('returns status and parsed JSON from a successful response', async () => {
    const payload = { data: [{ symbol: 'MOCKTECH' }] };
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse(payload)) as jest.MockedFunction<
      typeof fetch
    >;

    const result = await fetchNseDocument({ endpoint: ENDPOINT, fetchImpl });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(payload);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect(init?.method).toBe('GET');
    expect(init?.headers).toEqual(
      expect.objectContaining({
        'User-Agent': NSE_BROWSER_USER_AGENT,
      }),
    );
  });

  it('throws for a non-2xx response', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response('forbidden', { status: 403 }),
      ) as jest.MockedFunction<typeof fetch>;

    await expect(
      fetchNseDocument({ endpoint: ENDPOINT, fetchImpl }),
    ).rejects.toThrow(NseFetchError);
    await expect(
      fetchNseDocument({ endpoint: ENDPOINT, fetchImpl }),
    ).rejects.toThrow('NSE request failed with status 403');
  });

  it('throws for timeout and network failures', async () => {
    const hangingFetch: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

    await expect(
      fetchNseDocument({
        endpoint: ENDPOINT,
        timeoutMs: 20,
        fetchImpl: hangingFetch,
      }),
    ).rejects.toThrow('NSE request timed out');

    const failingFetch = jest
      .fn()
      .mockRejectedValue(new TypeError('fetch failed')) as jest.MockedFunction<
      typeof fetch
    >;

    await expect(
      fetchNseDocument({ endpoint: ENDPOINT, fetchImpl: failingFetch }),
    ).rejects.toThrow('NSE request failed: fetch failed');
  });

  it('throws for an empty response body', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        new Response('   ', { status: 200 }),
      ) as jest.MockedFunction<typeof fetch>;

    await expect(
      fetchNseDocument({ endpoint: ENDPOINT, fetchImpl }),
    ).rejects.toThrow('NSE response was empty');
  });
});
