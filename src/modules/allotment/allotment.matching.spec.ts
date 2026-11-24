import {
  AllotmentIdentifierType,
  AllotmentStatus,
  CheckAllotmentRequest,
} from './allotment.types';
import {
  applyRegistrarSpellingAliases,
  extractMeaningfulTokens,
  isTokenMatchSafely,
  levenshteinDistance,
  matchAllRegistrarCompanyCodes,
  matchRegistrarCompany,
  normalizeName,
  stripOfferingAndCorporateSuffixes,
} from './allotment.matching';

describe('Allotment Matching Pure Utility Tests', () => {
  const dummyRequest = (
    companyLegalName?: string,
    companyName?: string,
    symbol?: string,
  ): CheckAllotmentRequest => ({
    ipoId: '11111111-1111-1111-1111-111111111111',
    identifierType: AllotmentIdentifierType.PAN,
    identifierValue: 'ABCDE1234F',
    companyLegalName,
    companyName,
    symbol,
  });

  describe('Levenshtein distance & Token Safety', () => {
    it('calculates correct Levenshtein distance', () => {
      expect(levenshteinDistance('management', 'managment')).toBe(1);
      expect(levenshteinDistance('oneemi', 'onemi')).toBe(1);
      expect(levenshteinDistance('sbi', 'sbl')).toBe(1);
      expect(levenshteinDistance('abc', 'abd')).toBe(1);
      expect(levenshteinDistance('technology', 'techology')).toBe(1);
      expect(levenshteinDistance('fibre', 'finance')).toBe(4);
    });

    it('enforces short token exactness (<= 4 chars)', () => {
      expect(isTokenMatchSafely(['sbi', 'funds'], ['sbl', 'funds'])).toBe(false);
      expect(isTokenMatchSafely(['abc'], ['abd'])).toBe(false);
      expect(isTokenMatchSafely(['tata', 'motors'], ['tato', 'motors'])).toBe(false);
      expect(isTokenMatchSafely(['hero', 'motors'], ['hera', 'motors'])).toBe(false);
    });

    it('allows distance <= 1 for longer meaningful tokens (>= 5 chars)', () => {
      expect(
        isTokenMatchSafely(
          ['sbi', 'funds', 'management'],
          ['sbi', 'funds', 'managment'],
        ),
      ).toBe(true);
      expect(
        isTokenMatchSafely(
          ['oneemi', 'technology', 'solutions'],
          ['onemi', 'technology', 'solutions'],
        ),
      ).toBe(true);
    });
  });

  describe('Normalization & Spelling canonicalization', () => {
    it('normalizes corporate suffixes and offering types properly', () => {
      expect(stripOfferingAndCorporateSuffixes('Molbio Diagnostics Limited')).toBe(
        'molbio diagnostics',
      );
      expect(
        stripOfferingAndCorporateSuffixes('SBI FUNDS MANAGMENT LIMITED IPO'),
      ).toBe('sbi funds managment');
      expect(
        stripOfferingAndCorporateSuffixes('Crystal Crop Protection Ltd (Equity Shares)'),
      ).toBe('crystal crop protection');
      expect(
        stripOfferingAndCorporateSuffixes('Acme Solar Holdings [SME IPO] (Rights Issue)'),
      ).toBe('acme solar holdings');
      expect(normalizeName('Molbio Diagnostics Limited')).toBe(
        'molbiodiagnostics',
      );
      expect(normalizeName('SBI FUNDS MANAGMENT LIMITED IPO')).toBe(
        'sbifundsmanagment',
      );
    });

    it('strictly preserves "India" while stripping corporate and offering noise tokens', () => {
      const tokens = extractMeaningfulTokens('India Shelter Finance Corporation Ltd');
      expect(tokens).toContain('india');
      expect(tokens).toContain('shelter');
      expect(tokens).toContain('finance');
      expect(tokens).toContain('corporation');
      expect(tokens).not.toContain('ltd');

      const indiaPvtTokens = extractMeaningfulTokens('Link Intime India Private Limited (IPO)');
      expect(indiaPvtTokens).toContain('link');
      expect(indiaPvtTokens).toContain('intime');
      expect(indiaPvtTokens).toContain('india');
      expect(indiaPvtTokens).not.toContain('private');
      expect(indiaPvtTokens).not.toContain('limited');
      expect(indiaPvtTokens).not.toContain('ipo');
    });

    it('applies registrar spelling aliases deterministically', () => {
      expect(applyRegistrarSpellingAliases('sbifundsmanagment')).toBe(
        'sbifundsmanagement',
      );
      expect(applyRegistrarSpellingAliases('onemitechnologysolutions')).toBe(
        'oneemitechnologysolutions',
      );
    });
  });

  describe('Registrar Matching Contract Test Suite', () => {
    // 1. Exact Match: Molbio Diagnostics Limited
    it('0. should immediately match pre-configured registrarIpoCode if candidate code exists in list', () => {
      const list = [
        { clientId: '606', name: 'ACME INDIA INDUSTRIES LIMITED' },
        { clientId: '605', name: 'PARAMOUNT SYNTEX LIMITED' },
      ];
      const req = {
        ...dummyRequest('Acme India Industries', 'Acme India'),
        registrarIpoCode: '606',
      };
      const res = matchRegistrarCompany(list, req, 'BIGSHARE', 'Bigshare Services');
      expect(res).toBe('606');
    });

    it('1. should match Molbio Diagnostics Limited exactly', () => {
      const list = [
        { clientId: '81387868980', name: 'MOLBIO DIAGNOSTICS LIMITED' },
        { clientId: '99999999999', name: 'SOME OTHER COMPANY LIMITED' },
      ];
      const req = dummyRequest(
        'Molbio Diagnostics Limited',
        'Molbio Diagnostics',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect(res).toBe('81387868980');
    });

    // 2. Exact Match: Dhoot Transmission Limited
    it('2. should match Dhoot Transmission Limited exactly', () => {
      const list = [
        { clientId: '94818267561', name: 'DHOOT TRANSMISSION LIMITED' },
      ];
      const req = dummyRequest(
        'Dhoot Transmission Limited',
        'Dhoot Transmission',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect(res).toBe('94818267561');
    });

    // 3. Typo Match: SBI Funds Management Limited vs SBI FUNDS MANAGMENT LIMITED IPO
    it('3. should match SBI Funds Management Limited with registrar spelling typo (managment)', () => {
      const list = [
        { clientId: '89468061991', name: 'SBI FUNDS MANAGMENT LIMITED IPO' },
      ];
      const req = dummyRequest(
        'SBI Funds Management Limited',
        'SBI Funds Management',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect(res).toBe('89468061991');
    });

    // 4. Typo Match: OneEMI Technology Solutions Limited vs ONEMI TECHNOLOGY SOLUTIONS LIMITED
    it('4. should match OneEMI Technology Solutions Limited with registrar spelling variation (onemi)', () => {
      const list = [
        { clientId: '54450217260', name: 'ONEMI TECHNOLOGY SOLUTIONS LIMITED' },
      ];
      const req = dummyRequest(
        'OneEMI Technology Solutions Limited',
        'OneEMI Technology Solutions',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect(res).toBe('54450217260');
    });

    // 5. Must NOT match: SBI Funds Management Limited vs SBL Funds Management Limited
    it('5. must NOT match SBI vs SBL due to short identifier protection (length <= 4)', () => {
      const list = [
        { clientId: '12345678901', name: 'SBL FUNDS MANAGEMENT LIMITED' },
      ];
      const req = dummyRequest(
        'SBI Funds Management Limited',
        'SBI Funds Management',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect(typeof res).not.toBe('string');
      expect((res as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    });

    // 6. Must NOT match: Tata Motors Limited vs Hero Motors Limited
    it('6. must NOT match completely distinct companies (Tata Motors vs Hero Motors)', () => {
      const list = [
        { clientId: '12345678902', name: 'HERO MOTORS LIMITED' },
      ];
      const req = dummyRequest('Tata Motors Limited', 'Tata Motors');
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect((res as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    });

    // 7. Must NOT match: ABC Limited vs ABD Limited
    it('7. must NOT match short company names differing by 1 character (ABC vs ABD)', () => {
      const list = [
        { clientId: '12345678903', name: 'ABD LIMITED' },
      ];
      const req = dummyRequest('ABC Limited', 'ABC');
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect((res as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    });

    // 8. Must NOT match: Ashutosh Fibre Limited vs Ashutosh Finance Limited
    it('8. must NOT match different company with one shared token (Fibre vs Finance)', () => {
      const list = [
        { clientId: '12345678904', name: 'ASHUTOSH FINANCE LIMITED' },
      ];
      const req = dummyRequest(
        'Ashutosh Fibre Limited',
        'Ashutosh Fibre',
      );
      const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
      expect((res as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
    });

    // 9. Ambiguity: Two registrar records satisfying conservative matching rules -> NEEDS_REVIEW
    it('9. must return NEEDS_REVIEW when multiple candidates qualify under fallback rules', () => {
      const list = [
        { clientId: '11111111111', name: 'PRASOL PHARMA LIMITED' },
        { clientId: '22222222222', name: 'PRASOL PHARMO LIMITED' },
      ];
      // When target matches one candidate exactly
      const reqExact = dummyRequest(
        'Prasol Pharma Limited',
        'Prasol Pharma',
      );
      expect(
        matchRegistrarCompany(list, reqExact, 'KFINTECH', 'KFin Technologies'),
      ).toBe('11111111111');

      // When target is 1 edit from both candidates ('pharme' vs 'pharma' and 'pharmo') -> NEEDS_REVIEW
      const reqWithTypo = dummyRequest(
        'Prasol Pharme Limited',
        'Prasol Pharme',
      );
      const res = matchRegistrarCompany(
        list,
        reqWithTypo,
        'KFINTECH',
        'KFin Technologies',
      );
      expect(typeof res).not.toBe('string');
      expect((res as any).status).toBe(AllotmentStatus.NEEDS_REVIEW);
    });

    // Symbol Priority Test
    it('should prioritize exact symbol match over company name', () => {
      const list = [
        {
          clientId: '88888888888',
          name: 'Completely Different Name Ltd',
          symbol: 'TARGETSYM',
        },
        { clientId: '99999999999', name: 'Target Co Ltd', symbol: 'OTHERSYM' },
      ];
      const req = dummyRequest('Target Co Ltd', 'Target Co', 'TARGETSYM');
      const res = matchRegistrarCompany(list, req, 'MUFG_INTIME', 'MUFG Intime');
      expect(res).toBe('88888888888');
    });

    // Ambiguous Symbols -> NEEDS_REVIEW
    it('should return NEEDS_REVIEW when multiple items have duplicate symbol', () => {
      const list = [
        { clientId: '11111111111', name: 'Company A Ltd', symbol: 'DUPSYM' },
        { clientId: '22222222222', name: 'Company B Ltd', symbol: 'DUPSYM' },
      ];
      const req = dummyRequest('Company A Ltd', 'Company A', 'DUPSYM');
      const res = matchRegistrarCompany(list, req, 'MUFG_INTIME', 'MUFG Intime');
      expect(typeof res).not.toBe('string');
      expect((res as any).status).toBe(AllotmentStatus.NEEDS_REVIEW);
    });

    describe('Phase 10 Production Physical-Device Regression Cases', () => {
      it('10. Shivchem Agro matches Maashitla company list even when entries contain UUID company_id', () => {
        const list = [
          { company_id: 'e4979d51-7805-4b88-aac1-db4dbf559bd1', company_name: 'SHIVCHEM AGRO LIMITED' },
          { company_id: '4a4f7df8-cedd-47f5-ba76-858ccbb27037', company_name: 'VAMA WOVENFAB LIMITED' },
        ];
        const req = dummyRequest('Shivchem Agro Limited', 'Shivchem Agro');
        const res = matchRegistrarCompany(list, req, 'MAASHITLA', 'Maashitla Securities');
        expect(res).toBe('SHIVCHEM AGRO LIMITED');
      });

      it('11. Acme Universal Safezone 9 matches Maashitla company list correctly', () => {
        const list = [
          { code: 'ACME UNIVERSAL SAFEZONE 9 LIMITED', name: 'ACME UNIVERSAL SAFEZONE 9 LIMITED' },
          { code: 'OTHER COMPANY LIMITED', name: 'OTHER COMPANY LIMITED' },
        ];
        const req = dummyRequest('Acme Universal Safezone 9 Limited', 'Acme Universal Safezone 9');
        const res = matchRegistrarCompany(list, req, 'MAASHITLA', 'Maashitla Securities');
        expect(res).toBe('ACME UNIVERSAL SAFEZONE 9 LIMITED');
      });

      it('12. EverestIMS Technologies matches Maashitla EVEREST IMS TECHNOLOGIES LIMITED (with space)', () => {
        const list = [
          { code: 'EVEREST IMS TECHNOLOGIES LIMITED', name: 'EVEREST IMS TECHNOLOGIES LIMITED' },
        ];
        const req = dummyRequest('EverestIMS Technologies Limited', 'EverestIMS Technologies');
        const res = matchRegistrarCompany(list, req, 'MAASHITLA', 'Maashitla Securities');
        expect(res).toBe('EVEREST IMS TECHNOLOGIES LIMITED');
      });

      it('13. Nityas Gems & Jewellery matches Bigshare NITYAS GEMS AND JEWELLERY LIMITED (& vs AND normalization)', () => {
        const list = [
          { code: '1092', name: 'NITYAS GEMS AND JEWELLERY LIMITED' },
        ];
        const req = dummyRequest('Nityas Gems & Jewellery Limited', 'Nityas Gems & Jewellery');
        const res = matchRegistrarCompany(list, req, 'BIGSHARE', 'Bigshare Services');
        expect(res).toBe('1092');
      });

      it('14. Sollfege Smart Electronics matches KFin SOLLFEGE SMART ELECTRONICS LIMITED with display name Sollfege', () => {
        const list = [
          { clientId: '47651989560', name: 'SOLLFEGE SMART ELECTRONICS LIMITED' },
        ];
        const req = dummyRequest('Sollfege Smart Electronics Limited', 'Sollfege');
        const res = matchRegistrarCompany(list, req, 'KFINTECH', 'KFin Technologies');
        expect(res).toBe('47651989560');
      });

      it('15. must NOT match Atlanta against Atlanta Electricals in Tier 4 prefix matching', () => {
        const list = [
          { code: 'ATLANTA_ELEC', name: 'ATLANTA ELECTRICALS LIMITED' },
        ];
        const req = dummyRequest('Atlanta Limited', 'Atlanta');
        const res = matchRegistrarCompany(list, req, 'MUFG_INTIME', 'Link Intime');
        expect(typeof res).not.toBe('string');
        expect((res as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);

        const list2 = [
          { code: 'ATLANTA_OLD', name: 'ATLANTA LIMITED' },
        ];
        const req2 = dummyRequest('Atlanta Electricals Limited', 'Atlanta Electricals');
        const res2 = matchRegistrarCompany(list2, req2, 'MUFG_INTIME', 'Link Intime');
        expect(typeof res2).not.toBe('string');
        expect((res2 as any).status).toBe(AllotmentStatus.NOT_YET_AVAILABLE);
      });

      it('16. matchAllRegistrarCompanyCodes ignores UUID registrarIpoCode in Step 0', () => {
        const list = [
          { code: '4001', name: 'REAL COMPANY LIMITED' },
        ];
        const uuidCode = '550e8400-e29b-41d4-a716-446655440000';
        const req: any = {
          ...dummyRequest('Real Company Limited', 'Real Company'),
          registrarIpoCode: uuidCode,
        };
        const res = matchAllRegistrarCompanyCodes(list, req, 'BIGSHARE', 'Bigshare Services');
        // Matches by exact company name in Step 2, returning code 4001 rather than matching UUID
        expect(res).toEqual(['4001']);
      });

      it('17. Tier 4 containment allows pairwise aligned token prefix when token counts match', () => {
        const list = [
          { code: 'ABC_TECH', name: 'ABC TECHNO LIMITED' },
        ];
        const req = dummyRequest('ABC Technologies Limited', 'ABC Technologies');
        const res = matchRegistrarCompany(list, req, 'BIGSHARE', 'Bigshare Services');
        expect(res).toBe('ABC_TECH');
      });
    });
  });
});
