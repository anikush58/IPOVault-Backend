/**
 * Phase 20 — IPO Data Completeness & Canonical Quality Gate Tests
 */

import { AppException } from '../../common/errors/app.exception';
import { DiscoveryQualityGateService } from './discovery-quality-gate.service';
import { IpoCoverageReport } from './discovery-coverage.service';

const now = new Date('2026-09-10T12:00:00.000Z');

function makeIpoRecord(partial: Record<string, unknown> = {}) {
  return {
    id: 'ipo-1',
    companyId: 'comp-1',
    company: {
      id: 'comp-1',
      legalName: 'Test Company Ltd',
      displayName: 'Test Company',
      cin: 'L12345MH2020PLC123456',
      website: 'https://example.com',
      industry: 'Technology',
      sector: 'IT',
    },
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    status: 'OPEN',
    symbol: 'TESTSYM',
    issueSize: '100.00',
    freshIssueSize: '60.00',
    ofsSize: '40.00',
    issueShareCount: '10000000',
    freshIssueShareCount: '6000000',
    ofsShareCount: '4000000',
    faceValue: '10.00',
    priceBandLow: '100.00',
    priceBandHigh: '120.00',
    lotSize: 100,
    minimumLots: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    lifecycleEvents: [
      {
        id: 'evt-1',
        ipoId: 'ipo-1',
        eventType: 'OPEN',
        eventDate: new Date('2026-09-01T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'ref-1',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'evt-2',
        ipoId: 'ipo-1',
        eventType: 'CLOSE',
        eventDate: new Date('2026-09-05T00:00:00.000Z'),
        sourceId: 'src-sebi',
        sourceReference: 'ref-2',
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...partial,
  };
}

function makeDb(ipoRecord: Record<string, unknown> | null = makeIpoRecord()) {
  return {
    ipo: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => {
        if (!ipoRecord) return Promise.resolve(null);
        return Promise.resolve(
          (ipoRecord as Record<string, unknown>).id === args.where.id ? ipoRecord : null,
        );
      }),
    },
  };
}

function makeCoverageReport(
  partialFields: Array<{
    fieldName: string;
    status: 'COVERED' | 'MISSING' | 'STALE' | 'CONFLICT' | 'NOT_EXPECTED_FROM_SOURCE' | 'UNKNOWN';
    providingSource?: string;
    canonicalValue?: string | null;
  }> = [],
): IpoCoverageReport {
  const defaultFields: Array<{
    fieldName: string;
    category: 'IDENTITY' | 'ISSUE_STRUCTURE' | 'TERMS' | 'LIFECYCLE';
    status: 'COVERED' | 'MISSING' | 'STALE' | 'CONFLICT' | 'NOT_EXPECTED_FROM_SOURCE' | 'UNKNOWN';
    canonicalValue: string | null;
    expectedSources: string[];
    providingSource: string | null;
    observedAt: Date | null;
    comparisonOutcome: any;
    message: string;
  }> = [
    {
      fieldName: 'company.legalName',
      category: 'IDENTITY',
      status: 'COVERED',
      canonicalValue: 'Test Company Ltd',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
    {
      fieldName: 'priceBandLow',
      category: 'TERMS',
      status: 'COVERED',
      canonicalValue: '100.00',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
    {
      fieldName: 'priceBandHigh',
      category: 'TERMS',
      status: 'COVERED',
      canonicalValue: '120.00',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
    {
      fieldName: 'lotSize',
      category: 'TERMS',
      status: 'COVERED',
      canonicalValue: '100',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
    {
      fieldName: 'openDate',
      category: 'LIFECYCLE',
      status: 'COVERED',
      canonicalValue: '2026-09-01',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
    {
      fieldName: 'closeDate',
      category: 'LIFECYCLE',
      status: 'COVERED',
      canonicalValue: '2026-09-05',
      expectedSources: ['sebi', 'nse'],
      providingSource: 'sebi',
      observedAt: now,
      comparisonOutcome: 'MATCH',
      message: 'Covered',
    },
  ];

  for (const pf of partialFields) {
    const existing = defaultFields.find((f) => f.fieldName === pf.fieldName);
    if (existing) {
      existing.status = pf.status;
      if (pf.providingSource !== undefined) existing.providingSource = pf.providingSource;
      if (pf.canonicalValue !== undefined) existing.canonicalValue = pf.canonicalValue;
    } else {
      defaultFields.push({
        fieldName: pf.fieldName,
        category: 'TERMS',
        status: pf.status,
        canonicalValue: pf.canonicalValue ?? null,
        expectedSources: ['sebi'],
        providingSource: pf.providingSource ?? null,
        observedAt: now,
        comparisonOutcome: 'MATCH',
        message: 'Coverage field detail',
      });
    }
  }

  return {
    ipoId: 'ipo-1',
    overallStatus: 'COVERED',
    summary: {
      totalFields: defaultFields.length,
      covered: defaultFields.filter((f) => f.status === 'COVERED').length,
      missing: defaultFields.filter((f) => f.status === 'MISSING').length,
      stale: defaultFields.filter((f) => f.status === 'STALE').length,
      conflict: defaultFields.filter((f) => f.status === 'CONFLICT').length,
      notExpected: defaultFields.filter((f) => f.status === 'NOT_EXPECTED_FROM_SOURCE').length,
      unknown: defaultFields.filter((f) => f.status === 'UNKNOWN').length,
    },
    fields: defaultFields as any,
    refreshRecommendations: [],
    evaluatedAt: now,
  };
}

describe('DiscoveryQualityGateService (Phase 20)', () => {
  let mockCoverageService: { evaluateCoverage: jest.Mock };
  let service: DiscoveryQualityGateService;

  beforeEach(() => {
    mockCoverageService = { evaluateCoverage: jest.fn() };
    service = new DiscoveryQualityGateService(mockCoverageService as any);
  });

  it('1. Complete healthy IPO → returns PASS', async () => {
    const db = makeDb();
    mockCoverageService.evaluateCoverage.mockResolvedValue(makeCoverageReport());

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS');
    expect(report.blockers).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
  });

  it('2. Complete IPO with non-blocking warning → returns PASS_WITH_WARNINGS', async () => {
    const db = makeDb();
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'company.cin', status: 'UNKNOWN' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS_WITH_WARNINGS');
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.blockers).toHaveLength(0);
  });

  it('3. Missing required terms → returns INCOMPLETE', async () => {
    const db = makeDb(makeIpoRecord({ priceBandLow: null, priceBandHigh: null }));
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([
        { fieldName: 'priceBandLow', status: 'MISSING', canonicalValue: null },
        { fieldName: 'priceBandHigh', status: 'MISSING', canonicalValue: null },
      ]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.code === 'MISSING_PRICE_BAND_LOW')).toBe(true);
  });

  it('4. Missing lifecycle data → returns INCOMPLETE for OPEN IPO missing closeDate', async () => {
    const db = makeDb(makeIpoRecord({ lifecycleEvents: [] }));
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([
        { fieldName: 'openDate', status: 'MISSING', canonicalValue: null },
        { fieldName: 'closeDate', status: 'MISSING', canonicalValue: null },
      ]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.code === 'MISSING_OPEN_DATE')).toBe(true);
  });

  it('5. Unresolved source conflict → returns NEEDS_REVIEW', async () => {
    const db = makeDb();
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'priceBandLow', status: 'CONFLICT' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('NEEDS_REVIEW');
    expect(report.blockers.some((b) => b.code === 'UNRESOLVED_SOURCE_CONFLICT')).toBe(true);
  });

  it('6. Stale authoritative source → returns NEEDS_REVIEW', async () => {
    const db = makeDb();
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'priceBandLow', status: 'STALE', providingSource: 'sebi' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('NEEDS_REVIEW');
    expect(report.warnings.some((w) => w.code === 'STALE_AUTHORITATIVE_SOURCE')).toBe(true);
  });

  it('7. Stale non-authoritative source with healthy authoritative source → yields PASS', async () => {
    const db = makeDb();
    // Providing source is sebi (authoritative, fresh)
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'priceBandLow', status: 'COVERED', providingSource: 'sebi' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS');
    expect(report.blockers).toHaveLength(0);
  });

  it('8. Fresh-only IPO → no false OFS blocker', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: '100.00',
        ofsSize: null,
        issueShareCount: '1000000',
        freshIssueShareCount: '1000000',
        ofsShareCount: null,
      }),
    );
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([
        { fieldName: 'ofsSize', status: 'NOT_EXPECTED_FROM_SOURCE' },
        { fieldName: 'ofsShareCount', status: 'NOT_EXPECTED_FROM_SOURCE' },
      ]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS');
    expect(report.fields.find((f) => f.fieldName === 'ofsSize')?.status).toBe('NOT_APPLICABLE');
  });

  it('9. OFS-only IPO → no false fresh-issue blocker', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: null,
        ofsSize: '100.00',
        issueShareCount: '1000000',
        freshIssueShareCount: null,
        ofsShareCount: '1000000',
      }),
    );
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([
        { fieldName: 'freshIssueSize', status: 'NOT_EXPECTED_FROM_SOURCE' },
        { fieldName: 'freshIssueShareCount', status: 'NOT_EXPECTED_FROM_SOURCE' },
      ]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS');
    expect(report.fields.find((f) => f.fieldName === 'freshIssueSize')?.status).toBe('NOT_APPLICABLE');
  });

  it('10. Valid fresh + OFS structure → returns PASS', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: '60.00',
        ofsSize: '40.00',
        issueShareCount: '10000000',
        freshIssueShareCount: '6000000',
        ofsShareCount: '4000000',
      }),
    );
    mockCoverageService.evaluateCoverage.mockResolvedValue(makeCoverageReport());

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS');
    expect(report.blockers).toHaveLength(0);
  });

  it('11. Invalid share/issue structure → returns INCOMPLETE blocker', async () => {
    const db = makeDb(
      makeIpoRecord({
        issueSize: '100.00',
        freshIssueSize: '60.00',
        ofsSize: '50.00', // 60 + 50 = 110 != 100
      }),
    );
    mockCoverageService.evaluateCoverage.mockResolvedValue(makeCoverageReport());

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.code === 'ISSUE_SIZE_MISMATCH')).toBe(true);
  });

  it('12. Invalid price band → returns INCOMPLETE blocker when low > high', async () => {
    const db = makeDb(
      makeIpoRecord({
        priceBandLow: '150.00',
        priceBandHigh: '120.00',
      }),
    );
    mockCoverageService.evaluateCoverage.mockResolvedValue(makeCoverageReport());

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.code === 'INVALID_PRICE_BAND_RANGE')).toBe(true);
  });

  it('13. Invalid lot size → returns INCOMPLETE blocker when lotSize <= 0', async () => {
    const db = makeDb(makeIpoRecord({ lotSize: 0 }));
    mockCoverageService.evaluateCoverage.mockResolvedValue(makeCoverageReport());

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.code === 'INVALID_LOT_SIZE')).toBe(true);
  });

  it('14. Pre-listing IPO without listingDate → yields PASS (not incomplete)', async () => {
    const db = makeDb(makeIpoRecord({ status: 'UPCOMING', lifecycleEvents: [] }));
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([
        { fieldName: 'listingDate', status: 'NOT_EXPECTED_FROM_SOURCE' },
      ]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.blockers.some((b) => b.code === 'MISSING_LISTING_DATE')).toBe(false);
  });

  it('15. Unknown coverage → returns PASS_WITH_WARNINGS for optional unknown field', async () => {
    const db = makeDb();
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'company.cin', status: 'UNKNOWN' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('PASS_WITH_WARNINGS');
  });

  it('16. Unknown IPO ID → throws 404 AppException', async () => {
    const db = makeDb(null);

    await expect(service.evaluateQualityGate(db as any, 'unknown-id')).rejects.toThrow(
      AppException,
    );
  });

  it('17. Required unknown field (e.g. priceBandLow for OPEN IPO) → returns INCOMPLETE blocker', async () => {
    const db = makeDb(makeIpoRecord({ status: 'OPEN', priceBandLow: null }));
    mockCoverageService.evaluateCoverage.mockResolvedValue(
      makeCoverageReport([{ fieldName: 'priceBandLow', status: 'UNKNOWN' }]),
    );

    const report = await service.evaluateQualityGate(db as any, 'ipo-1', now);

    expect(report.status).toBe('INCOMPLETE');
    expect(report.blockers.some((b) => b.field === 'priceBandLow')).toBe(true);
  });
});
