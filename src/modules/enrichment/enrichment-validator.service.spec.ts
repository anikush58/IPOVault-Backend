import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentValidatorService } from './enrichment-validator.service';
import { AiExtractedIpoData } from './enrichment.types';

describe('EnrichmentValidatorService', () => {
  let service: EnrichmentValidatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EnrichmentValidatorService],
    }).compile();

    service = module.get<EnrichmentValidatorService>(EnrichmentValidatorService);
  });

  describe('CAGR Calculation', () => {
    it('should accurately calculate 2-year CAGR (across 3 fiscal years)', () => {
      // 100 to 200 over 2 periods: (200/100)^(1/2) - 1 = 1.4142 - 1 = 41.42%
      const cagr = service.calculateCagr(100, 200, 2);
      expect(cagr).toBeCloseTo(41.42, 1);
    });

    it('should return null when start value <= 0 or years <= 0', () => {
      expect(service.calculateCagr(0, 100, 3)).toBeNull();
      expect(service.calculateCagr(-50, 100, 3)).toBeNull();
      expect(service.calculateCagr(100, 200, 0)).toBeNull();
      expect(service.calculateCagr(100, -50, 3)).toBeNull();
    });
  });

  describe('Validation & Calculation of AI Output', () => {
    it('should validate and compute CAGRs for valid financial output', () => {
      const rawAi: AiExtractedIpoData = {
        aboutDescription: '   Leading digital payment platform.   ',
        industry: 'FinTech',
        sector: 'Financial Services',
        strengths: ['Large merchant network', 'High market share'],
        risks: ['Regulatory changes', 'Cybersecurity threats'],
        preIpoPe: 35.5,
        postIpoPe: 42.0,
        preIpoPromoterHolding: 78.5,
        postIpoPromoterHolding: 62.0,
        freshIssueShareCount: 15000000,
        ofsShareCount: 5000000,
        freshIssueSize: 300,
        ofsSize: 100,
        leadManagers: ['Kotak Mahindra Capital', 'Morgan Stanley India'],
        anchorDetails: {
          portion: 120,
          details: 'Allotted to marquee FIIs and DIIs',
        },
        financials: [
          {
            fiscalPeriod: 'FY2024',
            periodType: 'ANNUAL',
            totalRevenue: 1000,
            ebitda: 250,
            pat: 150,
            netWorth: 800,
            totalAssets: 1500,
          },
          {
            fiscalPeriod: 'FY2023',
            periodType: 'ANNUAL',
            totalRevenue: 800,
            ebitda: 180,
            pat: 100,
            netWorth: 650,
            totalAssets: 1200,
          },
          {
            fiscalPeriod: 'FY2022',
            periodType: 'ANNUAL',
            totalRevenue: 600,
            ebitda: 120,
            pat: 60,
            netWorth: 500,
            totalAssets: 1000,
          },
        ],
      };

      const result = service.validate(rawAi);
      expect(result.aboutDescription).toBe('Leading digital payment platform.');
      expect(result.preIpoPe).toBe(35.5);
      expect(result.postIpoPe).toBe(42.0);
      expect(result.preIpoPromoterHolding).toBe(78.5);
      expect(result.postIpoPromoterHolding).toBe(62.0);
      expect(result.leadManagers).toEqual(['Kotak Mahindra Capital', 'Morgan Stanley India']);

      // Deterministic CAGRs:
      // Revenue 2022(600) -> 2024(1000) over 2 periods: (1000/600)^(1/2) - 1 = 29.10%
      expect(result.derivedMetrics?.revenueCagrPct).toBeCloseTo(29.1, 1);
      // PAT 2022(60) -> 2024(150) over 2 periods: (150/60)^(1/2) - 1 = 58.11%
      expect(result.derivedMetrics?.patCagrPct).toBeCloseTo(58.11, 1);
    });

    it('should reject invalid promoter holding invariants (e.g. post > pre)', () => {
      const invalidAi: AiExtractedIpoData = {
        preIpoPromoterHolding: 60.0,
        postIpoPromoterHolding: 75.0, // Invalid: post cannot exceed pre in an IPO dilution
      };

      const result = service.validate(invalidAi);
      expect(result.preIpoPromoterHolding).toBeNull();
      expect(result.postIpoPromoterHolding).toBeNull();
      expect(result.validationWarnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Promoter holding invariant violated'),
        ]),
      );
    });

    it('should sanitize strings and limit bullets to 5 items', () => {
      const rawAi: AiExtractedIpoData = {
        aboutDescription: 'Overview<script>alert(1)</script> for our company profile here.',
        strengths: [
          'Strength 1 bullet point', 'Strength 2 bullet point', 'Strength 3 bullet point', 'Strength 4 bullet point',
          'Strength 5 bullet point', 'Strength 6 bullet point', 'Strength 7 bullet point', 'Strength 8 bullet point',
        ],
      };

      const result = service.validate(rawAi);
      expect(result.aboutDescription).not.toContain('<script>');
      expect(result.strengths?.length).toBe(5);
    });
  });
});
