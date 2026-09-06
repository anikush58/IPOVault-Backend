import { Test, TestingModule } from '@nestjs/testing';
import { AllotmentJobStatus, AllotmentResultStatus } from '@prisma/client';
import { AllotmentJobService } from './allotment-job.service';
import { AllotmentService } from './allotment.service';
import { AllotmentIdentifierType, AllotmentStatus } from './allotment.types';
import { encryptPan } from './allotment.utils';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { RegistrarResolver } from './registrar.resolver';

describe('AllotmentJobService Bulk Orchestration & Security Tests', () => {
  let jobService: AllotmentJobService;
  let prismaMock: {
    ipo: { findUnique: jest.Mock };
    allotmentCheckJob: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    allotmentCheckJobItem: { update: jest.Mock };
    userSavedPan: { findMany: jest.Mock };
  };
  let allotmentServiceMock: { checkAllotment: jest.Mock };
  let resolverMock: { resolveAdapter: jest.Mock };

  beforeEach(async () => {
    prismaMock = {
      ipo: {
        findUnique: jest.fn(),
      },
      allotmentCheckJob: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      allotmentCheckJobItem: {
        update: jest.fn(),
      },
      userSavedPan: {
        findMany: jest.fn(),
      },
    };

    allotmentServiceMock = {
      checkAllotment: jest.fn(),
    };

    resolverMock = {
      resolveAdapter: jest.fn().mockResolvedValue({
        adapter: { defaultConcurrency: 5 },
        registrarIpoCode: '40580036070',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllotmentJobService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AllotmentService, useValue: allotmentServiceMock },
        { provide: RegistrarResolver, useValue: resolverMock },
      ],
    }).compile();

    jobService = module.get<AllotmentJobService>(AllotmentJobService);
  });

  it('1. should automatically load saved PANs for authenticated user when identifierValues omitted', async () => {
    const mockIpo = { id: 'ipo-1', name: 'Test IPO' };
    prismaMock.ipo.findUnique.mockResolvedValue(mockIpo);

    prismaMock.userSavedPan.findMany.mockResolvedValue([
      {
        id: 'sp-1',
        userId: 'user-A',
        panEncrypted: encryptPan('ABCDE1234F'),
        panMasked: 'ABCDE****F',
      },
      {
        id: 'sp-2',
        userId: 'user-A',
        panEncrypted: encryptPan('FGHIJ5678K'),
        panMasked: 'FGHIJ****K',
      },
    ]);

    const mockJobRecord = {
      id: 'job-user-A',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.QUEUED,
      totalChecks: 2,
      processedChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      items: [],
    };

    prismaMock.allotmentCheckJob.create.mockResolvedValue(mockJobRecord);
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue(mockJobRecord);

    const job = await jobService.createJob({ ipoId: 'ipo-1' }, 'user-A');

    expect(job).toBeDefined();
    expect(prismaMock.userSavedPan.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-A' },
    });
    expect(prismaMock.allotmentCheckJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-A',
          totalChecks: 2,
        }),
      }),
    );
  });

  it('2. should enforce user ownership and prevent User B from reading User A job', async () => {
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue({
      id: 'job-user-A',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.COMPLETED,
      totalChecks: 1,
      processedChecks: 1,
      successfulChecks: 1,
      failedChecks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });

    // User A reading own job -> Success
    const jobA = await jobService.getJob('job-user-A', 'user-A');
    expect(jobA.id).toBe('job-user-A');

    // User B trying to read User A job -> 404 Exception
    await expect(jobService.getJob('job-user-A', 'user-B')).rejects.toThrow(
      AppException,
    );
  });

  it('2b. should prevent User B from retrying User A job', async () => {
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue({
      id: 'job-user-A',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.COMPLETED_WITH_ERRORS,
      totalChecks: 2,
      processedChecks: 2,
      successfulChecks: 1,
      failedChecks: 1,
      items: [],
    });

    await expect(
      jobService.retryFailedItems('job-user-A', 'user-B'),
    ).rejects.toThrow(AppException);
  });

  it('14. should format progress message correctly ("Checking X of Y...")', async () => {
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue({
      id: 'job-1',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.RUNNING,
      totalChecks: 29,
      processedChecks: 14,
      successfulChecks: 14,
      failedChecks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: [],
    });

    const job = await jobService.getJob('job-1', 'user-A');
    expect(job.progressMessage).toBe('Checking 14 of 29...');
    expect(job.processedChecks).toBe(14);
    expect(job.totalChecks).toBe(29);
  });

  it('11 & 12. should handle partial PAN failures and set final status to COMPLETED_WITH_ERRORS', async () => {
    const mockIpo = { id: 'ipo-1', name: 'Test IPO' };
    prismaMock.ipo.findUnique.mockResolvedValue(mockIpo);

    const mockJobRecord = {
      id: 'job-100',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.QUEUED,
      totalChecks: 3,
      processedChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      items: [
        {
          id: 'item-1',
          identifierType: AllotmentIdentifierType.PAN,
          identifierHash: 'hash-1',
          maskedId: 'ABCDE****F',
        },
        {
          id: 'item-2',
          identifierType: AllotmentIdentifierType.PAN,
          identifierHash: 'hash-2',
          maskedId: 'FGHIJ****K',
        },
        {
          id: 'item-3',
          identifierType: AllotmentIdentifierType.PAN,
          identifierHash: 'hash-3',
          maskedId: 'LMNOP****Q',
        },
      ],
    };

    prismaMock.allotmentCheckJob.create.mockResolvedValue(mockJobRecord);
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue(mockJobRecord);

    allotmentServiceMock.checkAllotment
      .mockResolvedValueOnce({
        status: AllotmentStatus.ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 100,
      })
      .mockResolvedValueOnce({
        status: AllotmentStatus.NOT_ALLOTTED,
        sharesApplied: 100,
        sharesAllotted: 0,
      })
      .mockResolvedValueOnce({
        status: AllotmentStatus.SOURCE_UNAVAILABLE,
        errorMessage: '502 Bad Gateway',
      });

    const job = await jobService.createJob(
      {
        ipoId: 'ipo-1',
        identifierValues: ['ABCDE1234F', 'FGHIJ5678K', 'LMNOP9012Q'],
      },
      'user-A',
    );

    expect(job).toBeDefined();
    expect(prismaMock.allotmentCheckJob.create).toHaveBeenCalled();
  });

  it('13. should support retrying failed items only', async () => {
    prismaMock.allotmentCheckJob.findUnique.mockResolvedValue({
      id: 'job-200',
      userId: 'user-A',
      ipoId: 'ipo-1',
      status: AllotmentJobStatus.COMPLETED_WITH_ERRORS,
      totalChecks: 3,
      processedChecks: 3,
      successfulChecks: 2,
      failedChecks: 1,
      items: [
        {
          id: 'item-1',
          maskedId: 'ABCDE****F',
          identifierHash: 'hash-1',
          status: AllotmentResultStatus.ALLOTTED,
        },
        {
          id: 'item-2',
          maskedId: 'FGHIJ****K',
          identifierHash: 'hash-2',
          status: AllotmentResultStatus.NOT_ALLOTTED,
        },
        {
          id: 'item-3',
          maskedId: 'LMNOP****Q',
          identifierHash: 'hash-3',
          status: AllotmentResultStatus.SOURCE_UNAVAILABLE,
        },
      ],
    });

    const result = await jobService.retryFailedItems('job-200', 'user-A', {
      'LMNOP****Q': 'LMNOP9012Q',
    });

    expect(result).toBeDefined();
    expect(prismaMock.allotmentCheckJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-200' },
        data: expect.objectContaining({ status: AllotmentJobStatus.RUNNING }),
      }),
    );
  });
});
