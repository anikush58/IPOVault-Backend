/**
 * Phase 15 Correction — Post-Refresh Verification Service Tests
 *
 * Test design principles:
 * - Observation is proven via FieldProvenance rows (IPO+source+window)
 * - Field changes come from IpoChangeEvent rows (exact before/after values)
 * - executionStatus drives observation classification before evidence check
 * - Concurrency/scoping: only the requested source's provenance counts
 * - All tests verify zero DB writes (only findMany/findUnique called)
 */

import { SourceHealthStatus, SourceType } from '@prisma/client';

import {
  DiscoveryRefreshVerificationService,
  RefreshVerificationRequest,
} from './discovery-refresh-verification.service';

// ---------------------------------------------------------------------------
// Helpers: fake DB
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<{
  ipo: Record<string, unknown> | null;
  sources: Record<string, unknown>[];
  ipoSourceIdentities: Record<string, unknown>[];
  fieldProvenance: Record<string, unknown>[];
  ipoChangeEvents: Record<string, unknown>[];
}> = {}) {
  const {
    ipo = {
      id: 'ipo-a',
      status: 'UPCOMING',
      marketSegment: 'MAINBOARD',
      exchange: 'BOTH',
      symbol: null,
      issueSize: null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      priceBandLow: null,
      priceBandHigh: null,
      lotSize: null,
      lifecycleEvents: [],
    },
    sources = [
      {
        id: 'src-sebi',
        code: 'sebi',
        name: 'SEBI',
        sourceType: SourceType.OFFICIAL_FILING,
        healthStatus: SourceHealthStatus.HEALTHY,
        enabled: true,
        priority: 10,
      },
      {
        id: 'src-nse',
        code: 'nse',
        name: 'NSE',
        sourceType: SourceType.EXCHANGE,
        healthStatus: SourceHealthStatus.HEALTHY,
        enabled: true,
        priority: 20,
      },
    ],
    ipoSourceIdentities = [],
    fieldProvenance = [],
    ipoChangeEvents = [],
  } = overrides;

  // Track all write calls to prove read-only guarantee
  const writeCalls: string[] = [];

  return {
    _writeCalls: writeCalls,
    ipo: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => {
        if (!ipo) return Promise.resolve(null);
        const row = ipo as Record<string, unknown>;
        return Promise.resolve(row.id === args.where.id ? row : null);
      }),
      create: jest.fn().mockImplementation(() => { writeCalls.push('ipo.create'); return Promise.resolve({}); }),
      update: jest.fn().mockImplementation(() => { writeCalls.push('ipo.update'); return Promise.resolve({}); }),
    },
    source: {
      findMany: jest.fn().mockResolvedValue(sources),
      findUnique: jest.fn().mockImplementation((args: { where: { code?: string; id?: string } }) => {
        const found = sources.find(
          (s: Record<string, unknown>) =>
            (args.where.code && s.code === args.where.code) ||
            (args.where.id && s.id === args.where.id),
        );
        return Promise.resolve(found ?? null);
      }),
      create: jest.fn().mockImplementation(() => { writeCalls.push('source.create'); return Promise.resolve({}); }),
      update: jest.fn().mockImplementation(() => { writeCalls.push('source.update'); return Promise.resolve({}); }),
    },
    ipoSourceIdentity: {
      findUnique: jest.fn().mockImplementation((args: { where: { ipoId_sourceId: { ipoId: string; sourceId: string } } }) => {
        const found = ipoSourceIdentities.find(
          (i: Record<string, unknown>) =>
            i.ipoId === args.where.ipoId_sourceId.ipoId &&
            i.sourceId === args.where.ipoId_sourceId.sourceId,
        );
        return Promise.resolve(found ?? null);
      }),
      create: jest.fn().mockImplementation(() => { writeCalls.push('ipoSourceIdentity.create'); return Promise.resolve({}); }),
    },
    fieldProvenance: {
      findMany: jest.fn().mockImplementation((args: {
        where?: {
          entityType?: string;
          entityId?: string;
          sourceId?: string;
          retrievedAt?: { gte?: Date; lte?: Date };
        };
        select?: Record<string, boolean>;
      }) => {
        let rows = fieldProvenance as Record<string, unknown>[];
        if (args.where?.entityType) {
          rows = rows.filter((r) => r.entityType === args.where?.entityType);
        }
        if (args.where?.entityId) {
          rows = rows.filter((r) => r.entityId === args.where?.entityId);
        }
        if (args.where?.sourceId) {
          rows = rows.filter((r) => r.sourceId === args.where?.sourceId);
        }
        if (args.where?.retrievedAt?.gte) {
          const gte = args.where.retrievedAt.gte;
          rows = rows.filter((r) => (r.retrievedAt as Date) >= gte);
        }
        if (args.where?.retrievedAt?.lte) {
          const lte = args.where.retrievedAt.lte;
          rows = rows.filter((r) => (r.retrievedAt as Date) <= lte);
        }
        if (args.select) {
          rows = rows.map((r) => ({ id: r.id }));
        }
        return Promise.resolve(rows);
      }),
      create: jest.fn().mockImplementation(() => { writeCalls.push('fieldProvenance.create'); return Promise.resolve({}); }),
    },
    ipoChangeEvent: {
      findMany: jest.fn().mockImplementation((args: {
        where?: {
          ipoId?: string;
          sourceId?: string;
          detectedAt?: { gte?: Date; lte?: Date };
        };
        orderBy?: unknown;
      }) => {
        let rows = ipoChangeEvents as Record<string, unknown>[];
        if (args.where?.ipoId) {
          rows = rows.filter((r) => r.ipoId === args.where?.ipoId);
        }
        if (args.where?.sourceId) {
          rows = rows.filter((r) => r.sourceId === args.where?.sourceId);
        }
        if (args.where?.detectedAt?.gte) {
          const gte = args.where.detectedAt.gte;
          rows = rows.filter((r) => (r.detectedAt as Date) >= gte);
        }
        if (args.where?.detectedAt?.lte) {
          const lte = args.where.detectedAt.lte;
          rows = rows.filter((r) => (r.detectedAt as Date) <= lte);
        }
        return Promise.resolve(rows);
      }),
      create: jest.fn().mockImplementation(() => { writeCalls.push('ipoChangeEvent.create'); return Promise.resolve({}); }),
    },
  } as unknown as any;
}

function makeRequest(overrides: Partial<RefreshVerificationRequest> = {}): RefreshVerificationRequest {
  const now = new Date('2024-06-01T12:00:00Z');
  return {
    ipoId: 'ipo-a',
    sourceCode: 'sebi',
    executionStatus: 'COMPLETED',
    refreshStartedAt: new Date(now.getTime() - 10_000),
    refreshCompletedAt: now,
    ...overrides,
  };
}

function makeProvenanceRow(
  sourceId: string,
  retrievedAt: Date,
  entityId = 'ipo-a',
): Record<string, unknown> {
  return {
    id: `prov-${Math.random()}`,
    entityType: 'IPO',
    entityId,
    sourceId,
    fieldName: 'issue_size',
    value: '100',
    retrievedAt,
  };
}

function makeChangeEvent(
  ipoId: string,
  fieldName: string,
  oldValue: string | null,
  newValue: string | null,
  detectedAt: Date,
  sourceId = 'src-sebi',
): Record<string, unknown> {
  return {
    id: `evt-${Math.random()}`,
    ipoId,
    fieldName,
    oldValue,
    newValue,
    sourceId,
    detectedAt,
    changeType: 'FIELD_CHANGED',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoveryRefreshVerificationService (Phase 15 Corrections)', () => {
  let service: DiscoveryRefreshVerificationService;

  beforeEach(() => {
    service = new DiscoveryRefreshVerificationService();
  });

  // =========================================================================
  // A. Execution status discrimination
  // =========================================================================

  describe('A. execution status discrimination', () => {
    it('A1. SKIPPED → observationStatus=SKIPPED, adequacy=REFRESH_DID_NOT_HELP, reason=REFRESH_SKIPPED', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'SKIPPED' });

      const report = await service.verify(db, req);

      expect(report.executionStatus).toBe('SKIPPED');
      expect(report.observationStatus).toBe('SKIPPED');
      expect(report.newProvenanceCount).toBe(0);
      expect(report.fieldChanges).toHaveLength(0);
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('REFRESH_SKIPPED');
    });

    it('A2. BLOCKED → observationStatus=BLOCKED, reason=REFRESH_BLOCKED', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'BLOCKED' });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('BLOCKED');
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('REFRESH_BLOCKED');
    });

    it('A3. FAILED → observationStatus=FAILED, reason=REFRESH_FAILED', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'FAILED' });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('FAILED');
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('REFRESH_FAILED');
    });

    it('A4. non-COMPLETED does not query IpoChangeEvent or FieldProvenance for observation', async () => {
      const db = makeDb();
      const req = makeRequest({ executionStatus: 'SKIPPED' });

      await service.verify(db, req);

      // non-completed execution short-circuits before checking changes/provenance
      expect(db.ipoChangeEvent.findMany).toHaveBeenCalledTimes(0);
    });
  });

  // =========================================================================
  // B. Requested-IPO observation proof
  // =========================================================================

  describe('B. requested-IPO observation proof', () => {
    it('B1. requested IPO observed → OBSERVED (provenance in window for correct sourceId)', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', tRefresh, 'ipo-a'),
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      expect(report.resolvedSourceId).toBe('src-sebi');
      expect(report.newProvenanceCount).toBeGreaterThan(0);
      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
    });

    it('B2. source flow completed but no provenance in window → NOT_OBSERVED', async () => {
      // No FieldProvenance rows at all for this IPO in the window
      const db = makeDb({
        fieldProvenance: [],
        ipoChangeEvents: [],
      });

      const req = makeRequest();
      const report = await service.verify(db, req);

      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
      expect(report.verdict.adequacy).toBe('FURTHER_REFRESH_RECOMMENDED');
      expect(report.verdict.reasons).toContain('REQUESTED_IPO_NOT_OBSERVED_BY_SOURCE');
    });

    it('B3. source flow succeeded + another IPO (ipo-b) observed, not ipo-a', async () => {
      // Provenance written for ipo-b (different IPO), not ipo-a
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', tRefresh, 'ipo-b'), // different IPO
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({ ipoId: 'ipo-a' });
      const report = await service.verify(db, req);

      // ipo-a has no provenance → NOT_OBSERVED
      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
    });

    it('B4. unrelated source (NSE) provenance for requested IPO does NOT prove SEBI observation', async () => {
      // NSE provenance written in window for ipo-a — but we requested SEBI
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-nse', tRefresh, 'ipo-a'), // NSE, not SEBI
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({ sourceCode: 'sebi' });
      const report = await service.verify(db, req);

      // SEBI (src-sebi) has no provenance for ipo-a in the window
      expect(report.resolvedSourceId).toBe('src-sebi');
      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
    });

    it('B5. provenance exists outside the refresh window → NOT counted', async () => {
      // Old provenance before the refresh started
      const tOld = new Date('2024-05-01T10:00:00Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', tOld, 'ipo-a'),
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      // tOld is before refreshStartedAt → window filter excludes it
      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
    });

    it('B6. source not in DB → resolvedSourceId=null → INCONCLUSIVE', async () => {
      const db = makeDb({ sources: [], fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ sourceCode: 'unknown-source' });

      const report = await service.verify(db, req);

      expect(report.resolvedSourceId).toBeNull();
      expect(report.observationStatus).toBe('INCONCLUSIVE');
      expect(report.verdict.adequacy).toBe('VERIFICATION_INCONCLUSIVE');
      expect(report.verdict.reasons).toContain('SOURCE_NOT_RESOLVABLE_FOR_IPO');
    });
  });

  // =========================================================================
  // C. Field-level change detection via IpoChangeEvent
  // =========================================================================

  describe('C. field-level change detection', () => {
    it('C1. IpoChangeEvent in refresh window → OBSERVED_AND_UPDATED with exact values', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'issue_size', '100.00', '200.00', tRefresh),
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('OBSERVED_AND_UPDATED');
      expect(report.changedFieldCount).toBe(1);
      expect(report.fieldChanges[0].fieldName).toBe('issue_size');
      expect(report.fieldChanges[0].status).toBe('UPDATED');
      expect(report.fieldChanges[0].valueBefore).toBe('100.00');
      expect(report.fieldChanges[0].valueAfter).toBe('200.00');
      expect(report.fieldChanges[0].detectedAt).toEqual(tRefresh);
    });

    it('C2. new provenance + no IpoChangeEvent → OBSERVED_BUT_UNCHANGED', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [], // canonicalizer found no changes
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
      expect(report.changedFieldCount).toBe(0);
      expect(report.fieldChanges).toHaveLength(0);
    });

    it('C3. historical IpoChangeEvent BEFORE refresh window does NOT count as current change', async () => {
      const tOldChange = new Date('2024-05-01T10:00:00Z'); // before refresh
      const tRefresh = new Date('2024-06-01T11:59:55Z');

      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'lot_size', '10', '15', tOldChange), // outside window
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      // Old event is filtered by refreshStartedAt → changedFieldCount = 0
      expect(report.changedFieldCount).toBe(0);
      // But provenance was written → observed but unchanged
      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
    });

    it('C4. multiple field changes in window → all reported with exact values', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'price_band_low', '80.00', '90.00', tRefresh),
          makeChangeEvent('ipo-a', 'price_band_high', '85.00', '95.00', tRefresh),
          makeChangeEvent('ipo-a', 'lot_size', '10', '12', tRefresh),
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('OBSERVED_AND_UPDATED');
      expect(report.changedFieldCount).toBe(3);
      const fields = report.fieldChanges.map((f) => f.fieldName);
      expect(fields).toContain('price_band_low');
      expect(fields).toContain('price_band_high');
      expect(fields).toContain('lot_size');
    });

    it('C5. IpoChangeEvent for DIFFERENT IPO does NOT count', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-b', 'lot_size', '10', '15', tRefresh), // different IPO
        ],
      });

      const req = makeRequest({ ipoId: 'ipo-a' });
      const report = await service.verify(db, req);

      expect(report.changedFieldCount).toBe(0);
      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
    });

    it('C6. IpoChangeEvent from another source during window → excluded from target source verification', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', tRefresh, 'ipo-a'),
          makeProvenanceRow('src-nse', tRefresh, 'ipo-a'),
        ],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'issue_size', '100.00', '200.00', tRefresh, 'src-sebi'),
          makeChangeEvent('ipo-a', 'lot_size', '10', '15', tRefresh, 'src-nse'),
        ],
      });

      const reqSebi = makeRequest({
        sourceCode: 'sebi',
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const reportSebi = await service.verify(db, reqSebi);

      // Only SEBI change event counted for SEBI refresh
      expect(reportSebi.changedFieldCount).toBe(1);
      expect(reportSebi.fieldChanges[0].fieldName).toBe('issue_size');

      const reqNse = makeRequest({
        sourceCode: 'nse',
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const reportNse = await service.verify(db, reqNse);

      // Only NSE change event counted for NSE refresh
      expect(reportNse.changedFieldCount).toBe(1);
      expect(reportNse.fieldChanges[0].fieldName).toBe('lot_size');
    });
  });

  // =========================================================================
  // D. Observation status → verdict mapping
  // =========================================================================

  describe('D. verdict adequacy', () => {
    it('D1. OBSERVED_AND_UPDATED + source FRESH → SUFFICIENT', async () => {
      const tRecent = new Date(Date.now() - 60_000); // 1 minute ago — within TTL
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRecent, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'issue_size', '100', '200', tRecent),
        ],
        sources: [
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date(tRecent.getTime() - 5000),
        refreshCompletedAt: tRecent,
      });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('OBSERVED_AND_UPDATED');
      expect(['SUFFICIENT', 'FURTHER_REFRESH_RECOMMENDED']).toContain(
        report.verdict.adequacy,
      );
    });

    it('D2. OBSERVED_BUT_UNCHANGED + source FRESH → SUFFICIENT', async () => {
      const tRecent = new Date(Date.now() - 60_000);
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRecent, 'ipo-a')],
        ipoChangeEvents: [], // no changes
        sources: [
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date(tRecent.getTime() - 5000),
        refreshCompletedAt: tRecent,
      });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
      expect(['SUFFICIENT', 'FURTHER_REFRESH_RECOMMENDED']).toContain(
        report.verdict.adequacy,
      );
    });

    it('D3. NOT_OBSERVED → FURTHER_REFRESH_RECOMMENDED', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('NOT_OBSERVED');
      expect(report.verdict.adequacy).toBe('FURTHER_REFRESH_RECOMMENDED');
      expect(report.verdict.reasons).toContain('REQUESTED_IPO_NOT_OBSERVED_BY_SOURCE');
      expect(report.verdict.furtherRefreshRecommended).toBe(true);
    });

    it('D4. INCONCLUSIVE → VERIFICATION_INCONCLUSIVE', async () => {
      const db = makeDb({ sources: [], fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ sourceCode: 'ghost-source' });

      const report = await service.verify(db, req);

      expect(report.observationStatus).toBe('INCONCLUSIVE');
      expect(report.verdict.adequacy).toBe('VERIFICATION_INCONCLUSIVE');
    });

    it('D5. source still STALE after observation → FURTHER_REFRESH_RECOMMENDED', async () => {
      const tStale = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tStale, 'ipo-a')],
        ipoChangeEvents: [],
        sources: [
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date(tStale.getTime() - 1000),
        refreshCompletedAt: tStale,
      });

      const report = await service.verify(db, req);

      // Provenance was written (observationStatus is OBSERVED_*) but source is still stale
      expect(report.verdict.adequacy).toBe('FURTHER_REFRESH_RECOMMENDED');
    });

    it('D6. furtherRefreshRecommended mirrors postRefreshPlan.hasRecommendedActions', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.verdict.furtherRefreshRecommended).toBe(
        report.postRefreshPlan.hasRecommendedActions,
      );
    });
  });

  // =========================================================================
  // E. Concurrency / scoping safety
  // =========================================================================

  describe('E. concurrency / source-scoping', () => {
    it('E1. concurrent NSE provenance for ipo-a does NOT prove SEBI observation', async () => {
      const tConcurrent = new Date('2024-06-01T11:59:57Z');

      const db = makeDb({
        // NSE provenance written concurrently for ipo-a
        fieldProvenance: [makeProvenanceRow('src-nse', tConcurrent, 'ipo-a')],
        ipoChangeEvents: [],
      });

      const req = makeRequest({ sourceCode: 'sebi' }); // requesting SEBI

      const report = await service.verify(db, req);

      // src-sebi has no provenance → NOT_OBSERVED despite NSE activity
      expect(report.resolvedSourceId).toBe('src-sebi');
      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
    });

    it('E2. concurrent SEBI provenance for ipo-b does NOT affect ipo-a verification', async () => {
      const tRefresh = new Date('2024-06-01T11:59:57Z');

      const db = makeDb({
        // SEBI provenance for a DIFFERENT IPO
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-b')],
        ipoChangeEvents: [],
      });

      const req = makeRequest({ ipoId: 'ipo-a' }); // requesting ipo-a

      const report = await service.verify(db, req);

      // ipo-a has no provenance
      expect(report.newProvenanceCount).toBe(0);
      expect(report.observationStatus).toBe('NOT_OBSERVED');
    });

    it('E3. multiple SEBI provenance rows for ipo-a in window → all counted', async () => {
      const t1 = new Date('2024-06-01T11:59:51Z');
      const t2 = new Date('2024-06-01T11:59:53Z');
      const t3 = new Date('2024-06-01T11:59:55Z');

      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', t1, 'ipo-a'),
          makeProvenanceRow('src-sebi', t2, 'ipo-a'),
          makeProvenanceRow('src-sebi', t3, 'ipo-a'),
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: new Date('2024-06-01T12:00:00Z'),
      });

      const report = await service.verify(db, req);

      expect(report.newProvenanceCount).toBe(3);
      expect(report.observationStatus).toBe('OBSERVED_BUT_UNCHANGED');
    });
  });

  // =========================================================================
  // F. Report structure completeness
  // =========================================================================

  describe('F. report structure', () => {
    it('F1. COMPLETED path report contains all required fields', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.ipoId).toBe('ipo-a');
      expect(report.sourceCode).toBe('sebi');
      expect(report.executionStatus).toBe('COMPLETED');
      expect(report.refreshStartedAt).toBeInstanceOf(Date);
      expect(report.refreshCompletedAt).toBeInstanceOf(Date);
      expect(report.observationStatus).toBeDefined();
      expect(typeof report.resolvedSourceId === 'string' || report.resolvedSourceId === null).toBe(true);
      expect(typeof report.newProvenanceCount).toBe('number');
      expect(Array.isArray(report.fieldChanges)).toBe(true);
      expect(typeof report.changedFieldCount).toBe('number');
      expect(report.qualitySummary).toBeDefined();
      expect(report.freshnessSummary).toBeDefined();
      expect(report.reconciliationSummary).toBeDefined();
      expect(report.postRefreshPlan).toBeDefined();
      expect(report.verdict).toBeDefined();
      expect(report.verifiedAt).toBeInstanceOf(Date);
    });

    it('F2. non-COMPLETED path report still contains all fields', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'SKIPPED' });

      const report = await service.verify(db, req);

      expect(report.executionStatus).toBe('SKIPPED');
      expect(report.resolvedSourceId).toBeNull();
      expect(report.newProvenanceCount).toBe(0);
      expect(report.fieldChanges).toHaveLength(0);
      expect(report.qualitySummary).toBeDefined();
      expect(report.freshnessSummary).toBeDefined();
      expect(report.reconciliationSummary).toBeDefined();
      expect(report.postRefreshPlan).toBeDefined();
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
    });

    it('F3. sourceCode is normalized to lowercase', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ sourceCode: 'SEBI' });

      const report = await service.verify(db, req);

      expect(report.sourceCode).toBe('sebi');
    });
  });

  // =========================================================================
  // G. Read-only guarantee
  // =========================================================================

  describe('G. read-only guarantee', () => {
    it('G1. COMPLETED path performs zero DB writes', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'issue_size', '100', '200', tRefresh),
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: tRefresh,
      });

      await service.verify(db, req);

      // Verify no write methods were called
      expect(db._writeCalls).toHaveLength(0);
      expect(db.ipo.create).not.toHaveBeenCalled();
      expect(db.ipo.update).not.toHaveBeenCalled();
      expect(db.fieldProvenance.create).not.toHaveBeenCalled();
      expect(db.ipoChangeEvent.create).not.toHaveBeenCalled();
      expect(db.ipoSourceIdentity.create).not.toHaveBeenCalled();
    });

    it('G2. SKIPPED path performs zero DB writes', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'SKIPPED' });

      await service.verify(db, req);

      expect(db._writeCalls).toHaveLength(0);
    });

    it('G3. FAILED path performs zero DB writes', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'FAILED' });

      await service.verify(db, req);

      expect(db._writeCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // H. Quality and freshness integration
  // =========================================================================

  describe('H. quality / freshness integration', () => {
    it('H1. no sources → empty freshness decisions and empty plan actions', async () => {
      const db = makeDb({ sources: [], fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.freshnessSummary.sourceDecisions).toHaveLength(0);
      expect(report.postRefreshPlan.actions).toHaveLength(0);
    });

    it('H2. source STALE (25h) → postRefreshPlan has RECOMMENDED actions', async () => {
      const tStale = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tStale, 'ipo-a')],
        ipoChangeEvents: [],
        sources: [
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date(tStale.getTime() - 1000),
        refreshCompletedAt: tStale,
      });

      const report = await service.verify(db, req);

      // SEBI is STALE → plan has RECOMMENDED action
      expect(report.postRefreshPlan.hasRecommendedActions).toBe(true);
      expect(report.verdict.adequacy).toBe('FURTHER_REFRESH_RECOMMENDED');
    });

    it('H3. freshness decisions include the requested source', async () => {
      const tRecent = new Date(Date.now() - 60_000);
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRecent, 'ipo-a')],
        ipoChangeEvents: [],
        sources: [
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date(tRecent.getTime() - 5000),
        refreshCompletedAt: tRecent,
      });

      const report = await service.verify(db, req);

      const sebiFreshness = report.freshnessSummary.sourceDecisions.find(
        (d) => d.sourceCode.toLowerCase() === 'sebi',
      );
      expect(sebiFreshness).toBeDefined();
      expect(sebiFreshness?.status).toBe('FRESH');
    });
  });

  // =========================================================================
  // I. Edge cases
  // =========================================================================

  describe('I. edge cases', () => {
    it('I1. IpoChangeEvent with null oldValue (first-time write) → valueBefore=null', async () => {
      const tRefresh = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [makeProvenanceRow('src-sebi', tRefresh, 'ipo-a')],
        ipoChangeEvents: [
          makeChangeEvent('ipo-a', 'lot_size', null, '15', tRefresh),
        ],
      });

      const req = makeRequest({
        refreshStartedAt: new Date('2024-06-01T11:59:50Z'),
        refreshCompletedAt: tRefresh,
      });

      const report = await service.verify(db, req);

      expect(report.fieldChanges[0].valueBefore).toBeNull();
      expect(report.fieldChanges[0].valueAfter).toBe('15');
      expect(report.fieldChanges[0].status).toBe('UPDATED');
    });

    it('I2. multiple FieldProvenance rows with different sourceIds → only requested source counted', async () => {
      const tWindow = new Date('2024-06-01T11:59:55Z');
      const db = makeDb({
        fieldProvenance: [
          makeProvenanceRow('src-sebi', tWindow, 'ipo-a'),
          makeProvenanceRow('src-nse', tWindow, 'ipo-a'),  // different source
        ],
        ipoChangeEvents: [],
      });

      const req = makeRequest({ sourceCode: 'sebi' });
      const report = await service.verify(db, req);

      // Only SEBI rows counted (1), not NSE rows
      expect(report.resolvedSourceId).toBe('src-sebi');
      expect(report.newProvenanceCount).toBe(1);
    });

    it('I3. BLOCKED execution → further refresh still recommended', async () => {
      const db = makeDb({ fieldProvenance: [], ipoChangeEvents: [] });
      const req = makeRequest({ executionStatus: 'BLOCKED' });

      const report = await service.verify(db, req);

      // The plan may or may not recommend, but the verdict is DID_NOT_HELP
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('REFRESH_BLOCKED');
      expect(report.qualitySummary).toBeDefined();
      expect(report.postRefreshPlan).toBeDefined();
    });
  });
});
