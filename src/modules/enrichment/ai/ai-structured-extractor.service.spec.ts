import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiStructuredExtractorService } from './ai-structured-extractor.service';

describe('AiStructuredExtractorService', () => {
  let service: AiStructuredExtractorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiStructuredExtractorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AiStructuredExtractorService>(AiStructuredExtractorService);
  });

  it('should parse and validate structured JSON response', async () => {
    const mockResponseJson = {
      aboutDescription: 'Specialty chemicals manufacturer in India.',
      industry: 'Chemicals',
      sector: 'Specialty Chemicals',
      strengths: ['Robust export demand', 'Diversified client base'],
      risks: ['Raw material price fluctuation'],
      financials: [
        {
          fiscalPeriod: 'FY2024',
          periodType: 'ANNUAL',
          totalRevenue: 500,
          pat: 50,
        },
      ],
      preIpoPe: 22.4,
      postIpoPe: 26.1,
      preIpoPromoterHolding: 80.0,
      postIpoPromoterHolding: 65.0,
      freshIssueSize: 200,
      ofsSize: 50,
      leadManagers: ['ICICI Securities'],
    };

    // Mock customFetchImpl
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockResponseJson) }],
            },
          },
        ],
      }),
    } as any);

    const dummySections = {
      SUMMARY_OF_THE_ISSUE: 'Issue structure: Fresh Issue Rs 200 Cr, OFS Rs 50 Cr...',
    };

    const result = await service.extract(
      {
        ipoId: 'ipo-test-1',
        companyName: 'ABC Chemicals Ltd',
        missingFields: ['aboutDescription', 'strengthsAndRisks', 'financials', 'freshIssueSize', 'ofsSize'],
        documentSections: dummySections,
      },
      mockFetch,
    );

    expect(result).not.toBeNull();
    expect(result?.aboutDescription).toBe('Specialty chemicals manufacturer in India.');
    expect(result?.strengths).toEqual(['Robust export demand', 'Diversified client base']);
    expect(result?.freshIssueSize).toBe(200);
    expect(result?.ofsSize).toBe(50);
    expect(result?.leadManagers).toEqual(['ICICI Securities']);
  });

  it('should reject invalid / malformed responses that violate Zod schema', async () => {
    // Malformed financial period where totalRevenue is string
    const invalidJson = {
      financials: [
        {
          fiscalPeriod: 'FY2024',
          totalRevenue: 'not-a-number',
        },
      ],
    };

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(invalidJson) }],
            },
          },
        ],
      }),
    } as any);

    const result = await service.extract(
      {
        ipoId: 'ipo-test-2',
        companyName: 'ABC Chemicals Ltd',
        missingFields: ['financials'],
        documentSections: {},
      },
      mockFetch,
    );

    expect(result).toBeNull();
  });

  it('should extract SME fields (industry, freshIssueShareCount, leadManagers, aboutDescription) while preserving nulls for undetermined values', async () => {
    const mockSmeResponse = {
      aboutDescription: 'Manufacturer and distributor of fashion accessories and imitation jewellery.',
      industry: 'Fashion Accessories',
      sector: 'Consumer Discretionary',
      strengths: ['Established distribution network in Eastern India'],
      risks: [
        'Our business is substantially dependent on certain key customers.',
        'We are dependent on our suppliers for uninterrupted supply of Raw-Materials.',
      ],
      financials: [
        {
          fiscalPeriod: 'FY26',
          totalRevenue: 31.54,
          pat: 6.29,
          netWorth: 16.16,
          eps: 5.59,
        },
        {
          fiscalPeriod: 'FY25',
          totalRevenue: 17.82,
          pat: 2.0,
          netWorth: 9.81,
          eps: 1.78,
        },
        {
          fiscalPeriod: 'FY24',
          totalRevenue: 14.46,
          pat: 0.95,
          netWorth: 7.82,
          eps: 0.84,
        },
      ],
      preIpoPe: null,
      postIpoPe: null,
      preIpoPromoterHolding: 99.61,
      postIpoPromoterHolding: null,
      freshIssueShareCount: 4267200,
      ofsShareCount: null,
      freshIssueSize: null,
      ofsSize: null,
      leadManagers: ['Finshore Management Services Limited'],
      anchorDetails: null,
    };

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockSmeResponse) }],
            },
          },
        ],
      }),
    } as any);

    const result = await service.extract(
      {
        ipoId: 'dd97b183-3e8a-4674-a9c3-aec1cf25d862',
        companyName: 'R.K. Fashion Accessories Limited',
        missingFields: [
          'aboutDescription',
          'industry',
          'financials',
          'freshIssueShareCount',
          'leadManagers',
          'preIpoPromoterHolding',
          'strengthsAndRisks',
        ],
        documentSections: {
          OUR_BUSINESS: 'We are engaged in manufacturing fashion accessories...',
          INDUSTRY_OVERVIEW: 'The fashion accessories and imitation jewellery market...',
          CAPITAL_STRUCTURE: 'Fresh Issue of up to 4,267,200 Equity Shares of Rs 10 each...',
          LEAD_MANAGERS_AND_GENERAL_INFO: 'Book Running Lead Manager: Finshore Management Services Limited...',
        },
      },
      mockFetch,
    );

    expect(result).not.toBeNull();
    expect(result?.industry).toBe('Fashion Accessories');
    expect(result?.aboutDescription).toBe(
      'Manufacturer and distributor of fashion accessories and imitation jewellery.',
    );
    expect(result?.freshIssueShareCount).toBe(4267200);
    expect(result?.leadManagers).toEqual(['Finshore Management Services Limited']);
    expect(result?.preIpoPromoterHolding).toBe(99.61);
    expect(result?.financials).toHaveLength(3);
    expect(result?.financials?.[0].fiscalPeriod).toBe('FY26');
    expect(result?.financials?.[0].totalRevenue).toBe(31.54);
    expect(result?.financials?.[0].pat).toBe(6.29);
    expect(result?.preIpoPe).toBeNull();
    expect(result?.postIpoPe).toBeNull();
    expect(result?.ofsSize).toBeNull();
    expect(result?.risks).toHaveLength(2);
  });
});
