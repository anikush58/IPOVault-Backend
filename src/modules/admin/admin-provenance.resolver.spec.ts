import { Test, TestingModule } from '@nestjs/testing';
import { SourceType } from '@prisma/client';
import { AdminProvenanceResolver } from './admin-provenance.resolver';
import { FieldProvenanceWithSource } from '../ipos/ipo.mapper';

describe('AdminProvenanceResolver', () => {
  let resolver: AdminProvenanceResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminProvenanceResolver],
    }).compile();

    resolver = module.get<AdminProvenanceResolver>(AdminProvenanceResolver);
  });

  describe('resolveField - 6 Visual States', () => {
    it('1. 🟢 IPOGuru: resolves IPOGURU status when source is IPOGuru commercial feed', () => {
      const now = new Date('2026-10-01T10:00:00Z');
      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p1',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'lotSize',
          value: '1000',
          confidence: null as any,
          sourceReference: 'https://ipoguru.in/api/v2/ipos/123',
          sourceId: 'src-ig',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-ig',
            code: 'IPOGURU_COMMERCIAL',
            name: 'IPOGuru API',
            sourceType: SourceType.SECONDARY,
            priority: 3,
            baseUrl: 'https://ipoguru.in',
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
      ];

      const res = resolver.resolveField('lotSize', 1000, provs);

      expect(res.status).toBe('IPOGURU');
      expect(res.statusLabel).toBe('IPOGuru');
      expect(res.sourceCode).toBe('IPOGURU_COMMERCIAL');
      expect(res.hasConflict).toBe(false);
    });

    it('2. 🔵 AI Enriched: resolves AI_ENRICHED status with SEBI prospectus reference and confidence', () => {
      const now = new Date('2026-10-02T12:00:00Z');
      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p2',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'freshIssueSize',
          value: '450.50',
          confidence: new (class { toString() { return '0.98'; } valueOf() { return 0.98; } })() as any,
          sourceReference: 'https://sebi.gov.in/filings/drhp123.pdf | Hash: 8f9b2a1c | Section: Objects of the Offer',
          sourceId: 'src-ai',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-ai',
            code: 'SEBI_AI_EXTRACTED',
            name: 'SEBI DRHP AI Extraction',
            sourceType: SourceType.OFFICIAL_FILING,
            priority: 4,
            baseUrl: 'https://sebi.gov.in',
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
      ];

      const res = resolver.resolveField('freshIssueSize', 450.50, provs);

      expect(res.status).toBe('AI_ENRICHED');
      expect(res.statusLabel).toBe('AI Enriched');
      expect(res.sourceLabel).toBe('SEBI Statutory Filing');
      expect(res.section).toBe('Objects of the Offer');
      expect(res.documentHash).toBe('8f9b2a1c');
      expect(res.sourceUrl).toBe('https://sebi.gov.in/filings/drhp123.pdf');
      expect(res.confidence).toBe(0.98);
      expect(res.model).toBe('Gemini 3.5 Flash');
      expect(res.hasConflict).toBe(false);
    });

    it('3. 🟣 Official Source: resolves OFFICIAL_SOURCE for deterministic exchange/SEBI feeds', () => {
      const now = new Date('2026-10-03T15:00:00Z');
      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p3',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'priceBandHigh',
          value: '425.00',
          confidence: null as any,
          sourceReference: 'https://www.nseindia.com/market-data/issue-details?symbol=TEST',
          sourceId: 'src-nse',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-nse',
            code: 'NSE',
            name: 'National Stock Exchange',
            sourceType: SourceType.EXCHANGE,
            priority: 2,
            baseUrl: 'https://www.nseindia.com',
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
      ];

      const res = resolver.resolveField('priceBandHigh', 425.00, provs);

      expect(res.status).toBe('OFFICIAL_SOURCE');
      expect(res.statusLabel).toBe('Official Source');
      expect(res.sourceLabel).toBe('NSE');
      expect(res.sourceCode).toBe('NSE');
      expect(res.hasConflict).toBe(false);
    });

    it('4. 🟠 Manual: resolves MANUAL status for admin overrides and manual edits', () => {
      const now = new Date('2026-10-04T09:00:00Z');
      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p4',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'displayName',
          value: 'Custom Display Name Ltd',
          confidence: null as any,
          sourceReference: 'Admin Console User Edit',
          sourceId: 'src-admin',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-admin',
            code: 'ADMIN',
            name: 'Admin Manual Review',
            sourceType: SourceType.OFFICIAL_FILING,
            priority: 1,
            baseUrl: null,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
      ];

      const res = resolver.resolveField('displayName', 'Custom Display Name Ltd', provs);

      expect(res.status).toBe('MANUAL');
      expect(res.statusLabel).toBe('Manual Entry');
      expect(res.sourceLabel).toBe('Admin Review / Override');
      expect(res.sourceCode).toBe('ADMIN');
      expect(res.hasConflict).toBe(false);
    });

    it('5. ⚪ No Verified Data: returns NO_VERIFIED_DATA when field is null/empty and has no provenance', () => {
      const res = resolver.resolveField('preIpoPe', null, []);

      expect(res.status).toBe('NO_VERIFIED_DATA');
      expect(res.statusLabel).toBe('No verified data');
      expect(res.sourceLabel).toBe('Not available');
      expect(res.sourceCode).toBe('NONE');
      expect(res.value).toBeNull();
      expect(res.hasConflict).toBe(false);
    });

    it('6. 🔴 Conflict / Review: detects conflicting values across distinct upstream sources', () => {
      const date1 = new Date('2026-10-01T10:00:00Z');
      const date2 = new Date('2026-10-02T10:00:00Z');

      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p-nse',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'issueSize',
          value: '500.00',
          confidence: null as any,
          sourceReference: 'https://nseindia.com',
          sourceId: 'src-nse',
          retrievedAt: date1,
          createdAt: date1,
          source: {
            id: 'src-nse',
            code: 'NSE',
            name: 'National Stock Exchange',
            sourceType: SourceType.EXCHANGE,
            priority: 2,
            baseUrl: 'https://nseindia.com',
            enabled: true,
            createdAt: date1,
            updatedAt: date1,
          } as any,
        },
        {
          id: 'p-ig',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'issueSize',
          value: '520.00',
          confidence: null as any,
          sourceReference: 'https://ipoguru.in',
          sourceId: 'src-ig',
          retrievedAt: date2,
          createdAt: date2,
          source: {
            id: 'src-ig',
            code: 'IPOGURU',
            name: 'IPOGuru API',
            sourceType: SourceType.SECONDARY,
            priority: 3,
            baseUrl: 'https://ipoguru.in',
            enabled: true,
            createdAt: date2,
            updatedAt: date2,
          } as any,
        },
      ];

      const res = resolver.resolveField('issueSize', 500.00, provs);

      expect(res.status).toBe('CONFLICT_REVIEW');
      expect(res.statusLabel).toBe('Conflict / Review');
      expect(res.hasConflict).toBe(true);
      expect(res.conflictingSources).toHaveLength(2);
      expect(res.conflictingSources?.[0].value).toBe('500.00');
      expect(res.conflictingSources?.[1].value).toBe('520.00');
    });
  });

  describe('Source Precedence Hierarchy', () => {
    it('Manual/Admin override (priority 1) trumps official, IPOGuru, and AI sources without conflict downgrade', () => {
      const date1 = new Date('2026-10-01T10:00:00Z');
      const date2 = new Date('2026-10-02T10:00:00Z');
      const date3 = new Date('2026-10-03T10:00:00Z');

      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p-ai',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'industry',
          value: 'Gems & Jewellery (AI)',
          confidence: null as any,
          sourceReference: 'Prospectus',
          sourceId: 'src-ai',
          retrievedAt: date1,
          createdAt: date1,
          source: {
            id: 'src-ai',
            code: 'SEBI_AI_EXTRACTED',
            name: 'SEBI AI',
            sourceType: SourceType.OFFICIAL_FILING,
            priority: 4,
            baseUrl: null,
            enabled: true,
            createdAt: date1,
            updatedAt: date1,
          } as any,
        },
        {
          id: 'p-ig',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'industry',
          value: 'Jewellery (IPOGuru)',
          confidence: null as any,
          sourceReference: 'Feed',
          sourceId: 'src-ig',
          retrievedAt: date2,
          createdAt: date2,
          source: {
            id: 'src-ig',
            code: 'IPOGURU',
            name: 'IPOGuru',
            sourceType: SourceType.SECONDARY,
            priority: 3,
            baseUrl: null,
            enabled: true,
            createdAt: date2,
            updatedAt: date2,
          } as any,
        },
        {
          id: 'p-admin',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'industry',
          value: 'Luxury Jewellery & Retail',
          confidence: null as any,
          sourceReference: 'Admin Explicit Override',
          sourceId: 'src-admin',
          retrievedAt: date3,
          createdAt: date3,
          source: {
            id: 'src-admin',
            code: 'ADMIN',
            name: 'Admin Review',
            sourceType: SourceType.OFFICIAL_FILING,
            priority: 1,
            baseUrl: null,
            enabled: true,
            createdAt: date3,
            updatedAt: date3,
          } as any,
        },
      ];

      const res = resolver.resolveField('industry', 'Luxury Jewellery & Retail', provs);

      expect(res.status).toBe('MANUAL');
      expect(res.statusLabel).toBe('Manual Entry');
      expect(res.sourceCode).toBe('ADMIN');
      expect(res.value).toBe('Luxury Jewellery & Retail');
    });

    it('Official source (priority 2) trumps IPOGuru (priority 3) and AI (priority 4)', () => {
      const date1 = new Date('2026-10-01T10:00:00Z');
      const date2 = new Date('2026-10-02T10:00:00Z');

      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p-ig',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'priceBandLow',
          value: '100',
          confidence: null as any,
          sourceReference: null,
          sourceId: 'src-ig',
          retrievedAt: date2,
          createdAt: date2,
          source: {
            id: 'src-ig',
            code: 'IPOGURU',
            name: 'IPOGuru',
            sourceType: SourceType.SECONDARY,
            priority: 3,
            baseUrl: null,
            enabled: true,
            createdAt: date2,
            updatedAt: date2,
          } as any,
        },
        {
          id: 'p-bse',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'priceBandLow',
          value: '100',
          confidence: null as any,
          sourceReference: null,
          sourceId: 'src-bse',
          retrievedAt: date1,
          createdAt: date1,
          source: {
            id: 'src-bse',
            code: 'BSE',
            name: 'BSE India',
            sourceType: SourceType.EXCHANGE,
            priority: 2,
            baseUrl: null,
            enabled: true,
            createdAt: date1,
            updatedAt: date1,
          } as any,
        },
      ];

      const res = resolver.resolveField('priceBandLow', 100, provs);

      expect(res.status).toBe('OFFICIAL_SOURCE');
      expect(res.sourceLabel).toBe('BSE');
      expect(res.hasConflict).toBe(false);
    });
  });

  describe('resolveAllFields - Full IPO Coverage', () => {
    it('resolves visual provenance mapping for an entire IPO object', () => {
      const ipoData = {
        legalName: 'TEST ENTERPRISES LIMITED',
        symbol: 'TESTENT',
        marketSegment: 'SME',
        priceBandLow: 120,
        priceBandHigh: 125,
        preIpoPe: null, // missing field
      };

      const now = new Date('2026-10-05T12:00:00Z');
      const provs: FieldProvenanceWithSource[] = [
        {
          id: 'p-bse',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'price_band_low',
          value: '120',
          confidence: null as any,
          sourceReference: 'https://bsesme.com',
          sourceId: 'src-bse',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-bse',
            code: 'BSE',
            name: 'BSE SME',
            sourceType: SourceType.EXCHANGE,
            priority: 2,
            baseUrl: 'https://bsesme.com',
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
        {
          id: 'p-ai',
          entityType: 'IPO',
          entityId: 'ipo-1',
          fieldName: 'price_band_high',
          value: '125',
          confidence: null as any,
          sourceReference: 'https://bseindia.com/prospectus.pdf | Hash: a1b2c3d4 | Section: Issue Details',
          sourceId: 'src-ai',
          retrievedAt: now,
          createdAt: now,
          source: {
            id: 'src-ai',
            code: 'BSE_SME_AI',
            name: 'BSE SME Prospectus AI',
            sourceType: SourceType.OFFICIAL_FILING,
            priority: 4,
            baseUrl: null,
            enabled: true,
            createdAt: now,
            updatedAt: now,
          } as any,
        },
      ];

      const map = resolver.resolveAllFields(ipoData, provs);

      expect(map.priceBandLow.status).toBe('OFFICIAL_SOURCE');
      expect(map.priceBandHigh.status).toBe('AI_ENRICHED');
      expect(map.priceBandHigh.sourceLabel).toBe('BSE SME Prospectus');
      expect(map.priceBandHigh.section).toBe('Issue Details');
      expect(map.preIpoPe.status).toBe('NO_VERIFIED_DATA');
      expect(map.preIpoPe.sourceLabel).toBe('Not available');
    });
  });
});
