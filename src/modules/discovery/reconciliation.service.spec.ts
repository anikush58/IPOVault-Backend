import { SourceType } from '@prisma/client';

import { DiscoveredIpo } from './discovery.types';
import { ReconciliationService } from './reconciliation.service';

function mockObservation(overrides: Partial<DiscoveredIpo['ipo']> = {}): DiscoveredIpo {
  return {
    company: {
      legalName: 'TEST COMPANY LIMITED',
      displayName: 'TEST COMPANY LIMITED',
      cin: 'U12345MH2020PLC123456',
    },
    ipo: {
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'UPCOMING',
      symbol: 'TEST',
      issueSize: '500.00',
      freshIssueSize: '300.00',
      ofsSize: '200.00',
      issueShareCount: '5000000',
      freshIssueShareCount: '3000000',
      ofsShareCount: '2000000',
      faceValue: '10.00',
      priceBandLow: '175.00',
      priceBandHigh: '185.00',
      lotSize: 80,
      minimumLots: 1,
      ...overrides,
    },
    lifecycle: {
      drhpDate: '2026-01-01',
      rhpDate: '2026-01-10',
      anchorDate: null,
      openDate: '2026-01-15',
      closeDate: '2026-01-18',
      basisOfAllotmentDate: null,
      refundInitiationDate: null,
      dematCreditDate: null,
      listingDate: '2026-01-22',
    },
    source: {
      externalId: 'EXT123',
      reference: 'https://example.com',
      filingType: 'RHP',
    },
  };
}

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    service = new ReconciliationService();
  });

  describe('reconcileObservations', () => {
    it('returns MATCH when SEBI and Exchange observations have identical values', () => {
      const sebi = mockObservation();
      const exchange = mockObservation();

      const result = service.reconcileObservations(sebi, exchange);

      expect(result.hasConflict).toBe(false);
      expect(result.comparisons.every((c) => c.outcome === 'MATCH')).toBe(true);
    });

    it('detects CONFLICT when SEBI and Exchange observations differ on issue size or price band', () => {
      const sebi = mockObservation({ issueSize: '500.00', priceBandLow: '175.00' });
      const exchange = mockObservation({ issueSize: '520.00', priceBandLow: '180.00' });

      const result = service.reconcileObservations(sebi, exchange);

      expect(result.hasConflict).toBe(true);

      const issueSizeComp = result.comparisons.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeComp?.outcome).toBe('CONFLICT');
      expect(issueSizeComp?.sebiValue).toBe('500.00');
      expect(issueSizeComp?.exchangeValue).toBe('520.00');

      const priceBandLowComp = result.comparisons.find((c) => c.fieldName === 'price_band_low');
      expect(priceBandLowComp?.outcome).toBe('CONFLICT');
      expect(priceBandLowComp?.sebiValue).toBe('175.00');
      expect(priceBandLowComp?.exchangeValue).toBe('180.00');
    });

    it('identifies SEBI_ONLY and EXCHANGE_ONLY fields correctly', () => {
      const sebi = mockObservation({ ofsSize: '200.00', lotSize: null });
      const exchange = mockObservation({ ofsSize: null, lotSize: 80 });

      const result = service.reconcileObservations(sebi, exchange);

      const ofsComp = result.comparisons.find((c) => c.fieldName === 'ofs_size');
      expect(ofsComp?.outcome).toBe('SEBI_ONLY');
      expect(ofsComp?.sebiValue).toBe('200.00');
      expect(ofsComp?.exchangeValue).toBeNull();

      const lotComp = result.comparisons.find((c) => c.fieldName === 'lot_size');
      expect(lotComp?.outcome).toBe('EXCHANGE_ONLY');
      expect(lotComp?.sebiValue).toBeNull();
      expect(lotComp?.exchangeValue).toBe('80');
    });
  });

  describe('detectConflicts (Database-backed)', () => {
    it('computes reconciliation report from field provenances', async () => {
      const mockIpo = {
        id: 'ipo-1',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        issueSize: { toFixed: () => '500.00' },
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        priceBandLow: { toFixed: () => '175.00' },
        priceBandHigh: { toFixed: () => '185.00' },
        lotSize: 80,
      };

      const mockProvenances = [
        {
          fieldName: 'issue_size',
          value: '500.00',
          sourceId: 'src-sebi',
          sourceReference: 'https://sebi.gov.in/doc1',
          retrievedAt: new Date('2026-01-01'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'issue_size',
          value: '520.00',
          sourceId: 'src-bse',
          sourceReference: 'https://bseindia.com/doc1',
          retrievedAt: new Date('2026-01-02'),
          source: { code: 'bse', sourceType: SourceType.EXCHANGE },
        },
      ];

      const tx = {
        ipo: {
          findUnique: jest.fn().mockResolvedValue(mockIpo),
        },
        fieldProvenance: {
          findMany: jest.fn().mockResolvedValue(mockProvenances),
        },
      } as any;

      const report = await service.detectConflicts(tx, 'ipo-1');

      expect(report.ipoId).toBe('ipo-1');
      expect(report.hasAnyConflict).toBe(true);

      const issueSizeConflict = report.conflicts.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeConflict).toBeDefined();
      expect(issueSizeConflict?.hasConflict).toBe(true);
      expect(issueSizeConflict?.observations).toHaveLength(2);
      expect(issueSizeConflict?.observations[0]!.sourceCode).toBe('sebi');
      expect(issueSizeConflict?.observations[1]!.sourceCode).toBe('bse');
    });

    it('returns hasAnyConflict=false when all source observations for a field agree', async () => {
      const mockIpo = {
        id: 'ipo-2',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        issueSize: { toFixed: () => '500.00' },
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
      };

      const mockProvenances = [
        {
          fieldName: 'issue_size',
          value: '500.00',
          sourceId: 'src-sebi',
          sourceReference: 'https://sebi.gov.in/doc1',
          retrievedAt: new Date('2026-01-01'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'issue_size',
          value: '500.00',
          sourceId: 'src-bse',
          sourceReference: 'https://bseindia.com/doc1',
          retrievedAt: new Date('2026-01-02'),
          source: { code: 'bse', sourceType: SourceType.EXCHANGE },
        },
      ];

      const tx = {
        ipo: {
          findUnique: jest.fn().mockResolvedValue(mockIpo),
        },
        fieldProvenance: {
          findMany: jest.fn().mockResolvedValue(mockProvenances),
        },
      } as any;

      const report = await service.detectConflicts(tx, 'ipo-2');

      expect(report.hasAnyConflict).toBe(false);
    });
  });
});
