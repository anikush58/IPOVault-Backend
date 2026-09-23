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

describe('ConsoleController', () => {
  let controller: ConsoleController;
  let service: Record<string, jest.Mock>;
  let adminIpoService: Record<string, jest.Mock>;
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
    };

    const ipoGuruService = {
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
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: ConsoleService, useValue: service },
        { provide: AdminIpoService, useValue: adminIpoService },
        { provide: IpoGuruService, useValue: ipoGuruService },
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
});
