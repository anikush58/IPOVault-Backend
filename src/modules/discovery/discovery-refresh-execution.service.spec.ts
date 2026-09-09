import { SourceHealthStatus, SourceType } from '@prisma/client';

import { DiscoveryRefreshExecutionService } from './discovery-refresh-execution.service';

describe('DiscoveryRefreshExecutionService (Phase 14 Controlled Refresh Execution)', () => {
  let executionService: DiscoveryRefreshExecutionService;

  const mockIpo = {
    id: 'ipo-exec-1',
    status: 'UPCOMING',
    lifecycleEvents: [],
  };

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
    {
      id: 'src-bse',
      code: 'bse',
      name: 'BSE',
      sourceType: SourceType.EXCHANGE,
      healthStatus: SourceHealthStatus.HEALTHY,
      enabled: true,
      priority: 30,
    },
  ];

  it('A. returns FAILED status when IPO does not exist', async () => {
    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService();
    const result = await executionService.execute(db, {
      ipoId: 'unknown-ipo-id',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('FAILED');
    expect(result.outcome).toBe('ERROR');
    expect(result.reasons).toContain('IPO_NOT_FOUND');
  });

  it('B. returns BLOCKED status when requested source is not registered in system', async () => {
    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService();
    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'unregistered-source',
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.outcome).toBe('UNSUPPORTED');
    expect(result.reasons).toContain('SOURCE_NOT_REGISTERED');
  });

  it('C. returns BLOCKED status when requested source is disabled', async () => {
    const disabledSource = { ...mockSources[0], enabled: false };
    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(disabledSource) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService();
    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.outcome).toBe('BLOCKED');
    expect(result.reasons).toContain('SOURCE_DISABLED');
  });

  it('D. returns BLOCKED/UNSUPPORTED status when source (e.g. BSE) has no executable flow', async () => {
    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[2]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService();
    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'bse',
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.outcome).toBe('UNSUPPORTED');
    expect(result.reasons).toContain('EXECUTABLE_FLOW_UNAVAILABLE');
  });

  it('E. SKIPPED action: does not invoke discovery flow when Phase 13 plan status is SKIPPED', async () => {
    const mockRefreshPlan = {
      generatePlan: jest.fn().mockResolvedValue({
        ipoId: 'ipo-exec-1',
        actions: [
          {
            sourceCode: 'sebi',
            status: 'SKIPPED',
            reasons: ['NO_REFRESH_REQUIRED'],
          },
        ],
      }),
    } as any;

    const mockSebiFlow = {
      run: jest.fn(),
    } as any;

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[0]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService(
      mockRefreshPlan,
      mockSebiFlow,
    );

    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('SKIPPED');
    expect(result.outcome).toBe('SKIPPED');
    expect(mockSebiFlow.run).not.toHaveBeenCalled();
  });

  it('F. BLOCKED action: does not invoke discovery flow when Phase 13 plan status is BLOCKED', async () => {
    const mockRefreshPlan = {
      generatePlan: jest.fn().mockResolvedValue({
        ipoId: 'ipo-exec-1',
        actions: [
          {
            sourceCode: 'sebi',
            status: 'BLOCKED',
            reasons: ['SOURCE_HEALTH_DEGRADED'],
          },
        ],
      }),
    } as any;

    const mockSebiFlow = {
      run: jest.fn(),
    } as any;

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[0]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService(
      mockRefreshPlan,
      mockSebiFlow,
    );

    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.outcome).toBe('BLOCKED');
    expect(mockSebiFlow.run).not.toHaveBeenCalled();
  });

  it('G & H. RECOMMENDED action for SEBI: dispatches to SebiDiscoveryFlow', async () => {
    const mockRefreshPlan = {
      generatePlan: jest.fn().mockResolvedValue({
        ipoId: 'ipo-exec-1',
        actions: [
          {
            sourceCode: 'sebi',
            status: 'RECOMMENDED',
            reasons: ['STALE_OBSERVATION'],
          },
        ],
      }),
    } as any;

    const mockSebiFlow = {
      run: jest.fn().mockResolvedValue({
        totalDiscovered: 2,
        canonicalCreatedCount: 0,
        canonicalMatchedCount: 2,
        duplicateCount: 0,
      }),
    } as any;

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[0]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService(
      mockRefreshPlan,
      mockSebiFlow,
    );

    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome).toBe('MATCHED');
    expect(mockSebiFlow.run).toHaveBeenCalledWith(1, 1, undefined, true, true);
  });

  it('I. RECOMMENDED action for NSE: dispatches to NseDiscoveryFlow', async () => {
    const mockRefreshPlan = {
      generatePlan: jest.fn().mockResolvedValue({
        ipoId: 'ipo-exec-1',
        actions: [
          {
            sourceCode: 'nse',
            status: 'RECOMMENDED',
            reasons: ['STALE_OBSERVATION'],
          },
        ],
      }),
    } as any;

    const mockNseFlow = {
      ingestLive: jest.fn().mockResolvedValue([
        { outcome: 'MATCHED', discoveryRecordId: 'rec-1', ipoId: 'ipo-exec-1' },
      ]),
    } as any;

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[1]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService(
      mockRefreshPlan,
      undefined,
      mockNseFlow,
    );

    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'nse',
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.outcome).toBe('MATCHED');
    expect(mockNseFlow.ingestLive).toHaveBeenCalled();
  });

  it('J. SOURCE FAILURE: captures discovery flow error safely without altering canonical state', async () => {
    const mockRefreshPlan = {
      generatePlan: jest.fn().mockResolvedValue({
        ipoId: 'ipo-exec-1',
        actions: [
          {
            sourceCode: 'sebi',
            status: 'RECOMMENDED',
            reasons: ['STALE_OBSERVATION'],
          },
        ],
      }),
    } as any;

    const mockSebiFlow = {
      run: jest.fn().mockRejectedValue(new Error('Network error on SEBI portal')),
    } as any;

    const db = {
      ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
      source: { findUnique: jest.fn().mockResolvedValue(mockSources[0]) },
    } as any;

    executionService = new DiscoveryRefreshExecutionService(
      mockRefreshPlan,
      mockSebiFlow,
    );

    const result = await executionService.execute(db, {
      ipoId: 'ipo-exec-1',
      sourceCode: 'sebi',
    });

    expect(result.status).toBe('FAILED');
    expect(result.outcome).toBe('ERROR');
    expect(result.message).toContain('Network error on SEBI portal');
    expect(result.reasons).toContain('DISCOVERY_FLOW_EXECUTION_FAILED');
  });
});
