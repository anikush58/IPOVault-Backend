import {
  cleanSectionContent,
  computeSha256,
  extractSebiDocumentSections,
  extractSebiDocumentSectionsFromContinuousText,
  extractSebiDocumentSectionsFromPages,
  findSectionHeadingOnPage,
  SEBI_PARSER_VERSION,
} from './sebi-section.extractor';
import { ALL_SEBI_SECTION_KEYS } from './sebi-section.types';

describe('SebiSectionExtractor (Phase 1)', () => {
  const samplePages = [
    {
      pageNumber: 1,
      text: `
        JINDAL SUPREME (INDIA) LIMITED
        DRAFT RED HERRING PROSPECTUS DATED SEPTEMBER 15, 2026
        TABLE OF CONTENTS
        SECTION I - GENERAL .................................................... 1
        SECTION II - RISK FACTORS .............................................. 2
        SECTION III - INTRODUCTION - CAPITAL STRUCTURE ......................... 3
        SECTION IV - ABOUT OUR COMPANY - OUR BUSINESS .......................... 4
        SECTION V - FINANCIAL INFORMATION ...................................... 5
      `,
    },
    {
      pageNumber: 2,
      text: `
        SECTION II - RISK FACTORS
        1. We are subject to strict regulatory compliance in manufacturing.
        2. Any disruption in our supply chain could adversely impact our revenues.
        3. Outstanding legal proceedings against our promoters may result in liabilities.
      `,
    },
    {
      pageNumber: 3,
      text: `
        SECTION III - INTRODUCTION - CAPITAL STRUCTURE
        The equity share capital of our company is ₹ 500,000,000 divided into 50,000,000 Equity Shares.
        Fresh Issue: Up to 10,000,000 Equity Shares.
        Offer for Sale: Up to 5,000,000 Equity Shares.
      `,
    },
    {
      pageNumber: 4,
      text: `
        SECTION IV - ABOUT OUR COMPANY - OUR BUSINESS
        We are a leading precision engineering manufacturer incorporated in India in 1974.
        Our products are exported to over 25 countries across North America and Europe.
      `,
    },
    {
      pageNumber: 5,
      text: `
        SECTION V - FINANCIAL INFORMATION
        RESTATED CONSOLIDATED FINANCIAL STATEMENTS
        Total Revenue for FY24 stood at ₹ 4,521.80 million compared to ₹ 3,890.10 million in FY23.
        Profit after Tax (PAT) for FY24 was ₹ 512.40 million.
      `,
    },
  ];

  describe('Page-by-Page Section Extraction', () => {
    it('extracts all detected sections with exact page ranges and content hashes', () => {
      const docHash = computeSha256('dummy-doc-bytes');
      const result = extractSebiDocumentSectionsFromPages(samplePages, docHash);

      expect(result.documentHash).toBe(docHash);
      expect(result.totalPageCount).toBe(5);
      expect(result.parserVersion).toBe(SEBI_PARSER_VERSION);

      // Verify RISK_FACTORS
      expect(result.sections.RISK_FACTORS).toBeDefined();
      expect(result.sections.RISK_FACTORS!.pageRange).toEqual({ startPage: 2, endPage: 2 });
      expect(result.sections.RISK_FACTORS!.content).toContain('We are subject to strict regulatory compliance');
      expect(result.sections.RISK_FACTORS!.contentHash).toBeDefined();
      expect(result.sections.RISK_FACTORS!.isTruncated).toBe(false);

      // Verify CAPITAL_STRUCTURE
      expect(result.sections.CAPITAL_STRUCTURE).toBeDefined();
      expect(result.sections.CAPITAL_STRUCTURE!.pageRange).toEqual({ startPage: 3, endPage: 3 });
      expect(result.sections.CAPITAL_STRUCTURE!.content).toContain('50,000,000 Equity Shares');

      // Verify OUR_BUSINESS
      expect(result.sections.OUR_BUSINESS).toBeDefined();
      expect(result.sections.OUR_BUSINESS!.pageRange).toEqual({ startPage: 4, endPage: 4 });
      expect(result.sections.OUR_BUSINESS!.content).toContain('leading precision engineering manufacturer');

      // Verify FINANCIAL_INFORMATION
      expect(result.sections.FINANCIAL_INFORMATION).toBeDefined();
      expect(result.sections.FINANCIAL_INFORMATION!.pageRange).toEqual({ startPage: 5, endPage: 5 });
      expect(result.sections.FINANCIAL_INFORMATION!.content).toContain('4,521.80 million');

      // Verify unresolved sections list
      expect(result.unresolvedSections).toContain('INDUSTRY_OVERVIEW');
      expect(result.unresolvedSections).toContain('ANCHOR_INVESTOR_PORTION');
      expect(result.unresolvedSections).not.toContain('RISK_FACTORS');
      expect(result.unresolvedSections).not.toContain('OUR_BUSINESS');
    });

    it('ignores headings inside Table of Contents', () => {
      const headingOnToc = findSectionHeadingOnPage(samplePages[0].text, true);
      expect(headingOnToc).toBeNull();

      const headingOnBody = findSectionHeadingOnPage(samplePages[1].text, false);
      expect(headingOnBody).not.toBeNull();
      expect(headingOnBody!.key).toBe('RISK_FACTORS');
    });

    it('handles empty pages gracefully', () => {
      const docHash = computeSha256('empty');
      const result = extractSebiDocumentSectionsFromPages([], docHash);

      expect(result.totalPageCount).toBe(0);
      expect(Object.keys(result.sections).length).toBe(0);
      expect(result.unresolvedSections.length).toBe(ALL_SEBI_SECTION_KEYS.length);
    });

    it('truncates section content when exceeding maxSectionChars and sets isTruncated flag', () => {
      const docHash = computeSha256('test');
      const result = extractSebiDocumentSectionsFromPages(samplePages, docHash, {
        maxSectionChars: 50,
      });

      expect(result.sections.RISK_FACTORS).toBeDefined();
      expect(result.sections.RISK_FACTORS!.content.length).toBeLessThanOrEqual(50);
      expect(result.sections.RISK_FACTORS!.isTruncated).toBe(true);
    });
  });

  describe('Continuous Text Extraction Fallback', () => {
    it('extracts sections from single unpaged string', () => {
      const rawText = `
        SECTION II - RISK FACTORS
        Risk point 1: Currency volatility.
        Risk point 2: Raw material costs.

        OUR BUSINESS
        We specialize in medical devices.

        BASIS FOR ISSUE PRICE
        The P/E ratio is 18.5x based on FY24 EPS of 12.4.

        GENERAL INFORMATION
        BRLM: Kotak Mahindra Capital Company Limited.
      `;

      const docHash = computeSha256(rawText);
      const result = extractSebiDocumentSectionsFromContinuousText(rawText, docHash, 1);

      expect(result.sections.RISK_FACTORS).toBeDefined();
      expect(result.sections.RISK_FACTORS!.content).toContain('Currency volatility');

      expect(result.sections.OUR_BUSINESS).toBeDefined();
      expect(result.sections.OUR_BUSINESS!.content).toContain('medical devices');

      expect(result.sections.BASIS_FOR_ISSUE_PRICE).toBeDefined();
      expect(result.sections.BASIS_FOR_ISSUE_PRICE!.content).toContain('P/E ratio is 18.5x');

      expect(result.sections.LEAD_MANAGERS_AND_GENERAL_INFO).toBeDefined();
      expect(result.sections.LEAD_MANAGERS_AND_GENERAL_INFO!.content).toContain('Kotak Mahindra Capital');
    });
  });

  describe('Text Cleaning & Normalization', () => {
    it('removes repeated running header lines and normalizes line breaks', () => {
      const raw = `
        Draft Red Herring Prospectus dated September 15, 2026
        Dated September 15, 2026
        
        OUR BUSINESS
        
        
        
        Our company produces high grade alloys.
      `;

      const cleaned = cleanSectionContent(raw);
      expect(cleaned).not.toContain('Draft Red Herring Prospectus');
      expect(cleaned).not.toContain('Dated September 15, 2026');
      expect(cleaned).toContain('OUR BUSINESS\n\nOur company produces high grade alloys.');
    });
  });

  describe('Deterministic Repeat Extraction', () => {
    it('produces identical output and hashes across multiple runs', () => {
      const docHash = computeSha256('deterministic-test');
      const run1 = extractSebiDocumentSectionsFromPages(samplePages, docHash);
      const run2 = extractSebiDocumentSectionsFromPages(samplePages, docHash);

      expect(run1.documentHash).toEqual(run2.documentHash);
      expect(run1.sections.OUR_BUSINESS!.contentHash).toEqual(run2.sections.OUR_BUSINESS!.contentHash);
      expect(run1.sections.FINANCIAL_INFORMATION!.contentHash).toEqual(run2.sections.FINANCIAL_INFORMATION!.contentHash);
      expect(run1.unresolvedSections).toEqual(run2.unresolvedSections);
    });
  });

  describe('SME & SEBI Heading Disambiguation', () => {
    it('accurately extracts GENERAL INFORMATION for lead managers and avoids GID disclaimer false positives', () => {
      const pages = [
        {
          pageNumber: 1,
          text: 'TABLE OF CONTENTS\nSECTION I - GENERAL ....................... 1',
        },
        {
          pageNumber: 2,
          text: 'GENERAL INFORMATION DOCUMENT FOR INVESTING IN PUBLIC OFFERS\nThis document is a regulatory overview...',
        },
        {
          pageNumber: 3,
          text: 'GENERAL INFORMATION\nBOOK RUNNING LEAD MANAGER: Finshore Management Services Limited\nREGISTRAR: Cameo Corporate Services Limited',
        },
        {
          pageNumber: 4,
          text: 'CAPITAL STRUCTURE\nThe Offer comprises Fresh Issue of 4,267,200 Equity Shares.',
        },
      ];

      const res = extractSebiDocumentSectionsFromPages(pages, 'gid-hash');
      expect(res.sections.LEAD_MANAGERS_AND_GENERAL_INFO).toBeDefined();
      expect(res.sections.LEAD_MANAGERS_AND_GENERAL_INFO!.pageRange.startPage).toBe(3);
      expect(res.sections.LEAD_MANAGERS_AND_GENERAL_INFO!.content).toContain('Finshore Management Services Limited');
    });

    it('extracts OUR BUSINESS from standalone section heading and ignores mid-sentence body occurrences', () => {
      const pages = [
        {
          pageNumber: 1,
          text: 'RISK FACTORS\nAny disruption in power supply may adversely affect our business operations significantly.',
        },
        {
          pageNumber: 2,
          text: 'OUR BUSINESS\nWe are a manufacturer and distributor of fashion accessories and imitation jewellery.',
        },
      ];

      const res = extractSebiDocumentSectionsFromPages(pages, 'biz-hash');
      expect(res.sections.OUR_BUSINESS).toBeDefined();
      expect(res.sections.OUR_BUSINESS!.pageRange.startPage).toBe(2);
      expect(res.sections.OUR_BUSINESS!.content).toContain('manufacturer and distributor of fashion accessories');
      expect(res.sections.OUR_BUSINESS!.charCount).toBeGreaterThan(0);
    });

    it('extracts INDUSTRY OVERVIEW from complex hyphenated and spaced chapter headers', () => {
      const pages = [
        {
          pageNumber: 1,
          text: 'SECTION V- ABOUT THE COMPANY INDUSTRY OVERVIEW\nThe Indian fashion accessories market is projected to grow at 12% CAGR.',
        },
        {
          pageNumber: 2,
          text: 'SECTION VI- OUR BUSINESS\nCompany overview details...',
        },
      ];

      const res = extractSebiDocumentSectionsFromPages(pages, 'ind-hash');
      expect(res.sections.INDUSTRY_OVERVIEW).toBeDefined();
      expect(res.sections.INDUSTRY_OVERVIEW!.content).toContain('Indian fashion accessories market');
    });
  });

  describe('Buffer Validation', () => {
    it('rejects empty or invalid buffer', async () => {
      await expect(extractSebiDocumentSections(Buffer.from(''))).rejects.toThrow(
        'PDF buffer is empty or invalid',
      );
    });
  });
});
