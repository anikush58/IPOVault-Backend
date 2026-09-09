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

describe('ReconciliationService (Phase 10 Data Quality Intelligence)', () => {
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

    it('returns CONFLICT when SEBI and NSE values differ', () => {
      const sebi = mockObservation({ issueSize: '500.00' });
      const nse = mockObservation({ issueSize: '520.00' });

      const result = service.reconcileObservations(sebi, nse);

      expect(result.hasConflict).toBe(true);
      const issueSizeComp = result.comparisons.find((c) => c.fieldName === 'issue_size');
      expect(issueSizeComp?.outcome).toBe('CONFLICT');
    });
  });

  describe('reconcileIpo (Data Quality & Consistency Checks)', () => {
    it('returns HEALTHY status for an internally consistent, fully matched IPO', async () => {
      const mockIpo = {
        id: 'ipo-healthy',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        issueSize: { toFixed: () => '500.00' },
        freshIssueSize: { toFixed: () => '300.00' },
        ofsSize: { toFixed: () => '200.00' },
        issueShareCount: { toString: () => '5000000' },
        freshIssueShareCount: { toString: () => '3000000' },
        ofsShareCount: { toString: () => '2000000' },
        priceBandLow: { toFixed: () => '175.00' },
        priceBandHigh: { toFixed: () => '185.00' },
        lotSize: 80,
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-healthy');

      expect(summary.qualitySummary.status).toBe('HEALTHY');
      expect(summary.qualitySummary.summary.errors).toBe(0);
      expect(summary.qualitySummary.summary.warnings).toBe(0);
    });

    it('detects INTERNAL_SHARE_COUNT_MISMATCH error when fresh + OFS != total share count', async () => {
      const mockIpo = {
        id: 'ipo-share-mismatch',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        issueShareCount: { toString: () => '5000000' },
        freshIssueShareCount: { toString: () => '3000000' },
        ofsShareCount: { toString: () => '1000000' }, // 3M + 1M = 4M != 5M
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-share-mismatch');

      expect(summary.qualitySummary.status).toBe('NEEDS_REVIEW');
      expect(summary.qualitySummary.summary.errors).toBeGreaterThanOrEqual(1);

      const finding = summary.qualitySummary.findings.find(
        (f) => f.code === 'INTERNAL_SHARE_COUNT_MISMATCH',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('ERROR');
    });

    it('detects INVALID_PRICE_BAND error when priceBandLow > priceBandHigh', async () => {
      const mockIpo = {
        id: 'ipo-bad-price-band',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        priceBandLow: { toFixed: () => '190.00' },
        priceBandHigh: { toFixed: () => '180.00' }, // 190 > 180!
        lotSize: 80,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-bad-price-band');

      expect(summary.qualitySummary.status).toBe('NEEDS_REVIEW');
      const finding = summary.qualitySummary.findings.find(
        (f) => f.code === 'INVALID_PRICE_BAND',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('ERROR');
    });

    it('detects INVALID_ISSUE_DATE_RANGE error when openDate > closeDate', async () => {
      const mockIpo = {
        id: 'ipo-bad-dates',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'TEST',
        priceBandLow: { toFixed: () => '175.00' },
        priceBandHigh: { toFixed: () => '185.00' },
        lotSize: 80,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        lifecycleEvents: [
          { eventType: 'OPEN', eventDate: new Date('2026-01-20T00:00:00Z') },
          { eventType: 'CLOSE', eventDate: new Date('2026-01-15T00:00:00Z') }, // Jan 20 > Jan 15!
        ],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-bad-dates');

      expect(summary.qualitySummary.status).toBe('NEEDS_REVIEW');
      const finding = summary.qualitySummary.findings.find(
        (f) => f.code === 'INVALID_ISSUE_DATE_RANGE',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('ERROR');
    });

    it('detects NON_POSITIVE_LOT_SIZE error when lotSize <= 0', async () => {
      const mockIpo = {
        id: 'ipo-zero-lot',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'UPCOMING',
        symbol: 'TEST',
        lotSize: 0,
        priceBandLow: null,
        priceBandHigh: null,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-zero-lot');

      const finding = summary.qualitySummary.findings.find(
        (f) => f.code === 'NON_POSITIVE_LOT_SIZE',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('ERROR');
    });

    it('detects SOURCE_CONFLICT warning when active SEBI and NSE observations disagree', async () => {
      const mockIpo = {
        id: 'ipo-conflict',
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
        lifecycleEvents: [],
      };

      const mockProvenances = [
        {
          fieldName: 'issue_size',
          value: '500.00',
          sourceId: 'src-sebi',
          sourceReference: 'ref-1',
          retrievedAt: new Date('2026-01-01'),
          source: { code: 'sebi', sourceType: SourceType.OFFICIAL_FILING },
        },
        {
          fieldName: 'issue_size',
          value: '520.00',
          sourceId: 'src-nse',
          sourceReference: 'ref-2',
          retrievedAt: new Date('2026-01-02'),
          source: { code: 'nse', sourceType: SourceType.EXCHANGE },
        },
      ];

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue(mockProvenances) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-conflict');

      expect(summary.qualitySummary.status).toBe('NEEDS_REVIEW');
      const finding = summary.qualitySummary.findings.find(
        (f) => f.code === 'SOURCE_CONFLICT',
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe('WARNING');
    });

    it('detects INCOMPLETE_TERMS warning for an OPEN IPO missing price band or lot size', async () => {
      const mockIpo = {
        id: 'ipo-open-incomplete',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'TEST',
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary = await service.reconcileIpo(db, 'ipo-open-incomplete');

      expect(summary.qualitySummary.status).toBe('NEEDS_REVIEW');
      const termsFindings = summary.qualitySummary.findings.filter(
        (f) => f.code === 'INCOMPLETE_TERMS',
      );
      expect(termsFindings.length).toBeGreaterThanOrEqual(2);
    });

    it('is strictly read-only, idempotent, and performs zero database writes', async () => {
      const mockIpo = {
        id: 'ipo-read-only',
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
        lifecycleEvents: [],
      };

      const db = {
        ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
        fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
      } as any;

      const summary1 = await service.reconcileIpo(db, 'ipo-read-only');
      const summary2 = await service.reconcileIpo(db, 'ipo-read-only');

      expect(summary1).toEqual(summary2);
      expect(db.ipo.findUnique).toHaveBeenCalledTimes(4);
    });

    describe('Phase 11 Hardening & False Positive Protection', () => {
      it('does NOT trigger INCOMPLETE_ISSUE_STRUCTURE for a valid Fresh-only IPO', async () => {
        const mockIpo = {
          id: 'ipo-fresh-only',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'UPCOMING',
          symbol: 'FRESHONLY',
          issueSize: { toFixed: () => '300.00' },
          freshIssueSize: { toFixed: () => '300.00' },
          ofsSize: null, // Legitimate fresh-only structure
          issueShareCount: { toString: () => '3000000' },
          freshIssueShareCount: { toString: () => '3000000' },
          ofsShareCount: null,
          priceBandLow: null,
          priceBandHigh: null,
          lotSize: null,
          lifecycleEvents: [],
        };

        const db = {
          ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
          fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        const summary = await service.reconcileIpo(db, 'ipo-fresh-only');
        const structureFindings = summary.qualitySummary.findings.filter(
          (f) => f.code === 'INCOMPLETE_ISSUE_STRUCTURE',
        );
        expect(structureFindings).toHaveLength(0);
      });

      it('does NOT trigger INCOMPLETE_ISSUE_STRUCTURE for a valid OFS-only IPO', async () => {
        const mockIpo = {
          id: 'ipo-ofs-only',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'UPCOMING',
          symbol: 'OFSONLY',
          issueSize: { toFixed: () => '200.00' },
          freshIssueSize: null,
          ofsSize: { toFixed: () => '200.00' }, // Legitimate OFS-only structure
          issueShareCount: { toString: () => '2000000' },
          freshIssueShareCount: null,
          ofsShareCount: { toString: () => '2000000' },
          priceBandLow: null,
          priceBandHigh: null,
          lotSize: null,
          lifecycleEvents: [],
        };

        const db = {
          ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
          fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        const summary = await service.reconcileIpo(db, 'ipo-ofs-only');
        const structureFindings = summary.qualitySummary.findings.filter(
          (f) => f.code === 'INCOMPLETE_ISSUE_STRUCTURE',
        );
        expect(structureFindings).toHaveLength(0);
      });

      it('does NOT trigger INVALID_ISSUE_DATE_RANGE for same-day open and close dates', async () => {
        const mockIpo = {
          id: 'ipo-sameday-dates',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'OPEN',
          symbol: 'SAMEDAY',
          priceBandLow: { toFixed: () => '100.00' },
          priceBandHigh: { toFixed: () => '105.00' },
          lotSize: 100,
          issueSize: null,
          freshIssueSize: null,
          ofsSize: null,
          issueShareCount: null,
          freshIssueShareCount: null,
          ofsShareCount: null,
          lifecycleEvents: [
            { eventType: 'OPEN', eventDate: new Date('2026-01-15T00:00:00Z') },
            { eventType: 'CLOSE', eventDate: new Date('2026-01-15T00:00:00Z') },
          ],
        };

        const db = {
          ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
          fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        const summary = await service.reconcileIpo(db, 'ipo-sameday-dates');
        const dateFinding = summary.qualitySummary.findings.find(
          (f) => f.code === 'INVALID_ISSUE_DATE_RANGE',
        );
        expect(dateFinding).toBeUndefined();
      });

      it('does NOT trigger INCOMPLETE_TERMS for early UPCOMING IPO missing price band/lot size', async () => {
        const mockIpo = {
          id: 'ipo-upcoming-early',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'UPCOMING',
          symbol: 'EARLY',
          priceBandLow: null,
          priceBandHigh: null,
          lotSize: null,
          issueSize: null,
          freshIssueSize: null,
          ofsSize: null,
          issueShareCount: null,
          freshIssueShareCount: null,
          ofsShareCount: null,
          lifecycleEvents: [],
        };

        const db = {
          ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
          fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        const summary = await service.reconcileIpo(db, 'ipo-upcoming-early');
        const termsFindings = summary.qualitySummary.findings.filter(
          (f) => f.code === 'INCOMPLETE_TERMS',
        );
        expect(termsFindings).toHaveLength(0);
      });

      it('does NOT trigger NON_POSITIVE_LOT_SIZE when lotSize is null', async () => {
        const mockIpo = {
          id: 'ipo-null-lot',
          marketSegment: 'MAINBOARD',
          exchange: 'NSE',
          status: 'UPCOMING',
          symbol: 'NULLLOT',
          lotSize: null,
          priceBandLow: null,
          priceBandHigh: null,
          issueSize: null,
          freshIssueSize: null,
          ofsSize: null,
          issueShareCount: null,
          freshIssueShareCount: null,
          ofsShareCount: null,
          lifecycleEvents: [],
        };

        const db = {
          ipo: { findUnique: jest.fn().mockResolvedValue(mockIpo) },
          fieldProvenance: { findMany: jest.fn().mockResolvedValue([]) },
        } as any;

        const summary = await service.reconcileIpo(db, 'ipo-null-lot');
        const lotFinding = summary.qualitySummary.findings.find(
          (f) => f.code === 'NON_POSITIVE_LOT_SIZE',
        );
        expect(lotFinding).toBeUndefined();
      });
    });
  });
});
