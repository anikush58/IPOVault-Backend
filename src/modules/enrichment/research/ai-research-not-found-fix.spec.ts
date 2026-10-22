import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiResearchAgentService } from './ai-research-agent.service';
import { AiResearchReconciliationService } from './ai-research-reconciliation.service';
import { AiResearchOrchestratorService } from './ai-research-orchestrator.service';
import { PrismaService } from '../../../database/prisma.service';
import {
  IpoResearchCandidates,
} from './research.types';

describe('AI Research & Reconciliation Production-Readiness Regression Tests', () => {
  let agentService: AiResearchAgentService;
  let reconcilerService: AiResearchReconciliationService;
  let orchestratorService: AiResearchOrchestratorService;
  let mockPrisma: any;

  const mockJioIpo = {
    id: 'a69cdbdb-fe22-4261-aec0-2cc5ff65a755',
    companyId: 'b40c46c6-a5f6-4ad8-a6f1-010b709389a2',
    symbol: null,
    nseSymbol: null,
    bseSymbol: null,
    status: 'OPEN',
    marketSegment: 'MAINBOARD',
    exchange: 'BOTH',
    priceBandLow: 1065,
    priceBandHigh: 1119,
    lotSize: 12,
    issueSize: 30213,
    freshIssueSize: 30187.65,
    ofsSize: 0,
    preIpoPe: 33.28,
    postIpoPe: 33.19,
    preIpoPromoterHolding: 66.43,
    postIpoPromoterHolding: 64.48,
    faceValue: null,
    isin: null,
    company: {
      id: 'b40c46c6-a5f6-4ad8-a6f1-010b709389a2',
      legalName: 'Jio Platforms Limited',
      displayName: 'Jio Platforms',
      cin: 'U72900GJ2019PLC110816',
      website: null,
      sector: 'Telecommunications and digital services',
      industry: 'Telecom, digital platforms and technology services',
      aboutDescription: 'Jio Platforms Limited is a technology-based digital connectivity...',
    },
    lifecycleEvents: [],
    allotmentConfig: null,
    participants: [],
    documents: [],
  };

  const existingProvenances = [
    {
      entityType: 'COMPANY',
      fieldName: 'company.legal_name',
      source: { code: 'IPOGURU', name: 'IPO Guru v2', sourceType: 'SECONDARY' },
      priority: 3,
    },
    {
      entityType: 'COMPANY',
      fieldName: 'company.display_name',
      source: { code: 'IPOGURU', name: 'IPO Guru v2', sourceType: 'SECONDARY' },
      priority: 3,
    },
    {
      entityType: 'IPO',
      fieldName: 'issue_size',
      source: { code: 'ADMIN', name: 'Admin Manual Review', sourceType: 'MANUAL' },
      priority: 1,
    },
  ];

  beforeEach(async () => {
    mockPrisma = {
      ipo: {
        findUnique: jest.fn().mockResolvedValue(mockJioIpo),
        update: jest.fn().mockResolvedValue(mockJioIpo),
      },
      company: {
        update: jest.fn().mockResolvedValue(mockJioIpo.company),
      },
      fieldProvenance: {
        findMany: jest.fn().mockResolvedValue(existingProvenances),
        create: jest.fn().mockResolvedValue({ id: 'prov-new-1' }),
      },
      ipoChangeEvent: {
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      },
      source: {
        findUnique: jest.fn().mockResolvedValue({ id: 'src-1', code: 'AI_RESEARCH_ENGINE' }),
        upsert: jest.fn().mockResolvedValue({ id: 'src-1', code: 'AI_RESEARCH_ENGINE' }),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => callback(mockPrisma)),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'GEMINI_API_KEY') return 'test-gemini-key-secret-123';
        if (key === 'GEMINI_MODEL') return 'gemini-3.8-flash';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResearchAgentService,
        AiResearchReconciliationService,
        AiResearchOrchestratorService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    agentService = module.get<AiResearchAgentService>(AiResearchAgentService);
    reconcilerService = module.get<AiResearchReconciliationService>(AiResearchReconciliationService);
    orchestratorService = module.get<AiResearchOrchestratorService>(AiResearchOrchestratorService);
  });

  describe('1. Existing Valid Values Classification (Fixing 100% Not Found)', () => {
    it('does NOT classify existing valid values (legalName, displayName, cin) as MISSING_VALUE when research returns empty candidates', () => {
      // Empty research candidates (e.g. provider returned no new fields)
      const emptyCandidates: IpoResearchCandidates = {
        diagnostics: {
          status: 'SUCCESS',
          diagnosticCode: 'SUCCESS',
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, emptyCandidates, existingProvenances);

      // Verify legalName is preserved as UNCHANGED, NOT marked MISSING_VALUE or (Not Found)
      const legalNameDecision = summary.decisions.find((d) => d.fieldKey === 'company.legalName');
      expect(legalNameDecision).toBeDefined();
      expect(legalNameDecision?.status).toBe('UNCHANGED');
      expect(legalNameDecision?.currentValueDisplay).toBe('Jio Platforms Limited');
      expect(legalNameDecision?.candidateValueDisplay).toBe('(Current Value Preserved)');
      expect(legalNameDecision?.statusReason).toContain('Current database value is verified');
      expect(legalNameDecision?.autoApply).toBe(false);

      // Verify CIN is preserved as UNCHANGED
      const cinDecision = summary.decisions.find((d) => d.fieldKey === 'company.cin');
      expect(cinDecision?.status).toBe('UNCHANGED');
      expect(cinDecision?.currentValueDisplay).toBe('U72900GJ2019PLC110816');
      expect(cinDecision?.candidateValueDisplay).toBe('(Current Value Preserved)');

      // Verify price bands are preserved as UNCHANGED
      const priceBandLowDecision = summary.decisions.find((d) => d.fieldKey === 'priceBandLow');
      expect(priceBandLowDecision?.status).toBe('UNCHANGED');
      expect(priceBandLowDecision?.currentValueDisplay).toBe('1065');

      // Genuinely missing fields in DB (e.g. isin, website, faceValue) should be MISSING_VALUE
      const isinDecision = summary.decisions.find((d) => d.fieldKey === 'isin');
      expect(isinDecision?.status).toBe('MISSING_VALUE');
      expect(isinDecision?.candidateValueDisplay).toBe('(Not Found)');
      expect(isinDecision?.diagnosticCode).toBe('FIELD_NOT_REPORTED_BY_SOURCES');

      // Summary counts verify that existing valid fields are NOT lumped into Unverifiable / Skipped
      expect(summary.unchangedCount).toBeGreaterThan(10);
      expect(summary.missingCount).toBeLessThan(25);
      expect(summary.verifiedUpdatesCount).toBe(0);
    });

    it('displays existing provenance details instead of (None) under source & evidence for database values', () => {
      const emptyCandidates: IpoResearchCandidates = {
        diagnostics: { status: 'SUCCESS' },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, emptyCandidates, existingProvenances);
      const legalNameDecision = summary.decisions.find((d) => d.fieldKey === 'company.legalName');

      // Existing provenance was registered under snake_case 'company.legal_name'
      expect(legalNameDecision?.existingProvenance).toBeDefined();
      expect(legalNameDecision?.existingProvenance?.sourceCode).toBe('IPOGURU');
      expect(legalNameDecision?.evidence).toContain('Recorded in database via');
    });
  });

  describe('2. Company Identity Matching (Legal Name & CIN)', () => {
    it('recognizes company legal name variations as equivalent without false update or conflict', () => {
      // Candidate has "Jio Platforms Ltd." instead of "Jio Platforms Limited"
      const candidates: IpoResearchCandidates = {
        legalName: {
          fieldKey: 'company.legalName',
          rawValue: 'Jio Platforms Ltd.',
          normalizedValue: 'Jio Platforms Ltd.',
          sourceUrl: 'https://www.bseindia.com/jio',
          sourceDomain: 'bseindia.com',
          sourceAuthority: 'TIER_1_STATUTORY',
          evidence: 'BSE notice for Jio Platforms Ltd.',
          confidence: 0.98,
          retrievedAt: new Date().toISOString(),
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, candidates, existingProvenances);
      const legalNameDecision = summary.decisions.find((d) => d.fieldKey === 'company.legalName');

      expect(legalNameDecision?.status).toBe('UNCHANGED');
      expect(legalNameDecision?.statusReason).toContain('Current database value matches researched candidate');
      expect(legalNameDecision?.autoApply).toBe(false);
    });

    it('recognizes formatted/spaced CIN as equivalent without false conflict', () => {
      const candidates: IpoResearchCandidates = {
        cin: {
          fieldKey: 'company.cin',
          rawValue: 'U72900 GJ 2019 PLC 110816', // with internal spaces
          normalizedValue: 'U72900GJ2019PLC110816',
          sourceUrl: 'https://www.mca.gov.in',
          sourceDomain: 'mca.gov.in',
          sourceAuthority: 'TIER_1_STATUTORY',
          evidence: 'MCA record CIN: U72900 GJ 2019 PLC 110816',
          confidence: 0.99,
          retrievedAt: new Date().toISOString(),
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, candidates, existingProvenances);
      const cinDecision = summary.decisions.find((d) => d.fieldKey === 'company.cin');

      expect(cinDecision?.status).toBe('UNCHANGED');
      expect(cinDecision?.autoApply).toBe(false);
    });
  });

  describe('3. Protected Entries & Precedence Rules', () => {
    it('protects Admin Manual entries from being overwritten by automated candidates', () => {
      // Candidate suggests an issueSize of 35000 Cr, but issueSize has an ADMIN manual entry
      const candidates: IpoResearchCandidates = {
        issueSize: {
          fieldKey: 'issueSize',
          rawValue: 35000,
          normalizedValue: 35000,
          sourceUrl: 'https://www.nseindia.com/jio',
          sourceDomain: 'nseindia.com',
          sourceAuthority: 'TIER_1_STATUTORY',
          evidence: 'NSE press release stating 35,000 Cr',
          confidence: 0.95,
          retrievedAt: new Date().toISOString(),
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, candidates, existingProvenances);
      const issueSizeDecision = summary.decisions.find((d) => d.fieldKey === 'issueSize');

      expect(issueSizeDecision?.status).toBe('PROTECTED');
      expect(issueSizeDecision?.diagnosticCode).toBe('CONFLICTS_WITH_ADMIN_LOCK');
      expect(issueSizeDecision?.autoApply).toBe(false);
      expect(issueSizeDecision?.statusReason).toContain('Protected by Manual/Admin entry');
    });

    it('applies authoritative candidate for previously missing field', () => {
      // isin is missing in mockJioIpo
      const candidates: IpoResearchCandidates = {
        isin: {
          fieldKey: 'isin',
          rawValue: 'INE123J01015',
          normalizedValue: 'INE123J01015',
          sourceUrl: 'https://www.nseindia.com/jio',
          sourceDomain: 'nseindia.com',
          sourceAuthority: 'TIER_1_STATUTORY',
          sourceName: 'NSE Official',
          evidence: 'ISIN INE123J01015 assigned for equity shares',
          confidence: 0.99,
          retrievedAt: new Date().toISOString(),
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, candidates, existingProvenances);
      const isinDecision = summary.decisions.find((d) => d.fieldKey === 'isin');

      expect(isinDecision?.status).toBe('VERIFIED_UPDATE');
      expect(isinDecision?.autoApply).toBe(true);
      expect(isinDecision?.candidateValue).toBe('INE123J01015');
      expect(summary.verifiedUpdatesCount).toBe(1);
    });
  });

  describe('4. Upstream Provider Failure & Diagnostic Sanitization', () => {
    it('marks all fields as SKIPPED and preserves DB values when Gemini hits 429 quota exhaustion', () => {
      const candidatesWith429: IpoResearchCandidates = {
        diagnostics: {
          status: 'FAILED',
          diagnosticCode: 'API_RATE_LIMIT_EXCEEDED',
          errorMessage: 'Gemini API rate limit or quota exceeded (HTTP 429) on model gemini-3.8-flash',
        },
      };

      const summary = reconcilerService.reconcile(mockJioIpo, candidatesWith429, existingProvenances);

      expect(summary.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
      expect(summary.skippedCount).toBe(35);
      expect(summary.verifiedUpdatesCount).toBe(0);

      // Verify that every decision is SKIPPED, NOT misclassified as MISSING_VALUE
      for (const d of summary.decisions) {
        expect(d.status).toBe('SKIPPED');
        expect(d.candidateValueDisplay).toBe('(Skipped)');
        expect(d.statusReason).toContain('Research skipped: Upstream AI search failed');
      }
    });

    it('sanitizes API keys and sensitive tokens from error messages', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Invalid request at endpoint?key=test-gemini-key-secret-123 failed'),
      });

      const result = await agentService.researchIpo(mockJioIpo, {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      expect(result.diagnostics?.status).toBe('FAILED');
      // The API key MUST be sanitized and never leaked
      expect(result.diagnostics?.errorMessage).not.toContain('test-gemini-key-secret-123');
      expect(result.diagnostics?.errorMessage).toContain('key=***');
    });

    it('builds research prompt containing CIN and legal name for targeted Indian market searches', () => {
      const prompt = agentService.buildResearchPrompt(mockJioIpo, ['isin', 'website']);
      expect(prompt).toContain('Corporate Identity Number (CIN): U72900GJ2019PLC110816');
      expect(prompt).toContain('Company Legal Name: Jio Platforms Limited');
      expect(prompt).toContain('Company Display Name: Jio Platforms');
      expect(prompt).toContain('GENUINELY MISSING FIELDS REQUIRING DISCOVERY: isin, website');
    });
  });

  describe('5. Orchestrator End-to-End Execution Flow', () => {
    it('executes research and records accurate summary counts without crashing', async () => {
      // Mock agentService.researchIpo directly for this test
      jest.spyOn(agentService, 'researchIpo').mockResolvedValue({
        diagnostics: {
          status: 'SUCCESS',
          diagnosticCode: 'SUCCESS',
          groundingSourcesCount: 1,
        },
      });

      const summary = await orchestratorService.executeResearchNow(mockJioIpo.id);

      expect(summary).toBeDefined();
      expect(summary.ipoId).toBe(mockJioIpo.id);
      expect(summary.fieldsInspected).toBe(35);
      expect(summary.valuesUnchangedCount).toBeGreaterThan(10);
      expect(summary.decisions.length).toBe(35);
    });
  });
});
