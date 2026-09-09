import { SourceHealthStatus, SourceType } from '@prisma/client';

import { DiscoveryRefreshService } from './discovery-refresh.service';

describe('DiscoveryRefreshService (Phase 13 Smart IPO Refresh Orchestration)', () => {
  let service: DiscoveryRefreshService;
  const now = new Date('2026-09-10T12:00:00.000Z');

  beforeEach(() => {
    service = new DiscoveryRefreshService();
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

  function makeProv(sourceId: string, retrievedAt: Date, sourceObj: any) {
    return {
      id: `prov-${sourceId}`,
      entityType: 'IPO',
      entityId: 'ipo-1',
      fieldName: 'symbol',
      value: 'TEST',
      sourceId,
      sourceReference: 'ref-1',
      retrievedAt,
      source: sourceObj,
    };
  }

  it('recommends SKIPPED status for a FRESH source requiring no refresh', async () => {
    const mockIpo = { id: 'ipo-fresh-plan', status: 'UPCOMING', lifecycleEvents: [] };
    const provenances = [
      makeProv('src-sebi', new Date(now.getTime() - 2 * 60 * 60 * 1000), mockSources[0]),
      makeProv('src-nse', new Date(now.getTime() - 1 * 60 * 60 * 1000), mockSources[1]),
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const plan = await service.generatePlan(db, 'ipo-fresh-plan', now);

    expect(plan.hasRecommendedActions).toBe(false);
    expect(plan.actions.every((a) => a.status === 'SKIPPED')).toBe(true);
  });

  it('recommends RECOMMENDED status for a STALE source', async () => {
    const mockIpo = { id: 'ipo-stale-plan', status: 'UPCOMING', lifecycleEvents: [] };
    // SEBI observed 30h ago (TTL 24h)
    const provenances = [
      makeProv('src-sebi', new Date(now.getTime() - 30 * 60 * 60 * 1000), mockSources[0]),
      makeProv('src-nse', new Date(now.getTime() - 1 * 60 * 60 * 1000), mockSources[1]),
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const plan = await service.generatePlan(db, 'ipo-stale-plan', now);

    expect(plan.hasRecommendedActions).toBe(true);
    const sebiAction = plan.actions.find((a) => a.sourceCode === 'sebi');
    expect(sebiAction?.status).toBe('RECOMMENDED');
    expect(sebiAction?.reasons).toContain('STALE_OBSERVATION');
  });

  it('recommends RECOMMENDED status for an UNKNOWN source without history', async () => {
    const mockIpo = { id: 'ipo-unknown-plan', status: 'UPCOMING', lifecycleEvents: [] };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const plan = await service.generatePlan(db, 'ipo-unknown-plan', now);

    expect(plan.hasRecommendedActions).toBe(true);
    const sebiAction = plan.actions.find((a) => a.sourceCode === 'sebi');
    expect(sebiAction?.status).toBe('RECOMMENDED');
    expect(sebiAction?.reasons).toContain('NEW_IPO_NO_SOURCE_OBSERVATION');
  });

  it('marks action as BLOCKED when a source health is FAILING or DEGRADED', async () => {
    const mockIpo = { id: 'ipo-failing-source', status: 'UPCOMING', lifecycleEvents: [] };
    const failingSources = [
      { ...mockSources[0]! },
      { ...mockSources[1]!, healthStatus: SourceHealthStatus.FAILING },
    ];

    // NSE observed 30h ago (STALE)
    const provenances = [
      makeProv('src-sebi', new Date(now.getTime() - 1 * 60 * 60 * 1000), failingSources[0]),
      makeProv('src-nse', new Date(now.getTime() - 30 * 60 * 60 * 1000), failingSources[1]),
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(failingSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const plan = await service.generatePlan(db, 'ipo-failing-source', now);

    const nseAction = plan.actions.find((a) => a.sourceCode === 'nse');
    expect(nseAction?.status).toBe('BLOCKED');
    expect(nseAction?.reasons).toContain('SOURCE_HEALTH_DEGRADED');
  });

  it('sorts actions deterministically by priority weight, source priority metadata, and sourceCode tie-breaker', async () => {
    const mockIpo = { id: 'ipo-sort', status: 'OPEN', lifecycleEvents: [] };

    // SEBI observed 30h ago (STALE -> HIGH priority for OPEN status)
    // NSE observed 10h ago (STALE -> HIGH priority for OPEN status)
    const provenances = [
      makeProv('src-sebi', new Date(now.getTime() - 30 * 60 * 60 * 1000), mockSources[0]),
      makeProv('src-nse', new Date(now.getTime() - 10 * 60 * 60 * 1000), mockSources[1]),
    ];

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue(provenances) },
    } as any;

    const plan = await service.generatePlan(db, 'ipo-sort', now);

    // Both are HIGH priority. SEBI has source.priority = 10, NSE has source.priority = 20.
    // Lower numeric dbPriority comes first!
    expect(plan.actions[0]?.sourceCode).toBe('sebi');
    expect(plan.actions[1]?.sourceCode).toBe('nse');
  });

  it('is strictly read-only, idempotent, and performs zero database writes', async () => {
    const mockIpo = { id: 'ipo-readonly-plan', status: 'UPCOMING', lifecycleEvents: [] };

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findMany: jest.fn().mockResolvedValue(mockSources) },
      fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
    } as any;

    const plan1 = await service.generatePlan(db, 'ipo-readonly-plan', now);
    const plan2 = await service.generatePlan(db, 'ipo-readonly-plan', now);

    expect(plan1).toEqual(plan2);
  });
});
