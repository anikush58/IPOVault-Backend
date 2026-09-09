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

describe('ReconciliationService (Phase 9 Multi-Source Reconciliation)', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    service = new ReconciliationService();
  });

  describe('reconcileObservations (Pure Observation Reconciliation)', () => {
    it('returns MATCH when SEBI and NSE observations have identical values', () => {
      const sebi = mockObservation();
      const nse = mockObservation();

      const result = service.reconcileObservations(sebi, nse);

      expect(result.hasConflict).toBe(false);
      expect(result.comparisons.every((c) => c.outcome === 'MATCH')).toBe(true);
    });

    it('returns MATCH when numeric values are equal but formatted differently (500 vs 500.00)', () => {
      const sebi = mockObservation({ issueSize: '500.00' });
      const nse = mockObservation({ issueSize: '500' });

      const result = service.reconcileObservations(sebi, nse);

      const issueSizeComp = result.comparisons.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeComp?.outcome).toBe('MATCH');
    });

    it('returns CONFLICT when SEBI and NSE values differ on price band or issue size', () => {
      const sebi = mockObservation({ issueSize: '500.00', priceBandLow: '175.00' });
      const nse = mockObservation({ issueSize: '520.00', priceBandLow: '180.00' });

      const result = service.reconcileObservations(sebi, nse);

      expect(result.hasConflict).toBe(true);

      const issueSizeComp = result.comparisons.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeComp?.outcome).toBe('CONFLICT');
      expect(issueSizeComp?.sebiValue).toBe('500.00');
      expect(issueSizeComp?.exchangeValue).toBe('520.00');

      const priceBandLowComp = result.comparisons.find((c) => c.fieldName === 'price_band_low');
      expect(priceBandLowComp?.outcome).toBe('CONFLICT');
    });

    it('classifies SEBI_ONLY when field exists in SEBI but is null in Exchange', () => {
      const sebi = mockObservation({ ofsSize: '200.00' });
      const nse = mockObservation({ ofsSize: null });

      const result = service.reconcileObservations(sebi, nse);

      const ofsComp = result.comparisons.find((c) => c.fieldName === 'ofs_size');
      expect(ofsComp?.outcome).toBe('SEBI_ONLY');
      expect(ofsComp?.sebiValue).toBe('200.00');
      expect(ofsComp?.exchangeValue).toBeNull();
    });

    it('classifies EXCHANGE_ONLY when field is null in SEBI but exists in Exchange', () => {
      const sebi = mockObservation({ lotSize: null });
      const nse = mockObservation({ lotSize: 80 });

      const result = service.reconcileObservations(sebi, nse);

      const lotComp = result.comparisons.find((c) => c.fieldName === 'lot_size');
      expect(lotComp?.outcome).toBe('EXCHANGE_ONLY');
      expect(lotComp?.sebiValue).toBeNull();
      expect(lotComp?.exchangeValue).toBe('80');
    });

    it('classifies UNRESOLVED when both SEBI and Exchange values are null', () => {
      const sebi = mockObservation({ freshIssueSize: null });
      const nse = mockObservation({ freshIssueSize: null });

      const result = service.reconcileObservations(sebi, nse);

      const freshComp = result.comparisons.find((c) => c.fieldName === 'fresh_issue_size');
      expect(freshComp?.outcome).toBe('UNRESOLVED');
    });
  });

  describe('detectConflicts (Active vs Historical Provenance Analysis)', () => {
    it('does NOT report false conflict for intra-source historical revisions (e.g. SEBI DRHP 175 -> SEBI RHP 180)', async () => {
      const mockIpo = {
        id: 'ipo-1',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        priceBandLow: { toFixed: () => '180.00' },
      };

      // Two historical provenance rows from the SAME source (SEBI)
      const mockProvenances = [
        {
          fieldName: 'price_band_low',
          value: '175.00',
          sourceId: 'src-sebi',
          sourceReference: 'https://sebi.gov.in/drhp',
          retrievedAt: new Date('2026-01-01'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'price_band_low',
          value: '180.00',
          sourceId: 'src-sebi',
          sourceReference: 'https://sebi.gov.in/rhp',
          retrievedAt: new Date('2026-01-10'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(mockProvenances) },
      } as any;

      const report = await service.detectConflicts(db, 'ipo-1');

      // Since both rows are from SEBI, the latest (180.00) is active. No cross-source conflict.
      expect(report.hasAnyConflict).toBe(false);
      const priceBandConflict = report.conflicts.find((c) => c.fieldName === 'price_band_low');
      expect(priceBandConflict?.hasConflict).toBe(false);
      expect(priceBandConflict?.activeObservations).toHaveLength(1);
      expect(priceBandConflict?.activeObservations[0]!.value).toBe('180.00');
    });

    it('reports CONFLICT when active observations from distinct sources disagree (e.g. SEBI=180 vs NSE=175)', async () => {
      const mockIpo = {
        id: 'ipo-2',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        priceBandLow: { toFixed: () => '180.00' },
      };

      const mockProvenances = [
        {
          fieldName: 'price_band_low',
          value: '180.00',
          sourceId: 'src-sebi',
          sourceReference: 'https://sebi.gov.in/rhp',
          retrievedAt: new Date('2026-01-10'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'price_band_low',
          value: '175.00',
          sourceId: 'src-nse',
          sourceReference: 'https://nseindia.com/ipo',
          retrievedAt: new Date('2026-01-11'),
          source: { code: 'nse', sourceType: SourceType.EXCHANGE },
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(mockProvenances) },
      } as any;

      const report = await service.detectConflicts(db, 'ipo-2');

      expect(report.hasAnyConflict).toBe(true);
      const priceBandConflict = report.conflicts.find((c) => c.fieldName === 'price_band_low');
      expect(priceBandConflict?.hasConflict).toBe(true);
      expect(priceBandConflict?.activeObservations).toHaveLength(2);
    });
  });

  describe('reconcileIpo (Scoped Multi-Source Reconciliation Summary)', () => {
    it('produces structured reconciliation summary for SEBI and NSE active observations without database writes', async () => {
      const mockIpo = {
        id: 'ipo-3',
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
          sourceReference: 'https://sebi.gov.in/rhp',
          retrievedAt: new Date('2026-01-10'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'issue_size',
          value: '520.00',
          sourceId: 'src-nse',
          sourceReference: 'https://nseindia.com/ipo',
          retrievedAt: new Date('2026-01-11'),
          source: { code: 'nse', sourceType: SourceType.EXCHANGE },
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(mockProvenances) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-3');

      expect(summary.ipoId).toBe('ipo-3');
      expect(summary.hasCrossSourceConflict).toBe(true);
      expect(summary.sebiActiveObservation['issue_size']).toBe('500.00');
      expect(summary.exchangeActiveObservation['issue_size']).toBe('520.00');

      const issueSizeComp = summary.fieldComparisons.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeComp?.outcome).toBe('CONFLICT');

      // Idempotency check: repeated calls return identical results without mutating state
      const summary2 = await service.reconcileIpo(db, 'ipo-3');
      expect(summary2).toEqual(summary);
    });
  });
});
