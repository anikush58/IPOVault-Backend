import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hashPayload } from '../../hash-payload';
import { normalizeDiscoveredIpo } from '../../normalize';
import { validateDiscoveredIpo } from '../../validate';
import { NseSourceAdapter } from './nse.adapter';
import { NseParseError } from './nse-parse.error';
import { parseNseIpo, parseNseIpos } from './nse.parser';

const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISCOVERED_AT = new Date('2026-09-01T10:00:00.000Z');

function loadFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(__dirname, 'fixtures', name), 'utf8'),
  ) as unknown;
}

describe('NSE parser', () => {
  it('parses required NSE fields from a realistic fixture', () => {
    const parsed = parseNseIpo(loadFixture('nse-ipo.valid.json'));

    expect(parsed.company.legalName).toBe('Mock Technologies Limited');
    expect(parsed.company.cin).toBe('U12345MH2024PLC000001');
    expect(parsed.ipo.marketSegment).toBe('MAINBOARD');
    expect(parsed.ipo.exchange).toBe('NSE');
    expect(parsed.ipo.status).toBe('UPCOMING');
    expect(parsed.ipo.symbol).toBe('MOCKTECH');
    expect(parsed.ipo.lotSize).toBe(120);
    expect(parsed.ipo.minimumLots).toBe(1);
    expect(parsed.source.externalId).toBe('MOCKTECH');
  });

  it('normalizes monetary values to INR rupees', () => {
    const parsed = parseNseIpo(loadFixture('nse-ipo.valid.json'));

    expect(parsed.ipo.issueSize).toBe(12_500_000_000);
    expect(parsed.ipo.freshIssueSize).toBe(10_000_000_000);
    expect(parsed.ipo.ofsSize).toBe(2_500_000_000);
    expect(parsed.ipo.faceValue).toBe(10);
    expect(parsed.ipo.priceBandLow).toBe(120);
    expect(parsed.ipo.priceBandHigh).toBe(126);
    expect(parsed.ipo.issueSizeShares).toBeNull();
  });

  it('keeps calendar dates as date-only strings', () => {
    const parsed = parseNseIpo(loadFixture('nse-ipo.valid.json'));

    expect(parsed.lifecycle.openDate).toBe('2026-09-10');
    expect(parsed.lifecycle.closeDate).toBe('2026-09-12');
    expect(parsed.lifecycle.listingDate).toBe('2026-09-18');
    expect(parsed.lifecycle.openDate).not.toMatch(/T/);
  });

  it('allows optional fields to be absent', () => {
    const parsed = parseNseIpo(loadFixture('nse-ipo.optional.json'));

    expect(parsed.company.cin).toBeNull();
    expect(parsed.ipo.faceValue).toBeNull();
    expect(parsed.ipo.freshIssueSize).toBeNull();
    expect(parsed.ipo.ofsSize).toBeNull();
    expect(parsed.ipo.minimumLots).toBeNull();
    expect(parsed.lifecycle.listingDate).toBeNull();
    expect(parsed.ipo.marketSegment).toBe('SME');
    expect(parsed.ipo.status).toBe('OPEN');
    expect(parsed.ipo.issueSize).toBe(1_500_000_000);
  });

  it('rejects malformed source data', () => {
    expect(() => parseNseIpo(null)).toThrow(NseParseError);
    expect(() => parseNseIpo('not-json-object')).toThrow(NseParseError);
    expect(() => parseNseIpo(loadFixture('nse-ipo.malformed.json'))).toThrow(
      NseParseError,
    );
  });
});

describe('NSE adapter', () => {
  const adapter = new NseSourceAdapter();

  it('outputs observations only and integrates with normalize/validate', () => {
    const [observation] = adapter.observe(loadFixture('nse-ipo.valid.json'), {
      sourceId: SOURCE_ID,
      discoveredAt: DISCOVERED_AT,
    });

    expect(adapter.sourceCode).toBe('nse');
    expect(observation.sourceId).toBe(SOURCE_ID);
    expect(observation.externalId).toBe('MOCKTECH');
    expect(observation.companyName).toBe('Mock Technologies Limited');
    expect(observation).not.toHaveProperty('companyId');
    expect(observation).not.toHaveProperty('ipoId');

    const discovered = normalizeDiscoveredIpo(observation.rawPayload);
    const validation = validateDiscoveredIpo(discovered);

    expect(validation.ok).toBe(true);
    expect(discovered.ipo.issueSize).toBe('12500000000.00');
    expect(discovered.ipo.priceBandLow).toBe('120.00');
    expect(discovered.ipo.priceBandHigh).toBe('126.00');
    expect(discovered.lifecycle.openDate).toBe('2026-09-10');
    expect(discovered.lifecycle.openDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('validates an optional-fields fixture after normalization', () => {
    const [observation] = adapter.observe(
      loadFixture('nse-ipo.optional.json'),
      {
        sourceId: SOURCE_ID,
        discoveredAt: DISCOVERED_AT,
      },
    );
    const discovered = normalizeDiscoveredIpo(observation.rawPayload);
    const validation = validateDiscoveredIpo(discovered);

    expect(validation.ok).toBe(true);
    expect(discovered.company.cin).toBeNull();
    expect(discovered.lifecycle.listingDate).toBeNull();
    expect(discovered.ipo.faceValue).toBeNull();
  });

  it('produces the same content hash for the same fixture', () => {
    const [first] = adapter.observe(loadFixture('nse-ipo.valid.json'), {
      sourceId: SOURCE_ID,
      discoveredAt: DISCOVERED_AT,
    });
    const [second] = adapter.observe(loadFixture('nse-ipo.valid.json'), {
      sourceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      discoveredAt: new Date('2026-09-02T00:00:00.000Z'),
    });

    expect(hashPayload(first.rawPayload)).toBe(hashPayload(second.rawPayload));
    expect(hashPayload(first.rawPayload)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects inverted price bands at the validation boundary', () => {
    const [observation] = adapter.observe(
      {
        companyName: 'Bad Band Limited',
        symbol: 'BADBND',
        priceBand: '126.00 - 120.00',
        issueType: 'Main Board',
      },
      { sourceId: SOURCE_ID, discoveredAt: DISCOVERED_AT },
    );

    const discovered = normalizeDiscoveredIpo(observation.rawPayload);
    const validation = validateDiscoveredIpo(discovered);

    expect(discovered.ipo.priceBandLow).toBe('126.00');
    expect(discovered.ipo.priceBandHigh).toBe('120.00');
    expect(validation.ok).toBe(false);
  });
});

const upcomingIssue = {
  companyName: 'Deepa Jewellers Limited',
  symbol: 'DEEPA',
  series: 'EQ',
  status: 'Active',
  issueStartDate: '01-Sep-2026',
  issueEndDate: '03-Sep-2026',
  issuePrice: 'Rs.168 to Rs.177',
  issueSize: '18520085',
};

const upcomingSmeIssue = {
  companyName: 'Qualiance International Limited',
  symbol: 'QUALIANCE',
  series: 'SME',
  status: 'Forthcoming',
  issueStartDate: '04-Sep-2026',
  issueEndDate: '08-Sep-2026',
  issuePrice: 'Rs.120 to Rs.127',
  issueSize: '3552000',
};

describe('NSE upcoming-issues parser', () => {
  it('parses an array with one issue', () => {
    const parsed = parseNseIpos([upcomingIssue]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].company.legalName).toBe('Deepa Jewellers Limited');
    expect(parsed[0].source.externalId).toBe('DEEPA');
    expect(parsed[0].ipo.symbol).toBe('DEEPA');
  });

  it('parses an array with multiple issues into one payload each', () => {
    const parsed = parseNseIpos([upcomingIssue, upcomingSmeIssue]);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((item) => item.ipo.symbol)).toEqual([
      'DEEPA',
      'QUALIANCE',
    ]);
  });

  it('parses issuePrice as a price band', () => {
    const [parsed] = parseNseIpos([upcomingIssue]);

    expect(parsed.ipo.priceBandLow).toBe(168);
    expect(parsed.ipo.priceBandHigh).toBe(177);
  });

  it('parses DD-Mon-YYYY issue dates', () => {
    const [parsed] = parseNseIpos([upcomingIssue]);

    expect(parsed.lifecycle.openDate).toBe('2026-09-01');
    expect(parsed.lifecycle.closeDate).toBe('2026-09-03');
    expect(parsed.lifecycle.listingDate).toBeNull();
  });

  it('maps series EQ and SME to market segments', () => {
    const [mainboard, sme] = parseNseIpos([upcomingIssue, upcomingSmeIssue]);

    expect(mainboard.ipo.marketSegment).toBe('MAINBOARD');
    expect(sme.ipo.marketSegment).toBe('SME');
  });

  it('maps Active and Forthcoming statuses', () => {
    const [active, forthcoming] = parseNseIpos([
      upcomingIssue,
      upcomingSmeIssue,
    ]);

    expect(active.ipo.status).toBe('OPEN');
    expect(forthcoming.ipo.status).toBe('UPCOMING');
  });

  it('keeps issueSize as a share count and does not convert it to crores or rupees', () => {
    const [parsed] = parseNseIpos([upcomingIssue]);

    expect(parsed.ipo.issueSizeShares).toBe(18_520_085);
    expect(parsed.ipo.issueSize).toBeNull();
    expect(parsed.ipo.issueSize).not.toBe(18_520_085 * 10_000_000);
    expect(parsed.ipo.freshIssueSize).toBeNull();
    expect(parsed.ipo.ofsSize).toBeNull();
    expect(parsed.ipo.lotSize).toBeNull();
    expect(parsed.company.cin).toBeNull();
    expect(parsed.ipo.faceValue).toBeNull();
  });

  it('rejects malformed or missing required fields', () => {
    expect(() => parseNseIpos([])).toThrow(NseParseError);
    expect(() => parseNseIpos([{ ...upcomingIssue, companyName: '' }])).toThrow(
      NseParseError,
    );
    expect(() => parseNseIpos([{ symbol: 'DEEPA' }])).toThrow(NseParseError);
    expect(() => parseNseIpos([null])).toThrow(NseParseError);
    expect(() =>
      parseNseIpos([{ ...upcomingIssue, issueSize: '1,250.00 Cr' }]),
    ).toThrow(NseParseError);
    expect(() =>
      parseNseIpos([{ ...upcomingIssue, issueStartDate: 'soon' }]),
    ).toThrow(NseParseError);
  });
});

describe('NSE upcoming-issues adapter', () => {
  const adapter = new NseSourceAdapter();

  it('emits one IncomingObservation per issue', () => {
    const observations = adapter.observe([upcomingIssue, upcomingSmeIssue], {
      sourceId: SOURCE_ID,
      discoveredAt: DISCOVERED_AT,
    });

    expect(observations).toHaveLength(2);
    expect(observations[0].externalId).toBe('DEEPA');
    expect(observations[0].companyName).toBe('Deepa Jewellers Limited');
    expect(observations[1].externalId).toBe('QUALIANCE');
    expect(observations[0]).not.toHaveProperty('companyId');
    expect(observations[0]).not.toHaveProperty('ipoId');

    const discovered = normalizeDiscoveredIpo(observations[0].rawPayload);
    expect(discovered.ipo.issueSize).toBeNull();
    expect(discovered.ipo.priceBandLow).toBe('168.00');
    expect(discovered.lifecycle.openDate).toBe('2026-09-01');
  });
});
