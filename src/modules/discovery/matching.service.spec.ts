import { MatchingService } from './matching.service';
import { createFakePrisma } from './fake-prisma';
import { DiscoveredIpo } from './discovery.types';
import { PrismaService } from '../../database/prisma.service';

const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function mockDiscovered(
  overrides: Partial<DiscoveredIpo> = {},
): DiscoveredIpo {
  return {
    company: {
      legalName: 'Acme Technologies Limited',
      displayName: 'Acme Tech',
      cin: 'L12345MH2020PLC123456',
      ...(overrides.company || {}),
    },
    ipo: {
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'OPEN',
      symbol: 'ACME',
      issueSize: '1000000000.00',
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: '10.00',
      priceBandLow: '100.00',
      priceBandHigh: '110.00',
      lotSize: 100,
      minimumLots: 1,
      ...(overrides.ipo || {}),
    },
    lifecycle: {
      drhpDate: null,
      rhpDate: null,
      anchorDate: null,
      openDate: '2026-09-01',
      closeDate: '2026-09-03',
      basisOfAllotmentDate: null,
      refundInitiationDate: null,
      dematCreditDate: null,
      listingDate: '2026-09-10',
      ...(overrides.lifecycle || {}),
    },
    source: {
      externalId: 'EXT-ACME-001',
      reference: 'nse://ipo/ACME',
      ...(overrides.source || {}),
    },
  };
}

describe('MatchingService', () => {
  it('1. strong CIN match: matches company when CIN is present and no IPO exists yet', async () => {
    const { prisma, db } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    db.companies.push({
      id: 'comp-111',
      legalName: 'Acme Technologies Limited',
      displayName: 'Acme Tech',
      cin: 'L12345MH2020PLC123456',
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const discovered = mockDiscovered({
      source: { externalId: null, reference: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('MATCH_COMPANY');
    if (result.decision === 'MATCH_COMPANY') {
      expect(result.companyId).toBe('comp-111');
      expect(result.confidence).toBe('HIGH');
    }
  });

  it('2. external source identity match: matches IPO directly by externalId', async () => {
    const { prisma, db } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    db.identities.push({
      id: 'id-1',
      ipoId: 'ipo-999',
      sourceId: SOURCE_ID,
      externalId: 'EXT-ACME-001',
      symbol: 'ACME',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    db.ipos.push({
      id: 'ipo-999',
      companyId: 'comp-111',
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'OPEN',
      symbol: 'ACME',
      issueSize: null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: null,
      priceBandLow: null,
      priceBandHigh: null,
      lotSize: null,
      minimumLots: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const discovered = mockDiscovered({
      company: { cin: null, legalName: 'Acme Technologies Limited', displayName: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('MATCH_IPO');
    if (result.decision === 'MATCH_IPO') {
      expect(result.ipoId).toBe('ipo-999');
      expect(result.companyId).toBe('comp-111');
    }
  });

  it('3. normalized company name + symbol/exchange match: matches company and single IPO by legal name', async () => {
    const { prisma, db } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    db.companies.push({
      id: 'comp-222',
      legalName: 'Beta Systems Limited',
      displayName: 'Beta Systems',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    db.ipos.push({
      id: 'ipo-222',
      companyId: 'comp-222',
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'OPEN',
      symbol: 'BETA',
      issueSize: null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: null,
      priceBandLow: null,
      priceBandHigh: null,
      lotSize: null,
      minimumLots: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const discovered = mockDiscovered({
      company: { cin: null, legalName: '  BETA SYSTEMS LIMITED  ', displayName: null },
      ipo: { symbol: 'BETA', marketSegment: 'MAINBOARD', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
      source: { externalId: null, reference: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('MATCH_IPO');
    if (result.decision === 'MATCH_IPO') {
      expect(result.ipoId).toBe('ipo-222');
      expect(result.companyId).toBe('comp-222');
    }
  });

  it('4. no match: returns CREATE when no company or symbol exists', async () => {
    const { prisma } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    const discovered = mockDiscovered({
      company: { cin: null, legalName: 'Brand New Startup Ltd', displayName: null },
      source: { externalId: null, reference: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('CREATE');
  });

  it('5. ambiguous match: rejects when multiple companies share the same normalized name', async () => {
    const { prisma, db } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    db.companies.push({
      id: 'comp-a',
      legalName: 'Alpha Corp Ltd',
      displayName: 'Alpha Corp',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    db.companies.push({
      id: 'comp-b',
      legalName: 'Alpha Corp Ltd',
      displayName: 'Alpha Corp',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const discovered = mockDiscovered({
      company: { cin: null, legalName: 'Alpha Corp Ltd', displayName: null },
      source: { externalId: null, reference: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('REJECT');
    if (result.decision === 'REJECT') {
      expect(result.reason).toContain('ambiguous company match');
    }
  });

  it('6. ensure weak/fuzzy matching cannot silently merge: rejects symbol match for different company name', async () => {
    const { prisma, db } = createFakePrisma();
    const service = new MatchingService(prisma as unknown as PrismaService);

    db.companies.push({
      id: 'comp-existing',
      legalName: 'Original Owner Corp',
      displayName: 'Original Owner',
      cin: null,
      website: null,
      industry: null,
      sector: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    db.ipos.push({
      id: 'ipo-existing',
      companyId: 'comp-existing',
      marketSegment: 'MAINBOARD',
      exchange: 'NSE',
      status: 'OPEN',
      symbol: 'SHARED',
      issueSize: null,
      freshIssueSize: null,
      ofsSize: null,
      issueShareCount: null,
      freshIssueShareCount: null,
      ofsShareCount: null,
      faceValue: null,
      priceBandLow: null,
      priceBandHigh: null,
      lotSize: null,
      minimumLots: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const discovered = mockDiscovered({
      company: { cin: null, legalName: 'Completely Different Company Ltd', displayName: null },
      ipo: { symbol: 'SHARED', marketSegment: 'MAINBOARD', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
      source: { externalId: null, reference: null },
    });

    const result = await service.match(discovered, SOURCE_ID);
    expect(result.decision).toBe('REJECT');
    if (result.decision === 'REJECT') {
      expect(result.reason).toContain('symbol matches existing IPO but company name differs');
    }
  });

  describe('Required Fixes Coverage', () => {
    it('1. No CIN + no externalId + no legalName → REJECT', async () => {
      const { prisma } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      const discovered = mockDiscovered({
        company: { cin: null, legalName: '', displayName: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('REJECT');
      if (result.decision === 'REJECT') {
        expect(result.reason).toContain('insufficient company identity');
      }
    });

    it('2. Whitespace-only legalName → REJECT', async () => {
      const { prisma } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      const discovered = mockDiscovered({
        company: { cin: null, legalName: '   \t\n  ', displayName: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('REJECT');
      if (result.decision === 'REJECT') {
        expect(result.reason).toContain('insufficient company identity');
      }
    });

    it('3. Punctuation-only legalName → REJECT', async () => {
      const { prisma } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      const discovered = mockDiscovered({
        company: { cin: null, legalName: '??? --- !!!', displayName: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('REJECT');
      if (result.decision === 'REJECT') {
        expect(result.reason).toContain('insufficient company identity');
      }
    });

    it('4. Existing company with one MAINBOARD/NSE IPO + incoming compatible MAINBOARD/NSE observation → MATCH_IPO', async () => {
      const { prisma, db } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      db.companies.push({
        id: 'comp-abc',
        legalName: 'Company ABC Limited',
        displayName: 'Company ABC',
        cin: null,
        website: null,
        industry: null,
        sector: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      db.ipos.push({
        id: 'ipo-abc-1',
        companyId: 'comp-abc',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'ABC',
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discovered = mockDiscovered({
        company: { cin: null, legalName: 'Company ABC Limited', displayName: null },
        ipo: { symbol: 'ABC', marketSegment: 'MAINBOARD', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('MATCH_IPO');
      if (result.decision === 'MATCH_IPO') {
        expect(result.ipoId).toBe('ipo-abc-1');
        expect(result.companyId).toBe('comp-abc');
      }
    });

    it('5. Existing company with one MAINBOARD/NSE IPO + incoming incompatible SME observation → MATCH_COMPANY', async () => {
      const { prisma, db } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      db.companies.push({
        id: 'comp-abc',
        legalName: 'Company ABC Limited',
        displayName: 'Company ABC',
        cin: null,
        website: null,
        industry: null,
        sector: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      db.ipos.push({
        id: 'ipo-abc-1',
        companyId: 'comp-abc',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'ABC',
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discovered = mockDiscovered({
        company: { cin: null, legalName: 'Company ABC Limited', displayName: null },
        ipo: { symbol: 'ABCSME', marketSegment: 'SME', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('MATCH_COMPANY');
      if (result.decision === 'MATCH_COMPANY') {
        expect(result.companyId).toBe('comp-abc');
      }
    });

    it('6. Existing company with one IPO but conflicting exchange → MATCH_COMPANY', async () => {
      const { prisma, db } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      db.companies.push({
        id: 'comp-abc',
        legalName: 'Company ABC Limited',
        displayName: 'Company ABC',
        cin: null,
        website: null,
        industry: null,
        sector: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      db.ipos.push({
        id: 'ipo-abc-1',
        companyId: 'comp-abc',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'ABC',
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discovered = mockDiscovered({
        company: { cin: null, legalName: 'Company ABC Limited', displayName: null },
        ipo: { symbol: 'ABC', marketSegment: 'MAINBOARD', exchange: 'BSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('MATCH_COMPANY');
      if (result.decision === 'MATCH_COMPANY') {
        expect(result.companyId).toBe('comp-abc');
      }
    });

    it('7. Existing company with one IPO but conflicting symbol → MATCH_COMPANY', async () => {
      const { prisma, db } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      db.companies.push({
        id: 'comp-abc',
        legalName: 'Company ABC Limited',
        displayName: 'Company ABC',
        cin: null,
        website: null,
        industry: null,
        sector: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      db.ipos.push({
        id: 'ipo-abc-1',
        companyId: 'comp-abc',
        marketSegment: 'MAINBOARD',
        exchange: 'NSE',
        status: 'OPEN',
        symbol: 'ABC',
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discovered = mockDiscovered({
        company: { cin: null, legalName: 'Company ABC Limited', displayName: null },
        ipo: { symbol: 'DIFFERENT', marketSegment: 'MAINBOARD', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discovered, SOURCE_ID);
      expect(result.decision).toBe('MATCH_COMPANY');
      if (result.decision === 'MATCH_COMPANY') {
        expect(result.companyId).toBe('comp-abc');
      }
    });

    it('8. Two distinct IPO offerings under the same company must never be automatically merged merely because company identity matches', async () => {
      const { prisma, db } = createFakePrisma();
      const service = new MatchingService(prisma as unknown as PrismaService);

      db.companies.push({
        id: 'comp-multi',
        legalName: 'Multi Offering Corp Ltd',
        displayName: 'Multi Offering',
        cin: 'L99999MH2020PLC999999',
        website: null,
        industry: null,
        sector: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      db.ipos.push({
        id: 'ipo-first',
        companyId: 'comp-multi',
        marketSegment: 'SME',
        exchange: 'NSE',
        status: 'LISTED',
        symbol: 'MULTISME',
        issueSize: null,
        freshIssueSize: null,
        ofsSize: null,
        issueShareCount: null,
        freshIssueShareCount: null,
        ofsShareCount: null,
        faceValue: null,
        priceBandLow: null,
        priceBandHigh: null,
        lotSize: null,
        minimumLots: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const discoveredNewIssue = mockDiscovered({
        company: { cin: 'L99999MH2020PLC999999', legalName: 'Multi Offering Corp Ltd', displayName: null },
        ipo: { symbol: 'MULTI', marketSegment: 'MAINBOARD', exchange: 'NSE', status: 'OPEN', issueSize: null, freshIssueSize: null, ofsSize: null, issueShareCount: null, freshIssueShareCount: null, ofsShareCount: null, faceValue: null, priceBandLow: null, priceBandHigh: null, lotSize: null, minimumLots: null },
        source: { externalId: null, reference: null },
      });

      const result = await service.match(discoveredNewIssue, SOURCE_ID);
      expect(result.decision).toBe('MATCH_COMPANY');
      if (result.decision === 'MATCH_COMPANY') {
        expect(result.companyId).toBe('comp-multi');
      }
    });
  });
});
