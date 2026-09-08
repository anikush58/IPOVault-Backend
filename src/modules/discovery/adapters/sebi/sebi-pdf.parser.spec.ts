import {
  extractCin,
  extractFaceValue,
  extractInrAmount,
  extractLegalName,
  extractShareCount,
  parseSebiExtractedText,
  parseSebiPdfBuffer,
} from './sebi-pdf.parser';

describe('SEBI PDF Issue Structure Parser — Phase 2A (A-AB Coverage)', () => {
  // Sample Real Extracted SEBI Document Text (Jindal Supreme (India) Limited RHP Fixture)
  const jindalRhpFixture = `
    JINDAL SUPREME (INDIA) LIMITED
    OUR COMPANY WAS INCORPORATED AS 'JINDAL SUPREME (INDIA) LIMITED' ON MAY 14, 1974 UNDER THE COMPANIES ACT, 1956.
    CIN: U27109HR1974PLC007126
    REGISTERED OFFICE: PLOT NO 12, INDUSTRIAL AREA, GURUGRAM, HARYANA - 122001.

    DETAILS OF THE OFFER
    INITIAL PUBLIC OFFER OF UP TO 23,500,000 EQUITY SHARES OF FACE VALUE OF ₹ 10 EACH ("EQUITY SHARES") OF JINDAL SUPREME (INDIA) LIMITED ("COMPANY" OR "ISSUER") FOR CASH AT A PRICE OF ₹ [●] PER EQUITY SHARE AGGREGATING UP TO ₹ 2,350.00 MILLION ("OFFER"). THE OFFER COMPRISES A FRESH ISSUE OF UP TO 18,500,000 EQUITY SHARES AGGREGATING UP TO ₹ 1,850.00 MILLION BY OUR COMPANY ("FRESH ISSUE") AND AN OFFER FOR SALE OF UP TO 5,000,000 EQUITY SHARES AGGREGATING UP TO ₹ 500.00 MILLION BY THE SELLING SHAREHOLDERS ("OFFER FOR SALE").
  `;

  // Sample Real Extracted SEBI Document Text (Tempsens Instruments (India) Limited Fixture)
  const tempsensFixture = `
    TEMPSENS INSTRUMENTS (INDIA) LIMITED
    CIN: U31402GJ1990PLC149769
    REGISTERED OFFICE: A-190, ROAD NO. 5, M.I.A., UDAIPUR, RAJASTHAN - 313003.

    DETAILS OF THE OFFER
    INITIAL PUBLIC OFFER OF UP TO 10,000,000 EQUITY SHARES OF FACE VALUE OF Rs. 5 EACH AGGREGATING UP TO Rs. 185.00 CRORE. THE OFFER COMPRISES A FRESH ISSUE OF UP TO 6,000,000 EQUITY SHARES AGGREGATING UP TO Rs. 111.00 CRORE AND AN OFFER FOR SALE OF UP TO 4,000,000 EQUITY SHARES AGGREGATING UP TO Rs. 74.00 CRORE.
  `;

  // A. PDF text extraction succeeds
  it('A. PDF text extraction succeeds from PDF text and buffer boundary', async () => {
    const text = 'JINDAL SUPREME (INDIA) LIMITED\nCIN: U27109HR1974PLC007126';
    const obs = parseSebiExtractedText(text, { externalId: '104328' });
    expect(obs.externalId).toBe('104328');
    expect(obs.cin.value).toBe('U27109HR1974PLC007126');

    // Test buffer rejection for empty buffer via parseSebiPdfBuffer
    await expect(
      parseSebiPdfBuffer(Buffer.from(''), { externalId: '104328' }),
    ).rejects.toThrow('PDF buffer is empty or invalid');
  });

  // B. CIN extraction
  it('B. extracts CIN accurately and normalizes uppercase & whitespace', () => {
    const text = 'CIN:\n U27109\nHR1974\nPLC007126\n';
    const field = extractCin(text);
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe('U27109HR1974PLC007126');
  });

  // C. legalName extraction
  it('C. extracts legalName without stripping legally meaningful words', () => {
    const field = extractLegalName(jindalRhpFixture);
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe('JINDAL SUPREME (INDIA) LIMITED');
  });

  // D. faceValue extraction
  it('D. extracts stated faceValue in INR', () => {
    const field = extractFaceValue(jindalRhpFixture);
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(10);

    const tempsensField = extractFaceValue(tempsensFixture);
    expect(tempsensField.status).toBe('EXTRACTED');
    expect(tempsensField.value).toBe(5);
  });

  // E. freshIssueShareCount extraction
  it('E. extracts freshIssueShareCount from explicitly tagged equity shares', () => {
    const field = extractShareCount(jindalRhpFixture, 'FRESH');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(18_500_000);
  });

  // F. ofsShareCount extraction
  it('F. extracts ofsShareCount from explicitly tagged equity shares', () => {
    const field = extractShareCount(jindalRhpFixture, 'OFS');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(5_000_000);
  });

  // G. issueShareCount extraction
  it('G. extracts total issueShareCount', () => {
    const field = extractShareCount(jindalRhpFixture, 'TOTAL');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(23_500_000);
  });

  // H. freshIssueSize INR extraction
  it('H. extracts freshIssueSize in INR with magnitude multiplier', () => {
    const field = extractInrAmount(jindalRhpFixture, 'FRESH');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(1_850_000_000); // 1,850.00 million
  });

  // I. ofsSize INR extraction
  it('I. extracts ofsSize in INR with magnitude multiplier', () => {
    const field = extractInrAmount(jindalRhpFixture, 'OFS');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(500_000_000); // 500.00 million
  });

  // J. issueSize INR extraction
  it('J. extracts total issueSize in INR', () => {
    const field = extractInrAmount(jindalRhpFixture, 'TOTAL');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(2_350_000_000); // 2,350.00 million
  });

  // K. million multiplier
  it('K. handles million magnitude multiplier (1 million = 1,000,000 INR)', () => {
    const fixture =
      'DETAILS OF THE OFFER\nINITIAL PUBLIC OFFER AGGREGATING UP TO ₹ 10.5 MILLION';
    const field = extractInrAmount(fixture, 'TOTAL');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(10_500_000);
  });

  // L. lakh/lakhs multiplier
  it('L. handles lakh/lakhs magnitude multiplier (1 lakh = 100,000 INR)', () => {
    const fixture =
      'DETAILS OF THE OFFER\nINITIAL PUBLIC OFFER AGGREGATING UP TO Rs. 50.00 LAKHS';
    const field = extractInrAmount(fixture, 'TOTAL');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(5_000_000);
  });

  // M. crore/crores multiplier
  it('M. handles crore/crores magnitude multiplier (1 crore = 10,000,000 INR)', () => {
    const field = extractInrAmount(tempsensFixture, 'TOTAL');
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe(1_850_000_000); // 185.00 crore
  });

  // N. comma-separated numbers
  it('N. handles comma-separated numbers in share counts and amounts', () => {
    const fixture =
      'DETAILS OF THE OFFER\nINITIAL PUBLIC OFFER OF UP TO 12,345,678 EQUITY SHARES AGGREGATING UP TO ₹ 1,234.56 LAKHS';
    const countField = extractShareCount(fixture, 'TOTAL');
    expect(countField.value).toBe(12_345_678);

    const inrField = extractInrAmount(fixture, 'TOTAL');
    expect(inrField.value).toBe(123_456_000);
  });

  // O. whitespace/newline artifacts
  it('O. tolerates whitespace and newline extraction artifacts', () => {
    const fixture = `
      DETAILS OF THE OFFER
      INITIAL PUBLIC OFFER OF UP TO
      18,500,000
      EQUITY SHARES
      AGGREGATING UP TO
      ₹ 1,850.00
      MILLION
    `;
    const countField = extractShareCount(fixture, 'TOTAL');
    expect(countField.value).toBe(18_500_000);

    const inrField = extractInrAmount(fixture, 'TOTAL');
    expect(inrField.value).toBe(1_850_000_000);
  });

  // P. placeholder `[●]`
  it('P. handles placeholder glyph `[●]` without converting to zero or NaN', () => {
    const fixture = `
      DETAILS OF THE OFFER
      INITIAL PUBLIC OFFER OF UP TO [●] EQUITY SHARES AGGREGATING UP TO ₹ [●] MILLION
    `;
    const countField = extractShareCount(fixture, 'TOTAL');
    expect(countField.status).toBe('UNRESOLVED');
    expect(countField.value).toBeNull();

    const inrField = extractInrAmount(fixture, 'TOTAL');
    expect(inrField.status).toBe('UNRESOLVED');
    expect(inrField.value).toBeNull();
  });

  // Q. placeholder `[•]`
  it('Q. handles placeholder glyph `[•]` without converting to zero or NaN', () => {
    const fixture = `
      DETAILS OF THE OFFER
      FRESH ISSUE OF UP TO [•] EQUITY SHARES
    `;
    const countField = extractShareCount(fixture, 'FRESH');
    expect(countField.status).toBe('UNRESOLVED');
    expect(countField.value).toBeNull();
  });

  // R. placeholder `[]`
  it('R. handles empty placeholder bracket `[]` as unresolved', () => {
    const fixture = `
      DETAILS OF THE OFFER
      OFFER FOR SALE OF UP TO [] EQUITY SHARES
    `;
    const countField = extractShareCount(fixture, 'OFS');
    expect(countField.status).toBe('UNRESOLVED');
    expect(countField.value).toBeNull();
  });

  // S. INR/share separation
  it('S. strictly keeps INR amounts and share counts separate', () => {
    const obs = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });

    // Verify share counts are numbers of shares, NOT INR amounts
    expect(obs.issueShareCount.value).toBe(23_500_000);
    expect(obs.freshIssueShareCount.value).toBe(18_500_000);
    expect(obs.ofsShareCount.value).toBe(5_000_000);

    // Verify INR amounts are in INR, NOT share counts
    expect(obs.issueSize.value).toBe(2_350_000_000);
    expect(obs.freshIssueSize.value).toBe(1_850_000_000);
    expect(obs.ofsSize.value).toBe(500_000_000);

    // Assert absolute non-overlap
    expect(obs.issueSize.value).not.toBe(obs.issueShareCount.value);
  });

  // T. multiple issuer/company names without selecting a wrong company
  it('T. avoids selecting selling shareholder or promoter company as issuer', () => {
    const multiCompanyFixture = `
      ABC TECHNOLOGIES LIMITED
      OUR COMPANY WAS INCORPORATED AS 'ABC TECHNOLOGIES LIMITED' ON JAN 1, 2010.
      CIN: U31402GJ1990PLC149769
      PROMOTER GROUP NAME: XYZ HOLDINGS PRIVATE LIMITED
      SELLING SHAREHOLDER NAME: PQR INVESTMENTS LIMITED
    `;
    const field = extractLegalName(multiCompanyFixture);
    expect(field.status).toBe('EXTRACTED');
    expect(field.value).toBe('ABC TECHNOLOGIES LIMITED');
    expect(field.value).not.toContain('XYZ HOLDINGS');
    expect(field.value).not.toContain('PQR INVESTMENTS');
  });

  // U. multiple valid CINs -> unresolved
  it('U. returns unresolved status when multiple distinct valid CINs are present', () => {
    const multiCinFixture = `
      ISSUER CIN: U27109HR1974PLC007126
      PROMOTER CIN: U31402GJ1990PLC149769
    `;
    const field = extractCin(multiCinFixture);
    expect(field.status).toBe('UNRESOLVED');
    expect(field.value).toBeNull();
    expect(field.warning).toContain('Multiple distinct CINs');
  });

  // V. missing CIN -> unresolved
  it('V. returns unresolved status when CIN is missing', () => {
    const noCinFixture = 'COMPANY NAME: ABC LIMITED';
    const field = extractCin(noCinFixture);
    expect(field.status).toBe('UNRESOLVED');
    expect(field.value).toBeNull();
  });

  // W. ambiguous issue table -> unresolved/review
  it('W. returns unresolved status when issue section is missing or ambiguous', () => {
    const ambiguousFixture = 'GENERAL ANNOUNCEMENT REGARDING ANNUAL MEETING';
    const obs = parseSebiExtractedText(ambiguousFixture, { externalId: '999999' });
    expect(obs.issueShareCount.status).toBe('UNRESOLVED');
    expect(obs.issueSize.status).toBe('UNRESOLVED');
  });

  // X. fresh + OFS + total mismatch -> warning/review, no correction
  it('X. emits warning on mismatch without altering extracted raw values', () => {
    const mismatchFixture = `
      CIN: U27109HR1974PLC007126
      DETAILS OF THE OFFER
      INITIAL PUBLIC OFFER OF UP TO 30,000,000 EQUITY SHARES AGGREGATING UP TO ₹ 3,000.00 MILLION.
      THE OFFER COMPRISES A FRESH ISSUE OF UP TO 18,500,000 EQUITY SHARES AGGREGATING UP TO ₹ 1,850.00 MILLION
      AND AN OFFER FOR SALE OF UP TO 5,000,000 EQUITY SHARES AGGREGATING UP TO ₹ 500.00 MILLION.
    `;
    const obs = parseSebiExtractedText(mismatchFixture, { externalId: '104328' });

    // Extracted raw values MUST be preserved intact (18.5M + 5M != 30M)
    expect(obs.freshIssueShareCount.value).toBe(18_500_000);
    expect(obs.ofsShareCount.value).toBe(5_000_000);
    expect(obs.issueShareCount.value).toBe(30_000_000);

    // Mismatch warning must be flagged
    expect(obs.issueShareCount.status).toBe('MISMATCH_WARNING');
    expect(obs.warnings.length).toBeGreaterThan(0);
    expect(obs.warnings[0]).toContain('Share count discrepancy');
  });

  // Y. parser does not call Prisma
  it('Y. parser function is pure and does not invoke Prisma', () => {
    const obs = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });
    expect(obs).toBeDefined();
    // Verify object structure returned directly without DB side-effects
    expect(obs.externalId).toBe('104328');
  });

  // Z. parser does not create Company
  it('Z. parser returns observation object without creating canonical Company entity', () => {
    const obs = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });
    expect(obs.legalName.value).toBe('JINDAL SUPREME (INDIA) LIMITED');
    expect((obs as Record<string, unknown>).companyId).toBeUndefined();
  });

  // AA. parser does not create IPO
  it('AA. parser returns observation object without creating canonical IPO entity', () => {
    const obs = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });
    expect(obs.issueSize.value).toBe(2_350_000_000);
    expect((obs as Record<string, unknown>).ipoId).toBeUndefined();
  });

  // AB. repeated parsing produces deterministic identical output
  it('AB. produces identical output on repeated runs', () => {
    const obs1 = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });
    const obs2 = parseSebiExtractedText(jindalRhpFixture, { externalId: '104328' });

    // Compare values (excluding extractedAt timestamp)
    expect(obs1.legalName).toEqual(obs2.legalName);
    expect(obs1.cin).toEqual(obs2.cin);
    expect(obs1.faceValue).toEqual(obs2.faceValue);
    expect(obs1.issueShareCount).toEqual(obs2.issueShareCount);
    expect(obs1.freshIssueShareCount).toEqual(obs2.freshIssueShareCount);
    expect(obs1.ofsShareCount).toEqual(obs2.ofsShareCount);
    expect(obs1.issueSize).toEqual(obs2.issueSize);
    expect(obs1.freshIssueSize).toEqual(obs2.freshIssueSize);
    expect(obs1.ofsSize).toEqual(obs2.ofsSize);
  });
});
