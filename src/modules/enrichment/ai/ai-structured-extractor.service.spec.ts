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
});
