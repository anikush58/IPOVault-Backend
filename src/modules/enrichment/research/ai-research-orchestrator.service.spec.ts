import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AiResearchOrchestratorService } from './ai-research-orchestrator.service';
import { AiResearchAgentService } from './ai-research-agent.service';
import { AiResearchReconciliationService } from './ai-research-reconciliation.service';
import { PrismaService } from '../../../database/prisma.service';
import {
  IpoReconciliationSummary,
  IpoResearchCandidates,
  ResearchedCandidateField,
} from './research.types';

describe('AiResearchOrchestratorService', () => {
  let service: AiResearchOrchestratorService;
  let mockPrisma: any;
  let mockAgent: any;
  let mockReconciler: any;

  const mockIpo = {
    id: 'ipo-orch-1',
    companyId: 'comp-orch-1',
    symbol: 'BETA',
    lotSize: 50,
    company: {
      id: 'comp-orch-1',
      displayName: 'Beta Systems',
      legalName: 'Beta Systems Limited',
    },
    lifecycleEvents: [],
    allotmentConfig: null,
  };

  const candidateLotSize: ResearchedCandidateField<number> = {
    fieldKey: 'lotSize',
    rawValue: 60,
    normalizedValue: 60,
    sourceUrl: 'https://www.nseindia.com/beta',
    sourceDomain: 'nseindia.com',
    sourceAuthority: 'TIER_1_STATUTORY',
    sourceName: 'NSE Official',
    evidence: 'Market lot 60',
    confidence: 0.98,
    retrievedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn().mockResolvedValue(mockIpo),
        update: jest.fn().mockResolvedValue({ ...mockIpo, lotSize: 60 }),
      },
      company: {
        update: jest.fn().mockResolvedValue(mockIpo.company),
      },
      fieldProvenance: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'prov-1' }),
      },
      ipoChangeEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      },
      ipoLifecycleEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'life-1' }),
      },
      allotmentConfiguration: {
        upsert: jest.fn().mockResolvedValue({ id: 'allot-1' }),
      },
      source: {
        findUnique: jest.fn().mockResolvedValue({ id: 'src-1', code: 'AI_RESEARCH_ENGINE' }),
        upsert: jest.fn().mockResolvedValue({ id: 'src-1', code: 'AI_RESEARCH_ENGINE' }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return await callback(mockPrisma);
      }),
    };

    mockAgent = {
      researchIpo: jest.fn().mockResolvedValue({
        lotSize: candidateLotSize,
      } as IpoResearchCandidates),
    };

    const mockSummary: IpoReconciliationSummary = {
      ipoId: 'ipo-orch-1',
      companyName: 'Beta Systems',
      fieldsEvaluated: 1,
      verifiedUpdatesCount: 1,
      unchangedCount: 0,
      conflictsCount: 0,
      unverifiableCount: 0,
      missingCount: 0,
      appliedCount: 1,
      skippedCount: 0,
      evaluatedAt: new Date().toISOString(),
      decisions: [
        {
          fieldKey: 'lotSize',
          fieldLabel: 'Lot Size',
          entityType: 'IPO',
          currentValue: 50,
          currentValueDisplay: '50',
          candidateValue: 60,
          candidateValueDisplay: '60',
          sourceUrl: 'https://www.nseindia.com/beta',
          sourceAuthority: 'TIER_1_STATUTORY',
          confidence: 0.98,
          evidence: 'Market lot 60',
          status: 'VERIFIED_UPDATE',
          statusReason: 'Verified update supported by TIER_1_STATUTORY',
          autoApply: true,
          applied: false,
        },
      ],
    };

    mockReconciler = {
      reconcile: jest.fn().mockReturnValue(mockSummary),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResearchOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiResearchAgentService, useValue: mockAgent },
        { provide: AiResearchReconciliationService, useValue: mockReconciler },
      ],
    }).compile();

    service = module.get<AiResearchOrchestratorService>(AiResearchOrchestratorService);
  });

  describe('startResearchJob & background deduplication', () => {
    it('should throw NotFoundException if IPO does not exist', async () => {
      mockPrisma.ipo.findUnique.mockResolvedValueOnce(null);

      await expect(service.startResearchJob('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should create and queue a new research job', async () => {
      const job = await service.startResearchJob('ipo-orch-1');

      expect(job).toBeDefined();
      expect(job.ipoId).toBe('ipo-orch-1');
      expect(job.companyName).toBe('Beta Systems');
      expect(['QUEUED', 'RUNNING', 'COMPLETED']).toContain(job.status);
    });

    it('should return existing running job if already active (deduplication)', async () => {
      const job1 = await service.startResearchJob('ipo-orch-1');
      const job2 = await service.startResearchJob('ipo-orch-1');

      // Both should reference the same job ID while active
      expect(job2.jobId).toBe(job1.jobId);
    });
  });

  describe('executeResearchNow (Transactional Updates & Audit)', () => {
    it('should execute research, apply verified updates in transaction, and record provenance and change events', async () => {
      const summary = await service.executeResearchNow('ipo-orch-1');

      expect(summary.verifiedUpdatesCount).toBe(1);
      expect(mockAgent.researchIpo).toHaveBeenCalledTimes(1);
      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);

      // Verify Prisma transaction was executed
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      // Verify IPO update with candidate value
      expect(mockPrisma.ipo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ipo-orch-1' },
          data: expect.objectContaining({ lotSize: 60 }),
        }),
      );

      // Verify field provenance recorded
      expect(mockPrisma.fieldProvenance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldName: 'lotSize',
            value: '60',
          }),
        }),
      );

      // Verify IPO change audit event recorded
      expect(mockPrisma.ipoChangeEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldName: 'lotSize',
            oldValue: '50',
            newValue: '60',
          }),
        }),
      );
    });

    it('should not update database if there are zero verified updates to apply', async () => {
      mockReconciler.reconcile.mockReturnValueOnce({
        ipoId: 'ipo-orch-1',
        companyName: 'Beta Systems',
        fieldsEvaluated: 1,
        verifiedUpdatesCount: 0,
        unchangedCount: 1,
        conflictsCount: 0,
        unverifiableCount: 0,
        missingCount: 0,
        appliedCount: 0,
        skippedCount: 1,
        evaluatedAt: new Date().toISOString(),
        decisions: [
          {
            fieldKey: 'lotSize',
            fieldLabel: 'Lot Size',
            entityType: 'IPO',
            currentValue: 50,
            currentValueDisplay: '50',
            candidateValue: 50,
            candidateValueDisplay: '50',
            status: 'UNCHANGED',
            statusReason: 'Current matches candidate',
            autoApply: false,
            applied: false,
          },
        ],
      });

      const summary = await service.executeResearchNow('ipo-orch-1');

      expect(summary.verifiedUpdatesCount).toBe(0);
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
      expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
      expect(mockPrisma.ipoChangeEvent.create).not.toHaveBeenCalled();
    });

    it('should mark job as FAILED and not apply updates when upstream AI research fails', async () => {
      mockAgent.researchIpo.mockResolvedValueOnce({
        diagnostics: {
          status: 'FAILED',
          diagnosticCode: 'API_RATE_LIMIT_EXCEEDED',
          errorMessage: 'Gemini API quota exceeded (HTTP 429)',
        },
      } as IpoResearchCandidates);

      mockReconciler.reconcile.mockReturnValueOnce({
        ipoId: 'ipo-orch-1',
        companyName: 'Beta Systems',
        fieldsEvaluated: 35,
        verifiedUpdatesCount: 0,
        unchangedCount: 0,
        conflictsCount: 0,
        unverifiableCount: 0,
        missingCount: 35,
        appliedCount: 0,
        skippedCount: 35,
        diagnosticCode: 'API_RATE_LIMIT_EXCEEDED',
        diagnosticMessage: 'Gemini API quota exceeded (HTTP 429)',
        evaluatedAt: new Date().toISOString(),
        decisions: [],
      });

      // executeResearchNow should throw because job.status === 'FAILED'
      await expect(service.executeResearchNow('ipo-orch-1')).rejects.toThrow(
        'Gemini API quota exceeded (HTTP 429)',
      );

      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
      expect(mockPrisma.fieldProvenance.create).not.toHaveBeenCalled();
    });
  });
});
