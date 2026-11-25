import { Test, TestingModule } from '@nestjs/testing';
import { EnrichmentOrchestratorService } from './enrichment-orchestrator.service';
import { MissingFieldDetectorService } from './missing-field-detector.service';
import { SebiDocumentRetrievalService } from '../discovery/adapters/sebi/sebi-document-retrieval.service';
import { AiStructuredExtractorService } from './ai/ai-structured-extractor.service';
import { EnrichmentValidatorService } from './enrichment-validator.service';
import { AiResearchOrchestratorService } from './research/ai-research-orchestrator.service';
import { PrismaService } from '../../database/prisma.service';

describe('EnrichmentOrchestratorService', () => {
  let orchestrator: EnrichmentOrchestratorService;

  const mockPrisma = {
    ipo: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    company: {
      update: jest.fn(),
    },
    companyFinancials: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ipoParticipant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    fieldProvenance: {
      create: jest.fn(),
    },
    source: {
      upsert: jest.fn().mockResolvedValue({ id: 'src-enrich', code: 'SEBI_RHP_AI' }),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn().mockImplementation(async (callback) => {
      return await callback(mockPrisma);
    }),
  };

  const mockDetector = {
    detect: jest.fn(),
  };

  const mockRetrieval = {
    retrieveAndExtractSections: jest.fn(),
  };

  const mockExtractor = {
    extract: jest.fn(),
  };

  const mockValidator = {
    validate: jest.fn(),
    calculateCagr: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrichmentOrchestratorService,
        { provide: MissingFieldDetectorService, useValue: mockDetector },
        { provide: SebiDocumentRetrievalService, useValue: mockRetrieval },
        { provide: AiStructuredExtractorService, useValue: mockExtractor },
        { provide: EnrichmentValidatorService, useValue: mockValidator },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    orchestrator = module.get<EnrichmentOrchestratorService>(EnrichmentOrchestratorService);
    jest.clearAllMocks();
  });

  it('should skip enrichment if no fields are missing', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-1',
      hasMissingFields: false,
      missingFields: [],
      companyName: 'Complete Corp',
    });

    const result = await orchestrator.processIpoEnrichment('ipo-1');
    expect(result.status).toBe('SKIPPED');
    expect(mockRetrieval.retrieveAndExtractSections).not.toHaveBeenCalled();
  });

  it('should prevent duplicate concurrent execution for the same IPO', async () => {
    // Lock the IPO manually
    (orchestrator as any).activeIpoJobs.add('ipo-locked');

    const result = await orchestrator.processIpoEnrichment('ipo-locked');
    expect(result.status).toBe('SKIPPED');
    expect(result.error).toContain('Job already running');
  });

  it('should gracefully handle SEBI document not found without throwing or corrupting data', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-2',
      hasMissingFields: true,
      missingFields: ['aboutDescription'],
      companyName: 'Unlisted Entity',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'DOCUMENT_UNRESOLVED',
      ipoId: 'ipo-2',
      error: 'No matching document found in SEBI registry',
      retrievedAt: new Date().toISOString(),
    });

    const result = await orchestrator.processIpoEnrichment('ipo-2');
    expect(result.status).toBe('DOCUMENT_UNRESOLVED');
    expect(result.missingFieldsDetected).toEqual(['aboutDescription']);
    expect(result.skippedFields).toEqual([]); // Must NOT label unresolved fields as skipped/preserved
    expect(result.enrichedFields).toEqual([]);
    expect(mockExtractor.extract).not.toHaveBeenCalled();
  });

  it('should successfully run end-to-end enrichment, validating and writing only missing fields + provenance', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-3',
      hasMissingFields: true,
      missingFields: ['aboutDescription', 'industry', 'preIpoPe', 'leadManagers'],
      companyName: 'Acme Solar Ltd',
      symbol: 'ACMESOLAR',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'SUCCESS',
      documentId: 'doc-1',
      documentHash: 'hash-12345',
      documentType: 'RHP',
      sourceUrl: 'https://www.sebi.gov.in/rhp/acme.pdf',
      retrievedAt: new Date().toISOString(),
      sections: {
        SUMMARY_OF_THE_ISSUE: {
          sectionKey: 'SUMMARY_OF_THE_ISSUE',
          sectionTitle: 'Summary of the Issue',
          content: 'Acme Solar is a renewable energy producer...',
          pageRange: { startPage: 1, endPage: 20 },
          charCount: 45,
          contentHash: 'sec-hash',
          isTruncated: false,
        },
      },
    });

    mockExtractor.extract.mockResolvedValue({
      aboutDescription: 'Acme Solar is a renewable energy producer.',
      industry: 'Renewable Energy',
      preIpoPe: 18.5,
      preIpoPromoterHolding: 80.0,
      leadManagers: ['Nuvama Wealth Management'],
    });

    mockValidator.validate.mockReturnValue({
      aboutDescription: 'Acme Solar is a renewable energy producer.',
      industry: 'Renewable Energy',
      preIpoPe: 18.5,
      preIpoPromoterHolding: 80.0,
      leadManagers: ['Nuvama Wealth Management'],
      validationWarnings: [],
    });

    // Mock IPO lookup inside transaction
    mockPrisma.ipo.findUnique.mockResolvedValue({
      id: 'ipo-3',
      companyId: 'comp-3',
      preIpoPe: null,
      preIpoPromoterHolding: 75.0, // Existing value: validator extracted 80%, but non-overwriting logic applies
      company: {
        id: 'comp-3',
        aboutDescription: null,
        industry: null,
      },
      participants: [],
    });

    const result = await orchestrator.processIpoEnrichment('ipo-3');
    expect(result.status).toBe('COMPLETED');
    expect(result.enrichedFields).toEqual(
      expect.arrayContaining(['aboutDescription', 'industry', 'preIpoPe', 'leadManagers']),
    );

    // Verify company update called with only missing fields
    expect(mockPrisma.company.update).toHaveBeenCalledWith({
      where: { id: 'comp-3' },
      data: {
        aboutDescription: 'Acme Solar is a renewable energy producer.',
        industry: 'Renewable Energy',
      },
    });

    // Verify fieldProvenance created
    expect(mockPrisma.fieldProvenance.create).toHaveBeenCalled();
  });

  it('should successfully enrich BSE SME IPO using BSE exchange-hosted prospectus and tag BSE_SME_AI provenance', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-bse-sme',
      hasMissingFields: true,
      missingFields: ['aboutDescription', 'sector', 'preIpoPe'],
      companyName: 'Zenith Logistics SME Ltd',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'SUCCESS',
      documentId: 'doc-bse-1',
      documentHash: 'hash-bse-sme',
      documentType: 'PROSPECTUS',
      sourceUrl: 'https://www.bseindia.com/downloads/ipo/zenith_prospectus.pdf',
      retrievedAt: new Date().toISOString(),
      sections: {
        SUMMARY_OF_THE_ISSUE: {
          sectionKey: 'SUMMARY_OF_THE_ISSUE',
          sectionTitle: 'Summary of Prospectus',
          content: 'Zenith Logistics is a third-party logistics provider...',
          pageRange: { startPage: 1, endPage: 15 },
          charCount: 50,
          contentHash: 'sec-bse-hash',
          isTruncated: false,
        },
      },
    });

    mockExtractor.extract.mockResolvedValue({
      aboutDescription: 'Zenith Logistics is a third-party logistics provider.',
      sector: 'Logistics',
      preIpoPe: 12.4,
    });

    mockValidator.validate.mockReturnValue({
      aboutDescription: 'Zenith Logistics is a third-party logistics provider.',
      sector: 'Logistics',
      preIpoPe: 12.4,
      validationWarnings: [],
    });

    mockPrisma.ipo.findUnique.mockResolvedValue({
      id: 'ipo-bse-sme',
      companyId: 'comp-bse',
      preIpoPe: null,
      company: {
        id: 'comp-bse',
        aboutDescription: null,
        sector: null,
      },
      participants: [],
    });

    const result = await orchestrator.processIpoEnrichment('ipo-bse-sme');
    expect(result.status).toBe('COMPLETED');
    expect(result.enrichedFields).toEqual(
      expect.arrayContaining(['aboutDescription', 'sector', 'preIpoPe']),
    );

    // Verify BSE source upserted
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'BSE_SME_AI' },
      }),
    );
  });

  it('should successfully enrich NSE Emerge IPO using NSE exchange-hosted prospectus and tag NSE_EMERGE_AI provenance', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-nse-sme',
      hasMissingFields: true,
      missingFields: ['aboutDescription', 'industry'],
      companyName: 'Accurate Bio-Chem Limited',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'SUCCESS',
      documentId: 'doc-nse-1',
      documentHash: 'hash-nse-sme',
      documentType: 'PROSPECTUS',
      sourceUrl: 'https://nsearchives.nseindia.com/emerge/ACCURATE_Prospectus.pdf',
      retrievedAt: new Date().toISOString(),
      sections: {
        SUMMARY_OF_THE_ISSUE: {
          sectionKey: 'SUMMARY_OF_THE_ISSUE',
          sectionTitle: 'Summary of the Issue',
          content: 'Accurate Bio-Chem manufactures specialty chemical formulations...',
          pageRange: { startPage: 1, endPage: 12 },
          charCount: 60,
          contentHash: 'sec-nse-hash',
          isTruncated: false,
        },
      },
    });

    mockExtractor.extract.mockResolvedValue({
      aboutDescription: 'Accurate Bio-Chem manufactures specialty chemical formulations.',
      industry: 'Specialty Chemicals',
    });

    mockValidator.validate.mockReturnValue({
      aboutDescription: 'Accurate Bio-Chem manufactures specialty chemical formulations.',
      industry: 'Specialty Chemicals',
      validationWarnings: [],
    });

    mockPrisma.ipo.findUnique.mockResolvedValue({
      id: 'ipo-nse-sme',
      companyId: 'comp-nse',
      company: {
        id: 'comp-nse',
        aboutDescription: null,
        industry: null,
      },
      participants: [],
    });

    const result = await orchestrator.processIpoEnrichment('ipo-nse-sme');
    expect(result.status).toBe('COMPLETED');
    expect(result.enrichedFields).toEqual(
      expect.arrayContaining(['aboutDescription', 'industry']),
    );

    // Verify NSE source upserted
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'NSE_EMERGE_AI' },
      }),
    );
  });

  it('should safely backfill incomplete IPOs without re-enqueueing complete IPOs', async () => {
    (mockPrisma.ipo as any).findMany = jest.fn().mockResolvedValue([
      { id: 'ipo-inc-1' },
      { id: 'ipo-comp-2' },
    ]);

    mockDetector.detect.mockImplementation(async (id: string) => {
      if (id === 'ipo-inc-1') {
        return { ipoId: id, hasMissingFields: true, missingFields: ['aboutDescription'], companyName: 'Incomplete' };
      }
      return { ipoId: id, hasMissingFields: false, missingFields: [], companyName: 'Complete' };
    });

    const backfillResult = await orchestrator.backfillIncompleteIpos({
      marketSegment: 'SME',
      limit: 10,
    });

    expect(backfillResult.queuedCount).toBe(1);
    expect(backfillResult.ipoIds).toEqual(['ipo-inc-1']);
  });

  it('should successfully enrich R.K.Fashion Accessories using BSE SME official document fixture', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'dd97b183-3e8a-4674-a9c3-aec1cf25d862',
      hasMissingFields: true,
      missingFields: ['aboutDescription', 'industry', 'preIpoPe', 'leadManagers'],
      companyName: 'R.K.Fashion Accessories',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'SUCCESS',
      documentId: 'doc-rkfashion-1',
      documentHash: 'hash-rkfashion-sme',
      documentType: 'PROSPECTUS',
      sourceUrl: 'https://www.bseindia.com/downloads/ipo/rkfashion_prospectus.pdf',
      retrievedAt: new Date().toISOString(),
      sections: {
        SUMMARY_OF_THE_ISSUE: {
          sectionKey: 'SUMMARY_OF_THE_ISSUE',
          sectionTitle: 'Summary of Prospectus',
          content: 'R.K.Fashion Accessories Limited specializes in high-fashion garment accessories...',
          pageRange: { startPage: 1, endPage: 10 },
          charCount: 80,
          contentHash: 'sec-rkfashion-hash',
          isTruncated: false,
        },
        GENERAL_INFORMATION: {
          sectionKey: 'GENERAL_INFORMATION',
          sectionTitle: 'General Information',
          content: 'Book Running Lead Manager: Fast Track Capital Advisors Pvt Ltd...',
          pageRange: { startPage: 11, endPage: 18 },
          charCount: 60,
          contentHash: 'sec-rkfashion-gen-hash',
          isTruncated: false,
        },
      },
    });

    mockExtractor.extract.mockResolvedValue({
      aboutDescription: 'R.K.Fashion Accessories Limited specializes in high-fashion garment accessories.',
      industry: 'Fashion & Apparel Accessories',
      preIpoPe: 15.2,
      leadManagers: ['Fast Track Capital Advisors Pvt Ltd'],
    });

    mockValidator.validate.mockReturnValue({
      aboutDescription: 'R.K.Fashion Accessories Limited specializes in high-fashion garment accessories.',
      industry: 'Fashion & Apparel Accessories',
      preIpoPe: 15.2,
      leadManagers: ['Fast Track Capital Advisors Pvt Ltd'],
      validationWarnings: [],
    });

    mockPrisma.ipo.findUnique.mockResolvedValue({
      id: 'dd97b183-3e8a-4674-a9c3-aec1cf25d862',
      companyId: 'a1f0d35b-8cfd-4490-87f7-933d0f32e23a',
      preIpoPe: null,
      company: {
        id: 'a1f0d35b-8cfd-4490-87f7-933d0f32e23a',
        aboutDescription: null,
        industry: null,
      },
      participants: [],
    });

    const result = await orchestrator.processIpoEnrichment('dd97b183-3e8a-4674-a9c3-aec1cf25d862');

    expect(result.status).toBe('COMPLETED');
    expect(result.enrichedFields).toEqual(
      expect.arrayContaining(['aboutDescription', 'industry', 'preIpoPe', 'leadManagers']),
    );
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'BSE_SME_AI' },
      }),
    );
  });

  it('should successfully enrich IPO using issuer-hosted official DRHP and tag ISSUER_PROSPECTUS_AI provenance', async () => {
    mockDetector.detect.mockResolvedValue({
      ipoId: 'ipo-acme-1',
      hasMissingFields: true,
      missingFields: ['aboutDescription', 'industry', 'preIpoPe'],
      companyName: 'Acme India Limited',
    });

    mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
      status: 'SUCCESS',
      documentId: 'doc-acme-1',
      documentHash: 'hash-acme-drhp',
      documentType: 'DRHP',
      sourceUrl: 'https://acmeindia.co/assets/web/pdf/DRHP_Acme_20250930201943.pdf',
      retrievedAt: new Date().toISOString(),
      sections: {
        SUMMARY_OF_THE_ISSUE: {
          sectionKey: 'SUMMARY_OF_THE_ISSUE',
          sectionTitle: 'Summary of Issue',
          content: 'Acme India Limited provides industrial engineering solutions...',
          pageRange: { startPage: 1, endPage: 10 },
          charCount: 65,
          contentHash: 'sec-acme-hash',
          isTruncated: false,
        },
      },
    });

    mockExtractor.extract.mockResolvedValue({
      aboutDescription: 'Acme India Limited provides industrial engineering solutions.',
      industry: 'Industrial Engineering',
      preIpoPe: 16.8,
    });

    mockValidator.validate.mockReturnValue({
      aboutDescription: 'Acme India Limited provides industrial engineering solutions.',
      industry: 'Industrial Engineering',
      preIpoPe: 16.8,
      validationWarnings: [],
    });

    mockPrisma.ipo.findUnique.mockResolvedValue({
      id: 'ipo-acme-1',
      companyId: 'comp-acme-1',
      preIpoPe: null,
      company: {
        id: 'comp-acme-1',
        aboutDescription: null,
        industry: null,
      },
      participants: [],
    });

    const result = await orchestrator.processIpoEnrichment('ipo-acme-1');

    expect(result.status).toBe('COMPLETED');
    expect(result.enrichedFields).toEqual(
      expect.arrayContaining(['aboutDescription', 'industry', 'preIpoPe']),
    );
    expect(mockPrisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: 'ISSUER_PROSPECTUS_AI' },
      }),
    );
  });

  it('should enforce concurrency cap of 2 and deduplicate already queued or in-flight jobs', async () => {
    let unblock1: () => void = () => {};
    let unblock2: () => void = () => {};

    // Mock processIpoEnrichment behavior by spying on it
    let activeCount = 0;
    let maxSeenActive = 0;

    jest.spyOn(orchestrator, 'processIpoEnrichment').mockImplementation(async (ipoId: string) => {
      activeCount++;
      if (activeCount > maxSeenActive) maxSeenActive = activeCount;
      if (ipoId === 'job-1') {
        await new Promise<void>((resolve) => { unblock1 = resolve; });
      } else if (ipoId === 'job-2') {
        await new Promise<void>((resolve) => { unblock2 = resolve; });
      }
      activeCount--;
      return { ipoId, status: 'COMPLETED' } as any;
    });

    // Enqueue 4 distinct IPOs
    await orchestrator.enqueueIpoEnrichment('job-1');
    await orchestrator.enqueueIpoEnrichment('job-2');
    await orchestrator.enqueueIpoEnrichment('job-3');
    await orchestrator.enqueueIpoEnrichment('job-4');

    // Enqueue duplicate for job-1 and job-3
    await orchestrator.enqueueIpoEnrichment('job-1');
    await orchestrator.enqueueIpoEnrichment('job-3');

    // Wait a tick for setImmediate
    await new Promise((resolve) => setImmediate(resolve));

    const stats = orchestrator.getQueueStats();
    expect(stats.active).toBeLessThanOrEqual(2);
    expect(maxSeenActive).toBeLessThanOrEqual(2);
    expect(stats.queued).toBe(2); // job-3 and job-4 waiting

    // Unblock job-1 and job-2
    unblock1();
    unblock2();

    // Wait ticks for queue drain
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(maxSeenActive).toBeLessThanOrEqual(2);
  });

  describe('Registrar Enrichment & Bounded Fallback', () => {
    it('deterministically extracts registrar from RHP LEAD_MANAGERS_AND_GENERAL_INFO without invoking AI when only registrar is missing', async () => {
      const mockConfigUpsert = jest.fn().mockResolvedValue({});
      (mockPrisma as any).ipoAllotmentConfig = {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: mockConfigUpsert,
      };
      mockPrisma.ipoParticipant.findFirst.mockResolvedValue(null);

      mockDetector.detect.mockResolvedValue({
        ipoId: 'ipo-det-rta',
        hasMissingFields: true,
        missingFields: ['registrar'],
        companyName: 'Deterministic RTA Corp',
      });

      mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
        status: 'SUCCESS',
        documentId: 'doc-det-1',
        documentHash: 'hash-det',
        documentType: 'RHP',
        sourceUrl: 'https://www.sebi.gov.in/filings/det_rhp.pdf',
        retrievedAt: new Date().toISOString(),
        sections: {
          LEAD_MANAGERS_AND_GENERAL_INFO: {
            sectionKey: 'LEAD_MANAGERS_AND_GENERAL_INFO',
            sectionTitle: 'General Information',
            content:
              'BOOK RUNNING LEAD MANAGER: Axis Capital Limited\nREGISTRAR TO THE OFFER\nKFin Technologies Limited\nSelenium Tower B, Hyderabad\nBANKERS TO THE OFFER\nHDFC Bank Limited',
            pageRange: { startPage: 10, endPage: 12 },
            charCount: 160,
            contentHash: 'sec-det',
            isTruncated: false,
          },
        },
      });

      mockValidator.validate.mockReturnValue({
        registrar: 'KFINTECH',
        validationWarnings: [],
      });

      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-det-rta',
        companyId: 'comp-det',
        company: { id: 'comp-det' },
        allotmentConfig: null,
        participants: [],
        sourceIdentities: [],
        lifecycleEvents: [],
      });

      const result = await orchestrator.processIpoEnrichment('ipo-det-rta');

      expect(result.status).toBe('COMPLETED');
      expect(result.enrichedFields).toEqual(['registrar']);
      expect(mockExtractor.extract).not.toHaveBeenCalled();
      expect(mockConfigUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ipoId: 'ipo-det-rta' },
          create: expect.objectContaining({
            registrar: 'KFINTECH',
            enabled: true,
          }),
        }),
      );
      expect(mockPrisma.ipoParticipant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ipoId: 'ipo-det-rta',
            role: 'REGISTRAR',
            name: 'KFINTECH',
          }),
        }),
      );
    });

    it('runs bounded AiResearchOrchestrator fallback for active/within-30d PUBLISHED IPOs when RHP is unresolved, and skips historical LISTED IPOs', async () => {
      const mockResearch = {
        executeResearchNow: jest.fn().mockResolvedValue({ fieldsUpdated: 1 }),
      };

      const moduleWithResearch = await Test.createTestingModule({
        providers: [
          EnrichmentOrchestratorService,
          { provide: MissingFieldDetectorService, useValue: mockDetector },
          { provide: SebiDocumentRetrievalService, useValue: mockRetrieval },
          { provide: AiStructuredExtractorService, useValue: mockExtractor },
          { provide: EnrichmentValidatorService, useValue: mockValidator },
          { provide: AiResearchOrchestratorService, useValue: mockResearch },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      const orchWithResearch = moduleWithResearch.get<EnrichmentOrchestratorService>(
        EnrichmentOrchestratorService,
      );

      (mockPrisma as any).ipoAllotmentConfig = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ registrar: 'MUFG Intime India Private Limited', enabled: true }),
        upsert: jest.fn().mockResolvedValue({}),
      };
      mockPrisma.ipoParticipant.findFirst.mockResolvedValue(null);

      mockDetector.detect.mockResolvedValue({
        ipoId: 'ipo-active-fallback',
        hasMissingFields: true,
        missingFields: ['registrar'],
        companyName: 'Active IPO Corp',
      });
      mockRetrieval.retrieveAndExtractSections.mockResolvedValue({
        status: 'DOCUMENT_UNRESOLVED',
        error: 'No SEBI RHP yet',
      });
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-active-fallback',
        status: 'UPCOMING',
        publicationStatus: 'PUBLISHED',
        allotmentConfig: null,
        participants: [],
        sourceIdentities: [],
        lifecycleEvents: [],
      });

      const activeResult = await orchWithResearch.processIpoEnrichment(
        'ipo-active-fallback',
      );
      expect(activeResult.status).toBe('COMPLETED');
      expect(activeResult.enrichedFields).toEqual(['registrar']);
      expect(mockResearch.executeResearchNow).toHaveBeenCalledWith(
        'ipo-active-fallback',
        expect.any(Object),
      );

      mockResearch.executeResearchNow.mockClear();
      mockDetector.detect.mockResolvedValue({
        ipoId: 'ipo-old-listed',
        hasMissingFields: true,
        missingFields: ['registrar'],
        companyName: 'Historical Listed Corp',
      });
      mockPrisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-old-listed',
        status: 'LISTED',
        publicationStatus: 'PUBLISHED',
        allotmentConfig: null,
        participants: [],
        sourceIdentities: [],
        lifecycleEvents: [
          { eventType: 'LISTING', eventDate: new Date(Date.now() - 90 * 86_400_000) },
        ],
      });

      const oldResult = await orchWithResearch.processIpoEnrichment('ipo-old-listed');
      expect(oldResult.status).toBe('DOCUMENT_UNRESOLVED');
      expect(mockResearch.executeResearchNow).not.toHaveBeenCalled();
    });
  });
});
