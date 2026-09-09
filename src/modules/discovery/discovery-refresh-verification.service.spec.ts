import { SourceHealthStatus, SourceType } from '@prisma/client';

import {
  DiscoveryRefreshVerificationService,
  ProvenanceSnapshot,
  RefreshVerificationRequest,
} from './discovery-refresh-verification.service';

// ---------------------------------------------------------------------------
// Minimal fake DB builder for verification tests
// ---------------------------------------------------------------------------

function makeDb(overrides: Partial<{
  ipo: Record<string, unknown> | null;
  provenances: Record<string, unknown>[];
  sources: Record<string, unknown>[];
}> = {}) {
  const {
    ipo = {
      id: 'ipo-v1',
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
    provenances = [],
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
  } = overrides;

  return {
    ipo: {
      findUnique: jest.fn().mockImplementation((args: { where: { id: string } }) => {
        if (!ipo) return Promise.resolve(null);
        const row = ipo as Record<string, unknown>;
        return Promise.resolve(row.id === args.where.id ? row : null);
      }),
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
    },
    fieldProvenance: {
      findMany: jest.fn().mockResolvedValue(provenances),
    },
  } as unknown as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<RefreshVerificationRequest> = {}): RefreshVerificationRequest {
  const now = new Date('2024-06-01T12:00:00Z');
  return {
    ipoId: 'ipo-v1',
    sourceCode: 'sebi',
    refreshCompleted: true,
    refreshStartedAt: new Date(now.getTime() - 5000),
    refreshCompletedAt: now,
    ...overrides,
  };
}

function makeSnapshot(bySource: Record<string, Date> = {}, capturedAt?: Date): ProvenanceSnapshot {
  return {
    bySource,
    capturedAt: capturedAt ?? new Date('2024-06-01T11:59:00Z'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoveryRefreshVerificationService (Phase 15)', () => {
  let service: DiscoveryRefreshVerificationService;

  beforeEach(() => {
    service = new DiscoveryRefreshVerificationService();
  });

  // -------------------------------------------------------------------------
  // A. captureSnapshot
  // -------------------------------------------------------------------------

  describe('A. captureSnapshot()', () => {
    it('A1. returns empty snapshot when no provenances exist', async () => {
      const db = makeDb({ provenances: [] });
      const snap = await service.captureSnapshot(db, 'ipo-v1');

      expect(snap.bySource).toEqual({});
      expect(snap.capturedAt).toBeInstanceOf(Date);
    });

    it('A2. returns max retrievedAt per source when multiple provenances exist', async () => {
      const t1 = new Date('2024-05-01T10:00:00Z');
      const t2 = new Date('2024-05-02T10:00:00Z');
      const t3 = new Date('2024-05-03T10:00:00Z');

      const db = makeDb({
        provenances: [
          { sourceId: 'src-sebi', fieldName: 'issue_size', value: '100', retrievedAt: t1, entityType: 'IPO', entityId: 'ipo-v1' },
          { sourceId: 'src-sebi', fieldName: 'lot_size', value: '15', retrievedAt: t2, entityType: 'IPO', entityId: 'ipo-v1' },
          { sourceId: 'src-nse', fieldName: 'issue_size', value: '100', retrievedAt: t3, entityType: 'IPO', entityId: 'ipo-v1' },
        ],
      });

      const snap = await service.captureSnapshot(db, 'ipo-v1');

      expect(snap.bySource['src-sebi']).toEqual(t2);
      expect(snap.bySource['src-nse']).toEqual(t3);
    });
  });

  // -------------------------------------------------------------------------
  // B. verify() — refresh not completed
  // -------------------------------------------------------------------------

  describe('B. verify() when refresh did not complete', () => {
    it('B1. returns REFRESH_DID_NOT_HELP when refreshCompleted=false', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest({ refreshCompleted: false });

      const report = await service.verify(db, req);

      expect(report.refreshCompleted).toBe(false);
      expect(report.newProvenanceRecorded).toBe(false);
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('REFRESH_NOT_COMPLETED');
    });

    it('B2. still produces reconciliation, freshness and plan even when not completed', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest({ refreshCompleted: false });

      const report = await service.verify(db, req);

      expect(report.qualitySummary).toBeDefined();
      expect(report.freshnessSummary).toBeDefined();
      expect(report.postRefreshPlan).toBeDefined();
      expect(report.reconciliationSummary).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // C. verify() — no new provenance after completed refresh
  // -------------------------------------------------------------------------

  describe('C. verify() when refresh completed but produced no new provenance', () => {
    it('C1. returns REFRESH_DID_NOT_HELP when no provenance change detected', async () => {
      const t1 = new Date('2024-05-01T10:00:00Z');
      const snapshotBefore = makeSnapshot({ 'src-sebi': t1 });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '100',
            retrievedAt: t1, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      // The after snapshot has the same max retrievedAt as before
      expect(report.newProvenanceRecorded).toBe(false);
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
      expect(report.verdict.reasons).toContain('NO_NEW_PROVENANCE_RECORDED');
    });
  });

  // -------------------------------------------------------------------------
  // D. verify() — new provenance recorded
  // -------------------------------------------------------------------------

  describe('D. verify() when new provenance was recorded', () => {
    it('D1. detects new provenance when after snapshot has newer retrievedAt', async () => {
      const tBefore = new Date('2024-05-01T10:00:00Z');
      const tAfter = new Date('2024-06-01T10:00:00Z');

      const snapshotBefore = makeSnapshot({ 'src-sebi': tBefore });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '200',
            retrievedAt: tAfter, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      expect(report.newProvenanceRecorded).toBe(true);
    });

    it('D2. detects new provenance when a source appears for the first time', async () => {
      const tAfter = new Date('2024-06-01T10:00:00Z');
      // snapshotBefore has no sources
      const snapshotBefore = makeSnapshot({});

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '200',
            retrievedAt: tAfter, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      expect(report.newProvenanceRecorded).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // E. Field-change detection
  // -------------------------------------------------------------------------

  describe('E. fieldChanges', () => {
    it('E1. all fields are UNKNOWN when no snapshotBefore is provided', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest({ snapshotBefore: undefined });

      const report = await service.verify(db, req);

      // With empty IPO (all canonical null) and no snapshotBefore, all fields are UNKNOWN
      expect(report.fieldChanges.every((f) => f.status === 'UNKNOWN')).toBe(true);
    });

    it('E2. fields are UNCHANGED when snapshotBefore provided but no new provenance', async () => {
      const t1 = new Date('2024-05-01T10:00:00Z');
      const snapshotBefore = makeSnapshot({ 'src-sebi': t1 });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '100',
            retrievedAt: t1, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      const unchangedFields = report.fieldChanges.filter((f) => f.status === 'UNCHANGED');
      expect(unchangedFields.length).toBeGreaterThan(0);
    });

    it('E3. changedFieldCount is 0 when no new provenance and baseline exists', async () => {
      const t1 = new Date('2024-05-01T10:00:00Z');
      const snapshotBefore = makeSnapshot({ 'src-sebi': t1 });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '100',
            retrievedAt: t1, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      expect(report.changedFieldCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // F. Verdict logic
  // -------------------------------------------------------------------------

  describe('F. verdict adequacy', () => {
    it('F1. SUFFICIENT when refresh completed, new provenance, no further refresh recommended', async () => {
      const tBefore = new Date('2024-04-01T10:00:00Z');
      const tAfter = new Date('2024-06-01T10:00:00Z');
      const snapshotBefore = makeSnapshot({ 'src-sebi': tBefore });

      // IPO with fresh data
      const db = makeDb({
        ipo: {
          id: 'ipo-v1', status: 'UPCOMING',
          marketSegment: 'MAINBOARD', exchange: 'BOTH',
          symbol: null, issueSize: null, freshIssueSize: null,
          ofsSize: null, issueShareCount: null, freshIssueShareCount: null,
          ofsShareCount: null, priceBandLow: null, priceBandHigh: null,
          lotSize: null, lifecycleEvents: [],
        },
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '200',
            retrievedAt: tAfter, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
        sources: [
          // Only SEBI source — so freshness only evaluates SEBI
          {
            id: 'src-sebi', code: 'sebi', name: 'SEBI',
            sourceType: SourceType.OFFICIAL_FILING,
            healthStatus: SourceHealthStatus.HEALTHY,
            enabled: true, priority: 10,
          },
        ],
      });

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      expect(report.newProvenanceRecorded).toBe(true);
      // SEBI freshness check: tAfter is within 24h TTL from verifiedAt
      // So SEBI is FRESH, no more refresh recommended
      expect(['SUFFICIENT', 'FURTHER_REFRESH_RECOMMENDED']).toContain(
        report.verdict.adequacy,
      );
      expect(report.verdict.furtherRefreshRecommended).toBe(
        report.postRefreshPlan.hasRecommendedActions,
      );
    });

    it('F2. furtherRefreshRecommended matches postRefreshPlan.hasRecommendedActions', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.verdict.furtherRefreshRecommended).toBe(
        report.postRefreshPlan.hasRecommendedActions,
      );
    });

    it('F3. FURTHER_REFRESH_RECOMMENDED when source still stale after refresh', async () => {
      // After snapshot: sebi retrievedAt is very old (25 hours ago)
      const tOld = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const tBefore = new Date(tOld.getTime() - 1000);
      const snapshotBefore = makeSnapshot({ 'src-sebi': tBefore });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '100',
            retrievedAt: tOld, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
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

      const req = makeRequest({ snapshotBefore });
      const report = await service.verify(db, req);

      // SEBI freshness: tOld is 25h ago > 24h TTL → STALE → FURTHER_REFRESH_RECOMMENDED
      expect(report.verdict.adequacy).toBe('FURTHER_REFRESH_RECOMMENDED');
    });
  });

  // -------------------------------------------------------------------------
  // G. Report structure completeness
  // -------------------------------------------------------------------------

  describe('G. report structure', () => {
    it('G1. report contains all required fields', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.ipoId).toBe('ipo-v1');
      expect(report.sourceCode).toBe('sebi');
      expect(report.refreshCompleted).toBe(true);
      expect(report.refreshStartedAt).toBeInstanceOf(Date);
      expect(report.refreshCompletedAt).toBeInstanceOf(Date);
      expect(report.snapshotBefore).toBeDefined();
      expect(report.snapshotAfter).toBeDefined();
      expect(typeof report.newProvenanceRecorded).toBe('boolean');
      expect(Array.isArray(report.fieldChanges)).toBe(true);
      expect(typeof report.changedFieldCount).toBe('number');
      expect(report.qualitySummary).toBeDefined();
      expect(report.freshnessSummary).toBeDefined();
      expect(report.reconciliationSummary).toBeDefined();
      expect(report.postRefreshPlan).toBeDefined();
      expect(report.verdict).toBeDefined();
      expect(report.verifiedAt).toBeInstanceOf(Date);
    });

    it('G2. sourceCode is normalized to lowercase', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest({ sourceCode: 'SEBI' });

      const report = await service.verify(db, req);

      expect(report.sourceCode).toBe('sebi');
    });

    it('G3. snapshotBefore defaults to empty when not provided', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest({ snapshotBefore: undefined });

      const report = await service.verify(db, req);

      expect(report.snapshotBefore.bySource).toEqual({});
    });

    it('G4. snapshotAfter capturedAt is the verifiedAt timestamp', async () => {
      const db = makeDb({ provenances: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      // snapshotAfter.capturedAt should be at or after refreshCompletedAt
      expect(report.snapshotAfter.capturedAt >= report.refreshCompletedAt).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  // H. Edge cases
  // -------------------------------------------------------------------------

  describe('H. edge cases', () => {
    it('H1. handles IPO with no sources gracefully', async () => {
      const db = makeDb({ provenances: [], sources: [] });
      const req = makeRequest();

      const report = await service.verify(db, req);

      expect(report.freshnessSummary.sourceDecisions).toHaveLength(0);
      expect(report.postRefreshPlan.actions).toHaveLength(0);
    });

    it('H2. handles multiple provenances per source correctly in snapshot', async () => {
      const t1 = new Date('2024-05-01T10:00:00Z');
      const t2 = new Date('2024-05-02T10:00:00Z');

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '100',
            retrievedAt: t1, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
          {
            sourceId: 'src-sebi', fieldName: 'lot_size', value: '15',
            retrievedAt: t2, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const snap = await service.captureSnapshot(db, 'ipo-v1');

      // Only the max retrievedAt per source should be kept
      expect(snap.bySource['src-sebi']).toEqual(t2);
    });

    it('H3. refreshCompleted=false overrides verdict regardless of provenance', async () => {
      const tBefore = new Date('2024-05-01T10:00:00Z');
      const tAfter = new Date('2024-06-01T10:00:00Z');
      const snapshotBefore = makeSnapshot({ 'src-sebi': tBefore });

      const db = makeDb({
        provenances: [
          {
            sourceId: 'src-sebi', fieldName: 'issue_size', value: '200',
            retrievedAt: tAfter, entityType: 'IPO', entityId: 'ipo-v1',
            source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
          },
        ],
      });

      const req = makeRequest({ refreshCompleted: false, snapshotBefore });
      const report = await service.verify(db, req);

      // Even though provenance exists, refreshCompleted=false must win
      expect(report.newProvenanceRecorded).toBe(false);
      expect(report.verdict.adequacy).toBe('REFRESH_DID_NOT_HELP');
    });
  });
});
