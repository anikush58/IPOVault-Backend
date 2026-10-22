import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiResearchAgentService } from './ai-research-agent.service';
import { AiResearchReconciliationService } from './ai-research-reconciliation.service';
import { AiResearchOrchestratorService } from './ai-research-orchestrator.service';
import { PrismaService } from '../../../database/prisma.service';

describe('SFC Environmental Technologies AI Research Reproduction & Regression', () => {
  let agentService: AiResearchAgentService;
  let reconcilerService: AiResearchReconciliationService;
  let orchestratorService: AiResearchOrchestratorService;
  let mockPrisma: any;

  const mockSfcIpo = {
    id: 'ipo-sfc-env-001',
    companyId: 'comp-sfc-001',
    symbol: 'SFCENV',
    marketSegment: 'MAINBOARD',
    exchange: 'BSE',
    status: 'UPCOMING',
    priceBandLow: null,
    priceBandHigh: null,
    lotSize: null,
    faceValue: 10,
    issueSize: null,
    freshIssueSize: null,
    ofsSize: null,
    issueShareCount: null,
    freshIssueShareCount: null,
    ofsShareCount: null,
    listingPrice: null,
    listingGainPct: null,
    preIpoPe: null,
    postIpoPe: null,
    preIpoPromoterHolding: null,
    postIpoPromoterHolding: null,
    company: {
      id: 'comp-sfc-001',
      legalName: 'SFC Environmental Technologies Limited',
      displayName: 'SFC Environmental Technologies',
      cin: null,
      website: 'https://www.sfcenv.com',
      aboutDescription: null,
      sector: 'Environment & Waste Management',
      industry: 'Water Treatment',
    },
    lifecycleEvents: [],
    allotmentConfig: {
      registrar: null,
      registrarIpoCode: null,
    },
    participants: [],
    documents: [],
  };

  beforeEach(async () => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn().mockResolvedValue(mockSfcIpo),
        update: jest.fn().mockResolvedValue(mockSfcIpo),
      },
      company: {
        update: jest.fn().mockResolvedValue(mockSfcIpo.company),
      },
      fieldProvenance: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'prov-sfc-1' }),
      },
      ipoChangeEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-sfc-1' }),
      },
      ipoLifecycleEvent: {
        upsert: jest.fn().mockResolvedValue({ id: 'life-sfc-1' }),
      },
      ipoAllotmentConfig: {
        upsert: jest.fn().mockResolvedValue({ id: 'allot-sfc-1' }),
      },
      source: {
        findUnique: jest.fn().mockResolvedValue({ id: 'src-ai', code: 'AI_RESEARCH_ENGINE' }),
        upsert: jest.fn().mockResolvedValue({ id: 'src-ai', code: 'AI_RESEARCH_ENGINE' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb) => cb(mockPrisma)),
    };

    const mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResearchAgentService,
        AiResearchReconciliationService,
        AiResearchOrchestratorService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    agentService = module.get<AiResearchAgentService>(AiResearchAgentService);
    reconcilerService = module.get<AiResearchReconciliationService>(AiResearchReconciliationService);
    orchestratorService = module.get<AiResearchOrchestratorService>(AiResearchOrchestratorService);
  });

  describe('Reproduction: Upstream Model / Quota Failure (Root Cause of 35 Missing)', () => {
    it('reproduces the failure where Gemini returns HTTP 429 quota exhaustion and reports explicit FAILED job status', async () => {
      // Simulate Gemini API returning HTTP 429 (exceeded current quota)
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 429,
              message:
                'You exceeded your current quota, please check your plan and billing details.',
              status: 'RESOURCE_EXHAUSTED',
            },
          }),
        ),
      });

      // 1. Agent execution
      const candidates = await agentService.researchIpo(mockSfcIpo, {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      // Verify diagnostics captured upstream failure
      expect(candidates.diagnostics?.status).toBe('FAILED');
      expect(candidates.diagnostics?.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
      expect(candidates.diagnostics?.errorMessage).toContain('429');

      // 2. Reconciliation execution
      const summary = reconcilerService.reconcile(mockSfcIpo, candidates, []);

      // Verify all 35 fields evaluated
      expect(summary.fieldsEvaluated).toBe(35);
      expect(summary.verifiedUpdatesCount).toBe(0);
      expect(summary.unchangedCount).toBe(0);
      expect(summary.conflictsCount).toBe(0);
      expect(summary.missingCount).toBe(35);
      expect(summary.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');

      // Verify each field decision explains WHY it was skipped
      for (const decision of summary.decisions) {
        expect(decision.status).toBe('MISSING_VALUE');
        expect(decision.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
        expect(decision.statusReason).toContain('Research skipped: Upstream AI search failed');
        expect(decision.candidateValueDisplay).toBe('(Skipped)');
      }

      // 3. Orchestration execution (Verify job is marked FAILED, NOT falsely COMPLETED)
      const job = await orchestratorService.startResearchJob('ipo-sfc-env-001', {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      while (job.status === 'QUEUED' || job.status === 'RUNNING') {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(job.status).toBe('FAILED');
      expect(job.error).toContain('429');
      expect(job.progressMessage).toContain('Research failed upstream');
      expect(mockPrisma.ipo.update).not.toHaveBeenCalled();
    });

    it('reproduces deprecated model 404 falling back gracefully or failing with MODEL_NOT_AVAILABLE', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue(
          JSON.stringify({
            error: {
              code: 404,
              message: 'This model models/gemini-2.5-flash is no longer available.',
              status: 'NOT_FOUND',
            },
          }),
        ),
      });

      const candidates = await agentService.researchIpo(mockSfcIpo, {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      expect(candidates.diagnostics?.status).toBe('FAILED');
      expect(candidates.diagnostics?.diagnosticCode).toBe('MODEL_NOT_AVAILABLE');
    });
  });

  describe('Success Regression: Live Grounded Research with Official Evidence', () => {
    it('successfully extracts grounded candidate fields from BSE & Link Intime and autoApplies verified updates', async () => {
      const mockSuccessfulGrounding = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    company: {
                      legalName: {
                        value: 'SFC Environmental Technologies Limited',
                        sourceUrl: 'https://www.bseindia.com/stock-share-price/sfc/543210/',
                        evidence: 'BSE statutory listing record',
                        confidence: 0.98,
                      },
                      cin: {
                        value: 'U74140MH2005PLC154832',
                        sourceUrl: 'https://www.mca.gov.in/mcafoportal/companyMasterData.do',
                        evidence: 'MCA official company master record',
                        confidence: 0.99,
                      },
                    },
                    pricingAndIssue: {
                      priceBandLow: {
                        value: 195,
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Floor price Rs 195 per share',
                        confidence: 0.98,
                      },
                      priceBandHigh: {
                        value: 205,
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Cap price Rs 205 per share',
                        confidence: 0.98,
                      },
                      lotSize: {
                        value: 70,
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Bid lot 70 equity shares',
                        confidence: 0.98,
                      },
                      issueSize: {
                        value: 125.5,
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Aggregate issue size Rs 125.50 Cr',
                        confidence: 0.95,
                      },
                    },
                    dates: {
                      openDate: {
                        value: '2026-06-01',
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Issue open date June 1, 2026',
                        confidence: 0.95,
                      },
                      closeDate: {
                        value: '2026-06-03',
                        sourceUrl: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                        evidence: 'Issue close date June 3, 2026',
                        confidence: 0.95,
                      },
                    },
                    allotmentAndRegistrar: {
                      registrarName: {
                        value: 'Link Intime India Private Limited',
                        sourceUrl: 'https://linkintime.co.in/initial_offer/public-issues.html',
                        evidence: 'Registrar to the issue Link Intime India',
                        confidence: 0.99,
                      },
                    },
                  }),
                },
              ],
            },
            groundingMetadata: {
              webSearchQueries: ['SFC Environmental Technologies IPO RHP BSE'],
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.bseindia.com/markets/publicIssues/sfc.aspx',
                    title: 'BSE IPO Disclosures',
                  },
                },
              ],
            },
          },
        ],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockSuccessfulGrounding)),
        json: jest.fn().mockResolvedValue(mockSuccessfulGrounding),
      });

      const summary = await orchestratorService.executeResearchNow('ipo-sfc-env-001', {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      expect(summary.verifiedUpdatesCount).toBeGreaterThan(0);

      // Verify price band and lot size were verified and applied
      const lotDecision = summary.decisions.find((d) => d.fieldKey === 'lotSize');
      expect(lotDecision?.status).toBe('VERIFIED_UPDATE');
      expect(lotDecision?.candidateValue).toBe(70);
      expect(lotDecision?.applied).toBe(true);
      expect(lotDecision?.sourceAuthority).toBe('TIER_1_STATUTORY');

      // Verify MCA CIN was verified as Tier 1 Statutory
      const cinDecision = summary.decisions.find((d) => d.fieldKey === 'company.cin');
      expect(cinDecision?.status).toBe('VERIFIED_UPDATE');
      expect(cinDecision?.candidateValue).toBe('U74140MH2005PLC154832');
      expect(cinDecision?.sourceAuthority).toBe('TIER_1_STATUTORY');

      // Verify Registrar was recognized as Tier 2 Registrar
      const regDecision = summary.decisions.find((d) => d.fieldKey === 'registrarName');
      expect(regDecision?.status).toBe('VERIFIED_UPDATE');
      expect(regDecision?.sourceAuthority).toBe('TIER_2_REGISTRAR');

      // Verify Prisma transaction occurred
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.fieldProvenance.create).toHaveBeenCalled();
    });

    it('protects admin manually entered fields from automated overwrite during research', async () => {
      // Simulate Admin entry for priceBandHigh
      mockPrisma.fieldProvenance.findMany.mockResolvedValueOnce([
        {
          entityType: 'IPO',
          fieldName: 'priceBandHigh',
          source: { sourceType: 'ADMIN', code: 'ADMIN_MANUAL' },
          confidenceScore: 1.0,
        },
      ]);

      const mockWithDifferentPrice = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    pricingAndIssue: {
                      priceBandHigh: {
                        value: 220,
                        sourceUrl: 'https://www.bseindia.com/markets/sfc.aspx',
                        evidence: 'Revision notice Rs 220',
                        confidence: 0.95,
                      },
                    },
                  }),
                },
              ],
            },
          },
        ],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockWithDifferentPrice)),
        json: jest.fn().mockResolvedValue(mockWithDifferentPrice),
      });

      const summary = await orchestratorService.executeResearchNow('ipo-sfc-env-001', {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      const priceHighDecision = summary.decisions.find((d) => d.fieldKey === 'priceBandHigh');
      expect(priceHighDecision?.status).toBe('CONFLICTING_SOURCES');
      expect(priceHighDecision?.diagnosticCode).toBe('CONFLICTS_WITH_ADMIN_LOCK');
      expect(priceHighDecision?.autoApply).toBe(false);
      expect(priceHighDecision?.applied).toBe(false);
      expect(priceHighDecision?.statusReason).toContain('Protected by Manual/Admin entry');
    });
  });
});
