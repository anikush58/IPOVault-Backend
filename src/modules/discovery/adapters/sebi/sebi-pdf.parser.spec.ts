import {
  extractCin,
  extractFaceValue,
  extractInrAmount,
  extractIssueCloseDate,
  extractIssueOpenDate,
  extractLegalName,
  extractLotSize,
  extractPriceBand,
  extractShareCount,
  parseDateToIso,
  parseSebiExtractedText,
  parseSebiPdfBuffer,
} from './sebi-pdf.parser';

describe('SEBI PDF Issue Structure & Terms Parser (Phase 2A & Phase 2B)', () => {
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

  // Sample Real Finalized Terms & Dates Document Fixture (Price Band Advertisement / Notice)
  const finalizedTermsFixture = `
    BAAZAR STYLE RETAIL LIMITED
    CIN: U18101WB2013PLC194148

    ISSUE DETAILS
    PRICE BAND: ₹ 175 TO ₹ 185 PER EQUITY SHARE OF FACE VALUE OF ₹ 5 EACH.
    BID LOT: 80 EQUITY SHARES AND IN MULTIPLES OF 80 EQUITY SHARES THEREAFTER.
    MINIMUM APPLICATION AMOUNT: ₹ 14,800.
    EMPLOYEE DISCOUNT: ₹ 15 PER EQUITY SHARE.

    BID/OFFER OPENS ON: TUESDAY, SEPTEMBER 15, 2026
    BID/OFFER CLOSES ON: THURSDAY, SEPTEMBER 17, 2026
    ANCHOR INVESTOR BIDDING DATE: MONDAY, SEPTEMBER 14, 2026
    BASIS OF ALLOTMENT: TUESDAY, SEPTEMBER 22, 2026
    LISTING DATE: THURSDAY, SEPTEMBER 24, 2026
  `;

  // Phase 2A Baseline Tests (A-AB)
  describe('Phase 2A Baseline Coverage', () => {
    it('A. PDF text extraction succeeds from PDF text and buffer boundary', async () => {
      const text = 'JINDAL SUPREME (INDIA) LIMITED\nCIN: U27109HR1974PLC007126';
      const obs = parseSebiExtractedText(text, { externalId: '104328' });
      expect(obs.externalId).toBe('104328');
      expect(obs.cin.value).toBe('U27109HR1974PLC007126');

      await expect(
        parseSebiPdfBuffer(Buffer.from(''), { externalId: '104328' }),
      ).rejects.toThrow('PDF buffer is empty or invalid');
    });

    it('B. extracts CIN accurately and normalizes uppercase & whitespace', () => {
      const text = 'CIN:\n U27109\nHR1974\nPLC007126\n';
      const field = extractCin(text);
      expect(field.status).toBe('EXTRACTED');
      expect(field.value).toBe('U27109HR1974PLC007126');
    });

    it('C. extracts legalName without stripping legally meaningful words', () => {
      const field = extractLegalName(jindalRhpFixture);
      expect(field.status).toBe('EXTRACTED');
      expect(field.value).toBe('JINDAL SUPREME (INDIA) LIMITED');
    });

    it('D. extracts stated faceValue in INR', () => {
      const field = extractFaceValue(jindalRhpFixture);
      expect(field.status).toBe('EXTRACTED');
      expect(field.value).toBe(10);

      const tempsensField = extractFaceValue(tempsensFixture);
      expect(tempsensField.status).toBe('EXTRACTED');
      expect(tempsensField.value).toBe(5);

      const shareField = extractShareCount(jindalRhpFixture, 'FRESH');
      expect(shareField.value).toBe(18_500_000);

      const inrField = extractInrAmount(jindalRhpFixture, 'FRESH');
      expect(inrField.value).toBe(1_850_000_000);
    });
  });

  // Phase 2B PRICE BAND Tests (1-14)
  describe('Phase 2B Price Band Extraction', () => {
    it('1. extracts standard ₹ price band range', () => {
      const pb = extractPriceBand('Price Band: ₹ 175 to ₹ 185 per Equity Share');
      expect(pb.low.status).toBe('EXTRACTED');
      expect(pb.low.value).toBe(175);
      expect(pb.high.status).toBe('EXTRACTED');
      expect(pb.high.value).toBe(185);
    });

    it('2. extracts Rs. price band range', () => {
      const pb = extractPriceBand('Price Band of Rs. 175 to Rs. 185 per Equity Share');
      expect(pb.low.value).toBe(175);
      expect(pb.high.value).toBe(185);
    });

    it('3. extracts INR price band range', () => {
      const pb = extractPriceBand('Price Band of INR 175.50 to INR 185.00');
      expect(pb.low.value).toBe(175.5);
      expect(pb.high.value).toBe(185);
    });

    it('4. extracts Floor Price and Cap Price wording', () => {
      const pb = extractPriceBand(
        'Floor Price of ₹ 175 per Equity Share and Cap Price of ₹ 185 per Equity Share',
      );
      expect(pb.low.value).toBe(175);
      expect(pb.high.value).toBe(185);
    });

    it('5. handles fixed explicit issue price (low == high)', () => {
      const pb = extractPriceBand('Offer Price of ₹ 180 per Equity Share');
      expect(pb.low.value).toBe(180);
      expect(pb.high.value).toBe(180);
    });

    it('6. face value must not become price band', () => {
      const text = 'Face Value of ₹ 10 each';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
      expect(pb.high.status).toBe('UNRESOLVED');
    });

    it('7. application amount must not become price band', () => {
      const text = 'Minimum Application Amount: ₹ 14,800';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
    });

    it('8. employee discount must not become price band', () => {
      const text = 'Employee Discount: ₹ 15 per Equity Share';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
    });

    it('9. single endpoint without range → unresolved', () => {
      const text = 'Floor Price of ₹ 175 per Equity Share';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
      expect(pb.high.status).toBe('UNRESOLVED');
    });

    it('10. placeholder → unresolved', () => {
      const text = 'Price Band: ₹ [●] to ₹ [●] per Equity Share';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
      expect(pb.high.status).toBe('UNRESOLVED');
    });

    it('11. invalid range low > high → unresolved', () => {
      const text = 'Price Band: ₹ 185 to ₹ 175 per Equity Share';
      const pb = extractPriceBand(text);
      expect(pb.low.status).toBe('UNRESOLVED');
      expect(pb.high.status).toBe('UNRESOLVED');
    });

    it('12. decimal price support', () => {
      const pb = extractPriceBand('Price Band: ₹ 175.50 to ₹ 185.75 per Equity Share');
      expect(pb.low.value).toBe(175.5);
      expect(pb.high.value).toBe(185.75);
    });

    it('13. irrelevant monetary values surrounding valid issue terms do not corrupt price band', () => {
      const pb = extractPriceBand(finalizedTermsFixture);
      expect(pb.low.value).toBe(175);
      expect(pb.high.value).toBe(185);
    });

    it('14. fixed price placeholder → unresolved', () => {
      const pb = extractPriceBand('Issue Price: Rs. [●] per Equity Share');
      expect(pb.low.status).toBe('UNRESOLVED');
      expect(pb.high.status).toBe('UNRESOLVED');
    });
  });

  // Phase 2B LOT SIZE Tests (15-24)
  describe('Phase 2B Lot Size Extraction', () => {
    it('15. extracts Bid Lot share count', () => {
      const lot = extractLotSize('Bid Lot: 80 Equity Shares and in multiples of 80 thereafter');
      expect(lot.status).toBe('EXTRACTED');
      expect(lot.value).toBe(80);
    });

    it('16. extracts Market Lot share count', () => {
      const lot = extractLotSize('Market Lot: 80 Equity Shares');
      expect(lot.status).toBe('EXTRACTED');
      expect(lot.value).toBe(80);
    });

    it('17. extracts Minimum Bid Quantity share count', () => {
      const lot = extractLotSize('Minimum Bid Quantity: 80 Equity Shares');
      expect(lot.status).toBe('EXTRACTED');
      expect(lot.value).toBe(80);
    });

    it('18. INR application amount must not become lotSize', () => {
      const lot = extractLotSize('Minimum Application Amount: ₹ 14,800');
      expect(lot.status).toBe('UNRESOLVED');
    });

    it('19. "1 lot" phrase must not become lotSize', () => {
      const lot = extractLotSize('Application of 1 lot');
      expect(lot.status).toBe('UNRESOLVED');
    });

    it('20. anchor investor quantity must not become lotSize', () => {
      const lot = extractLotSize('Anchor Investor Portion: 5,000,000 Equity Shares');
      expect(lot.status).toBe('UNRESOLVED');
    });

    it('21. placeholder → unresolved', () => {
      const lot = extractLotSize('Bid Lot: [●] Equity Shares');
      expect(lot.status).toBe('UNRESOLVED');
      expect(lot.value).toBeNull();
    });

    it('22. ambiguous multiple candidate lot sizes → unresolved', () => {
      const lot = extractLotSize('Bid Lot: 80 Equity Shares\nMarket Lot: 100 Equity Shares');
      expect(lot.status).toBe('UNRESOLVED');
    });

    it('23. extracts lotSize from full finalized terms fixture', () => {
      const lot = extractLotSize(finalizedTermsFixture);
      expect(lot.status).toBe('EXTRACTED');
      expect(lot.value).toBe(80);
    });
  });

  // Phase 2B DATES Tests (25-35)
  describe('Phase 2B Issue Dates Extraction', () => {
    it('25. extracts standard issue open date from text', () => {
      const open = extractIssueOpenDate('BID/OFFER OPENS ON: TUESDAY, SEPTEMBER 15, 2026');
      expect(open.status).toBe('EXTRACTED');
      expect(open.value).toBe('2026-09-15');
    });

    it('26. extracts standard issue close date from text', () => {
      const close = extractIssueCloseDate('BID/OFFER CLOSES ON: THURSDAY, SEPTEMBER 17, 2026');
      expect(close.status).toBe('EXTRACTED');
      expect(close.value).toBe('2026-09-17');
    });

    it('27. handles numeric date format DD-MM-YYYY', () => {
      const open = extractIssueOpenDate('ISSUE OPENS ON: 15-09-2026');
      expect(open.value).toBe('2026-09-15');

      const close = extractIssueCloseDate('ISSUE CLOSES ON: 17-09-2026');
      expect(close.value).toBe('2026-09-17');
    });

    it('28. parses date strings to ISO YYYY-MM-DD via parseDateToIso', () => {
      expect(parseDateToIso('SEPTEMBER 15, 2026')).toBe('2026-09-15');
      expect(parseDateToIso('15TH SEPTEMBER 2026')).toBe('2026-09-15');
      expect(parseDateToIso('15/09/2026')).toBe('2026-09-15');
      expect(parseDateToIso('[●]')).toBeNull();
    });

    it('29. anchor date must not become issueOpenDate', () => {
      const text = 'ANCHOR INVESTOR BIDDING DATE: MONDAY, SEPTEMBER 14, 2026';
      const open = extractIssueOpenDate(text);
      expect(open.status).toBe('UNRESOLVED');
    });

    it('30. listing date must not become issueCloseDate', () => {
      const text = 'LISTING DATE: THURSDAY, SEPTEMBER 24, 2026';
      const close = extractIssueCloseDate(text);
      expect(close.status).toBe('UNRESOLVED');
    });

    it('31. allotment date must not become issueCloseDate', () => {
      const text = 'BASIS OF ALLOTMENT: TUESDAY, SEPTEMBER 22, 2026';
      const close = extractIssueCloseDate(text);
      expect(close.status).toBe('UNRESOLVED');
    });

    it('32. refund date must not become issueCloseDate', () => {
      const text = 'INITIATION OF REFUNDS: WEDNESDAY, SEPTEMBER 23, 2026';
      const close = extractIssueCloseDate(text);
      expect(close.status).toBe('UNRESOLVED');
    });

    it('33. placeholder date → unresolved', () => {
      const open = extractIssueOpenDate('ISSUE OPENS ON: [●]');
      expect(open.status).toBe('UNRESOLVED');

      const close = extractIssueCloseDate('ISSUE CLOSES ON: [●]');
      expect(close.status).toBe('UNRESOLVED');
    });

    it('34. extracts issue open and close dates from full finalized terms fixture', () => {
      const open = extractIssueOpenDate(finalizedTermsFixture);
      expect(open.value).toBe('2026-09-15');

      const close = extractIssueCloseDate(finalizedTermsFixture);
      expect(close.value).toBe('2026-09-17');
    });

    it('35. invalid date string → unresolved', () => {
      const open = extractIssueOpenDate('ISSUE OPENS ON: INVALID_DATE_STRING');
      expect(open.status).toBe('UNRESOLVED');
    });
  });

  // GENERAL Tests (36-39)
  describe('Phase 2B General Safety & Integration', () => {
    it('36. deterministic repeated parsing produces identical observation', () => {
      const obs1 = parseSebiExtractedText(finalizedTermsFixture, { externalId: '194148' });
      const obs2 = parseSebiExtractedText(finalizedTermsFixture, { externalId: '194148' });

      expect(obs1.priceBandLow).toEqual(obs2.priceBandLow);
      expect(obs1.priceBandHigh).toEqual(obs2.priceBandHigh);
      expect(obs1.lotSize).toEqual(obs2.lotSize);
      expect(obs1.issueOpenDate).toEqual(obs2.issueOpenDate);
      expect(obs1.issueCloseDate).toEqual(obs2.issueCloseDate);
    });

    it('37. no arithmetic inference: lot size and price band are never inferred from each other', () => {
      const partialFixture = 'PRICE BAND: ₹ 100 TO ₹ 110 PER EQUITY SHARE';
      const obs = parseSebiExtractedText(partialFixture, { externalId: '123456' });

      expect(obs.priceBandLow.value).toBe(100);
      expect(obs.priceBandHigh.value).toBe(110);
      expect(obs.lotSize.value).toBeNull();
      expect(obs.issueOpenDate.value).toBeNull();
    });

    it('38. no cross-field contamination', () => {
      const obs = parseSebiExtractedText(finalizedTermsFixture, { externalId: '194148' });

      // Assert price band values are in INR
      expect(obs.priceBandLow.value).toBe(175);
      expect(obs.priceBandHigh.value).toBe(185);

      // Assert lot size is shares
      expect(obs.lotSize.value).toBe(80);

      // Assert open and close dates are YYYY-MM-DD
      expect(obs.issueOpenDate.value).toBe('2026-09-15');
      expect(obs.issueCloseDate.value).toBe('2026-09-17');
    });

    it('39. partial extraction works when only some fields are present', () => {
      const partialFixture = `
        BAAZAR STYLE RETAIL LIMITED
        CIN: U18101WB2013PLC194148
        PRICE BAND: ₹ 175 TO ₹ 185 PER EQUITY SHARE
      `;
      const obs = parseSebiExtractedText(partialFixture, { externalId: '194148' });

      expect(obs.cin.value).toBe('U18101WB2013PLC194148');
      expect(obs.legalName.value).toBe('BAAZAR STYLE RETAIL LIMITED');
      expect(obs.priceBandLow.value).toBe(175);
      expect(obs.priceBandHigh.value).toBe(185);
      expect(obs.lotSize.value).toBeNull();
      expect(obs.issueOpenDate.value).toBeNull();
    });
  });
});
