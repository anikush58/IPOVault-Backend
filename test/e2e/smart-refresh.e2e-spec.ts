import { Prisma } from '@prisma/client';
import request from 'supertest';

import { DiscoverySmartRefreshService } from '../../src/modules/discovery/discovery-smart-refresh.service';
import { DiscoveryRefreshExecutionService } from '../../src/modules/discovery/discovery-refresh-execution.service';
import { IpoWithRelations } from '../../src/modules/ipos/ipo.types';
import { createTestApp } from './create-test-app';

const now = new Date('2026-09-01T12:00:00.000Z');

function makeIpoRecord(id = '11111111-1111-4111-8111-111111111111'): IpoWithRelations {
  return {
    id,
    companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    marketSegment: 'MAINBOARD',
    exchange: 'NSE',
    status: 'OPEN',
    symbol: 'TESTSYM',
    issueSize: new Prisma.Decimal('100.00'),
    freshIssueSize: null,
    ofsSize: null,
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
    faceValue: new Prisma.Decimal('10.00'),
    priceBandLow: new Prisma.Decimal('10.00'),
    priceBandHigh: new Prisma.Decimal('12.00'),
    lotSize: 10,
    minimumLots: 1,
    createdAt: now,
    updatedAt: now,
    company: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      legalName: 'Test Company Ltd',
      displayName: 'Test Company',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: now,
      updatedAt: now,
    },
    lifecycleEvents: [],
  };
}

function createPrismaStubWithIpo(ipoId = '11111111-1111-4111-8111-111111111111') {
  const record = makeIpoRecord(ipoId);
  const targetSource = {
    id: 'src-sebi',
    code: 'sebi',
    name: 'SEBI',
    sourceType: 'OFFICIAL_FILING',
    priority: 1,
    enabled: true,
    healthStatus: 'HEALTHY',
  };

  const db: any = {
    $connect: async () => undefined,
    $disconnect: async () => undefined,
    $queryRaw: async () => [{ '?column?': 1 }],
    ipo: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        id === ipoId ? record : null,
      findMany: async () => [record],
      count: async () => 1,
    },
    source: {
      findMany: async () => [targetSource],
      findUnique: async ({ where: { code } }: { where: { code: string } }) =>
        code === 'sebi' ? targetSource : null,
    },
  };

  return new Proxy(db, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return {
        findMany: async () => [],
        findUnique: async () => null,
        findFirst: async () => null,
        count: async () => 0,
        groupBy: async () => [],
        create: async () => ({}),
        update: async () => ({}),
      };
    },
  });
}

describe('POST /api/v1/ipos/:id/smart-refresh (E2E Hardening)', () => {
  const targetId = '11111111-1111-4111-8111-111111111111';

  it('1. Valid smart-refresh request returns 200 with envelope & request ID header', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESHED_AND_VERIFIED',
      summaryMessage: "Successfully refreshed 'sebi'.",
      initialRefreshPlan: {
        ipoId: targetId,
        overallStatus: 'STALE',
        highestPriority: 'HIGH',
        hasRecommendedActions: true,
        generatedAt: now,
        actions: [],
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.data).toBeDefined();
    expect(response.body.data.ipoId).toBe(targetId);
    expect(response.body.data.sourceCode).toBe('sebi');
    expect(response.body.data.finalOutcome).toBe('REFRESHED_AND_VERIFIED');
    expect(response.body.data.summaryMessage).toBeDefined();

    await app.close();
  });

  it('2. Unknown IPO ID returns 404 with IPO_NOT_FOUND error code', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));

    const response = await request(app.getHttpServer())
      .post('/api/v1/ipos/99999999-9999-4999-8999-999999999999/smart-refresh')
      .send({ source: 'sebi' });

    expect(response.status).toBe(404);
    expect(response.body.error).toBeDefined();
    expect(response.body.error.code).toBe('IPO_NOT_FOUND');
    expect(response.body.error.message).toBe('IPO was not found');

    await app.close();
  });

  it('3. Invalid request (missing source, empty source, whitespace source, invalid UUID) returns 400', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));

    const missingSource = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({});

    const whitespaceSource = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: '   ' });

    const invalidUuid = await request(app.getHttpServer())
      .post('/api/v1/ipos/not-a-uuid/smart-refresh')
      .send({ source: 'sebi' });

    expect(missingSource.status).toBe(400);
    expect(missingSource.body.error.code).toBe('VALIDATION_ERROR');

    expect(whitespaceSource.status).toBe(400);
    expect(whitespaceSource.body.error.code).toBe('VALIDATION_ERROR');

    expect(invalidUuid.status).toBe(400);
    expect(invalidUuid.body.error.code).toBe('VALIDATION_ERROR');

    await app.close();
  });

  it('4. Skipped source returns REFRESH_SKIPPED without execution or verification', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESH_SKIPPED',
      summaryMessage: "Refresh skipped for 'sebi'.",
      initialRefreshPlan: {
        ipoId: targetId,
        overallStatus: 'FRESH',
        highestPriority: 'NONE',
        hasRecommendedActions: false,
        generatedAt: now,
        actions: [],
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('REFRESH_SKIPPED');
    expect(response.body.data.execution).toBeUndefined();
    expect(response.body.data.verification).toBeUndefined();

    await app.close();
  });

  it('5. Blocked source returns REFRESH_BLOCKED', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'nse',
      generatedAt: now,
      finalOutcome: 'REFRESH_BLOCKED',
      summaryMessage: "Refresh blocked for 'nse'.",
      initialRefreshPlan: {
        ipoId: targetId,
        overallStatus: 'UNKNOWN',
        highestPriority: 'HIGH',
        hasRecommendedActions: false,
        generatedAt: now,
        actions: [],
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'nse' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('REFRESH_BLOCKED');

    await app.close();
  });

  it('6. Completed + observed + updated returns REFRESHED_AND_VERIFIED', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESHED_AND_VERIFIED',
      summaryMessage: "Successfully refreshed 'sebi': 1 field(s) updated.",
      initialRefreshPlan: { ipoId: targetId, overallStatus: 'STALE', highestPriority: 'HIGH', hasRecommendedActions: true, generatedAt: now, actions: [] },
      execution: {
        ipoId: targetId,
        sourceCode: 'sebi',
        status: 'COMPLETED',
        startedAt: now,
        completedAt: now,
        outcome: 'MATCHED',
        message: 'Completed',
        reasons: [],
      },
      verification: {
        ipoId: targetId,
        sourceCode: 'sebi',
        executionStatus: 'COMPLETED',
        refreshStartedAt: now,
        refreshCompletedAt: now,
        observationStatus: 'OBSERVED_AND_UPDATED',
        changedFieldCount: 1,
        verdict: { adequacy: 'SUFFICIENT', reasons: [], furtherRefreshRecommended: false },
        verifiedAt: now,
      } as any,
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('REFRESHED_AND_VERIFIED');
    expect(response.body.data.execution.status).toBe('COMPLETED');
    expect(response.body.data.verification.changedFieldCount).toBe(1);

    await app.close();
  });

  it('7. Completed + observed + unchanged returns REFRESHED_BUT_UNCHANGED', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESHED_BUT_UNCHANGED',
      summaryMessage: "Refreshed 'sebi': no canonical field values changed.",
      initialRefreshPlan: { ipoId: targetId, overallStatus: 'STALE', highestPriority: 'HIGH', hasRecommendedActions: true, generatedAt: now, actions: [] },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('REFRESHED_BUT_UNCHANGED');

    await app.close();
  });

  it('8. Completed + not observed returns NOT_OBSERVED', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'NOT_OBSERVED',
      summaryMessage: "Refreshed 'sebi': execution completed, but IPO was not observed.",
      initialRefreshPlan: { ipoId: targetId, overallStatus: 'STALE', highestPriority: 'HIGH', hasRecommendedActions: true, generatedAt: now, actions: [] },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('NOT_OBSERVED');

    await app.close();
  });

  it('9. Completed + inconclusive returns VERIFICATION_INCONCLUSIVE', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'VERIFICATION_INCONCLUSIVE',
      summaryMessage: "Refreshed 'sebi': verification inconclusive.",
      initialRefreshPlan: { ipoId: targetId, overallStatus: 'STALE', highestPriority: 'HIGH', hasRecommendedActions: true, generatedAt: now, actions: [] },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('VERIFICATION_INCONCLUSIVE');

    await app.close();
  });

  it('10. Execution failure returns REFRESH_FAILED', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESH_FAILED',
      summaryMessage: "Refresh failed for 'sebi'.",
      initialRefreshPlan: { ipoId: targetId, overallStatus: 'STALE', highestPriority: 'HIGH', hasRecommendedActions: true, generatedAt: now, actions: [] },
      execution: {
        ipoId: targetId,
        sourceCode: 'sebi',
        status: 'FAILED',
        startedAt: now,
        completedAt: now,
        outcome: 'ERROR',
        message: 'Network error',
        reasons: ['FETCH_FAILED'],
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data.finalOutcome).toBe('REFRESH_FAILED');
    expect(response.body.data.execution.status).toBe('FAILED');

    await app.close();
  });

  it('11. Full response structure contains all required contract fields', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const smartSvc = app.get(DiscoverySmartRefreshService);

    jest.spyOn(smartSvc, 'smartRefresh').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      generatedAt: now,
      finalOutcome: 'REFRESHED_AND_VERIFIED',
      summaryMessage: "Successfully refreshed 'sebi'.",
      initialRefreshPlan: {
        ipoId: targetId,
        overallStatus: 'STALE',
        highestPriority: 'HIGH',
        hasRecommendedActions: true,
        generatedAt: now,
        actions: [],
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/smart-refresh`)
      .send({ source: 'sebi' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        ipoId: targetId,
        sourceCode: 'sebi',
        generatedAt: expect.any(String),
        finalOutcome: expect.any(String),
        summaryMessage: expect.any(String),
        initialRefreshPlan: expect.any(Object),
      }),
    );

    await app.close();
  });

  it('12. No regression of lower-level refresh APIs', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));
    const execSvc = app.get(DiscoveryRefreshExecutionService);

    jest.spyOn(execSvc, 'execute').mockResolvedValueOnce({
      ipoId: targetId,
      sourceCode: 'sebi',
      status: 'SKIPPED',
      startedAt: now,
      completedAt: now,
      outcome: 'SKIPPED',
      message: 'Refresh action skipped',
      reasons: ['NO_REFRESH_REQUIRED'],
    });

    const planRes = await request(app.getHttpServer()).get(
      `/api/v1/ipos/${targetId}/refresh-plan`,
    );
    expect(planRes.status).toBe(200);
    expect(planRes.body.data.ipoId).toBe(targetId);

    const execRes = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/refresh`)
      .send({ source: 'sebi' });
    expect(execRes.status).toBe(200);
    expect(execRes.body.data.ipoId).toBe(targetId);

    const verifyRes = await request(app.getHttpServer())
      .post(`/api/v1/ipos/${targetId}/refresh-verification`)
      .send({
        source: 'sebi',
        executionStatus: 'COMPLETED',
        refreshStartedAt: now.toISOString(),
        refreshCompletedAt: now.toISOString(),
      });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.ipoId).toBe(targetId);

    await app.close();
  });

  it('13. GET /api/v1/ipos/:id/coverage - returns deterministic IPO data coverage report', async () => {
    const app = await createTestApp([], createPrismaStubWithIpo(targetId));

    const response = await request(app.getHttpServer()).get(
      `/api/v1/ipos/${targetId}/coverage`,
    );

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.data).toBeDefined();
    expect(response.body.data.ipoId).toBe(targetId);
    expect(response.body.data.overallStatus).toBeDefined();
    expect(response.body.data.summary).toBeDefined();
    expect(response.body.data.fields).toBeInstanceOf(Array);
    expect(response.body.data.refreshRecommendations).toBeInstanceOf(Array);

    await app.close();
  });
});
