import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Response } from 'express';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { ConsoleEnabledGuard } from './console.guard';
import { ResponseEnvelopeInterceptor } from '../../common/interceptors/response-envelope.interceptor';
import { AdminIpoService } from '../admin/admin-ipo.service';
import { IpoGuruService } from '../ipo-guru/ipo-guru.service';
import { IpoTimelineSchedulerService } from '../ipos/ipo-timeline-scheduler.service';
import { UserEntitlementService } from '../user/user-entitlement.service';
import { ProPlanService } from '../pro-plan/pro-plan.service';
import * as vm from 'vm';

describe('ConsoleController', () => {
  let controller: ConsoleController;
  let service: Record<string, jest.Mock>;
  let adminIpoService: Record<string, jest.Mock>;
  let ipoGuruService: Record<string, jest.Mock>;
  let timelineSchedulerService: Record<string, jest.Mock>;
  let userEntitlementService: Record<string, jest.Mock>;
  let proPlanService: Record<string, jest.Mock>;
  let app: INestApplication;

  beforeEach(async () => {
    adminIpoService = {
      listManualIpos: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      createManualIpo: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      getManualIpo: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      updateManualIpo: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      publishIpo: jest.fn().mockResolvedValue({ id: 'ipo-1', publicationStatus: 'PUBLISHED' }),
      unpublishIpo: jest.fn().mockResolvedValue({ id: 'ipo-1', publicationStatus: 'DRAFT' }),
      archiveIpo: jest.fn().mockResolvedValue({ id: 'ipo-1', publicationStatus: 'ARCHIVED' }),
      deleteIpo: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      bulkUpdateStatus: jest.fn().mockResolvedValue({ count: 1, status: 'OPEN' }),
      bulkPublish: jest.fn().mockResolvedValue({ count: 1, publishedIds: ['ipo-1'] }),
      bulkUnpublish: jest.fn().mockResolvedValue({ count: 1 }),
      bulkArchive: jest.fn().mockResolvedValue({ count: 1 }),
      bulkDelete: jest.fn().mockResolvedValue({ count: 1, deletedIds: ['ipo-1'] }),
      parseDocumentUrl: jest.fn().mockResolvedValue({ extraction: {} }),
      uploadAndParseDocument: jest.fn().mockResolvedValue({ extraction: {} }),
      updateAllotmentConfig: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
    };

    service = {
      getDashboardSummary: jest
        .fn()
        .mockResolvedValue({ ipoCounts: { total: 5 } }),
      listIpos: jest.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
      getIpoDetail: jest.fn().mockResolvedValue({ id: 'ipo-1' }),
      getIpoLineage: jest.fn().mockResolvedValue({ provenances: [] }),
      getDataQualitySummary: jest
        .fn()
        .mockResolvedValue({ overallQualityGateStatus: 'COMPLETE' }),
      getSourceHealth: jest.fn().mockResolvedValue({ sources: [] }),
      getNotificationOpsSummary: jest
        .fn()
        .mockResolvedValue({ totalDeliveries: 10 }),
      getAllotmentOpsSummary: jest.fn().mockResolvedValue({ totalJobs: 2 }),
      getSyncRuns: jest.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
      getSyncRunDetails: jest.fn().mockResolvedValue({ run: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' }, data: [], pagination: { total: 0 } }),
    };

    ipoGuruService = {
      getStatus: jest.fn().mockResolvedValue({
        istDate: '2026-09-23',
        requestsUsedToday: 0,
        requestsRemainingToday: 10,
        autoRequestsUsedToday: 0,
        autoRequestsTotal: 4,
        manualRequestsUsedToday: 0,
        manualRequestsRemaining: 6,
        nextScheduledAutoSync: 'Today at 10:00 AM IST',
        nextScheduledIso: '2026-09-23T04:30:00.000Z',
        lastSuccessfulFetch: null,
        lastFetchStatus: 'IDLE',
        lastRequestAt: null,
        scheduledSlots: ['10:00', '13:00', '15:00', '17:30'],
        completedSlots: [],
      }),
      fetchIpos: jest.fn().mockResolvedValue({ httpStatus: 200, ipos: [], total: 0 }),
      syncIpos: jest.fn().mockResolvedValue({ totalFetched: 0, matchedUpdated: 0, newlyCreated: 0, skipped: 0, errorCount: 0, items: [] }),
      previewProvenanceBackfill: jest.fn().mockResolvedValue({ ipoId: 'ipo-1', companyName: 'Acme', added: 12, preserved: 4, skipped: 5, details: [] }),
      applyProvenanceBackfill: jest.fn().mockResolvedValue({ ipoId: 'ipo-1', companyName: 'Acme', added: 12, preserved: 4, skipped: 5, details: [] }),
    };

    timelineSchedulerService = {
      checkAllotmentForAwaitedIpos: jest.fn().mockResolvedValue({ totalChecked: 2, totalUpdated: 1, results: [] }),
    };

    userEntitlementService = {
      listUsers: jest.fn().mockResolvedValue({
        users: [{ uid: 'u1', email: 'test@example.com', tier: 'NON_PRO' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        counts: { total: 1, pro: 0, nonPro: 1 },
      }),
      getUserDetail: jest.fn().mockResolvedValue({
        uid: 'u1',
        email: 'test@example.com',
        tier: 'NON_PRO',
        auditLogs: [],
      }),
      updateUserEntitlement: jest.fn().mockResolvedValue({
        success: true,
        uid: 'u1',
        tier: 'PRO',
      }),
    };

    proPlanService = {
      listAdminPlans: jest.fn().mockResolvedValue([]),
      createPlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      getPlanById: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      updatePlan: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      publishPlan: jest.fn().mockResolvedValue({ id: 'plan-1', status: 'PUBLISHED' }),
      unpublishPlan: jest.fn().mockResolvedValue({ id: 'plan-1', status: 'DRAFT' }),
      archivePlan: jest.fn().mockResolvedValue({ id: 'plan-1', status: 'ARCHIVED' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: ConsoleService, useValue: service },
        { provide: AdminIpoService, useValue: adminIpoService },
        { provide: IpoGuruService, useValue: ipoGuruService },
        { provide: IpoTimelineSchedulerService, useValue: timelineSchedulerService },
        { provide: UserEntitlementService, useValue: userEntitlementService },
        { provide: ProPlanService, useValue: proPlanService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(true) },
        },
        ConsoleEnabledGuard,
      ],
    })
      .overrideGuard(ConsoleEnabledGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ConsoleController>(ConsoleController);

    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should render HTML console UI template string when called directly without res', () => {
    const html = controller.getConsoleUi();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('IPOVault');
    expect(html).toContain('Manual IPO');
    expect(html).not.toMatch(/^\s*\{\s*"data"\s*:/);
  });

  it('should generate valid client-side JavaScript without syntax errors in the console HTML template', () => {
    const html = controller.getConsoleUi();
    expect(typeof html).toBe('string');
    const scriptMatch = (html as string).match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch).toBeTruthy();
    const scriptContent = scriptMatch![1];
    expect(() => new vm.Script(scriptContent)).not.toThrow();
  });

  it('should invoke res.setHeader and res.send when Express Response is passed', () => {
    const mockRes = {
      setHeader: jest.fn(),
      send: jest.fn(),
    } as unknown as Response;

    const html = controller.getConsoleUi(mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(mockRes.send).toHaveBeenCalledWith(
      expect.stringContaining('<!DOCTYPE html>'),
    );
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('GET /api/v1/console should return HTTP 200 with raw HTML and bypass JSON envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/console')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(response.text).toMatch(/^\s*<!DOCTYPE html>/i);
    expect(response.text).toContain('<html');
    expect(response.text).toContain('IPOVault');
    expect(response.text).not.toMatch(/^\s*\{\s*"data"\s*:/);
    expect(response.text).not.toContain('{"data":');
  });

  it('GET /api/v1/console/api/dashboard should return HTTP 200 with preserved JSON envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/console/api/dashboard')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      data: { ipoCounts: { total: 5 } },
    });
  });

  it('should delegate dashboard summary to service', async () => {
    const res = await controller.getDashboardSummary();
    expect(res).toEqual({ ipoCounts: { total: 5 } });
    expect(service.getDashboardSummary).toHaveBeenCalled();
  });

  it('should delegate IPO list query to service', async () => {
    await controller.listIpos('test', 'OPEN', 'MAINBOARD', 'NSE', '1', '10');
    expect(service.listIpos).toHaveBeenCalledWith({
      q: 'test',
      status: 'OPEN',
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      page: 1,
      limit: 10,
    });
  });

  it('should delegate IPO detail query to service', async () => {
    const res = await controller.getIpoDetail('ipo-1');
    expect(res).toEqual({ id: 'ipo-1' });
    expect(service.getIpoDetail).toHaveBeenCalledWith('ipo-1');
  });

  it('should delegate source health query to service', async () => {
    await controller.getSourceHealth();
    expect(service.getSourceHealth).toHaveBeenCalled();
  });

  it('should delegate data quality query to service', async () => {
    await controller.getDataQualitySummary();
    expect(service.getDataQualitySummary).toHaveBeenCalled();
  });

  it('should delegate ipo-guru status query to ipoGuruService', async () => {
    const res = await controller.getIpoGuruStatus();
    expect(res.istDate).toBe('2026-09-23');
    expect(res.requestsRemainingToday).toBe(10);
  });

  it('should delegate ipo-guru fetch to ipoGuruService', async () => {
    await controller.fetchIpoGuruData();
    expect(ipoGuruService.fetchIpos).toHaveBeenCalledWith('MANUAL');
  });

  it('should delegate ipo-guru sync to ipoGuruService with provided ipos if present', async () => {
    const mockIpos = [{ slug: 'test-ipo', name: 'Test IPO' }] as any;
    await controller.syncIpoGuruData({ ipos: mockIpos });
    expect(ipoGuruService.syncIpos).toHaveBeenCalledWith('MANUAL', undefined, mockIpos);
  });

  it('should delegate check-awaited to ipoTimelineSchedulerService', async () => {
    const res = await controller.checkAllotmentAwaited();
    expect(timelineSchedulerService.checkAllotmentForAwaitedIpos).toHaveBeenCalled();
    expect(res).toEqual({ totalChecked: 2, totalUpdated: 1, results: [] });
  });

  it('should delegate provenance preview to ipoGuruService', async () => {
    const res = await controller.previewIpoGuruProvenanceBackfill({ ipoId: 'ipo-1' });
    expect(ipoGuruService.previewProvenanceBackfill).toHaveBeenCalledWith('ipo-1');
    expect(res).toEqual({ ipoId: 'ipo-1', companyName: 'Acme', added: 12, preserved: 4, skipped: 5, details: [] });
  });

  it('should delegate provenance apply to ipoGuruService with authenticated admin user', async () => {
    const mockReq = { user: { username: 'admin_test' } } as any;
    const res = await controller.applyIpoGuruProvenanceBackfill({ ipoId: 'ipo-1' }, mockReq);
    expect(ipoGuruService.applyProvenanceBackfill).toHaveBeenCalledWith('ipo-1', 'admin_test');
    expect(res).toEqual({ ipoId: 'ipo-1', companyName: 'Acme', added: 12, preserved: 4, skipped: 5, details: [] });
  });

  it('should delegate single manual ipo provenance preview and apply', async () => {
    await controller.previewSingleManualIpoProvenance('a7a4e3af-f954-4d70-9adb-9a57e4a90637');
    expect(ipoGuruService.previewProvenanceBackfill).toHaveBeenCalledWith('a7a4e3af-f954-4d70-9adb-9a57e4a90637');

    const mockReq = { user: { username: 'superadmin' } } as any;
    await controller.applySingleManualIpoProvenance('a7a4e3af-f954-4d70-9adb-9a57e4a90637', mockReq);
    expect(ipoGuruService.applyProvenanceBackfill).toHaveBeenCalledWith('a7a4e3af-f954-4d70-9adb-9a57e4a90637', 'superadmin');
  });

  it('should delegate enrichManualIpoWithAi to adminIpoService.enrichIpoWithAi', async () => {
    const mockEnrichResult = {
      result: {
        ipoId: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637',
        status: 'COMPLETED',
        missingFieldsDetected: ['aboutDescription'],
        enrichedFields: ['aboutDescription'],
        skippedFields: [],
        durationMs: 1200,
      },
      updatedIpo: { id: 'a7a4e3af-f954-4d70-9adb-9a57e4a90637' },
    };
    adminIpoService.enrichIpoWithAi = jest.fn().mockResolvedValue(mockEnrichResult);

    const res = await controller.enrichManualIpoWithAi('a7a4e3af-f954-4d70-9adb-9a57e4a90637', { forceRefresh: true });

    expect(adminIpoService.enrichIpoWithAi).toHaveBeenCalledWith('a7a4e3af-f954-4d70-9adb-9a57e4a90637', true);
    expect(res).toEqual(mockEnrichResult);
  });

  describe('User Management Endpoints', () => {
    it('should delegate listUsers to userEntitlementService.listUsers with parsed pagination and tier', async () => {
      const res = await controller.listUsers('john', 'PRO', '2', '50');
      expect(userEntitlementService.listUsers).toHaveBeenCalledWith({
        q: 'john',
        tier: 'PRO',
        page: 2,
        limit: 50,
      });
      expect(res).toBeDefined();
    });

    it('should fallback to safe default pagination and tier ALL if invalid params provided', async () => {
      await controller.listUsers(undefined, 'INVALID_TIER', '-1', '999');
      expect(userEntitlementService.listUsers).toHaveBeenCalledWith({
        q: undefined,
        tier: 'ALL',
        page: 1,
        limit: 100,
      });
    });

    it('should delegate getUserDetail to userEntitlementService.getUserDetail', async () => {
      const res = await controller.getUserDetail('u1');
      expect(userEntitlementService.getUserDetail).toHaveBeenCalledWith('u1');
      expect(res).toEqual({
        uid: 'u1',
        email: 'test@example.com',
        tier: 'NON_PRO',
        auditLogs: [],
      });
    });

    it('should delegate updateUserEntitlement to userEntitlementService.updateUserEntitlement', async () => {
      const mockReq = { ip: '127.0.0.1', user: { username: 'superadmin' } } as any;
      const res = await controller.updateUserEntitlement(
        'u1',
        { tier: 'PRO', reason: 'Subscriber upgrade' },
        mockReq,
      );
      expect(userEntitlementService.updateUserEntitlement).toHaveBeenCalledWith(
        'u1',
        'PRO',
        'superadmin',
        'Subscriber upgrade',
        '127.0.0.1',
      );
      expect(res).toEqual({
        success: true,
        uid: 'u1',
        tier: 'PRO',
      });
    });

    it('should serve User Management navigation and content sections in HTML console UI', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console')
        .expect(200);

      expect(response.text).toContain('id="nav-btn-users"');
      expect(response.text).toContain("switchTab('users')");
      expect(response.text).toContain('id="tab-users"');
      expect(response.text).toContain('id="nav-users-pro-count"');
      expect(response.text).toContain('id="user-entitlement-confirm-modal"');
      expect(response.text).toContain('id="user-details-modal"');
      expect(response.text).toContain('User &amp; Entitlement Management');
    });

    it('GET /api/v1/console/api/users should return 200 and paginated user list', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console/api/users?page=1&limit=20&tier=ALL')
        .expect(200);

      expect(userEntitlementService.listUsers).toHaveBeenCalled();
      expect(response.body.data.users).toBeDefined();
      expect(response.body.data.users.length).toBe(1);
    });

    it('GET /api/v1/console/api/users/:uid should return 200 and user detail', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console/api/users/u1')
        .expect(200);

      expect(userEntitlementService.getUserDetail).toHaveBeenCalledWith('u1');
      expect(response.body.data.uid).toBe('u1');
      expect(response.body.data.tier).toBe('NON_PRO');
    });

    it('POST /api/v1/console/api/users/:uid/entitlement should return 200/201 and update entitlement', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/console/api/users/u1/entitlement')
        .send({ tier: 'PRO', reason: 'Admin upgraded' })
        .expect((res) => {
          expect([200, 201]).toContain(res.status);
        });

      expect(userEntitlementService.updateUserEntitlement).toHaveBeenCalled();
      expect(response.body.data.success).toBe(true);
      expect(response.body.data.tier).toBe('PRO');
    });
  });

  describe('Sync Activity Logs Endpoints', () => {
    it('should delegate listSyncRuns to service.getSyncRuns with pagination and trigger filter', async () => {
      await controller.listSyncRuns('AUTO', '2', '15');
      expect(service.getSyncRuns).toHaveBeenCalledWith('AUTO', 2, 15);
    });

    it('should fallback to safe defaults for listSyncRuns params', async () => {
      await controller.listSyncRuns(undefined, '-5', 'invalid');
      expect(service.getSyncRuns).toHaveBeenCalledWith(undefined, 1, 20);
    });

    it('GET /api/v1/console/api/sync-logs should return HTTP 200 with runs', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console/api/sync-logs?trigger=MANUAL&page=1&limit=20')
        .expect(200);

      expect(service.getSyncRuns).toHaveBeenCalledWith('MANUAL', 1, 20);
      expect(response.body.data).toBeDefined();
    });

    it('should delegate getSyncRunDetails to service.getSyncRunDetails with filters and UUID validation', async () => {
      const runUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      await controller.getSyncRunDetails(runUuid, 'UPDATED', 'Tata', '1', '50');
      expect(service.getSyncRunDetails).toHaveBeenCalledWith(runUuid, 'UPDATED', 'Tata', 1, 50);
    });

    it('GET /api/v1/console/api/sync-logs/:runId should return HTTP 200 with details', async () => {
      const runUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const response = await request(app.getHttpServer())
        .get(`/api/v1/console/api/sync-logs/${runUuid}?action=ADDED`)
        .expect(200);

      expect(service.getSyncRunDetails).toHaveBeenCalledWith(runUuid, 'ADDED', undefined, 1, 50);
      expect(response.body.data).toBeDefined();
    });

    it('should serve Sync Logs navigation item and section view in HTML console UI', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console')
        .expect(200);

      expect(response.text).toContain('id="nav-btn-sync-logs"');
      expect(response.text).toContain("switchTab('sync-logs')");
      expect(response.text).toContain('id="tab-sync-logs"');
      expect(response.text).toContain('id="sync-runs-table-body"');
      expect(response.text).toContain('id="sync-run-detail-overlay"');
      expect(response.text).toContain('IPO Guru Sync Activity Logs');
    });

    it('should render quick-choose registrar code chips for Registrar Name and Registrar Code inputs', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/console')
        .expect(200);

      expect(response.text).toContain('id="part-reg-chips"');
      expect(response.text).toContain('id="allot-reg-chips"');
      expect(response.text).toContain("selectRegistrarCodeChip('KFINTECH', 'part')");
      expect(response.text).toContain("selectRegistrarCodeChip('MUFG_INTIME', 'allot')");
      expect(response.text).toContain("selectRegistrarCodeChip('BIGSHARE', 'allot')");
      expect(response.text).toContain("selectRegistrarCodeChip('MAASHITLA', 'allot')");
      expect(response.text).toContain("selectRegistrarCodeChip('SKYLINE', 'allot')");
      expect(response.text).toContain("selectRegistrarCodeChip('PURVA', 'allot')");
      expect(response.text).toContain("selectRegistrarCodeChip('CAMEO', 'allot')");
    });
  });
});
