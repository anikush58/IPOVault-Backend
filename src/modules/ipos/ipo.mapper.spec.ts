import { Prisma } from '@prisma/client';

import { toIpoDataReadinessDto, toIpoResponseDto } from './ipo.mapper';
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
    publicationStatus: 'PUBLISHED',
    symbol: 'EXMPL',
    issueSize: new Prisma.Decimal('12500000000.00'),
    freshIssueSize: new Prisma.Decimal('10000000000.00'),
    ofsSize: new Prisma.Decimal('2500000000.00'),
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('120.00'),
    priceBandHigh: new Prisma.Decimal('126.00'),
    lotSize: 120,
    minimumLots: 1,
    listingPrice: null,
    listingGainPct: null,
    profitAmount: null,
    profitPercentage: null,
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
    expect(dto.company).toMatchObject({
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
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
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

  describe('toIpoDataReadinessDto contract tests', () => {
    const baseReport = {
      ipoId: '11111111-1111-4111-8111-111111111111',
      summary: { totalChecks: 15, passed: 15, warnings: 0, blockers: 0 },
      blockers: [],
      warnings: [],
      fields: [],
      qualityFindings: [],
      coverageSummary: { totalFields: 15, covered: 15, missing: 0, stale: 0, conflict: 0, notExpected: 0, unknown: 0 },
      refreshRecommendations: [],
      evaluatedAt: new Date('2026-09-01T12:00:00.000Z'),
    };

    it('1. maps PASS status to READY with isReady = true', () => {
      const report = { ...baseReport, status: 'PASS' as const };
      const dto = toIpoDataReadinessDto(report);

      expect(dto.status).toBe('READY');
      expect(dto.isReady).toBe(true);
      expect(dto.summary).toBe('IPO data is complete, fresh, and ready for production consumption.');
    });

    it('2. maps PASS_WITH_WARNINGS status to READY_WITH_WARNINGS with isReady = true', () => {
      const report = { ...baseReport, status: 'PASS_WITH_WARNINGS' as const };
      const dto = toIpoDataReadinessDto(report);

      expect(dto.status).toBe('READY_WITH_WARNINGS');
      expect(dto.isReady).toBe(true);
      expect(dto.summary).toBe('IPO data is ready for consumption with minor non-blocking warnings.');
    });

    it('3. maps NEEDS_REVIEW status to NEEDS_REVIEW with isReady = false', () => {
      const report = { ...baseReport, status: 'NEEDS_REVIEW' as const };
      const dto = toIpoDataReadinessDto(report);

      expect(dto.status).toBe('NEEDS_REVIEW');
      expect(dto.isReady).toBe(false);
      expect(dto.summary).toBe('IPO data requires review due to source conflicts or stale authoritative data.');
    });

    it('4. maps INCOMPLETE status to INCOMPLETE with isReady = false', () => {
      const report = { ...baseReport, status: 'INCOMPLETE' as const };
      const dto = toIpoDataReadinessDto(report);

      expect(dto.status).toBe('INCOMPLETE');
      expect(dto.isReady).toBe(false);
      expect(dto.summary).toBe('IPO data is incomplete and missing required terms or lifecycle information.');
    });

    it('5. enforces status and isReady strict consistency', () => {
      const statuses = ['PASS', 'PASS_WITH_WARNINGS', 'NEEDS_REVIEW', 'INCOMPLETE'] as const;
      for (const s of statuses) {
        const dto = toIpoDataReadinessDto({ ...baseReport, status: s });
        if (dto.status === 'READY' || dto.status === 'READY_WITH_WARNINGS') {
          expect(dto.isReady).toBe(true);
        } else {
          expect(dto.isReady).toBe(false);
        }
      }
    });

    it('6 & 7. correctly serializes count fields and booleans', () => {
      const report = {
        ...baseReport,
        status: 'NEEDS_REVIEW' as const,
        coverageSummary: {
          totalFields: 15,
          covered: 10,
          missing: 2,
          unknown: 1,
          stale: 3,
          conflict: 1,
          notExpected: 0,
        },
        refreshRecommendations: [
          {
            sourceCode: 'sebi',
            reason: 'Stale observation',
            targetFields: ['priceBandHigh'],
          },
        ],
      };

      const dto = toIpoDataReadinessDto(report);

      expect(dto.missingFieldCount).toBe(3); // 2 missing + 1 unknown
      expect(typeof dto.missingFieldCount).toBe('number');
      expect(dto.staleFieldCount).toBe(3);
      expect(typeof dto.staleFieldCount).toBe('number');
      expect(dto.conflictFieldCount).toBe(1);
      expect(typeof dto.conflictFieldCount).toBe('number');
      expect(dto.refreshRecommended).toBe(true);
      expect(typeof dto.refreshRecommended).toBe('boolean');
      expect(typeof dto.isReady).toBe('boolean');
    });

    it('8. generates deterministic, clean summary message without internal sensitive details', () => {
      const dto = toIpoDataReadinessDto({ ...baseReport, status: 'PASS' });
      expect(dto.summary).not.toContain('SELECT');
      expect(dto.summary).not.toContain('prisma');
      expect(dto.summary).not.toContain('11111111');
      expect(dto.summary).not.toContain('Error');
    });

    it('9. propagates refreshRecommended boolean based on recommendations length', () => {
      const dtoNoRec = toIpoDataReadinessDto({ ...baseReport, status: 'PASS', refreshRecommendations: [] });
      expect(dtoNoRec.refreshRecommended).toBe(false);

      const dtoWithRec = toIpoDataReadinessDto({
        ...baseReport,
        status: 'PASS',
        refreshRecommendations: [{ sourceCode: 'bse', reason: 'Missing fields', targetFields: [] }],
      });
      expect(dtoWithRec.refreshRecommended).toBe(true);
    });
  });

  describe('toIpoChangesResponseDto', () => {
    it('maps change events cleanly into public DTO shape without exposing secrets', () => {
      const { toIpoChangesResponseDto } = require('./ipo.mapper');
      const mockEvents = [
        {
          id: 'change-1',
          ipoId: '11111111-1111-4111-8111-111111111111',
          fieldName: 'price_band_high',
          oldValue: '175.00',
          newValue: '180.00',
          changeType: 'PRICE_BAND_CHANGED',
          sourceId: 'src-1',
          sourceReference: 'ref-123',
          detectedAt: new Date('2026-09-10T10:30:00.000Z'),
          createdAt: new Date('2026-09-10T10:30:00.000Z'),
          source: {
            id: 'src-1',
            code: 'SEBI',
            name: 'Securities and Exchange Board of India',
            sourceType: 'OFFICIAL_FILING',
          },
        },
        {
          id: 'change-2',
          ipoId: '11111111-1111-4111-8111-111111111111',
          fieldName: 'lot_size',
          oldValue: null,
          newValue: '100',
          changeType: 'LOT_SIZE_CHANGED',
          sourceId: null,
          sourceReference: null,
          detectedAt: new Date('2026-09-05T08:00:00.000Z'),
          createdAt: new Date('2026-09-05T08:00:00.000Z'),
          source: null,
        },
      ];

      const res = toIpoChangesResponseDto('11111111-1111-4111-8111-111111111111', mockEvents);

      expect(res.ipoId).toBe('11111111-1111-4111-8111-111111111111');
      expect(res.changes).toHaveLength(2);

      expect(res.changes[0]).toEqual({
        id: 'change-1',
        fieldName: 'price_band_high',
        oldValue: '175.00',
        newValue: '180.00',
        changeType: 'PRICE_BAND_CHANGED',
        source: {
          id: 'src-1',
          code: 'SEBI',
          name: 'Securities and Exchange Board of India',
          sourceType: 'OFFICIAL_FILING',
        },
        sourceReference: 'ref-123',
        detectedAt: '2026-09-10T10:30:00.000Z',
        createdAt: '2026-09-10T10:30:00.000Z',
      });

      expect(res.changes[1].oldValue).toBeNull();
      expect(res.changes[1].source).toBeNull();
    });
  });
});
