import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { IpoGuruService } from './ipo-guru.service';

// Minimal stub for global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('IpoGuruService', () => {
  let service: IpoGuruService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      if (key === 'IPOGURU_API_KEY') return 'test-api-key-secret';
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpoGuruService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    service = module.get<IpoGuruService>(IpoGuruService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── Test 1: Successful API response parsing ────────────────────────────

  it('should parse a successful API response with data envelope', async () => {
    const mockIpos = [
      {
        id: '1',
        name: 'Acme Corp IPO',
        ipo_type: 'Mainboard',
        status: 'Open',
        open_date: '2025-01-10',
        close_date: '2025-01-12',
        allotment_date: '2025-01-14',
        listing_date: '2025-01-16',
        price_band_min: 100,
        price_band_max: 110,
        issue_price: 110,
        lot_size: 135,
        issue_size: 500,
        exchange: 'BSE, NSE',
        registrar: 'Link Intime',
        qib_sub: 4.5,
        nii_sub: 12.3,
        retail_sub: 8.1,
        total_sub: 7.9,
        gmp: 25,
        gmp_pct: 22.7,
        issue_type: 'Fresh Issue',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({ data: mockIpos, total: 1 }),
    });

    const result = await service.fetchIpos();

    expect(result.httpStatus).toBe(200);
    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].name).toBe('Acme Corp IPO');
    expect(result.ipos[0].status).toBe('Open');
    expect(result.ipos[0].gmp).toBe(25);
    expect(result.ipos[0].gmp_pct).toBe(22.7);
    expect(result.total).toBe(1);
    expect(result.fetchedAt).toBeTruthy();
    expect(new Date(result.fetchedAt).toISOString()).toBe(result.fetchedAt);
  });

  it('should parse a successful API response with ipos envelope', async () => {
    const mockIpos = [{ id: '2', name: 'Beta IPO', status: 'Upcoming' }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({ ipos: mockIpos, count: 1 }),
    });

    const result = await service.fetchIpos();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].name).toBe('Beta IPO');
    expect(result.total).toBe(1);
  });

  it('should parse a successful response with top-level array', async () => {
    const mockIpos = [{ id: '3', name: 'Gamma IPO' }];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce(mockIpos),
    });

    const result = await service.fetchIpos();

    expect(result.ipos).toHaveLength(1);
    expect(result.ipos[0].name).toBe('Gamma IPO');
  });

  // ── Test 2: API error handling ─────────────────────────────────────────

  it('should return empty result with httpStatus on 4xx API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: jest.fn().mockResolvedValueOnce('{"error":"Forbidden"}'),
    });

    const result = await service.fetchIpos();

    expect(result.httpStatus).toBe(403);
    expect(result.ipos).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('should return empty result with httpStatus on 429 rate-limit error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: jest.fn().mockResolvedValueOnce('Rate limit exceeded'),
    });

    const result = await service.fetchIpos();

    expect(result.httpStatus).toBe(429);
    expect(result.ipos).toHaveLength(0);
  });

  it('should throw on network error (fetch throws)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

    await expect(service.fetchIpos()).rejects.toThrow(
      'IPO Guru API request failed: Network unreachable',
    );
  });

  it('should throw when IPOGURU_API_KEY is not configured', async () => {
    configGet.mockReturnValue(undefined);

    await expect(service.fetchIpos()).rejects.toThrow(
      'IPOGURU_API_KEY is not configured',
    );
  });

  // ── Test 3: API key is not exposed in response or UI ─────────────────

  it('should NOT expose API key in the fetch result', async () => {
    const apiKey = 'test-api-key-secret';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({
        data: [{ id: '1', name: 'Test IPO' }],
        // Simulate a paranoid API that echoes the key in response (should be filtered)
        api_key: apiKey,
        key: apiKey,
        token: 'some-token',
      }),
    });

    const result = await service.fetchIpos();

    // Result struct should never contain the API key or token fields
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(result.responseKeys).not.toContain('api_key');
    expect(result.responseKeys).not.toContain('key');
    expect(result.responseKeys).not.toContain('token');
    expect(result.responseKeys).not.toContain('secret');
  });

  it('should send the API key as X-API-KEY header, not in query params or Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValueOnce({ data: [] }),
    });

    await service.fetchIpos();

    const [calledUrl, calledOptions] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];

    // URL must not include the key as a query param
    expect(calledUrl).not.toContain('api_key=');
    expect(calledUrl).not.toContain('key=');
    expect(calledUrl).not.toContain('apiKey=');

    // Key must be in X-API-KEY header, not Authorization
    const headers = calledOptions?.headers as Record<string, string>;
    expect(headers?.['X-API-KEY']).toBe('test-api-key-secret');
    expect(headers?.['Authorization']).toBeUndefined();
  });
});
