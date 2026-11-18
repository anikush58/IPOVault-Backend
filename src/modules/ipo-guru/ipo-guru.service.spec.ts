import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { IpoGuruService } from './ipo-guru.service';
import { PrismaService } from '../../database/prisma.service';

// Minimal stub for global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('IpoGuruService', () => {
  let service: IpoGuruService;
  let configGet: jest.Mock;
  let mockPrisma: any;

  beforeEach(async () => {
    configGet = jest.fn((key: string) => {
      if (key === 'IPOGURU_API_KEY') return 'test-api-key-secret';
      return undefined;
    });

    const txMock = {
      ipo: {
        update: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
        create: jest.fn().mockResolvedValue({ id: 'new-ipo-id' }),
      },
      company: {
        create: jest.fn().mockResolvedValue({ id: 'new-company-id' }),
      },
      ipoSourceIdentity: {
        upsert: jest.fn().mockResolvedValue({ id: 'isi-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue({ id: 'isi-1' }),
        update: jest.fn().mockResolvedValue({ id: 'isi-1' }),
      },
      ipoLifecycleEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'ile-1' }),
      },
      ipoAllotmentConfig: {
        upsert: jest.fn().mockResolvedValue({ id: 'iac-1' }),
      },
      ipoParticipant: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ip-1' }),
        update: jest.fn().mockResolvedValue({ id: 'ip-1' }),
      },
      gmpObservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'gmp-1' }),
      },
      subscriptionObservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      },
      fieldProvenance: {
        create: jest.fn().mockResolvedValue({ id: 'fp-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockPrisma = {
      source: {
        upsert: jest.fn().mockResolvedValue({ id: 'source-ipoguru', rateLimitPolicy: null }),
        update: jest.fn().mockResolvedValue({ id: 'source-ipoguru' }),
      },
      ipo: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      discoveryRecord: {
        create: jest.fn().mockResolvedValue({ id: 'dr-1' }),
      },
      $transaction: jest.fn((callback) => callback(txMock)),
      _txMock: txMock,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpoGuruService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
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
        api_key: apiKey,
        key: apiKey,
        token: 'some-token',
      }),
    });

    const result = await service.fetchIpos();

    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(result.responseKeys).not.toContain('api_key');
    expect(result.responseKeys).not.toContain('key');
    expect(result.responseKeys).not.toContain('token');
    expect(result.responseKeys).not.toContain('secret');
  });

    it('should send the API key as X-API-KEY header and call the v2 endpoint', async () => {
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

      expect(calledUrl).toBe('https://www.ipoguru.in/api/v2/ipos');
      expect(calledUrl).not.toContain('api_key=');
      expect(calledUrl).not.toContain('key=');
      expect(calledUrl).not.toContain('apiKey=');

      const headers = calledOptions?.headers as Record<string, string>;
      expect(headers?.['X-API-KEY']).toBe('test-api-key-secret');
      expect(headers?.['Authorization']).toBeUndefined();
    });

    it('should detect and classify retired v1 403 error with actionable migration guidance', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValueOnce(
          JSON.stringify({
            success: false,
            error: 'v1_retired',
            message: 'API v1 was deprecated on 30 September 2026 and is no longer available for this key. Please use API v2 only.',
          }),
        ),
      });

      const result = await service.fetchIpos();

      expect(result.httpStatus).toBe(403);
      expect(result.ipos).toEqual([]);
      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rateLimitPolicy: expect.objectContaining({
              lastFetchStatus: expect.stringContaining('v1 was retired on 30 September 2026'),
            }),
          }),
        }),
      );
    });

    it('should automatically migrate configured IPOGURU_BASE_URL pointing to /api/v1 to /api/v2', async () => {
      configGet.mockImplementation((key: string) => {
        if (key === 'IPOGURU_API_KEY') return 'test-api-key-secret';
        if (key === 'IPOGURU_BASE_URL') return 'https://www.ipoguru.in/api/v1';
        return undefined;
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ data: [] }),
      });

      await service.fetchIpos();

      const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe('https://www.ipoguru.in/api/v2/ipos');
      expect(calledUrl).not.toContain('/api/v1');
    });

    it('should append query parameters like months=0 and status to the v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({ data: [] }),
      });

      await service.fetchIpos('MANUAL', undefined, { months: 0, status: 'upcoming' });

      const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toBe('https://www.ipoguru.in/api/v2/ipos?months=0&status=upcoming');
    });

  // ── Test 4: Matching Logic (matchIpo) ───────────────────────────────────

  describe('matchIpo', () => {
    const existingIpo = {
      id: 'ipo-existing-1',
      symbol: 'SWIGGY',
      nseSymbol: 'SWIGGY',
      bseSymbol: '544280',
      marketSegment: 'MAINBOARD',
      status: 'CLOSED',
      company: {
        id: 'comp-1',
        legalName: 'Swiggy Limited',
        displayName: 'Swiggy Ltd',
      },
      sourceIdentities: [
        { sourceId: 'src-1', symbol: 'SWIGGY', externalId: 'swiggy-ipo' },
      ],
    } as any;

    it('should match an IPO by externalId / slug', () => {
      const match = service.matchIpo(
        { slug: 'swiggy-ipo', name: 'Different Name' } as any,
        [existingIpo],
      );
      expect(match.matchedBy).toBe('SYMBOL');
      expect(match.matchedIpo?.id).toBe('ipo-existing-1');
    });

    it('should match an IPO by exact symbol match', () => {
      const match = service.matchIpo(
        { symbol: 'SWIGGY', name: 'Different Name IPO' } as any,
        [existingIpo],
      );
      expect(match.matchedBy).toBe('SYMBOL');
      expect(match.matchedIpo?.id).toBe('ipo-existing-1');
    });

    it('should match an IPO by normalized company name', () => {
      const match = service.matchIpo(
        { symbol: undefined, name: 'Swiggy Limited' } as any,
        [existingIpo],
      );
      expect(match.matchedBy).toBe('NAME');
      expect(match.matchedIpo?.id).toBe('ipo-existing-1');
    });

    it('should return NONE when no match is found', () => {
      const match = service.matchIpo(
        { symbol: 'UNKNOWN', name: 'Completely New Company Ltd' } as any,
        [existingIpo],
      );
      expect(match.matchedBy).toBe('NONE');
      expect(match.matchedIpo).toBeNull();
    });

    it('should return AMBIGUOUS when multiple IPOs match by normalized name', () => {
      const candidate1 = {
        id: 'ipo-1',
        company: { displayName: 'Swastika Infra Ltd.', legalName: 'Swastika Infra Ltd.' },
        sourceIdentities: [],
      } as any;
      const candidate2 = {
        id: 'ipo-2',
        company: { displayName: 'Swastika Infra Limited', legalName: 'Swastika Infra Limited' },
        sourceIdentities: [],
      } as any;

      const match = service.matchIpo(
        { symbol: undefined, name: 'Swastika Infra' } as any,
        [candidate1, candidate2],
      );

      expect(match.matchedBy).toBe('AMBIGUOUS');
      expect(match.matchedIpo).toBeNull();
      expect(match.ambiguousCandidates).toHaveLength(2);
    });

    it('should return AMBIGUOUS when multiple IPOs match by symbol', () => {
      const candidate1 = {
        id: 'ipo-1',
        symbol: 'SHARED_SYM',
        company: { displayName: 'Company A' },
        sourceIdentities: [],
      } as any;
      const candidate2 = {
        id: 'ipo-2',
        symbol: 'SHARED_SYM',
        company: { displayName: 'Company B' },
        sourceIdentities: [],
      } as any;

      const match = service.matchIpo(
        { symbol: 'SHARED_SYM', name: 'Some Name' } as any,
        [candidate1, candidate2],
      );

      expect(match.matchedBy).toBe('AMBIGUOUS');
      expect(match.matchedIpo).toBeNull();
      expect(match.ambiguousCandidates).toHaveLength(2);
    });
  });

  // ── Test 5: syncIpos database synchronization ──────────────────────────

  describe('syncIpos', () => {
    it('should parse v2 response (slug, subscription_total, UTC ISO gmp.updated_at, numeric issue_size, missing registrar/face_value) and update existing IPO', async () => {
      const existingIpo = {
        id: 'ipo-existing-1',
        symbol: 'SWIGGY',
        marketSegment: 'MAINBOARD',
        status: 'UPCOMING',
        faceValue: new Prisma.Decimal('1'),
        priceBandLow: new Prisma.Decimal('371'),
        priceBandHigh: new Prisma.Decimal('390'),
        lotSize: 38,
        company: {
          id: 'comp-1',
          legalName: 'Swiggy Limited',
          displayName: 'Swiggy Ltd',
        },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([existingIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swiggy-limited',
              name: 'Swiggy Limited',
              symbol: 'SWIGGY',
              type: 'Mainboard',
              status: 'Closed',
              price_band: '371-390',
              lot_size: 38,
              issue_size: 11327.43,
              open_date: '2024-11-06',
              close_date: '2024-11-08',
              allotment_date: '2024-11-11',
              listing_date: '2024-11-13',
              // registrar and face_value omitted in v2 list response
              gmp: {
                price: 25,
                percentage: 6.41,
                updated_at: '2024-11-13T11:30:00.000Z',
                updated_at_label: '13 Nov 2024, 05:00 PM IST',
              },
              subscription: {
                qib: 1.5,
                nii: 2.1,
                retail: 3.59,
              },
              subscription_total: 3.59,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.totalFetched).toBe(1);
      expect(result.matchedUpdated).toBe(1);
      expect(result.newlyCreated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.items[0].action).toBe('UPDATED');
      expect(result.items[0].matchedBy).toBe('SYMBOL');

      // Verify tx updates
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).toHaveBeenCalled();
      expect(tx.company.create).not.toHaveBeenCalled();
      expect(tx.ipo.create).not.toHaveBeenCalled();
      expect(tx.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ externalId: 'swiggy-limited' }),
          update: expect.objectContaining({ externalId: 'swiggy-limited' }),
        }),
      );
      expect(tx.gmpObservation.create).toHaveBeenCalled();
      expect(tx.subscriptionObservation.create).toHaveBeenCalledTimes(3); // QIB, NII, RETAIL (no spurious OTHER for total)
      expect(tx.ipoAllotmentConfig.upsert).not.toHaveBeenCalled(); // registrar omitted
    });

    it('should NEVER overwrite canonical IpoStatus (e.g. LISTED) when IPO Guru reports CLOSED, but still sync other enrichment fields', async () => {
      const listedIpo = {
        id: 'ipo-listed-1',
        symbol: 'SWIGGY',
        marketSegment: 'MAINBOARD',
        status: 'LISTED',
        faceValue: new Prisma.Decimal('1'),
        priceBandLow: new Prisma.Decimal('371'),
        priceBandHigh: new Prisma.Decimal('390'),
        lotSize: 38,
        company: {
          id: 'comp-1',
          legalName: 'Swiggy Limited',
          displayName: 'Swiggy Ltd',
        },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([listedIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swiggy-limited',
              name: 'Swiggy Limited',
              symbol: 'SWIGGY',
              type: 'Mainboard',
              status: 'Closed',
              price_band: '371-390',
              lot_size: 40,
              issue_size: 11327.43,
              open_date: '2024-11-06',
              close_date: '2024-11-08',
              gmp: {
                price: 30,
                percentage: 7.69,
                updated_at: '2024-11-13T11:30:00.000Z',
              },
              subscription: {
                retail: 4.5,
              },
              subscription_total: 4.5,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-listed-1' },
          data: expect.not.objectContaining({ status: expect.anything() }),
        }),
      );
      expect(tx.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lotSize: 40 }),
        }),
      );
      expect(tx.gmpObservation.create).toHaveBeenCalled();
      expect(tx.subscriptionObservation.create).toHaveBeenCalled();
    });

    it('LISTED + IPO Guru listing price -> listing price syncs', async () => {
      const listedIpo = {
        id: 'ipo-listed-lp-1',
        symbol: 'SWIGGY',
        marketSegment: 'MAINBOARD',
        status: 'LISTED',
        listingPrice: null,
        company: {
          id: 'comp-1',
          legalName: 'Swiggy Limited',
          displayName: 'Swiggy Ltd',
        },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([listedIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swiggy-limited',
              name: 'Swiggy Limited',
              symbol: 'SWIGGY',
              listing_price: 420.5,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-listed-lp-1' },
          data: expect.objectContaining({
            listingPrice: new Prisma.Decimal('420.5'),
          }),
        }),
      );
    });

    it('NOT LISTED + IPO Guru listing price -> listing price does not sync', async () => {
      const closedIpo = {
        id: 'ipo-closed-lp-1',
        symbol: 'SWIGGY',
        marketSegment: 'MAINBOARD',
        status: 'CLOSED', // Not LISTED
        listingPrice: null,
        company: {
          id: 'comp-1',
          legalName: 'Swiggy Limited',
          displayName: 'Swiggy Ltd',
        },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([closedIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swiggy-limited',
              name: 'Swiggy Limited',
              symbol: 'SWIGGY',
              listing_price: 420.5,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            listingPrice: expect.anything(),
          }),
        }),
      );
    });

    it('LISTED + missing/null IPO Guru listing price -> existing listing price remains unchanged', async () => {
      const existingListingPrice = new Prisma.Decimal('415.0');
      const listedIpo = {
        id: 'ipo-listed-lp-existing',
        symbol: 'SWIGGY',
        marketSegment: 'MAINBOARD',
        status: 'LISTED',
        listingPrice: existingListingPrice,
        company: {
          id: 'comp-1',
          legalName: 'Swiggy Limited',
          displayName: 'Swiggy Ltd',
        },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([listedIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swiggy-limited',
              name: 'Swiggy Limited',
              symbol: 'SWIGGY',
              listing_price: null, // missing/null from Guru
              lot_size: 40,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-listed-lp-existing' },
          data: expect.not.objectContaining({
            listingPrice: expect.anything(),
          }),
        }),
      );
    });

    it('should create new company and IPO when no match is found', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'brand-new-startup',
              name: 'Brand New Startup Limited',
              type: 'SME',
              status: 'Upcoming',
              price_band: '120-125',
              lot_size: 1000,
              issue_size: 50.25,
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.totalFetched).toBe(1);
      expect(result.matchedUpdated).toBe(0);
      expect(result.newlyCreated).toBe(1);
      expect(result.items[0].action).toBe('CREATED');

      const tx = mockPrisma._txMock;
      expect(tx.company.create).toHaveBeenCalled();
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'PUBLISHED',
          }),
        }),
      );
      expect(tx.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ externalId: 'brand-new-startup' }),
        }),
      );
    });

    it('should update existing DRAFT publicationStatus to PUBLISHED upon syncing new data', async () => {
      const existingDraftIpo = {
        id: 'draft-ipo-1',
        symbol: 'DRAFTCORP',
        status: 'UPCOMING',
        publicationStatus: 'DRAFT',
        company: { id: 'comp-draft', legalName: 'Draft Corp Limited', displayName: 'Draft Corp' },
        sourceIdentities: [{ externalId: 'draft-corp-ipo', symbol: 'DRAFTCORP' }],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([existingDraftIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'draft-corp-ipo',
              name: 'Draft Corp Limited',
              symbol: 'DRAFTCORP',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'draft-ipo-1' },
          data: expect.objectContaining({
            publicationStatus: 'PUBLISHED',
          }),
        }),
      );
    });

    it('should preserve DRAFT status when existing IPO is under manual review or admin-managed', async () => {
      const existingDraftAdminIpo = {
        id: 'draft-admin-ipo-1',
        symbol: 'ADMINCORP',
        status: 'UPCOMING',
        publicationStatus: 'DRAFT',
        company: { id: 'comp-admin', legalName: 'Admin Corp Limited', displayName: 'Admin Corp' },
        sourceIdentities: [
          { externalId: 'admin-corp-ipo', symbol: 'ADMINCORP', source: { code: 'ADMIN' } },
        ],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([existingDraftAdminIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'admin-corp-ipo',
              name: 'Admin Corp Limited',
              symbol: 'ADMINCORP',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      if (tx.ipo.update.mock.calls.length > 0) {
        expect(tx.ipo.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              publicationStatus: 'PUBLISHED',
            }),
          }),
        );
      }
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should preserve DRAFT status when existing IPO receives data with validation errors', async () => {
      const existingDraftIpo = {
        id: 'draft-bad-ipo-1',
        symbol: 'BADCORP',
        status: 'UPCOMING',
        publicationStatus: 'DRAFT',
        company: { id: 'comp-bad', legalName: 'Bad Corp Limited', displayName: 'Bad Corp' },
        sourceIdentities: [{ externalId: 'bad-corp-ipo', symbol: 'BADCORP' }],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([existingDraftIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'bad-corp-ipo',
              name: 'Bad Corp Limited',
              symbol: 'BADCORP',
              price_band_min: 500,
              price_band_max: 400, // Invalid: low > high
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      if (tx.ipo.update.mock.calls.length > 0) {
        expect(tx.ipo.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              publicationStatus: 'PUBLISHED',
            }),
          }),
        );
      }
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should create new IPO as DRAFT when price band range is inverted (low > high)', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'bad-band-ipo',
              name: 'Inverted Band Limited',
              symbol: 'INVBAND',
              price_band_min: 600,
              price_band_max: 500, // Invalid: low > high
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'DRAFT',
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should create new IPO as DRAFT when openDate is after closeDate', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'bad-date-ipo',
              name: 'Inverted Dates Ltd',
              symbol: 'INVDATE',
              open_date: '2026-11-20',
              close_date: '2026-11-15', // Invalid: open > close
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'DRAFT',
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should create new IPO as DRAFT when lot size is invalid (<= 0)', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'bad-lot-ipo',
              name: 'Bad Lot Size Ltd',
              symbol: 'BADLOT',
              lot_size: 0, // Invalid: lotSize <= 0
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'DRAFT',
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should idempotently sync on repeated runs without creating duplicate IPOs or companies', async () => {
      const existingIpo = {
        id: 'canonical-ipo-1',
        symbol: 'STEADY',
        status: 'UPCOMING',
        publicationStatus: 'PUBLISHED',
        company: { id: 'comp-steady', legalName: 'Steady Corp Limited', displayName: 'Steady Corp' },
        sourceIdentities: [{ externalId: 'steady-corp-ipo', symbol: 'STEADY' }],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([existingIpo]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'steady-corp-ipo',
              name: 'Steady Corp Limited',
              symbol: 'STEADY',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(0);
      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.company.create).not.toHaveBeenCalled();
      expect(tx.ipo.create).not.toHaveBeenCalled();
    });

    it('should publish a newly announced IPO with verified company identity and no opening or closing dates', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'nova-semi-ltd',
              name: 'Nova Semiconductor Limited',
              symbol: 'NOVASEMI',
              type: 'Mainboard',
              status: 'Announced',
              // open_date and close_date intentionally omitted / null
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'PUBLISHED',
            status: 'UPCOMING',
          }),
        }),
      );
      // Ensure missing lifecycle dates remain null and are not fabricated
      expect(tx.ipoLifecycleEvent.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_eventType: expect.objectContaining({ eventType: 'OPEN' }),
          }),
        }),
      );
      expect(tx.ipoLifecycleEvent.upsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_eventType: expect.objectContaining({ eventType: 'CLOSE' }),
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('PUBLISHED');
    });

    it('should create new IPO as DRAFT when company identity is an unverified placeholder', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'placeholder-ipo',
              name: 'TBD', // Placeholder name
              symbol: 'TBD',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'DRAFT',
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should create new IPO as DRAFT when openDate is after listingDate (contradictory dates)', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'contradictory-listing-ipo',
              name: 'Contradictory Chronology Ltd',
              symbol: 'CONTRADATE',
              open_date: '2026-11-20',
              listing_date: '2026-11-10', // Invalid: open > listing
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.newlyCreated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.ipo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            publicationStatus: 'DRAFT',
          }),
        }),
      );
      expect(result.items[0].publicationStatus).toBe('DRAFT');
    });

    it('should preserve ADMIN/MANUAL drafts on repeated syncs and never override admin unpublish decisions', async () => {
      const existingAdminDraft = {
        id: 'admin-draft-ipo',
        symbol: 'PROTECTED',
        status: 'UPCOMING',
        publicationStatus: 'DRAFT',
        company: { id: 'comp-prot', legalName: 'Protected Holdings Limited', displayName: 'Protected Holdings' },
        sourceIdentities: [
          { externalId: 'protected-ipo', symbol: 'PROTECTED', source: { code: 'ADMIN' } },
        ],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValue([existingAdminDraft]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          data: [
            {
              slug: 'protected-ipo',
              name: 'Protected Holdings Limited',
              symbol: 'PROTECTED',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      // First sync
      const result1 = await service.syncIpos();
      expect(result1.matchedUpdated).toBe(1);
      expect(result1.newlyCreated).toBe(0);
      expect(result1.items[0].publicationStatus).toBe('DRAFT');

      // Second sync
      const result2 = await service.syncIpos();
      expect(result2.matchedUpdated).toBe(1);
      expect(result2.newlyCreated).toBe(0);
      expect(result2.items[0].publicationStatus).toBe('DRAFT');

      const tx = mockPrisma._txMock;
      expect(tx.company.create).not.toHaveBeenCalled();
      expect(tx.ipo.create).not.toHaveBeenCalled();
      if (tx.ipo.update.mock.calls.length > 0) {
        expect(tx.ipo.update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              publicationStatus: 'PUBLISHED',
            }),
          }),
        );
      }
    });

    it('should prevent in-batch duplicate IPO creation when duplicate items appear in single feed', async () => {
      mockPrisma.ipo.findMany.mockResolvedValueOnce([]); // No existing records initially

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'unique-new-ipo',
              name: 'Unique New IPO Ltd',
              symbol: 'UNIQ',
              type: 'Mainboard',
              status: 'Upcoming',
            },
            {
              slug: 'unique-new-ipo',
              name: 'Unique New IPO Ltd',
              symbol: 'UNIQ',
              type: 'Mainboard',
              status: 'Upcoming',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.totalFetched).toBe(2);
      expect(result.newlyCreated).toBe(1);
      expect(result.matchedUpdated).toBe(1);
      const tx = mockPrisma._txMock;
      expect(tx.company.create).toHaveBeenCalledTimes(1);
      expect(tx.ipo.create).toHaveBeenCalledTimes(1);
    });

    it('should SKIP ambiguous matches without updating or creating records', async () => {
      const candidate1 = {
        id: 'dup-1',
        company: { displayName: 'Swastika Infra Ltd.', legalName: 'Swastika Infra Ltd.' },
        sourceIdentities: [],
      } as any;
      const candidate2 = {
        id: 'dup-2',
        company: { displayName: 'Swastika Infra Limited', legalName: 'Swastika Infra Limited' },
        sourceIdentities: [],
      } as any;

      mockPrisma.ipo.findMany.mockResolvedValueOnce([candidate1, candidate2]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'swastika-infra',
              name: 'Swastika Infra',
              type: 'SME',
              price_band: '80-85',
            },
          ],
        }),
      });

      const result = await service.syncIpos();

      expect(result.totalFetched).toBe(1);
      expect(result.matchedUpdated).toBe(0);
      expect(result.newlyCreated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(result.items[0].action).toBe('SKIPPED');
      expect(result.items[0].matchedBy).toBe('AMBIGUOUS');
      expect(result.items[0].reason).toContain('AMBIGUOUS_MATCH');

      // Crucial: verify database was NEVER touched
      const tx = mockPrisma._txMock;
      expect(tx.ipo.update).not.toHaveBeenCalled();
      expect(tx.company.create).not.toHaveBeenCalled();
      expect(tx.ipo.create).not.toHaveBeenCalled();
    });

    it('should sync provided IPO records directly without calling external API or incrementing quota (0 additional external requests)', async () => {
      const providedIpos = [
        {
          slug: 'test-direct-sync',
          name: 'Direct Sync Corp',
          symbol: 'DIRECT',
          type: 'Mainboard',
        },
      ];

      const result = await service.syncIpos('MANUAL', undefined, providedIpos as any);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.totalFetched).toBe(1);
      expect(result.newlyCreated).toBe(1);
    });

    it('should fetch from external API and consume quota when provided records are not provided (automatic scheduled sync)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'auto-scheduled-ipo',
              name: 'Auto Scheduled Corp',
              type: 'Mainboard',
            },
          ],
        }),
      });

      const result = await service.syncIpos('AUTO', '10:00');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.totalFetched).toBe(1);
    });

    it('Manual Fetch -> Sync with fetched records should result in exactly 1 external API request total', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce({
          data: [
            {
              slug: 'manual-flow-ipo',
              name: 'Manual Flow Corp',
              type: 'Mainboard',
            },
          ],
        }),
      });

      // Step 1: Manual Fetch (dispatches external request)
      const fetchResult = await service.fetchIpos('MANUAL');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(fetchResult.ipos.length).toBe(1);

      // Step 2: Manual Sync with provided records (0 additional external requests)
      const syncResult = await service.syncIpos('MANUAL', undefined, fetchResult.ipos);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Quota preserved: still exactly 1 external call!
      expect(syncResult.totalFetched).toBe(1);
    });
  });

  // ── Test 6: Quota, Budget & Persistent Counter Tests ────────────────────

  describe('Budget & Usage Counter', () => {
    it('should reset counter when IST date changes', async () => {
      // Mock state from previous date
      mockPrisma.source.upsert.mockResolvedValueOnce({
        id: 'source-ipoguru',
        rateLimitPolicy: {
          istDate: '2026-09-20',
          totalRequestsToday: 10,
          autoRequestsToday: 4,
          manualRequestsToday: 6,
          lastRequestAt: '2026-09-20T17:30:00.000Z',
          lastSuccessAt: '2026-09-20T17:30:00.000Z',
          lastFetchStatus: 'HTTP 200 (Success)',
          completedSlots: ['10:00', '13:00', '15:00', '17:30'],
        },
      });

      const today = new Date('2026-09-23T10:00:00.000Z');
      const state = await service.getPersistedUsageState(today);

      expect(state.istDate).toBe('2026-09-23');
      expect(state.totalRequestsToday).toBe(0);
      expect(state.autoRequestsToday).toBe(0);
      expect(state.manualRequestsToday).toBe(0);
      expect(state.completedSlots).toHaveLength(0);
      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rateLimitPolicy: expect.objectContaining({
              istDate: '2026-09-23',
              totalRequestsToday: 0,
            }),
          }),
        }),
      );
    });

    it('should block requests when 10-request hard daily limit is reached', async () => {
      mockPrisma.source.upsert.mockResolvedValueOnce({
        id: 'source-ipoguru',
        rateLimitPolicy: {
          istDate: '2026-09-23',
          totalRequestsToday: 10,
          autoRequestsToday: 4,
          manualRequestsToday: 6,
          lastRequestAt: '2026-09-23T08:00:00.000Z',
          completedSlots: ['10:00', '13:00', '15:00', '17:30'],
        },
      });

      const check = await service.checkBudgetAndRateLimit(
        'MANUAL',
        undefined,
        new Date('2026-09-23T12:00:00.000Z'),
      );

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Daily IPO Guru quota limit reached (10/10 requests used today)');
    });

    it('should block manual requests when remaining quota is reserved for auto syncs', async () => {
      // 0 auto executed, but 6 manual already used (total 6).
      // Remaining auto slots today = 4. Total = 6 + 4 = 10. Manual should have 0 remaining.
      mockPrisma.source.upsert.mockResolvedValueOnce({
        id: 'source-ipoguru',
        rateLimitPolicy: {
          istDate: '2026-09-23',
          totalRequestsToday: 6,
          autoRequestsToday: 0,
          manualRequestsToday: 6,
          lastRequestAt: '2026-09-23T02:00:00.000Z', // 7:30 AM IST (before 10:00)
          completedSlots: [],
        },
      });

      const check = await service.checkBudgetAndRateLimit(
        'MANUAL',
        undefined,
        new Date('2026-09-23T02:30:00.000Z'), // 8:00 AM IST
      );

      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Manual request blocked: Remaining quota is reserved for scheduled automatic syncs');
    });

    it('should enforce 1-minute rate-limit between requests', async () => {
      const lastReq = new Date('2026-09-23T10:00:00.000Z');
      const nextReq = new Date('2026-09-23T10:00:30.000Z'); // only 30s later

      mockPrisma.source.upsert.mockResolvedValueOnce({
        id: 'source-ipoguru',
        rateLimitPolicy: {
          istDate: '2026-09-23',
          totalRequestsToday: 1,
          autoRequestsToday: 0,
          manualRequestsToday: 1,
          lastRequestAt: lastReq.toISOString(),
          completedSlots: [],
        },
      });

      const check = await service.checkBudgetAndRateLimit('MANUAL', undefined, nextReq);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Please wait at least 1 minute');
    });

    it('should return accurate getStatus response with IST times and remaining budget', async () => {
      mockPrisma.source.upsert.mockResolvedValueOnce({
        id: 'source-ipoguru',
        rateLimitPolicy: {
          istDate: '2026-09-23',
          totalRequestsToday: 2,
          autoRequestsToday: 1,
          manualRequestsToday: 1,
          lastRequestAt: '2026-09-23T04:30:00.000Z', // 10:00 AM IST
          lastSuccessAt: '2026-09-23T04:30:00.000Z',
          lastFetchStatus: 'HTTP 200 (Success)',
          completedSlots: ['10:00'],
        },
      });

      // Query at 11:00 AM IST (05:30 UTC)
      const now = new Date('2026-09-23T05:30:00.000Z');
      const status = await service.getStatus(now);

      expect(status.istDate).toBe('2026-09-23');
      expect(status.requestsUsedToday).toBe(2);
      expect(status.requestsRemainingToday).toBe(8);
      expect(status.autoRequestsUsedToday).toBe(1);
      expect(status.autoRequestsTotal).toBe(4);
      expect(status.manualRequestsUsedToday).toBe(1);
      expect(status.nextScheduledAutoSync).toBe('Today at 1:00 PM IST');
      expect(status.completedSlots).toEqual(['10:00']);
      expect(status.lastFetchStatus).toBe('HTTP 200 (Success)');
    });
  });

  // ── Refund Initiation Date Ingestion & Provenance Tests ───────────────────────
  describe('Refund Initiation Date Ingestion & Provenance', () => {
    it('Test A — direct field: upserts REFUND_INITIATION event when refund_date is present', async () => {
      const rawIpo = {
        name: 'Direct Refund Corp',
        slug: 'direct-refund-corp',
        open_date: '2026-07-09',
        close_date: '2026-07-13',
        allotment_date: '2026-07-14',
        refund_date: '2026-07-15',
        listing_date: '2026-07-16',
      };

      const result = await service.syncIpos('MANUAL', undefined, [rawIpo]);
      expect(result.matchedUpdated + result.newlyCreated).toBe(1);

      const tx = mockPrisma._txMock;
      expect(tx.ipoLifecycleEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_eventType: { ipoId: 'new-ipo-id', eventType: 'REFUND_INITIATION' },
          }),
          create: expect.objectContaining({
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-07-15'),
          }),
        }),
      );

      // Verify provenance record created for refund_date
      expect(tx.fieldProvenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldName: 'refund_date',
            value: '2026-07-15',
          }),
        }),
      );
    });

    it('Test B — timeline field: upserts REFUND_INITIATION from timeline.refund_date', async () => {
      const rawIpo = {
        name: 'Timeline Refund Corp',
        slug: 'timeline-refund-corp',
        timeline: {
          open_date: '2026-07-09',
          close_date: '2026-07-13',
          allotment_date: '2026-07-14',
          refund_date: '2026-07-15',
          listing_date: '2026-07-16',
        },
      };

      await service.syncIpos('MANUAL', undefined, [rawIpo]);

      const tx = mockPrisma._txMock;
      expect(tx.ipoLifecycleEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_eventType: { ipoId: 'new-ipo-id', eventType: 'REFUND_INITIATION' },
          }),
          create: expect.objectContaining({
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-07-15'),
          }),
        }),
      );

      expect(tx.fieldProvenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldName: 'refund_date',
            value: '2026-07-15',
          }),
        }),
      );
    });

    it('Test C — both fields: prefers rawItem.refund_date over timeline.refund_date', async () => {
      const rawIpo = {
        name: 'Both Refund Corp',
        slug: 'both-refund-corp',
        refund_date: '2026-07-15',
        timeline: {
          refund_date: '2026-07-18', // Should be ignored in favor of top-level
        },
      };

      await service.syncIpos('MANUAL', undefined, [rawIpo]);

      const tx = mockPrisma._txMock;
      expect(tx.ipoLifecycleEvent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            eventType: 'REFUND_INITIATION',
            eventDate: new Date('2026-07-15'),
          }),
        }),
      );
    });

    it('Test D — missing: does not create REFUND_INITIATION event when refund_date is absent', async () => {
      const rawIpo = {
        name: 'No Refund Corp',
        slug: 'no-refund-corp',
        open_date: '2026-07-09',
        close_date: '2026-07-13',
        allotment_date: '2026-07-14',
        listing_date: '2026-07-16',
      };

      await service.syncIpos('MANUAL', undefined, [rawIpo]);

      const tx = mockPrisma._txMock;
      const upsertCalls = tx.ipoLifecycleEvent.upsert.mock.calls;
      const refundUpsert = upsertCalls.find((call: any) => call[0].where.ipoId_eventType.eventType === 'REFUND_INITIATION');
      expect(refundUpsert).toBeUndefined();
    });

    it('Test E & I — idempotency & existing lifecycle events: runs sync twice and preserves all 5 event types', async () => {
      const rawIpo = {
        name: 'Idempotent Corp',
        slug: 'idempotent-corp',
        open_date: '2026-07-09',
        close_date: '2026-07-13',
        allotment_date: '2026-07-14',
        refund_date: '2026-07-15',
        listing_date: '2026-07-16',
      };

      await service.syncIpos('MANUAL', undefined, [rawIpo]);
      await service.syncIpos('MANUAL', undefined, [rawIpo]);

      const tx = mockPrisma._txMock;
      // All 5 events upserted safely with @@unique([ipoId, eventType])
      const eventTypesUpserted = tx.ipoLifecycleEvent.upsert.mock.calls.map(
        (c: any) => c[0].where.ipoId_eventType.eventType,
      );
      expect(eventTypesUpserted).toContain('OPEN');
      expect(eventTypesUpserted).toContain('CLOSE');
      expect(eventTypesUpserted).toContain('BASIS_OF_ALLOTMENT');
      expect(eventTypesUpserted).toContain('REFUND_INITIATION');
      expect(eventTypesUpserted).toContain('LISTING');
    });
  });

  describe('Field-level update and skip visibility', () => {
    it('should report updated fields and skipped fields with reasons when updating existing IPO', async () => {
      const existingIpo = {
        id: 'ipo-existing-1',
        companyId: 'company-1',
        marketSegment: 'MAINBOARD',
        exchange: 'BSE',
        status: 'OPEN',
        publicationStatus: 'PUBLISHED',
        symbol: 'EXISTING',
        priceBandLow: new Prisma.Decimal(100),
        priceBandHigh: new Prisma.Decimal(110),
        lotSize: 50,
        issueSize: new Prisma.Decimal(500),
        freshIssueSize: new Prisma.Decimal(300),
        ofsSize: new Prisma.Decimal(200),
        company: { id: 'company-1', legalName: 'Existing Company Ltd', displayName: 'Existing Company' },
        sourceIdentities: [
          {
            sourceId: 'source-ipoguru',
            externalId: 'existing-company',
            symbol: 'EXISTING',
            source: { code: 'IPOGURU', name: 'IPO Guru v2' },
          },
        ],
      };

      mockPrisma.ipo.findMany.mockResolvedValue([existingIpo]);

      const rawIpo = {
        name: 'Existing Company',
        slug: 'existing-company',
        type: 'Mainboard', // Same segment -> skipped (Value unchanged)
        status: 'Closed', // Status is authoritative -> skipped (Canonical lifecycle status is authoritative)
        exchange: 'BSE, NSE', // Changed -> updated
        price_band_min: 105, // Changed -> updated
        price_band_max: 110, // Same -> skipped (Value unchanged)
        lot_size: 50, // Same -> skipped (Value unchanged)
        open_date: '2026-08-01', // Provided -> updated
      };

      const result = await service.syncIpos('MANUAL', undefined, [rawIpo]);

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.action).toBe('UPDATED');
      expect(item.updatedFields).toContain('exchange');
      expect(item.updatedFields).toContain('priceBandLow');
      expect(item.updatedFields).toContain('openDate');

      const skippedFields = item.skippedFields ?? [];
      const skippedFieldNames = skippedFields.map((s) => s.field);
      expect(skippedFieldNames).toContain('status');
      expect(skippedFieldNames).toContain('marketSegment');
      expect(skippedFieldNames).toContain('priceBandHigh');
      expect(skippedFieldNames).toContain('lotSize');
      expect(skippedFieldNames).toContain('listingPrice');

      const statusSkip = skippedFields.find((s) => s.field === 'status');
      expect(statusSkip?.reason).toBe('Canonical lifecycle status is authoritative');

      const segSkip = skippedFields.find((s) => s.field === 'marketSegment');
      expect(segSkip?.reason).toBe('Value unchanged');
    });

    it('should report skippedFields when match is ambiguous or empty name', async () => {
      const ambiguousExisting = [
        {
          id: 'ipo-ambig-1',
          companyId: 'company-1',
          symbol: 'DUPE',
          company: { displayName: 'Dupe 1' },
          sourceIdentities: [],
        },
        {
          id: 'ipo-ambig-2',
          companyId: 'company-2',
          symbol: 'DUPE',
          company: { displayName: 'Dupe 2' },
          sourceIdentities: [],
        },
      ];
      mockPrisma.ipo.findMany.mockResolvedValue(ambiguousExisting);

      const rawIpo = {
        name: 'Ambiguous Corp',
        symbol: 'DUPE',
      };

      const result = await service.syncIpos('MANUAL', undefined, [rawIpo]);
      expect(result.items[0].action).toBe('SKIPPED');
      expect(result.items[0].skippedFields?.[0].field).toBe('all');
      expect(result.items[0].skippedFields?.[0].reason).toContain('Multiple candidate matches');
    });

    it('should create dual source identities (IPOGURU and ADMIN) for synced IPO to guarantee visibility in Manual IPO Manager', async () => {
      mockPrisma.source.upsert
        .mockResolvedValueOnce({ id: 'source-ipoguru-id', code: 'IPOGURU' })
        .mockResolvedValueOnce({ id: 'source-admin-id', code: 'ADMIN' });

      const rawIpo = {
        name: 'Dual Identity Tech Ltd',
        symbol: 'DUALTECH',
        slug: 'dual-tech',
      };

      const result = await service.syncIpos('MANUAL', undefined, [rawIpo]);
      expect(result.newlyCreated).toBe(1);

      const tx = mockPrisma._txMock;
      expect(tx.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_sourceId: {
              ipoId: 'new-ipo-id',
              sourceId: 'source-ipoguru-id',
            },
          }),
        }),
      );
      expect(tx.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ipoId_sourceId: {
              ipoId: 'new-ipo-id',
              sourceId: 'source-admin-id',
            },
          }),
        }),
      );
    });
  });
});
