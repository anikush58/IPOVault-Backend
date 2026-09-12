import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { ConsoleEnabledGuard } from './console.guard';

describe('ConsoleController', () => {
  let controller: ConsoleController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController],
      providers: [
        { provide: ConsoleService, useValue: service },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(true) },
        },
        ConsoleEnabledGuard,
      ],
    }).compile();

    controller = module.get<ConsoleController>(ConsoleController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should render HTML console UI template string', () => {
    const html = controller.getConsoleUi();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('IPOVault Console');
    expect(html).toContain('Read-Only');
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
});
