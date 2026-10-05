import { Test, TestingModule } from '@nestjs/testing';
import { DocumentType } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import {
  SmeDocumentMatcherService,
  BSE_SME_SOURCE_CODE,
  NSE_EMERGE_SOURCE_CODE,
} from './sme-document-matcher.service';

describe('SmeDocumentMatcherService', () => {
  let service: SmeDocumentMatcherService;
  let prisma: {
    ipo: { findUnique: jest.Mock };
    source: { findMany: jest.Mock };
    discoveryRecord: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      ipo: { findUnique: jest.fn() },
      source: { findMany: jest.fn() },
      discoveryRecord: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmeDocumentMatcherService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SmeDocumentMatcherService>(SmeDocumentMatcherService);
  });

  describe('findSmeOfficialDocument', () => {
    it('returns linked IpoDocument if already present with authoritative exchange URL', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-sme-1',
        marketSegment: 'SME',
        exchange: 'BSE',
        company: { id: 'comp-1', displayName: 'Tech Innovators SME Ltd', cin: null },
        documents: [
          {
            id: 'doc-1',
            documentType: 'PROSPECTUS' as DocumentType,
            sourceUrl: 'https://www.bseindia.com/downloads/ipo/tech_innovators_prospectus.pdf',
            fileName: 'tech_innovators_prospectus.pdf',
          },
        ],
        sourceIdentities: [],
      });

      const result = await service.findSmeOfficialDocument('ipo-sme-1');

      expect(result).not.toBeNull();
      expect(result?.documentId).toBe('doc-1');
      expect(result?.documentType).toBe('PROSPECTUS');
      expect(result?.sourceUrl).toBe(
        'https://www.bseindia.com/downloads/ipo/tech_innovators_prospectus.pdf',
      );
      expect(result?.matchSource).toBe('BSE_SME_MATCH');
    });

    it('matches BSE SME prospectus by company name from BSE discovery records', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-bse-sme',
        marketSegment: 'SME',
        exchange: 'BSE',
        company: { id: 'comp-bse', displayName: 'Zenith Logistics SME Ltd', cin: null },
        documents: [],
        sourceIdentities: [],
      });

      prisma.source.findMany.mockResolvedValue([
        { id: 'src-bse-sme', code: BSE_SME_SOURCE_CODE },
      ]);

      prisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-1',
          sourceId: 'src-bse-sme',
          companyName: 'Zenith Logistics Limited',
          sourceReference: 'https://www.bseindia.com/markets/publicIssues/zenith',
          rawPayload: {
            issueName: 'Zenith Logistics Limited SME IPO',
            documentUrl: 'https://www.bseindia.com/downloads/ipo/zenith_prospectus.pdf',
            filingType: 'PROSPECTUS',
            issueStartDate: '2026-03-10',
          },
          discoveredAt: new Date('2026-03-01'),
        },
      ]);

      const result = await service.findSmeOfficialDocument('ipo-bse-sme');

      expect(result).not.toBeNull();
      expect(result?.companyName).toBe('Zenith Logistics SME Ltd');
      expect(result?.documentType).toBe('PROSPECTUS');
      expect(result?.sourceUrl).toBe(
        'https://www.bseindia.com/downloads/ipo/zenith_prospectus.pdf',
      );
      expect(result?.matchSource).toBe('BSE_SME_MATCH');
    });

    it('matches NSE Emerge prospectus by symbol from NSE discovery records', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-nse-emerge',
        marketSegment: 'SME',
        exchange: 'NSE',
        symbol: 'ACCURATE',
        company: { id: 'comp-nse', displayName: 'Accurate Bio-Chem Limited', cin: null },
        documents: [],
        sourceIdentities: [],
      });

      prisma.source.findMany.mockResolvedValue([
        { id: 'src-nse-emerge', code: NSE_EMERGE_SOURCE_CODE },
      ]);

      prisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-nse-1',
          sourceId: 'src-nse-emerge',
          companyName: 'Accurate Bio-Chem Limited',
          externalId: 'ACCURATE',
          sourceReference: 'https://nsearchives.nseindia.com/emerge/ACCURATE',
          rawPayload: {
            symbol: 'ACCURATE',
            prospectusUrl: 'https://nsearchives.nseindia.com/emerge/ACCURATE_Prospectus.pdf',
            filingTitle: 'Accurate Bio-Chem SME Prospectus',
            filingType: 'PROSPECTUS',
          },
          discoveredAt: new Date('2026-04-01'),
        },
      ]);

      const result = await service.findSmeOfficialDocument('ipo-nse-emerge');

      expect(result).not.toBeNull();
      expect(result?.sourceUrl).toBe(
        'https://nsearchives.nseindia.com/emerge/ACCURATE_Prospectus.pdf',
      );
      expect(result?.matchSource).toBe('NSE_EMERGE_MATCH');
    });

    it('prefers PROSPECTUS over RHP over DRHP when multiple filings exist', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-ranking',
        marketSegment: 'SME',
        exchange: 'BSE',
        company: { id: 'comp-rank', displayName: 'Apex Instruments Limited', cin: null },
        documents: [],
        sourceIdentities: [],
      });

      prisma.source.findMany.mockResolvedValue([
        { id: 'src-bse', code: BSE_SME_SOURCE_CODE },
      ]);

      prisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-drhp',
          sourceId: 'src-bse',
          companyName: 'Apex Instruments Limited',
          rawPayload: {
            documentUrl: 'https://www.bseindia.com/downloads/ipo/apex_drhp.pdf',
            filingType: 'DRHP',
          },
          discoveredAt: new Date('2026-01-01'),
        },
        {
          id: 'rec-rhp',
          sourceId: 'src-bse',
          companyName: 'Apex Instruments Limited',
          rawPayload: {
            documentUrl: 'https://www.bseindia.com/downloads/ipo/apex_rhp.pdf',
            filingType: 'RHP',
          },
          discoveredAt: new Date('2026-02-01'),
        },
        {
          id: 'rec-prospectus',
          sourceId: 'src-bse',
          companyName: 'Apex Instruments Limited',
          rawPayload: {
            documentUrl: 'https://www.bseindia.com/downloads/ipo/apex_final_prospectus.pdf',
            filingType: 'PROSPECTUS',
          },
          discoveredAt: new Date('2026-02-15'),
        },
      ]);

      const result = await service.findSmeOfficialDocument('ipo-ranking');

      expect(result).not.toBeNull();
      expect(result?.documentType).toBe('PROSPECTUS');
      expect(result?.sourceUrl).toBe(
        'https://www.bseindia.com/downloads/ipo/apex_final_prospectus.pdf',
      );
    });

    it('rejects ambiguous matches when multiple distinct companies match similarly', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-ambiguous',
        marketSegment: 'SME',
        exchange: 'BSE',
        company: { id: 'comp-amb', displayName: 'National Solar Tech Limited', cin: null },
        documents: [],
        sourceIdentities: [],
      });

      prisma.source.findMany.mockResolvedValue([
        { id: 'src-bse', code: BSE_SME_SOURCE_CODE },
      ]);

      // Two different companies with overlapping tokens
      prisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-solar-1',
          sourceId: 'src-bse',
          companyName: 'National Solar Power Limited',
          rawPayload: {
            documentUrl: 'https://www.bseindia.com/downloads/ipo/solar_power.pdf',
            filingType: 'PROSPECTUS',
          },
          discoveredAt: new Date('2026-02-01'),
        },
        {
          id: 'rec-solar-2',
          sourceId: 'src-bse',
          companyName: 'National Solar Panels Limited',
          rawPayload: {
            documentUrl: 'https://www.bseindia.com/downloads/ipo/solar_panels.pdf',
            filingType: 'PROSPECTUS',
          },
          discoveredAt: new Date('2026-02-01'),
        },
      ]);

      const result = await service.findSmeOfficialDocument('ipo-ambiguous');

      // Ambiguity rejection: must return null rather than attaching wrong prospectus
      expect(result).toBeNull();
    });

    it('rejects unapproved third-party or malicious URLs', async () => {
      prisma.ipo.findUnique.mockResolvedValue({
        id: 'ipo-unapproved-url',
        marketSegment: 'SME',
        exchange: 'BSE',
        company: { id: 'comp-bad', displayName: 'Secure Tech Limited', cin: null },
        documents: [],
        sourceIdentities: [],
      });

      prisma.source.findMany.mockResolvedValue([
        { id: 'src-bse', code: BSE_SME_SOURCE_CODE },
      ]);

      prisma.discoveryRecord.findMany.mockResolvedValue([
        {
          id: 'rec-bad',
          sourceId: 'src-bse',
          companyName: 'Secure Tech Limited',
          rawPayload: {
            documentUrl: 'https://untrusted-ipo-blog.com/secure_tech_prospectus.pdf',
            filingType: 'PROSPECTUS',
          },
          discoveredAt: new Date('2026-02-01'),
        },
      ]);

      const result = await service.findSmeOfficialDocument('ipo-unapproved-url');

      expect(result).toBeNull();
    });
  });
});
