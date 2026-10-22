import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiResearchAgentService } from './ai-research-agent.service';

describe('AiResearchAgentService', () => {
  let service: AiResearchAgentService;

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'GEMINI_API_KEY') return 'test-gemini-key';
      if (key === 'GEMINI_MODEL') return 'gemini-2.5-flash';
      return null;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiResearchAgentService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AiResearchAgentService>(AiResearchAgentService);
  });

  describe('classifySourceAuthority', () => {
    it('should classify SEBI, NSE, and BSE as TIER_1_STATUTORY', () => {
      const sebi = service.classifySourceAuthority('https://www.sebi.gov.in/filings/public-issues/dec-2024/acme-rhp.pdf');
      expect(sebi.tier).toBe('TIER_1_STATUTORY');
      expect(sebi.sourceName).toBe('SEBI Official');

      const nse = service.classifySourceAuthority('https://www.nseindia.com/market-data/all-upcoming-issues-ipo');
      expect(nse.tier).toBe('TIER_1_STATUTORY');
      expect(nse.sourceName).toBe('NSE Official');

      const bse = service.classifySourceAuthority('https://www.bseindia.com/publicissue.html');
      expect(bse.tier).toBe('TIER_1_STATUTORY');
      expect(bse.sourceName).toBe('BSE Official');
    });

    it('should classify official registrars as TIER_2_REGISTRAR', () => {
      const linkintime = service.classifySourceAuthority('https://linkintime.co.in/initial_offer/public-issues.html');
      expect(linkintime.tier).toBe('TIER_2_REGISTRAR');
      expect(linkintime.sourceName).toBe('Link Intime');

      const kfintech = service.classifySourceAuthority('https://ris.kfintech.com/ipostatus');
      expect(kfintech.tier).toBe('TIER_2_REGISTRAR');
      expect(kfintech.sourceName).toBe('KFin Technologies');

      const bigshare = service.classifySourceAuthority('https://ipo.bigshareonline.com/IPO_Status.html');
      expect(bigshare.tier).toBe('TIER_2_REGISTRAR');
      expect(bigshare.sourceName).toBe('Bigshare Services');
    });

    it('should classify company prospectus/drhp links as TIER_3_ISSUER', () => {
      const issuer = service.classifySourceAuthority('https://acmecorp.com/investor-relations/rhp.pdf');
      expect(issuer.tier).toBe('TIER_3_ISSUER');
      expect(issuer.sourceName).toBe('Issuer Filing');
    });

    it('should classify secondary aggregators and blogs as TIER_4_SECONDARY', () => {
      const chittor = service.classifySourceAuthority('https://www.chittorgarh.com/ipo/acme-ipo/123/');
      expect(chittor.tier).toBe('TIER_4_SECONDARY');

      const ipowatch = service.classifySourceAuthority('https://ipowatch.in/acme-ipo-allotment-status/');
      expect(ipowatch.tier).toBe('TIER_4_SECONDARY');

      const unknown = service.classifySourceAuthority('not-a-valid-domain');
      expect(unknown.tier).toBe('TIER_4_SECONDARY');
      expect(unknown.domain).toBe('unknown');
    });
  });

  describe('researchIpo with Gemini web search grounding', () => {
    it('should query Gemini with Google Search tool and parse candidate fields', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    company: {
                      legalName: {
                        value: 'Acme Technologies Limited',
                        sourceUrl: 'https://www.nseindia.com/companies-listing/acme',
                        evidence: 'Official listing notification from NSE',
                        confidence: 0.98,
                      },
                      website: {
                        value: 'https://acmetech.in',
                        sourceUrl: 'https://www.sebi.gov.in/rhp/acme.pdf',
                        evidence: 'Issuer corporate details page in RHP',
                        confidence: 0.95,
                      },
                    },
                    pricingAndIssue: {
                      priceBandLow: {
                        value: 285,
                        sourceUrl: 'https://www.bseindia.com/acme-notice',
                        evidence: 'Floor price set at Rs 285',
                        confidence: 0.99,
                      },
                      priceBandHigh: {
                        value: 300,
                        sourceUrl: 'https://www.bseindia.com/acme-notice',
                        evidence: 'Cap price set at Rs 300',
                        confidence: 0.99,
                      },
                      lotSize: {
                        value: 50,
                        sourceUrl: 'https://www.nseindia.com/acme',
                        evidence: 'Market lot of 50 equity shares',
                        confidence: 0.99,
                      },
                    },
                    dates: {
                      openDate: {
                        value: '2026-03-10',
                        sourceUrl: 'https://www.bseindia.com/acme',
                        evidence: 'Issue opening date',
                        confidence: 0.95,
                      },
                      closeDate: {
                        value: '2026-03-12',
                        sourceUrl: 'https://www.bseindia.com/acme',
                        evidence: 'Issue closing date',
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
        text: jest.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
        json: jest.fn().mockResolvedValue(mockApiResponse),
      });

      const ipo = {
        id: 'ipo-test-1',
        symbol: 'ACME',
        company: {
          legalName: 'Acme Tech Ltd',
          displayName: 'Acme',
        },
      };

      const result = await service.researchIpo(ipo, {
        customFetchImpl: mockFetch as any,
        retryDelayMs: 0,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledOptions] = mockFetch.mock.calls[0];
      expect(calledUrl).toContain('models/gemini-2.5-flash:generateContent');
      const body = JSON.parse(calledOptions.body);
      expect(body.tools).toEqual([{ google_search: {} }]);

      expect(result.legalName).toBeDefined();
      expect(result.legalName?.rawValue).toBe('Acme Technologies Limited');
      expect(result.legalName?.sourceAuthority).toBe('TIER_1_STATUTORY');
      expect(result.priceBandLow?.rawValue).toBe(285);
      expect(result.lotSize?.rawValue).toBe(50);
      expect(result.openDate?.rawValue).toBe('2026-03-10');
    });

    it('should handle markdown fenced JSON returned by model', async () => {
      const mockMarkdownResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: '```json\n{\n  "pricingAndIssue": {\n    "lotSize": {\n      "value": 100,\n      "sourceUrl": "https://linkintime.co.in/acme",\n      "evidence": "100 shares per lot"\n    }\n  }\n}\n```',
                },
              ],
            },
          },
        ],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockMarkdownResponse)),
        json: jest.fn().mockResolvedValue(mockMarkdownResponse),
      });

      const result = await service.researchIpo(
        { id: 'ipo-2', company: { legalName: 'Sample Ltd' } },
        { customFetchImpl: mockFetch as any, retryDelayMs: 0 },
      );

      expect(result.lotSize?.rawValue).toBe(100);
      expect(result.lotSize?.sourceAuthority).toBe('TIER_2_REGISTRAR');
    });

    it('should extract grounding metadata chunks and enrich missing candidate source URLs', async () => {
      const mockGroundedResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    pricingAndIssue: {
                      lotSize: {
                        value: 75,
                        sourceUrl: '', // Model did not output explicit URL
                        evidence: 'Lot size 75',
                      },
                    },
                  }),
                },
              ],
            },
            groundingMetadata: {
              webSearchQueries: ['SFC Environmental Technologies IPO NSE BSE'],
              groundingChunks: [
                {
                  web: {
                    uri: 'https://www.bseindia.com/stock-share-price/sfc/500123/',
                    title: 'BSE India - SFC Environmental Technologies',
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
        text: jest.fn().mockResolvedValue(JSON.stringify(mockGroundedResponse)),
        json: jest.fn().mockResolvedValue(mockGroundedResponse),
      });

      const result = await service.researchIpo(
        { id: 'ipo-sfc-grounded', company: { legalName: 'SFC Environmental Technologies' } },
        { customFetchImpl: mockFetch as any, retryDelayMs: 0 },
      );

      expect(result.lotSize).toBeDefined();
      expect(result.lotSize?.rawValue).toBe(75);
      expect(result.lotSize?.sourceUrl).toBe('https://www.bseindia.com/stock-share-price/sfc/500123/');
      expect(result.lotSize?.sourceAuthority).toBe('TIER_1_STATUTORY');
      expect(result.diagnostics?.status).toBe('SUCCESS');
      expect(result.diagnostics?.groundingSourcesCount).toBe(1);
    });

    it('should return diagnostics with API_RATE_LIMIT_EXCEEDED when API returns 429', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Rate limit or quota exceeded'),
        json: jest.fn().mockResolvedValue({ error: 'Rate limit or quota exceeded' }),
      });

      const result = await service.researchIpo(
        { id: 'ipo-3', company: { legalName: 'Error Co' } },
        { customFetchImpl: mockFetch as any, retryDelayMs: 0 },
      );

      expect(result.lotSize).toBeUndefined();
      expect(result.diagnostics?.status).toBe('FAILED');
      expect(result.diagnostics?.diagnosticCode).toBe('API_RATE_LIMIT_EXCEEDED');
      expect(result.diagnostics?.errorMessage).toContain('429');
    });

    it('should return diagnostics with SCHEMA_PARSE_ERROR when model returns malformed non-JSON', async () => {
      const mockBadResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Here is some general text about the IPO, but not JSON at all.' }],
            },
          },
        ],
      };

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(JSON.stringify(mockBadResponse)),
        json: jest.fn().mockResolvedValue(mockBadResponse),
      });

      const result = await service.researchIpo(
        { id: 'ipo-bad-json', company: { legalName: 'Malformed Co' } },
        { customFetchImpl: mockFetch as any, retryDelayMs: 0 },
      );

      expect(result.diagnostics?.status).toBe('FAILED');
      expect(result.diagnostics?.diagnosticCode).toBe('SCHEMA_PARSE_ERROR');
    });

    it('should classify MCA as TIER_1_STATUTORY and issuer company domain as TIER_3_ISSUER', () => {
      const mca = service.classifySourceAuthority('https://www.mca.gov.in/mcafoportal/companyLLPMasterData.do');
      expect(mca.tier).toBe('TIER_1_STATUTORY');
      expect(mca.sourceName).toBe('MCA Official');

      const issuerDomainMatch = service.classifySourceAuthority('https://www.sfcenv.com/about-us', 'sfcenv.com');
      expect(issuerDomainMatch.tier).toBe('TIER_3_ISSUER');
      expect(issuerDomainMatch.sourceName).toBe('Issuer Filing');
    });
  });
});
