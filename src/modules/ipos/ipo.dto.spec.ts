import { ipoIdParamSchema, ipoListQuerySchema } from './ipo.dto';

describe('ipoListQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(ipoListQuerySchema.parse({})).toEqual({
      status: undefined,
      marketSegment: undefined,
      exchange: undefined,
      page: 1,
      limit: 20,
    });
  });

  it('accepts supported filters', () => {
    expect(
      ipoListQuerySchema.parse({
        status: 'OPEN',
        marketSegment: 'SME',
        exchange: 'BSE',
        page: '2',
        limit: '10',
      }),
    ).toEqual({
      status: 'OPEN',
      marketSegment: 'SME',
      exchange: 'BSE',
      page: 2,
      limit: 10,
    });
  });

  it('rejects unsupported status, oversize pages, and invalid ids', () => {
    expect(ipoListQuerySchema.safeParse({ status: 'ACTIVE' }).success).toBe(
      false,
    );
    expect(ipoListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(ipoListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(ipoIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(
      false,
    );
    expect(
      ipoIdParamSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
  });
});
