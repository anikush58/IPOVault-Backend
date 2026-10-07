import { Test, TestingModule } from '@nestjs/testing';
import { SourceHealthStatus, SourceType } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { DiscoveryService } from '../../discovery.service';
import { SourceRegistryService } from '../../source-registry.service';
import { BSE_SME_SOURCE_CODE, NSE_EMERGE_SOURCE_CODE } from '../source-adapter';
import { SmeSourceAdapter } from './sme-discovery.adapter';
import { SmeDiscoveryFetcher } from './sme-discovery.fetcher';
import { SmeDiscoveryFlow } from './sme-discovery.flow';
import { SmeFilingItem } from './sme-discovery.types';

describe('SmeDiscoveryFlow', () => {
  let flow: SmeDiscoveryFlow;
  let mockPrisma: any;
  let mockSourceRegistry: any;
  let mockDiscoveryService: any;
  let mockFetcher: any;

  beforeEach(async () => {
    mockPrisma = {
      source: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    mockSourceRegistry = {
      ensureSource: jest.fn().mockImplementation((code: string) => {
        return Promise.resolve({
          id: `src-${code}`,
          code,
          name: code === BSE_SME_SOURCE_CODE ? 'BSE SME Platform' : 'NSE Emerge Platform',
          sourceType: SourceType.EXCHANGE,
        });
      }),
    };

    mockDiscoveryService = {
      process: jest.fn(),
    };

    mockFetcher = {
      fetchBseSmeFilings: jest.fn(),
      fetchNseEmergeFilings: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmeDiscoveryFlow,
        SmeSourceAdapter,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SourceRegistryService, useValue: mockSourceRegistry },
        { provide: DiscoveryService, useValue: mockDiscoveryService },
        { provide: SmeDiscoveryFetcher, useValue: mockFetcher },
      ],
    }).compile();

    flow = module.get<SmeDiscoveryFlow>(SmeDiscoveryFlow);
  });

  describe('ingestBseSme', () => {
    it('successfully processes BSE SME filings and creates DiscoveryRecords', async () => {
      const filings: SmeFilingItem[] = [
        {
          companyName: 'R.K.Fashion Accessories Limited',
          marketSegment: 'SME',
          exchange: 'BSE',
          documentUrl: 'https://www.bseindia.com/downloads/ipo/rkfashion_prospectus.pdf',
          filingType: 'PROSPECTUS',
          filingTitle: 'R.K.Fashion Accessories Limited SME Prospectus',
          symbol: 'RKFASHION',
          issueStartDate: '2026-10-05',
          issueEndDate: '2026-10-07',
          issueSize: '34.99',
          lotSize: 1600,
          priceBandLow: 77,
          priceBandHigh: 82,
          externalId: '544123',
        },
      ];

      mockDiscoveryService.process.mockResolvedValue({
        outcome: 'CREATED',
        discoveryRecordId: 'rec-rkfashion-1',
        ipoId: 'ipo-rkfashion-1',
      });

      const result = await flow.ingestBseSme(filings);

      expect(mockSourceRegistry.ensureSource).toHaveBeenCalledWith(BSE_SME_SOURCE_CODE);
      expect(mockDiscoveryService.process).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceId: 'src-bse_sme',
          externalId: '544123',
          companyName: 'R.K.Fashion Accessories Limited',
          sourceReference: 'https://www.bseindia.com/downloads/ipo/rkfashion_prospectus.pdf',
          rawPayload: expect.objectContaining({
            company: expect.objectContaining({
              legalName: 'R.K.Fashion Accessories Limited',
            }),
            ipo: expect.objectContaining({
              marketSegment: 'SME',
              exchange: 'BSE',
              lotSize: 1600,
            }),
            source: expect.objectContaining({
              documentUrl: 'https://www.bseindia.com/downloads/ipo/rkfashion_prospectus.pdf',
              filingType: 'PROSPECTUS',
            }),
          }),
        }),
      );

      expect(result.totalDiscovered).toBe(1);
      expect(result.createdRecordsCount).toBe(1);
      expect(result.duplicateCount).toBe(0);
      expect(result.failedCount).toBe(0);

      // Verify health tracking
      expect(mockPrisma.source.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'src-bse_sme' },
          data: expect.objectContaining({
            healthStatus: SourceHealthStatus.HEALTHY,
          }),
        }),
      );
    });

    it('handles duplicate filings idempotently without failure', async () => {
      const filings: SmeFilingItem[] = [
        {
          companyName: 'R.K.Fashion Accessories Limited',
          marketSegment: 'SME',
          exchange: 'BSE',
          documentUrl: 'https://www.bseindia.com/downloads/ipo/rkfashion_prospectus.pdf',
        },
      ];

      mockDiscoveryService.process.mockResolvedValue({
        outcome: 'DUPLICATE',
        discoveryRecordId: 'rec-rkfashion-existing',
        ipoId: null,
      });

      const result = await flow.ingestBseSme(filings);

      expect(result.totalDiscovered).toBe(1);
      expect(result.createdRecordsCount).toBe(0);
      expect(result.duplicateCount).toBe(1);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('ingestNseEmerge', () => {
    it('successfully processes NSE Emerge filings', async () => {
      const filings: SmeFilingItem[] = [
        {
          companyName: 'Accurate Bio-Chem Limited',
          marketSegment: 'SME',
          exchange: 'NSE',
          documentUrl: 'https://nsearchives.nseindia.com/emerge/ACCURATE_Prospectus.pdf',
          filingType: 'PROSPECTUS',
          symbol: 'ACCURATE',
        },
      ];

      mockDiscoveryService.process.mockResolvedValue({
        outcome: 'CREATED',
        discoveryRecordId: 'rec-nse-1',
        ipoId: 'ipo-nse-1',
      });

      const result = await flow.ingestNseEmerge(filings);

      expect(mockSourceRegistry.ensureSource).toHaveBeenCalledWith(NSE_EMERGE_SOURCE_CODE);
      expect(result.createdRecordsCount).toBe(1);
    });
  });

  describe('ingestLive', () => {
    it('runs both BSE SME and NSE Emerge feeds concurrently in isolation', async () => {
      mockFetcher.fetchBseSmeFilings.mockResolvedValue([]);
      mockFetcher.fetchNseEmergeFilings.mockResolvedValue([]);

      const result = await flow.ingestLive();

      expect(result.bse.sourceCode).toBe(BSE_SME_SOURCE_CODE);
      expect(result.nse.sourceCode).toBe(NSE_EMERGE_SOURCE_CODE);
    });
  });
});
