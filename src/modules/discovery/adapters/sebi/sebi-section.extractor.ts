import * as crypto from 'crypto';
import pdf from 'pdf-parse';

import {
  ALL_SEBI_SECTION_KEYS,
  ExtractedSectionMetadata,
  SebiExtractedDocumentSections,
  SebiSectionExtractionOptions,
  SebiSectionKey,
} from './sebi-section.types';

export const SEBI_PARSER_VERSION = 'sebi-section-extractor-v1';
export const DEFAULT_MAX_SECTION_CHARS = 50_000;

interface SectionPatternDef {
  key: SebiSectionKey;
  defaultTitle: string;
  headingRegexes: RegExp[];
  priority: number;
}

const SECTION_DEFINITIONS: SectionPatternDef[] = [
  {
    key: 'RISK_FACTORS',
    defaultTitle: 'Risk Factors',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?RISK\s+FACTORS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?INTERNAL\s+AND\s+EXTERNAL\s+RISK\s+FACTORS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?RISKS\s+RELATING\s+TO\s+(?:OUR\s+)?BUSINESS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?RISKS\s+RELATING\s+TO\s+OUR\s+COMPANY\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?FACTORS\s+RELATING\s+TO\s+THE\s+ISSUE\b/i,
    ],
    priority: 1,
  },
  {
    key: 'SUMMARY_OF_THE_ISSUE',
    defaultTitle: 'Summary of the Issue & Business',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?SUMMARY\s+OF\s+OUR\s+BUSINESS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?SUMMARY\s+OF\s+THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?SUMMARY\s+OF\s+THE\s+OFFER(?:ING)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?SUMMARY\s+OF\s+(?:THE\s+)?PROSPECTUS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?SUMMARY\s+OF\s+THE\s+OFFER\s+DOCUMENT\b/i,
      /\bOFFER\s+SUMMARY\b/i,
      /\bISSUE\s+SUMMARY\b/i,
      /\bEXECUTIVE\s+SUMMARY\b/i,
    ],
    priority: 2,
  },
  {
    key: 'OUR_BUSINESS',
    defaultTitle: 'Our Business',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?OUR\s+BUSINESS(?:\s+AND\s+OPERATIONS)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?BUSINESS\s+OVERVIEW\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?ABOUT\s+OUR\s+BUSINESS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?ABOUT\s+OUR\s+COMPANY\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?ABOUT\s+THE\s+ISSUER\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?DESCRIPTION\s+OF\s+OUR\s+BUSINESS\b/i,
    ],
    priority: 3,
  },
  {
    key: 'INDUSTRY_OVERVIEW',
    defaultTitle: 'Industry Overview',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?INDUSTRY\s+OVERVIEW\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?INDUSTRY\s+REPORT\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?SECTOR\s+OVERVIEW\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?AN\s+OVERVIEW\s+OF\s+THE\s+INDUSTRY\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?INDUSTRY\s+SCENARIO\b/i,
    ],
    priority: 4,
  },
  {
    key: 'CAPITAL_STRUCTURE',
    defaultTitle: 'Capital Structure',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?CAPITAL\s+STRUCTURE(?:\s+OF\s+OUR\s+COMPANY)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?SHARE\s+CAPITAL(?:\s+OF\s+OUR\s+COMPANY)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?DETAILS\s+OF\s+CAPITAL\s+STRUCTURE\b/i,
    ],
    priority: 5,
  },
  {
    key: 'OBJECTS_OF_THE_ISSUE',
    defaultTitle: 'Objects of the Issue',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?OBJECTS\s+OF\s+THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?OBJECTS\s+OF\s+THE\s+OFFER(?:ING)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?REQUIREMENT\s+OF\s+FUNDS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?UTILISATION\s+OF\s+(?:ISSUE\s+)?PROCEEDS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?UTILIZATION\s+OF\s+(?:ISSUE\s+)?PROCEEDS\b/i,
    ],
    priority: 6,
  },
  {
    key: 'BASIS_FOR_ISSUE_PRICE',
    defaultTitle: 'Basis for Issue Price',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?BASIS\s+FOR\s+(?:THE\s+)?ISSUE\s+PRICE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?BASIS\s+OF\s+(?:THE\s+)?ISSUE\s+PRICE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?VALUATION\s+AND\s+BASIS\s+FOR\s+ISSUE\s+PRICE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?JUSTIFICATION\s+OF\s+(?:THE\s+)?ISSUE\s+PRICE\b/i,
    ],
    priority: 7,
  },
  {
    key: 'FINANCIAL_INFORMATION',
    defaultTitle: 'Financial Information',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?FINANCIAL\s+INFORMATION\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?FINANCIAL\s+STATEMENTS(?:\s+AS\s+RESTATED)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?RESTATED\s+(?:CONSOLIDATED\s+)?FINANCIAL\s+(?:STATEMENTS|INFORMATION)\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*)?SUMMARY\s+OF\s+(?:RESTATED\s+)?FINANCIAL\s+INFORMATION\b/i,
    ],
    priority: 8,
  },
  {
    key: 'PROMOTERS_AND_SHAREHOLDING',
    defaultTitle: 'Promoters & Promoter Group',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?OUR\s+PROMOTERS(?:\s+AND\s+(?:THE\s+)?PROMOTER\s+GROUP)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?PROMOTERS\s+AND\s+PROMOTER\s+GROUP\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?OUR\s+PROMOTERS\s+AND\s+MANAGEMENT\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?SHAREHOLDING\s+PATTERN\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:ABOUT\s+OUR\s+COMPANY\s*[-–:]\s*)?)?OUR\s+MANAGEMENT\b/i,
    ],
    priority: 9,
  },
  {
    key: 'FRESH_ISSUE_AND_OFS',
    defaultTitle: 'The Offer & Issue Details',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?THE\s+OFFER\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?DETAILS\s+OF\s+THE\s+OFFER\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?DETAILS\s+OF\s+THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?TERMS\s+OF\s+THE\s+(?:OFFER|ISSUE)\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?STRUCTURE\s+OF\s+THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?FRESH\s+ISSUE\s+AND\s+OFFER\s+FOR\s+SALE\b/i,
    ],
    priority: 10,
  },
  {
    key: 'LEAD_MANAGERS_AND_GENERAL_INFO',
    defaultTitle: 'General Information & Lead Managers',
    headingRegexes: [
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?GENERAL\s+INFORMATION(?:\s+ABOUT\s+THE\s+ISSUER)?\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?BOOK\s+RUNNING\s+LEAD\s+MANAGERS\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?LEAD\s+MANAGER\s+TO\s+THE\s+ISSUE\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?MERCHANT\s+BANKERS?\s+TO\s+THE\s+(?:OFFER|ISSUE)\b/i,
      /\b(?:SECTION\s+[IVXLCDM]+\s*[-–:]\s*(?:INTRODUCTION\s*[-–:]\s*)?)?REGISTRAR\s+TO\s+THE\s+(?:OFFER|ISSUE)\b/i,
    ],
    priority: 11,
  },
  {
    key: 'ANCHOR_INVESTOR_PORTION',
    defaultTitle: 'Anchor Investor Allocation',
    headingRegexes: [
      /\bALLOCATION\s+TO\s+ANCHOR\s+INVESTORS\b/i,
      /\bANCHOR\s+INVESTOR\s+(?:PORTION|ALLOCATION)\b/i,
      /\bANCHOR\s+INVESTORS\b/i,
      /\bANCHOR\s+ALLOCATION\b/i,
    ],
    priority: 12,
  },
];

export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Normalizes text content by cleaning running headers, footers, and excess spacing.
 */
export function cleanSectionContent(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove repeated running headers common in SEBI filings
    .replace(
      /^[^\n]*(?:Draft Red Herring Prospectus|Red Herring Prospectus|Final Prospectus)[^\n]*$/gim,
      '',
    )
    .replace(/^[^\n]*Dated\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}[^\n]*$/gim, '')
    // Clean leading/trailing spaces per line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // Replace 3 or more newlines with 2 newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Matches major section heading on a given page text.
 */
export function findSectionHeadingOnPage(
  pageText: string,
  isTocPage = false,
): { key: SebiSectionKey; title: string; matchIndex: number } | null {
  if (isTocPage) return null;

  // Search top 1500 chars of page for section title
  const topText = pageText.slice(0, 1500);

  for (const def of SECTION_DEFINITIONS) {
    for (const rx of def.headingRegexes) {
      const match = rx.exec(topText);
      if (match) {
        // Ensure this isn't a Table of Contents entry (e.g. dots or page numbers on the line)
        const matchedLine = match[0];
        if (/[.]{4,}|\b\d{2,4}$/.test(matchedLine)) {
          continue;
        }
        return {
          key: def.key,
          title: match[0].trim(),
          matchIndex: match.index,
        };
      }
    }
  }

  return null;
}

/**
 * Deterministically extracts standard SEBI sections from extracted pages.
 */
export function extractSebiDocumentSectionsFromPages(
  pages: Array<{ pageNumber: number; text: string }>,
  documentHash: string,
  options?: SebiSectionExtractionOptions,
): SebiExtractedDocumentSections {
  const maxChars = options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const sections: Partial<Record<SebiSectionKey, ExtractedSectionMetadata>> = {};
  const totalPageCount = pages.length;

  if (pages.length === 0) {
    return {
      documentHash,
      totalPageCount: 0,
      extractedAt: new Date().toISOString(),
      parserVersion: SEBI_PARSER_VERSION,
      sections: {},
      unresolvedSections: [...ALL_SEBI_SECTION_KEYS],
      extractionMethod: 'DETERMINISTIC_PDF_SECTION_EXTRACTOR',
    };
  }

  // 1. Identify Table of Contents range (typically first 1-25 pages)
  let tocEndPage = 0;
  for (let i = 0; i < Math.min(25, pages.length); i++) {
    const pText = pages[i].text.toUpperCase();
    if (
      pText.includes('TABLE OF CONTENTS') ||
      pText.includes('INDEX OF CHAPTERS') ||
      (pText.includes('CONTENTS') && pText.includes('SECTION II'))
    ) {
      tocEndPage = Math.max(tocEndPage, pages[i].pageNumber);
    }
  }

  // 2. Scan pages for section boundary transitions
  interface DetectedMarker {
    key: SebiSectionKey;
    title: string;
    pageNumber: number;
  }

  const markers: DetectedMarker[] = [];
  const seenKeys = new Set<SebiSectionKey>();

  for (const page of pages) {
    const isToc = page.pageNumber <= tocEndPage;
    const found = findSectionHeadingOnPage(page.text, isToc);

    if (found && !seenKeys.has(found.key)) {
      markers.push({
        key: found.key,
        title: found.title,
        pageNumber: page.pageNumber,
      });
      seenKeys.add(found.key);
    }
  }

  // If no body markers found (e.g. continuous unpaged text in 1 page or unusual format),
  // fallback to multi-section heading scan on combined text
  if (markers.length === 0 && pages.length > 0) {
    const combinedText = pages.map((p) => p.text).join('\n\n');
    return extractSebiDocumentSectionsFromContinuousText(
      combinedText,
      documentHash,
      totalPageCount,
      options,
    );
  }

  // Sort markers by page number ascending
  markers.sort((a, b) => a.pageNumber - b.pageNumber);

  // 3. Assemble section page ranges and content
  for (let i = 0; i < markers.length; i++) {
    const curr = markers[i];
    const next = markers[i + 1];

    const startPage = curr.pageNumber;
    const endPage = next ? Math.max(startPage, next.pageNumber - 1) : totalPageCount;

    const sectionPages = pages.filter(
      (p) => p.pageNumber >= startPage && p.pageNumber <= endPage,
    );

    const rawSectionText = sectionPages.map((p) => p.text).join('\n\n');
    const cleaned = cleanSectionContent(rawSectionText);

    const isTruncated = cleaned.length > maxChars;
    const finalContent = isTruncated ? cleaned.slice(0, maxChars) : cleaned;

    sections[curr.key] = {
      sectionKey: curr.key,
      sectionTitle: curr.title,
      pageRange: { startPage, endPage },
      content: finalContent,
      charCount: finalContent.length,
      contentHash: computeSha256(finalContent),
      isTruncated,
    };
  }

  const resolvedKeys = Object.keys(sections) as SebiSectionKey[];
  const unresolvedSections = ALL_SEBI_SECTION_KEYS.filter(
    (k) => !resolvedKeys.includes(k),
  );

  return {
    documentHash,
    totalPageCount,
    extractedAt: new Date().toISOString(),
    parserVersion: SEBI_PARSER_VERSION,
    sections,
    unresolvedSections,
    extractionMethod: 'DETERMINISTIC_PDF_SECTION_EXTRACTOR',
  };
}

/**
 * Continuous text fallback for unpaged text or single-page blocks.
 */
export function extractSebiDocumentSectionsFromContinuousText(
  text: string,
  documentHash: string,
  totalPageCount = 1,
  options?: SebiSectionExtractionOptions,
): SebiExtractedDocumentSections {
  const maxChars = options?.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const sections: Partial<Record<SebiSectionKey, ExtractedSectionMetadata>> = {};

  interface TextOffsetMarker {
    key: SebiSectionKey;
    title: string;
    startIndex: number;
  }

  const markers: TextOffsetMarker[] = [];

  for (const def of SECTION_DEFINITIONS) {
    for (const rx of def.headingRegexes) {
      const match = rx.exec(text);
      if (match) {
        markers.push({
          key: def.key,
          title: match[0].trim(),
          startIndex: match.index,
        });
        break;
      }
    }
  }

  markers.sort((a, b) => a.startIndex - b.startIndex);

  for (let i = 0; i < markers.length; i++) {
    const curr = markers[i];
    const next = markers[i + 1];

    const rawChunk = next
      ? text.slice(curr.startIndex, next.startIndex)
      : text.slice(curr.startIndex);

    const cleaned = cleanSectionContent(rawChunk);
    const isTruncated = cleaned.length > maxChars;
    const finalContent = isTruncated ? cleaned.slice(0, maxChars) : cleaned;

    sections[curr.key] = {
      sectionKey: curr.key,
      sectionTitle: curr.title,
      pageRange: { startPage: 1, endPage: totalPageCount },
      content: finalContent,
      charCount: finalContent.length,
      contentHash: computeSha256(finalContent),
      isTruncated,
    };
  }

  const resolvedKeys = Object.keys(sections) as SebiSectionKey[];
  const unresolvedSections = ALL_SEBI_SECTION_KEYS.filter(
    (k) => !resolvedKeys.includes(k),
  );

  return {
    documentHash,
    totalPageCount,
    extractedAt: new Date().toISOString(),
    parserVersion: SEBI_PARSER_VERSION,
    sections,
    unresolvedSections,
    extractionMethod: 'DETERMINISTIC_PDF_SECTION_EXTRACTOR',
  };
}

/**
 * Main parser entry point: parses raw PDF buffer into structured document sections.
 */
export async function extractSebiDocumentSections(
  pdfBuffer: Buffer,
  options?: SebiSectionExtractionOptions,
): Promise<SebiExtractedDocumentSections> {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error('PDF buffer is empty or invalid');
  }

  const documentHash = computeSha256(pdfBuffer);
  const pages: Array<{ pageNumber: number; text: string }> = [];

  try {
    await pdf(pdfBuffer, {
      pagerender: (pageData: any) => {
        return pageData.getTextContent().then((textContent: any) => {
          const pageNum = pageData.pageIndex + 1;
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          pages.push({ pageNumber: pageNum, text: pageText });
          return pageText;
        });
      },
    });
    pages.sort((a, b) => a.pageNumber - b.pageNumber);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to extract text from PDF buffer: ${msg}`);
  }

  return extractSebiDocumentSectionsFromPages(pages, documentHash, options);
}
