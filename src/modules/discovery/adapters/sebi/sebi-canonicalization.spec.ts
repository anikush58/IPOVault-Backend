import { sebiPdfObservationToRawPayload, sebiFilingMetadataToRawPayload } from './sebi.adapter';
import { SebiPdfIssueObservation } from './sebi.types';
import { normalizeDiscoveredIpo } from '../../normalize';
import { validateDiscoveredIpo } from '../../validate';

describe('SEBI Canonicalization & Mapping Suite (Phase 3)', () => {
  const samplePdfObservation: SebiPdfIssueObservation = {
    externalId: 'sebi-104328',
    sourceUrl: 'https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/104328.pdf',
    extractedAt: '2026-09-09T10:00:00.000Z',
    legalName: { value: 'Lalithaa Jewellery Mart Limited', status: 'EXTRACTED' },
    cin: { value: 'U27109TN1985PLC012345', status: 'EXTRACTED' },
    faceValue: { value: 10, status: 'EXTRACTED' },
    priceBandLow: { value: 175, status: 'EXTRACTED' },
    priceBandHigh: { value: 185, status: 'EXTRACTED' },
    lotSize: { value: 80, status: 'EXTRACTED' },
    issueShareCount: { value: 10000000, status: 'EXTRACTED' },
    freshIssueShareCount: { value: 6000000, status: 'EXTRACTED' },
    ofsShareCount: { value: 4000000, status: 'EXTRACTED' },
    issueSize: { value: 1850000000, status: 'EXTRACTED' },
    freshIssueSize: { value: 1110000000, status: 'EXTRACTED' },
    ofsSize: { value: 740000000, status: 'EXTRACTED' },
    issueOpenDate: { value: '2026-09-15', status: 'EXTRACTED' },
    issueCloseDate: { value: '2026-09-18', status: 'EXTRACTED' },
    warnings: [],
  };

  it('1. complete SEBI observation maps correctly to DiscoveredIpo', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation, undefined, '2026-08-20');
    const discovered = normalizeDiscoveredIpo(raw);
    const validation = validateDiscoveredIpo(discovered);

    expect(validation.ok).toBe(true);
    expect(discovered.company.legalName).toBe('Lalithaa Jewellery Mart Limited');
    expect(discovered.company.cin).toBe('U27109TN1985PLC012345');
    expect(discovered.ipo.priceBandLow).toBe('175.00');
    expect(discovered.ipo.priceBandHigh).toBe('185.00');
    expect(discovered.ipo.lotSize).toBe(80);
    expect(discovered.ipo.faceValue).toBe('10.00');
    expect(discovered.ipo.issueSize).toBe('1850000000.00');
    expect(discovered.ipo.freshIssueSize).toBe('1110000000.00');
    expect(discovered.ipo.ofsSize).toBe('740000000.00');
    expect(discovered.ipo.issueShareCount).toBe('10000000');
    expect(discovered.ipo.freshIssueShareCount).toBe('6000000');
    expect(discovered.ipo.ofsShareCount).toBe('4000000');
  });

  it('2. partial SEBI observation maps correctly and passes validation', () => {
    const partialObs: SebiPdfIssueObservation = {
      ...samplePdfObservation,
      priceBandLow: { value: null, status: 'UNRESOLVED' },
      priceBandHigh: { value: null, status: 'UNRESOLVED' },
      lotSize: { value: null, status: 'UNRESOLVED' },
      issueOpenDate: { value: null, status: 'UNRESOLVED' },
      issueCloseDate: { value: null, status: 'UNRESOLVED' },
    };

    const raw = sebiPdfObservationToRawPayload(partialObs, 'Lalithaa Jewellery Mart Limited', '2026-08-20');
    const discovered = normalizeDiscoveredIpo(raw);
    const validation = validateDiscoveredIpo(discovered);

    expect(validation.ok).toBe(true);
    expect(discovered.company.legalName).toBe('Lalithaa Jewellery Mart Limited');
    expect(discovered.company.cin).toBe('U27109TN1985PLC012345');
    expect(discovered.ipo.priceBandLow).toBeNull();
    expect(discovered.ipo.priceBandHigh).toBeNull();
    expect(discovered.ipo.lotSize).toBeNull();
    expect(discovered.lifecycle.openDate).toBeNull();
    expect(discovered.lifecycle.closeDate).toBeNull();
  });

  it('3. CIN is preserved and normalized to uppercase 21-char string', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);
    expect(discovered.company.cin).toBe('U27109TN1985PLC012345');
  });

  it('4. externalId and source reference context are preserved', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.source.externalId).toBe('sebi-104328');
    expect(discovered.source.reference).toBe(
      'https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/104328.pdf',
    );
  });

  it('5. unresolved values remain strictly null without converting to zero or empty strings', () => {
    const unresolvedObs: SebiPdfIssueObservation = {
      ...samplePdfObservation,
      cin: { value: null, status: 'UNRESOLVED' },
      faceValue: { value: null, status: 'UNRESOLVED' },
      issueSize: { value: null, status: 'UNRESOLVED' },
      freshIssueSize: { value: null, status: 'UNRESOLVED' },
      ofsSize: { value: null, status: 'UNRESOLVED' },
      issueShareCount: { value: null, status: 'UNRESOLVED' },
      freshIssueShareCount: { value: null, status: 'UNRESOLVED' },
      ofsShareCount: { value: null, status: 'UNRESOLVED' },
      priceBandLow: { value: null, status: 'UNRESOLVED' },
      priceBandHigh: { value: null, status: 'UNRESOLVED' },
      lotSize: { value: null, status: 'UNRESOLVED' },
      issueOpenDate: { value: null, status: 'UNRESOLVED' },
      issueCloseDate: { value: null, status: 'UNRESOLVED' },
    };

    const raw = sebiPdfObservationToRawPayload(unresolvedObs, 'Fallback Corp');
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.company.cin).toBeNull();
    expect(discovered.ipo.faceValue).toBeNull();
    expect(discovered.ipo.issueSize).toBeNull();
    expect(discovered.ipo.freshIssueSize).toBeNull();
    expect(discovered.ipo.ofsSize).toBeNull();
    expect(discovered.ipo.issueShareCount).toBeNull();
    expect(discovered.ipo.freshIssueShareCount).toBeNull();
    expect(discovered.ipo.ofsShareCount).toBeNull();
    expect(discovered.ipo.priceBandLow).toBeNull();
    expect(discovered.ipo.priceBandHigh).toBeNull();
    expect(discovered.ipo.lotSize).toBeNull();
    expect(discovered.lifecycle.openDate).toBeNull();
    expect(discovered.lifecycle.closeDate).toBeNull();
  });

  it('6. listingDate is never created from issue dates in SEBI flow', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.lifecycle.listingDate).toBeNull();
  });

  it('7. anchorDate is never fabricated as issueOpenDate', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.lifecycle.anchorDate).toBeNull();
    expect(discovered.lifecycle.openDate).toBe('2026-09-15');
  });

  it('8. issueOpenDate maps to existing OPEN representation', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.lifecycle.openDate).toBe('2026-09-15');
  });

  it('9. issueCloseDate maps to existing CLOSE representation', () => {
    const raw = sebiPdfObservationToRawPayload(samplePdfObservation);
    const discovered = normalizeDiscoveredIpo(raw);

    expect(discovered.lifecycle.closeDate).toBe('2026-09-18');
  });

  it('10. HTML listing metadata mapping produces valid DiscoveredIpo payload', () => {
    const raw = sebiFilingMetadataToRawPayload({
      externalId: '104328',
      companyName: 'Jindal Supreme India Limited',
      filingTitle: 'Jindal Supreme (India) Limited - RHP',
      filingType: 'RHP',
      filingDate: '2026-09-08',
      detailUrl: 'https://www.sebi.gov.in/filings/104328.html',
    });

    const discovered = normalizeDiscoveredIpo(raw);
    const validation = validateDiscoveredIpo(discovered);

    expect(validation.ok).toBe(true);
    expect(discovered.company.legalName).toBe('Jindal Supreme India Limited');
    expect(discovered.lifecycle.rhpDate).toBe('2026-09-08');
    expect(discovered.source.externalId).toBe('104328');
  });
});
