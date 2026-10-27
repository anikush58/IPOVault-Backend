import { AllotmentStatus, CategoryAllotmentResult } from './allotment.types';
import {
  mapRegistrarCategory,
  deduplicateCategoryRecords,
  deriveOverallAllotment,
} from './allotment-category.utils';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { BigshareRegistrarAdapter } from './adapters/bigshare-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';

describe('Category-Aware IPO Allotment Specification & Regression Test Suite', () => {
  describe('1. mapRegistrarCategory', () => {
    it('should map various Retail registrar aliases to RETAIL', () => {
      expect(mapRegistrarCategory('IND')).toBe('RETAIL');
      expect(mapRegistrarCategory('RET')).toBe('RETAIL');
      expect(mapRegistrarCategory('RI')).toBe('RETAIL');
      expect(mapRegistrarCategory('RII')).toBe('RETAIL');
      expect(mapRegistrarCategory('RETAIL')).toBe('RETAIL');
      expect(mapRegistrarCategory('Retail Individual')).toBe('RETAIL');
      expect(mapRegistrarCategory('INDIVIDUAL')).toBe('RETAIL');
    });

    it('should map Shareholder registrar aliases to SHAREHOLDER', () => {
      expect(mapRegistrarCategory('SH')).toBe('SHAREHOLDER');
      expect(mapRegistrarCategory('SHA')).toBe('SHAREHOLDER');
      expect(mapRegistrarCategory('SHR')).toBe('SHAREHOLDER');
      expect(mapRegistrarCategory('SHH')).toBe('SHAREHOLDER');
      expect(mapRegistrarCategory('SHAREHOLDER')).toBe('SHAREHOLDER');
      expect(mapRegistrarCategory('SHARE HOLDERS QUOTA')).toBe('SHAREHOLDER');
    });

    it('should map Employee and HNI aliases accurately', () => {
      expect(mapRegistrarCategory('EMP')).toBe('EMPLOYEE');
      expect(mapRegistrarCategory('EMPLOYEE')).toBe('EMPLOYEE');
      expect(mapRegistrarCategory('HNI')).toBe('HNI');
      expect(mapRegistrarCategory('NII')).toBe('HNI');
      expect(mapRegistrarCategory('B-HNI')).toBe('HNI');
      expect(mapRegistrarCategory('S-HNI')).toBe('HNI');
      expect(mapRegistrarCategory('NON INSTITUTIONAL')).toBe('HNI');
    });

    it('should preserve unknown raw categories without guessing or inventing fake data', () => {
      expect(mapRegistrarCategory('PROMOTER_TRUST')).toBe('PROMOTER_TRUST');
      expect(mapRegistrarCategory('SPECIAL_RESERVED')).toBe('SPECIAL_RESERVED');
      expect(mapRegistrarCategory(undefined)).toBeUndefined();
      expect(mapRegistrarCategory('')).toBeUndefined();
      expect(mapRegistrarCategory(null)).toBeUndefined();
    });
  });

  describe('2. deriveOverallAllotment Multi-Category Scenarios (Requirement 4 & 7)', () => {
    it('Scenario A: Shareholder NOT_ALLOTTED (0 shares) + Retail ALLOTTED (15 shares) => Overall ALLOTTED (15 shares)', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          rawCategory: 'SH',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_SH_001',
        },
        {
          category: 'RETAIL',
          rawCategory: 'IND',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_RET_002',
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.ALLOTTED);
      expect(overall.sharesAllotted).toBe(15);
      expect(overall.sharesApplied).toBe(30);
    });

    it('Scenario B: Shareholder ALLOTTED (15 shares) + Retail NOT_ALLOTTED (0 shares) => Overall ALLOTTED (15 shares)', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          rawCategory: 'SH',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_SH_001',
        },
        {
          category: 'RETAIL',
          rawCategory: 'IND',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_RET_002',
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.ALLOTTED);
      expect(overall.sharesAllotted).toBe(15);
      expect(overall.sharesApplied).toBe(30);
    });

    it('Scenario C: Both categories NOT_ALLOTTED => Overall NOT_ALLOTTED only after both succeed', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_SH_001',
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_RET_002',
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.NOT_ALLOTTED);
      expect(overall.sharesAllotted).toBe(0);
      expect(overall.sharesApplied).toBe(30);
    });

    it('Scenario D: One category fails (SOURCE_UNAVAILABLE) while other is NOT_ALLOTTED => Overall NOT confirmed, NEVER false NOT_ALLOTTED', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          status: AllotmentStatus.SOURCE_UNAVAILABLE,
          sharesAllotted: 0,
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_RET_002',
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.SOURCE_UNAVAILABLE);
      expect(overall.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
    });

    it('Scenario D2: One category rate limited (RATE_LIMITED) while other is NOT_ALLOTTED => Overall RATE_LIMITED', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          status: AllotmentStatus.RATE_LIMITED,
          sharesAllotted: 0,
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.RATE_LIMITED);
      expect(overall.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
    });

    it('Scenario D3: One category NOT_YET_AVAILABLE while other is NOT_ALLOTTED => Overall NOT_YET_AVAILABLE', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          status: AllotmentStatus.NOT_YET_AVAILABLE,
          sharesAllotted: 0,
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
      expect(overall.status).not.toBe(AllotmentStatus.NOT_ALLOTTED);
    });

    it('Scenario E: Both categories ALLOTTED (15 + 15) => Overall ALLOTTED with sum total 30 shares without duplication', () => {
      const categories: CategoryAllotmentResult[] = [
        {
          category: 'SHAREHOLDER',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_SH_001',
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_RET_002',
        },
      ];

      const overall = deriveOverallAllotment(categories);
      expect(overall.status).toBe(AllotmentStatus.ALLOTTED);
      expect(overall.sharesAllotted).toBe(30);
      expect(overall.sharesApplied).toBe(30);
    });

    it('Scenario F: Existing single-category applications continue to work seamlessly', () => {
      const singleAllotted: CategoryAllotmentResult[] = [
        {
          category: 'RETAIL',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_RET_001',
        },
      ];
      const resAllotted = deriveOverallAllotment(singleAllotted);
      expect(resAllotted.status).toBe(AllotmentStatus.ALLOTTED);
      expect(resAllotted.sharesAllotted).toBe(15);

      const singleNotAllotted: CategoryAllotmentResult[] = [
        {
          category: 'RETAIL',
          status: AllotmentStatus.NOT_ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 0,
          applicationNumber: 'APP_RET_002',
        },
      ];
      const resNotAllotted = deriveOverallAllotment(singleNotAllotted);
      expect(resNotAllotted.status).toBe(AllotmentStatus.NOT_ALLOTTED);
      expect(resNotAllotted.sharesAllotted).toBe(0);
    });

    it('Scenario G: Deduplication of repeated registrar records is idempotent', () => {
      const duplicateRecords: CategoryAllotmentResult[] = [
        {
          category: 'RETAIL',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_123',
        },
        {
          category: 'RETAIL',
          status: AllotmentStatus.ALLOTTED,
          sharesApplied: 15,
          sharesAllotted: 15,
          applicationNumber: 'APP_123', // duplicate record from server glitch
        },
      ];

      const deduped = deduplicateCategoryRecords(duplicateRecords);
      expect(deduped).toHaveLength(1);
      const overall = deriveOverallAllotment(duplicateRecords);
      expect(overall.sharesAllotted).toBe(15); // not double counted to 30!
    });
  });

  describe('3. Registrar Multi-Category Array End-to-End Parsing', () => {
    let kfinAdapter: KfinRegistrarAdapter;
    let mufgAdapter: MufgIntimeRegistrarAdapter;
    let bigshareAdapter: BigshareRegistrarAdapter;
    let maashitlaAdapter: MaashitlaRegistrarAdapter;

    beforeEach(() => {
      kfinAdapter = new KfinRegistrarAdapter();
      mufgAdapter = new MufgIntimeRegistrarAdapter();
      bigshareAdapter = new BigshareRegistrarAdapter();
      maashitlaAdapter = new MaashitlaRegistrarAdapter();
    });

    it('KFin: parses multi-category array with Shareholder (0) + Retail (15) => ALLOTTED with breakdown', () => {
      const kfinMultiCategoryPayload = [
        {
          App_Shares: 15,
          All_Shares: 0,
          Appln_No: '10001',
          Category: 'SH',
          Name: 'ANISH KUSHWAHA',
        },
        {
          App_Shares: 15,
          All_Shares: 15,
          Appln_No: '10002',
          Category: 'IND',
          Name: 'ANISH KUSHWAHA',
        },
      ];

      const result = kfinAdapter.normalizeKfinResponse(
        kfinMultiCategoryPayload,
      );
      expect(result.status).toBe(AllotmentStatus.ALLOTTED);
      expect(result.sharesAllotted).toBe(15);
      expect(result.categoryResults).toBeDefined();
      expect(result.categoryResults).toHaveLength(2);

      const sh = result.categoryResults?.find(
        (c) => c.category === 'SHAREHOLDER',
      );
      const ret = result.categoryResults?.find((c) => c.category === 'RETAIL');
      expect(sh?.status).toBe(AllotmentStatus.NOT_ALLOTTED);
      expect(sh?.sharesAllotted).toBe(0);
      expect(ret?.status).toBe(AllotmentStatus.ALLOTTED);
      expect(ret?.sharesAllotted).toBe(15);
    });

    it('Link Intime: parses multi-table XML with Shareholder (15) + Retail (0) => ALLOTTED with breakdown', () => {
      const mufgMultiTableXml = {
        d: `<NewDataSet>
              <Table>
                <name>RAHUL VERMA</name>
                <CAT>SH</CAT>
                <SHARES>15</SHARES>
                <ALLOT>15</ALLOT>
                <app_no>LINK_SH_1</app_no>
              </Table>
              <Table>
                <name>RAHUL VERMA</name>
                <CAT>IND</CAT>
                <SHARES>15</SHARES>
                <ALLOT>0</ALLOT>
                <app_no>LINK_RET_2</app_no>
              </Table>
            </NewDataSet>`,
      };

      const result = mufgAdapter.normalizeMufgResponse(mufgMultiTableXml);
      expect(result.status).toBe(AllotmentStatus.ALLOTTED);
      expect(result.sharesAllotted).toBe(15);
      expect(result.categoryResults).toHaveLength(2);

      const sh = result.categoryResults?.find(
        (c) => c.category === 'SHAREHOLDER',
      );
      const ret = result.categoryResults?.find((c) => c.category === 'RETAIL');
      expect(sh?.status).toBe(AllotmentStatus.ALLOTTED);
      expect(ret?.status).toBe(AllotmentStatus.NOT_ALLOTTED);
    });

    it('Bigshare: parses multi-record payload with category breakdown', () => {
      const bigshareMultiRecordPayload = JSON.stringify({
        d: {
          Records: [
            {
              Name: 'PRIYA MEHTA',
              Category: 'SH',
              APPLIED: 15,
              ALLOTED: 15,
              AppNo: 'BIG_SH_1',
            },
            {
              Name: 'PRIYA MEHTA',
              Category: 'IND',
              APPLIED: 15,
              ALLOTED: 15,
              AppNo: 'BIG_RET_2',
            },
          ],
        },
      });

      const result = bigshareAdapter.parseAllotmentResult(
        bigshareMultiRecordPayload,
        {} as unknown as import('./allotment.types').CheckAllotmentRequest,
        new Date(),
      );
      expect(result.status).toBe(AllotmentStatus.ALLOTTED);
      expect(result.sharesAllotted).toBe(30); // 15 + 15 without double counting
      expect(result.categoryResults).toHaveLength(2);
    });

    it('Maashitla: parses multi-record array with category breakdown', () => {
      const maashitlaMultiPayload = [
        {
          name: 'KIRAN PATEL',
          applied_category: 'SHAREHOLDER',
          shares_applied: 30,
          shares_allotted: 0,
          application_no: 'MS_SH_1',
        },
        {
          name: 'KIRAN PATEL',
          applied_category: 'RETAIL',
          shares_applied: 30,
          shares_allotted: 30,
          application_no: 'MS_RET_2',
        },
      ];

      const result = maashitlaAdapter.normalizeMaashitlaResponse(
        maashitlaMultiPayload,
      );
      expect(result.status).toBe(AllotmentStatus.ALLOTTED);
      expect(result.sharesAllotted).toBe(30);
      expect(result.categoryResults).toHaveLength(2);
      expect(result.categoryResults?.[0].category).toBe('SHAREHOLDER');
      expect(result.categoryResults?.[0].status).toBe(
        AllotmentStatus.NOT_ALLOTTED,
      );
      expect(result.categoryResults?.[1].category).toBe('RETAIL');
      expect(result.categoryResults?.[1].status).toBe(AllotmentStatus.ALLOTTED);
    });
  });
});
