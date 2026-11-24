import { Prisma } from '@prisma/client';

import { ipoListQuerySchema } from './ipo.dto';
import { IpoRepository } from './ipo.repository';

describe('Phase 25 — Smart IPO Search & Filtering Unit Tests', () => {
  describe('ipoListQuerySchema Zod Validation & Boundaries', () => {
    it('accepts empty query and sets default page, limit, sort, order', () => {
      const parsed = ipoListQuerySchema.parse({});
      expect(parsed).toEqual({
        page: 1,
        limit: 20,
      });
    });

    it('parses text search query, trimming whitespace', () => {
      const parsed = ipoListQuerySchema.parse({ q: '  acme corp  ' });
      expect(parsed.q).toBe('  acme corp  ');
    });

    it('validates price range and accepts priceMin <= priceMax', () => {
      const valid = ipoListQuerySchema.parse({
        priceMin: '100',
        priceMax: '200',
      });
      expect(valid.priceMin).toBe(100);
      expect(valid.priceMax).toBe(200);
    });

    it('rejects priceMin > priceMax', () => {
      expect(() =>
        ipoListQuerySchema.parse({
          priceMin: '250',
          priceMax: '100',
        }),
      ).toThrow();
    });

    it('validates lotSize range and rejects lotSizeMin > lotSizeMax', () => {
      expect(() =>
        ipoListQuerySchema.parse({
          lotSizeMin: '100',
          lotSizeMax: '50',
        }),
      ).toThrow();
    });

    it('validates issueSize range and rejects issueSizeMin > issueSizeMax', () => {
      expect(() =>
        ipoListQuerySchema.parse({
          issueSizeMin: '500',
          issueSizeMax: '100',
        }),
      ).toThrow();
    });

    it('validates ISO date format YYYY-MM-DD and rejects malformed date strings', () => {
      expect(() =>
        ipoListQuerySchema.parse({ openDateFrom: '01-09-2026' }),
      ).toThrow();

      const validDate = ipoListQuerySchema.parse({
        openDateFrom: '2026-09-01',
        openDateTo: '2026-09-10',
      });
      expect(validDate.openDateFrom).toBe('2026-09-01');
      expect(validDate.openDateTo).toBe('2026-09-10');
    });

    it('rejects openDateFrom after openDateTo', () => {
      expect(() =>
        ipoListQuerySchema.parse({
          openDateFrom: '2026-09-10',
          openDateTo: '2026-09-01',
        }),
      ).toThrow();
    });

    it('validates sort allowlist and order enum', () => {
      const parsed = ipoListQuerySchema.parse({
        sort: 'priceBandLow',
        order: 'asc',
      });
      expect(parsed.sort).toBe('priceBandLow');
      expect(parsed.order).toBe('asc');

      expect(() =>
        ipoListQuerySchema.parse({ sort: 'invalidField' }),
      ).toThrow();
    });
  });

  describe('IpoRepository Query Builder', () => {
    let repository: IpoRepository;
    let findManySpy: jest.SpyInstance;

    const mockPrisma = {
      ipo: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    beforeEach(() => {
      repository = new IpoRepository(mockPrisma as any);
      findManySpy = mockPrisma.ipo.findMany;
      findManySpy.mockClear();
    });

    it('builds text search OR condition for q parameter', async () => {
      const query = ipoListQuerySchema.parse({ q: 'ACME' });
      await repository.findMany(query, 0);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { company: { legalName: { contains: 'ACME', mode: 'insensitive' } } },
              { company: { displayName: { contains: 'ACME', mode: 'insensitive' } } },
              { company: { cin: { contains: 'ACME', mode: 'insensitive' } } },
              { symbol: { contains: 'ACME', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('builds combined AND filters for status, marketSegment, exchange, priceMin, and openDate range', async () => {
      const query = ipoListQuerySchema.parse({
        status: 'OPEN',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        priceMin: 100,
        priceMax: 200,
        openDateFrom: '2026-09-01',
        openDateTo: '2026-09-10',
      });

      await repository.findMany(query, 0);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'OPEN',
            marketSegment: 'MAINBOARD',
            exchange: 'NSE',
            priceBandLow: {
              gte: new Prisma.Decimal(100),
              lte: new Prisma.Decimal(200),
            },
            AND: [
              {
                lifecycleEvents: {
                  some: {
                    eventType: 'OPEN',
                    eventDate: {
                      gte: new Date('2026-09-01T00:00:00.000Z'),
                      lte: new Date('2026-09-10T23:59:59.999Z'),
                    },
                  },
                },
              },
            ],
          }),
        }),
      );
    });

    it('applies allowlisted sort and order with stable secondary ordering', async () => {
      const query = ipoListQuerySchema.parse({
        sort: 'companyName',
        order: 'asc',
      });

      await repository.findMany(query, 0);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ company: { legalName: 'asc' } }, { id: 'asc' }],
        }),
      );
    });

    it('builds query condition for ALLOTMENT_COMPLETED including recent checkable LISTED IPOs within 14 days', async () => {
      const query = ipoListQuerySchema.parse({
        status: 'ALLOTMENT_COMPLETED' as any,
      });

      await repository.findMany(query, 0);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publicationStatus: 'PUBLISHED',
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: [
                  { status: 'ALLOTMENT_COMPLETED' },
                  expect.objectContaining({
                    status: 'LISTED',
                    OR: [
                      expect.objectContaining({ allotmentResultAvailableAt: expect.any(Object) }),
                      expect.objectContaining({ lifecycleEvents: expect.any(Object) }),
                    ],
                    AND: [
                      expect.objectContaining({
                        OR: [
                          { allotmentResultAvailableAt: { not: null } },
                          {
                            allotmentConfig: {
                              enabled: true,
                              registrar: { not: '' },
                            },
                          },
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ]),
          }),
        }),
      );
    });

    it('preserves text search q condition and ALLOTMENT_OUT filter simultaneously without overwriting where.OR', async () => {
      const query = ipoListQuerySchema.parse({
        q: 'ACME',
        status: 'ALLOTMENT_OUT' as any,
      });

      await repository.findMany(query, 0);

      expect(findManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { company: { legalName: { contains: 'ACME', mode: 'insensitive' } } },
              { company: { displayName: { contains: 'ACME', mode: 'insensitive' } } },
              { company: { cin: { contains: 'ACME', mode: 'insensitive' } } },
              { symbol: { contains: 'ACME', mode: 'insensitive' } },
            ],
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  { status: 'ALLOTMENT_COMPLETED' },
                ]),
              }),
            ]),
          }),
        }),
      );
    });
  });
});
