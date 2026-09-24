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
      expect(tx.subscriptionObservation.create).toHaveBeenCalledTimes(1); // Only subscription_total -> OTHER
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
      expect(tx.ipo.create).toHaveBeenCalled();
      expect(tx.ipoSourceIdentity.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ externalId: 'brand-new-startup' }),
        }),
      );
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
});
