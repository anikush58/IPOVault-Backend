import { Prisma } from '@prisma/client';

import { toIpoResponseDto } from './ipo.mapper';
import { IpoWithRelations } from './ipo.types';

function buildIpo(
  overrides: Partial<IpoWithRelations> & {
    lifecycleEvents?: IpoWithRelations['lifecycleEvents'];
    company?: IpoWithRelations['company'];
  } = {},
): IpoWithRelations {
  const now = new Date('2026-09-01T12:00:00.000Z');

  return {
    id: '11111111-1111-4111-8111-111111111111',
    companyId: '22222222-2222-4222-8222-222222222222',
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    status: 'OPEN',
    symbol: 'EXMPL',
    issueSize: new Prisma.Decimal('12500000000.00'),
    freshIssueSize: new Prisma.Decimal('10000000000.00'),
    ofsSize: new Prisma.Decimal('2500000000.00'),
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('120.00'),
    priceBandHigh: new Prisma.Decimal('126.00'),
    lotSize: 120,
    minimumLots: 1,
    createdAt: now,
    updatedAt: now,
    company: {
      id: '22222222-2222-4222-8222-222222222222',
      legalName: 'Example Technologies Limited',
      displayName: 'Example Tech',
      cin: 'U12345MH2024PLC000001',
      website: 'https://example.com',
      industry: 'Technology',
      sector: 'IT',
      createdAt: now,
      updatedAt: now,
    },
    lifecycleEvents: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        ipoId: '11111111-1111-4111-8111-111111111111',
        eventType: 'OPEN',
        eventDate: new Date('2026-09-10T00:00:00.000Z'),
        sourceId: 'should-not-appear',
        sourceReference: 'secret-ref',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        ipoId: '11111111-1111-4111-8111-111111111111',
        eventType: 'LISTING',
        eventDate: new Date('2026-09-18T00:00:00.000Z'),
        sourceId: null,
        sourceReference: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  };
}

describe('toIpoResponseDto', () => {
  it('maps canonical IPO fields, company summary, and lifecycle dates', () => {
    const dto = toIpoResponseDto(buildIpo());

    expect(dto.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(dto.company).toEqual({
      id: '22222222-2222-4222-8222-222222222222',
      legalName: 'Example Technologies Limited',
      displayName: 'Example Tech',
      cin: 'U12345MH2024PLC000001',
      website: 'https://example.com',
      industry: 'Technology',
      sector: 'IT',
    });
    expect(dto.issueSize).toBe('12500000000.00');
    expect(dto.priceBandLow).toBe('120.00');
    expect(dto.priceBandHigh).toBe('126.00');
    expect(dto.lotSize).toBe(120);
    expect(dto.lifecycle.openDate).toBe('2026-09-10');
    expect(dto.lifecycle.listingDate).toBe('2026-09-18');
    expect(dto.lifecycle.closeDate).toBeNull();
    expect(dto.createdAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it('does not expose provenance, discovery, or lifecycle source internals', () => {
    const dto = toIpoResponseDto(buildIpo());
    const serialized = JSON.stringify(dto);

    expect(serialized).not.toContain('should-not-appear');
    expect(serialized).not.toContain('secret-ref');
    expect(dto).not.toHaveProperty('lifecycleEvents');
    expect(dto).not.toHaveProperty('sourceIdentities');
    expect(dto).not.toHaveProperty('changeEvents');
    expect(dto.company).not.toHaveProperty('createdAt');
  });

  it('serializes missing money fields as null', () => {
    const dto = toIpoResponseDto(
      buildIpo({
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        symbol: null,
        lifecycleEvents: [],
      }),
    );

    expect(dto.issueSize).toBeNull();
    expect(dto.symbol).toBeNull();
    expect(dto.lifecycle.openDate).toBeNull();
  });
});
