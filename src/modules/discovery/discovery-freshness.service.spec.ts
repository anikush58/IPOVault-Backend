import { SourceHealthStatus, SourceType } from '@prisma/client';

import { DiscoveryFreshnessService } from './discovery-freshness.service';

describe('DiscoveryFreshnessService (Phase 12 Data Freshness)', () => {
  let service: DiscoveryFreshnessService;
  const now = new Date('2026-09-10T12:00:00.000Z');

  beforeEach(() => {
    service = new DiscoveryFreshnessService();
  });

  const mockSources = [
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
  ];

  it('returns UNKNOWN status and HIGH priority when a source has no prior observations for UPCOMING IPO', async () => {
    const mockIpo = {
      id: 'ipo-new',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-new',
      undefined,
      undefined,
      now,
    );

    expect(summary.overallStatus).toBe('UNKNOWN');
    expect(summary.highestPriority).toBe('HIGH');
    expect(summary.sourceDecisions).toHaveLength(2);

    const sebiDecision = summary.sourceDecisions.find(
      (d) => d.sourceCode === 'sebi',
    );
    expect(sebiDecision?.status).toBe('UNKNOWN');
    expect(sebiDecision?.priority).toBe('HIGH');
    expect(sebiDecision?.lastObservedAt).toBeNull();
    expect(sebiDecision?.reasons).toContain('NEW_IPO_NO_SOURCE_OBSERVATION');
    expect(sebiDecision?.recommendRefresh).toBe(true);
  });

  it('returns UNKNOWN status but LOW priority when a source has no prior observations for LISTED IPO', async () => {
    const mockIpo = {
      id: 'ipo-listed-no-obs',
      status: 'LISTED',
      lifecycleEvents: [],
    };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-listed-no-obs',
      undefined,
      undefined,
      now,
    );

    expect(summary.overallStatus).toBe('UNKNOWN');
    const sebiDecision = summary.sourceDecisions.find(
      (d) => d.sourceCode === 'sebi',
    );
    expect(sebiDecision?.status).toBe('UNKNOWN');
    expect(sebiDecision?.priority).toBe('LOW');
  });

  it('evaluates FRESH status for observations within configured TTL', async () => {
    const mockIpo = {
      id: 'ipo-fresh',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    // SEBI observed 2h ago (TTL 24h), NSE observed 1h ago (TTL 6h)
    const provenances = [
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
      {
        sourceId: 'src-nse',
        retrievedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-fresh',
      undefined,
      undefined,
      now,
    );

    expect(summary.overallStatus).toBe('FRESH');
    expect(summary.highestPriority).toBe('NONE');
    expect(summary.sourceDecisions.every((d) => d.status === 'FRESH')).toBe(
      true,
    );
    expect(
      summary.sourceDecisions.every((d) => d.recommendRefresh === false),
    ).toBe(true);
  });

  describe('TTL Exact Boundary Tests', () => {
    it('evaluates status as FRESH when age is exactly equal to TTL', async () => {
      const mockIpo = { id: 'ipo-boundary-fresh', status: 'UPCOMING', lifecycleEvents: [] };
      const sebiTtlMs = 24 * 60 * 60 * 1000; // 24h
      const exactTtlDate = new Date(now.getTime() - sebiTtlMs);

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        source: { findMany: jest.fn().mockResolvedValue([mockSources[0]!]) },
        fieldProvenance: {
          findMany: jest.fn().mockResolvedValue([{ sourceId: 'src-sebi', retrievedAt: exactTtlDate }]),
        },
      } as any;

      const summary = await service.evaluateFreshness(db, 'ipo-boundary-fresh', undefined, undefined, now);
      const sebiDecision = summary.sourceDecisions[0];

      expect(sebiDecision?.status).toBe('FRESH');
    });

    it('evaluates status as STALE when age is 1ms beyond TTL', async () => {
      const mockIpo = { id: 'ipo-boundary-stale', status: 'UPCOMING', lifecycleEvents: [] };
      const sebiTtlMs = 24 * 60 * 60 * 1000; // 24h
      const justOverTtlDate = new Date(now.getTime() - sebiTtlMs - 1);

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        source: { findMany: jest.fn().mockResolvedValue([mockSources[0]!]) },
        fieldProvenance: {
          findMany: jest.fn().mockResolvedValue([{ sourceId: 'src-sebi', retrievedAt: justOverTtlDate }]),
        },
      } as any;

      const summary = await service.evaluateFreshness(db, 'ipo-boundary-stale', undefined, undefined, now);
      const sebiDecision = summary.sourceDecisions[0];

      expect(sebiDecision?.status).toBe('STALE');
    });
  });

  describe('Event-Aware Freshness (RECENT_LIFECYCLE_CHANGE)', () => {
    it('emits RECENT_LIFECYCLE_CHANGE and elevates priority when a lifecycle event occurred within window', async () => {
      const mockIpo = {
        id: 'ipo-recent-event',
        status: 'OPEN',
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, // 12h ago (< 48h window)
        ],
      };

      const provenances = [
        {
          sourceId: 'src-sebi',
          retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // Fresh
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        source: { findMany: jest.fn().mockResolvedValue([mockSources[0]!]) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
      } as any;

      const summary = await service.evaluateFreshness(db, 'ipo-recent-event', undefined, undefined, now);
      const sebiDecision = summary.sourceDecisions[0];

      expect(sebiDecision?.reasons).toContain('RECENT_LIFECYCLE_CHANGE');
      expect(sebiDecision?.priority).toBe('MEDIUM');
    });

    it('does NOT emit RECENT_LIFECYCLE_CHANGE when lifecycle events are outside recency window', async () => {
      const mockIpo = {
        id: 'ipo-old-event',
        status: 'OPEN',
        lifecycleEvents: [
          { eventType: 'DRHP', eventDate: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) }, // 10 days ago (> 48h window)
        ],
      };

      const provenances = [
        {
          sourceId: 'src-sebi',
          retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // Fresh
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        source: { findMany: jest.fn().mockResolvedValue([mockSources[0]!]) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
      } as any;

      const summary = await service.evaluateFreshness(db, 'ipo-old-event', undefined, undefined, now);
      const sebiDecision = summary.sourceDecisions[0];

      expect(sebiDecision?.reasons).not.toContain('RECENT_LIFECYCLE_CHANGE');
    });
  });

  it('evaluates SEBI and NSE independently when one is stale and one is fresh', async () => {
    const mockIpo = {
      id: 'ipo-split',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    // SEBI observed 30h ago (STALE, TTL 24h), NSE observed 2h ago (FRESH, TTL 6h)
    const provenances = [
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000),
      },
      {
        sourceId: 'src-nse',
        retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-split',
      undefined,
      undefined,
      now,
    );

    expect(summary.overallStatus).toBe('STALE');

    const sebiDecision = summary.sourceDecisions.find(
      (d) => d.sourceCode === 'sebi',
    );
    const nseDecision = summary.sourceDecisions.find(
      (d) => d.sourceCode === 'nse',
    );

    expect(sebiDecision?.status).toBe('STALE');
    expect(sebiDecision?.recommendRefresh).toBe(true);

    expect(nseDecision?.status).toBe('FRESH');
    expect(nseDecision?.recommendRefresh).toBe(false);
  });

  it('separates Source Health from Freshness timestamp (preserves last successful observation)', async () => {
    const mockIpo = {
      id: 'ipo-degraded-source',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    const failingSources = [
      { ...mockSources[0]! },
      { ...mockSources[1]!, healthStatus: SourceHealthStatus.FAILING },
    ];

    // Last successful NSE observation was 2h ago
    const provenances = [
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
      {
        sourceId: 'src-nse',
        retrievedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      },
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(failingSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-degraded-source',
      undefined,
      undefined,
      now,
    );

    const nseDecision = summary.sourceDecisions.find(
      (d) => d.sourceCode === 'nse',
    );
    expect(nseDecision?.status).toBe('FRESH'); // Freshness timestamp is still 2h ago!
    expect(nseDecision?.lastObservedAt).toEqual(
      new Date(now.getTime() - 2 * 60 * 60 * 1000),
    );
    expect(nseDecision?.healthStatus).toBe('FAILING');
    expect(nseDecision?.reasons).toContain('SOURCE_HEALTH_DEGRADED');
  });

  it('elevates priority to HIGH when SOURCE_CONFLICT exists in QualitySummary', async () => {
    const mockIpo = {
      id: 'ipo-conflict-freshness',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    const provenances = [
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
      {
        sourceId: 'src-nse',
        retrievedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
      },
    ];

    const mockQualitySummary = {
      status: 'NEEDS_REVIEW' as const,
      findings: [
        {
          code: 'SOURCE_CONFLICT',
          severity: 'WARNING' as const,
          field: 'issue_size',
          message: 'Source conflict',
        },
      ],
      summary: { errors: 0, warnings: 1, info: 0 },
    };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-conflict-freshness',
      mockQualitySummary,
      undefined,
      now,
    );

    expect(summary.highestPriority).toBe('HIGH');
    expect(
      summary.sourceDecisions.some((d) => d.reasons.includes('SOURCE_CONFLICT')),
    ).toBe(true);
  });

  it('uses latest retrievedAt timestamp when multiple historical revisions exist', async () => {
    const mockIpo = {
      id: 'ipo-revisions',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    const provenances = [
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 48 * 60 * 60 * 1000), // Older T1
      },
      {
        sourceId: 'src-sebi',
        retrievedAt: new Date(now.getTime() - 1 * 60 * 60 * 1000), // Latest T2
      },
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue([mockSources[0]!]) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const summary = await service.evaluateFreshness(
      db,
      'ipo-revisions',
      undefined,
      undefined,
      now,
    );

    const sebiDecision = summary.sourceDecisions[0];
    expect(sebiDecision?.status).toBe('FRESH');
    expect(sebiDecision?.lastObservedAt).toEqual(
      new Date(now.getTime() - 1 * 60 * 60 * 1000),
    );
  });

  it('is strictly read-only, side-effect free, and performs zero database writes', async () => {
    const mockIpo = {
      id: 'ipo-readonly',
      status: 'UPCOMING',
      lifecycleEvents: [],
    };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const res1 = await service.evaluateFreshness(
      db,
      'ipo-readonly',
      undefined,
      undefined,
      now,
    );
    const res2 = await service.evaluateFreshness(
      db,
      'ipo-readonly',
      undefined,
      undefined,
      now,
    );

    expect(res1).toEqual(res2);
    expect(db.ipo.findUnique).toHaveBeenCalledTimes(2);
  });
});
