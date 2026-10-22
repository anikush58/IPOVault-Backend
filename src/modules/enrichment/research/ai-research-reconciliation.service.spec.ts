import { Test, TestingModule } from '@nestjs/testing';
import { AiResearchReconciliationService } from './ai-research-reconciliation.service';
import {
  IpoResearchCandidates,
  ResearchedCandidateField,
  SourceAuthorityTier,
} from './research.types';

describe('AiResearchReconciliationService', () => {
  let service: AiResearchReconciliationService;

  const createCandidate = <T>(
    key: string,
    val: T,
    sourceUrl: string,
    authorityTier: SourceAuthorityTier,
    evidence = 'Sample statutory evidence',
    confidence = 0.95,
  ): ResearchedCandidateField<T> => ({
    fieldKey: key,
    rawValue: val,
    normalizedValue: val,
    sourceUrl,
    sourceDomain: 'example.com',
    sourceAuthority: authorityTier,
    sourceName: 'Example Source',
    evidence,
    confidence,
    retrievedAt: new Date().toISOString(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiResearchReconciliationService],
    }).compile();

    service = module.get<AiResearchReconciliationService>(AiResearchReconciliationService);
  });

  describe('Reconciliation Decision Rules', () => {
    const baseIpo = {
      id: 'ipo-100',
      symbol: 'ALPHA',
      status: 'UPCOMING',
      marketSegment: 'MAINBOARD',
      exchange: 'BOTH',
      priceBandLow: 100,
      priceBandHigh: 108,
      lotSize: 130,
      minimumLots: 1,
      faceValue: 10,
      issueSize: 500,
      freshIssueSize: 400,
      ofsSize: 100,
      company: {
        id: 'comp-100',
        legalName: 'Alpha Tech Limited',
        displayName: 'Alpha Tech',
        cin: 'U72900MH2020PTC123456',
        website: 'https://alphatech.com',
      },
      lifecycleEvents: [
        { eventType: 'OPEN', eventDate: new Date('2026-04-01T00:00:00.000Z') },
        { eventType: 'CLOSE', eventDate: new Date('2026-04-03T00:00:00.000Z') },
      ],
      allotmentConfig: {
        registrarName: 'Link Intime India Private Limited',
      },
    };

    it('should classify identical values as UNCHANGED', () => {
      const candidates: IpoResearchCandidates = {
        legalName: createCandidate(
          'company.legalName',
          'Alpha Tech Limited',
          'https://www.nseindia.com/alpha',
          'TIER_1_STATUTORY',
        ),
        lotSize: createCandidate(
          'lotSize',
          130,
          'https://www.bseindia.com/alpha',
          'TIER_1_STATUTORY',
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, []);
      expect(summary.verifiedUpdatesCount).toBe(0);

      const lotDecision = summary.decisions.find((d) => d.fieldKey === 'lotSize');
      expect(lotDecision?.status).toBe('UNCHANGED');
      expect(lotDecision?.autoApply).toBe(false);

      const legalNameDecision = summary.decisions.find((d) => d.fieldKey === 'company.legalName');
      expect(legalNameDecision?.status).toBe('UNCHANGED');
      expect(legalNameDecision?.autoApply).toBe(false);
    });

    it('should classify missing fields with authoritative candidate as VERIFIED_UPDATE and autoApply', () => {
      const candidates: IpoResearchCandidates = {
        allotmentDate: createCandidate(
          'dates.allotmentDate',
          '2026-04-07',
          'https://www.bseindia.com/alpha',
          'TIER_1_STATUTORY',
        ),
        isin: createCandidate(
          'isin',
          'INE123A01019',
          'https://www.nseindia.com/alpha',
          'TIER_1_STATUTORY',
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, []);
      expect(summary.verifiedUpdatesCount).toBe(2);

      const isinDecision = summary.decisions.find((d) => d.fieldKey === 'isin');
      expect(isinDecision?.status).toBe('VERIFIED_UPDATE');
      expect(isinDecision?.autoApply).toBe(true);
      expect(isinDecision?.candidateValue).toBe('INE123A01019');

      const allotDecision = summary.decisions.find((d) => d.fieldKey === 'allotmentDate');
      expect(allotDecision?.status).toBe('VERIFIED_UPDATE');
      expect(allotDecision?.autoApply).toBe(true);
    });

    it('should NEVER overwrite ADMIN / MANUAL entries with secondary or automated sources', () => {
      // Simulate an existing provenance entry created by an Admin
      const existingProvenances = [
        {
          entityType: 'IPO',
          fieldName: 'priceBandHigh',
          source: { sourceType: 'ADMIN', code: 'ADMIN_MANUAL' },
          confidenceScore: 1.0,
        },
      ];

      const candidates: IpoResearchCandidates = {
        priceBandHigh: createCandidate(
          'priceBandHigh',
          120, // Candidate suggests 120 instead of manual 108
          'https://ipowatch.in/alpha',
          'TIER_4_SECONDARY',
          'Aggregator rumor on price band',
          0.8,
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, existingProvenances);
      const priceDecision = summary.decisions.find((d) => d.fieldKey === 'priceBandHigh');

      expect(priceDecision).toBeDefined();
      expect(priceDecision?.status).toBe('PROTECTED');
      expect(priceDecision?.autoApply).toBe(false);
      expect(priceDecision?.statusReason).toContain('Protected by Manual/Admin entry');
    });

    it('should reject secondary sources (TIER_4_SECONDARY) when attempting to change existing official data', () => {
      const existingProvenances = [
        {
          entityType: 'IPO',
          fieldName: 'lotSize',
          source: { sourceType: 'EXCHANGE', code: 'NSE' },
          priority: 2,
        },
      ];

      const candidates: IpoResearchCandidates = {
        lotSize: createCandidate(
          'lotSize',
          150,
          'https://www.chittorgarh.com/alpha',
          'TIER_4_SECONDARY',
          'Lot size claimed to be 150',
          0.7,
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, existingProvenances);
      const lotDecision = summary.decisions.find((d) => d.fieldKey === 'lotSize');

      expect(lotDecision?.status).toBe('PROTECTED');
      expect(lotDecision?.autoApply).toBe(false);
      expect(lotDecision?.statusReason).toContain('Secondary candidate cannot overwrite');
    });

    it('should mark invalid/unparseable candidate values on missing fields as MISSING_VALUE with NORMALIZATION_FAILED', () => {
      // openDate is present in baseIpo lifecycleEvents, test on isin which is missing in baseIpo
      const candidates: IpoResearchCandidates = {
        isin: createCandidate(
          'isin',
          'invalid-isin-format',
          'https://someforum.com/alpha',
          'TIER_4_SECONDARY',
          'Discussion post with no clear isin',
          0.3,
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, []);
      const isinDecision = summary.decisions.find((d) => d.fieldKey === 'isin');

      expect(isinDecision?.status).toBe('MISSING_VALUE');
      expect(isinDecision?.diagnosticCode).toBe('NORMALIZATION_FAILED');
      expect(isinDecision?.autoApply).toBe(false);
      expect(isinDecision?.statusReason).toContain('could not be normalized');
    });

    it('should record informative diagnostics and skip reasons when upstream research failed', () => {
      const candidates: IpoResearchCandidates = {
        diagnostics: {
          status: 'FAILED',
          diagnosticCode: 'API_RATE_LIMIT_EXCEEDED',
          errorMessage: 'Gemini API quota exceeded (HTTP 429)',
        },
      };

      const summary = service.reconcile(baseIpo, candidates, []);

      expect(summary.fieldsEvaluated).toBe(35);
      expect(summary.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
      expect(summary.diagnosticMessage).toBe('Gemini API quota exceeded (HTTP 429)');
      expect(summary.verifiedUpdatesCount).toBe(0);

      // Verify each decision explains upstream failure and is marked SKIPPED
      for (const d of summary.decisions) {
        expect(d.status).toBe('SKIPPED');
        expect(d.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
        expect(d.statusReason).toContain('Research skipped: Upstream AI search failed');
        expect(d.candidateValueDisplay).toBe('(Skipped)');
      }
    });

    it('should preserve valid existing DB values as UNCHANGED when sources return no candidate', () => {
      const candidates: IpoResearchCandidates = {
        diagnostics: {
          status: 'SUCCESS',
          diagnosticCode: 'SUCCESS',
        },
        lotSize: createCandidate('lotSize', 130, 'https://www.nseindia.com', 'TIER_1_STATUTORY'),
      };

      const summary = service.reconcile(baseIpo, candidates, []);
      const cinDecision = summary.decisions.find((d) => d.fieldKey === 'company.cin');

      // company.cin is already present in baseIpo ('U72900MH2020PTC123456'), so it MUST be preserved!
      expect(cinDecision?.status).toBe('UNCHANGED');
      expect(cinDecision?.candidateValueDisplay).toBe('(Current Value Preserved)');
      expect(cinDecision?.diagnosticCode).toBe('DATABASE_VALUE_PRESERVED');
      expect(cinDecision?.statusReason).toContain('Current database value is verified');
    });

    it('should mark genuinely missing DB fields as FIELD_NOT_REPORTED_BY_SOURCES on successful research', () => {
      const ipoWithoutCin = {
        ...baseIpo,
        company: {
          ...baseIpo.company,
          cin: null,
        },
      };

      const candidates: IpoResearchCandidates = {
        diagnostics: {
          status: 'SUCCESS',
          diagnosticCode: 'SUCCESS',
        },
        lotSize: createCandidate('lotSize', 130, 'https://www.nseindia.com', 'TIER_1_STATUTORY'),
      };

      const summary = service.reconcile(ipoWithoutCin, candidates, []);
      const cinDecision = summary.decisions.find((d) => d.fieldKey === 'company.cin');

      expect(cinDecision?.status).toBe('MISSING_VALUE');
      expect(cinDecision?.diagnosticCode).toBe('FIELD_NOT_REPORTED_BY_SOURCES');
      expect(cinDecision?.statusReason).toContain('Field is missing in database');
    });

    it('should classify secondary source rejection with UNTRUSTED_SECONDARY_SOURCE diagnostic code', () => {
      const candidates: IpoResearchCandidates = {
        sector: createCandidate(
          'company.sector',
          'Technology',
          'https://unverified-blog.com/ipo',
          'TIER_4_SECONDARY',
          'Random blog post',
          0.8,
        ),
      };

      const summary = service.reconcile(baseIpo, candidates, []);
      const sectorDecision = summary.decisions.find((d) => d.fieldKey === 'company.sector');

      expect(sectorDecision?.status).toBe('UNVERIFIABLE');
      expect(sectorDecision?.diagnosticCode).toBe('UNTRUSTED_SECONDARY_SOURCE');
      expect(sectorDecision?.statusReason).toContain('secondary or unverified');
    });
  });

  describe('Field Normalizations', () => {
    it('should normalize MarketSegment string values', () => {
      expect(service.normalizeMarketSegment('Main Board')).toBe('MAINBOARD');
      expect(service.normalizeMarketSegment('sme')).toBe('SME');
      expect(service.normalizeMarketSegment('MAINBOARD')).toBe('MAINBOARD');
      expect(service.normalizeMarketSegment('Unknown Segment')).toBeNull();
    });

    it('should normalize ExchangeListing enum values', () => {
      expect(service.normalizeExchange('NSE, BSE')).toBe('BOTH');
      expect(service.normalizeExchange('NSE & BSE')).toBe('BOTH');
      expect(service.normalizeExchange('NSE')).toBe('NSE');
      expect(service.normalizeExchange('BSE')).toBe('BSE');
      expect(service.normalizeExchange('UNKNOWN')).toBeNull();
    });

    it('should normalize numeric and currency values', () => {
      expect(service.normalizeNumber('₹ 1,250.50')).toBe(1250.5);
      expect(service.normalizeNumber(500)).toBe(500);
      expect(service.normalizeNumber('N/A')).toBeNull();
    });

    it('should normalize percentage values within [0, 100]', () => {
      expect(service.normalizePercentage('18.5%')).toBe(18.5);
      expect(service.normalizePercentage(75)).toBe(75);
      expect(service.normalizePercentage(150)).toBe(100); // Clamped
      expect(service.normalizePercentage(-5)).toBe(0); // Clamped
    });

    it('should normalize date strings to YYYY-MM-DD', () => {
      const parsed = service.normalizeDate('2026-05-15');
      expect(parsed).toBe('2026-05-15');

      expect(service.normalizeDate('invalid-date')).toBeNull();
    });

    it('should normalize Corporate Identity Numbers (CIN)', () => {
      expect(service.normalizeCin('  u72900mh2020ptc123456  ')).toBe('U72900MH2020PTC123456');
      expect(service.normalizeCin('invalid-cin')).toBeNull();
    });
  });
});
