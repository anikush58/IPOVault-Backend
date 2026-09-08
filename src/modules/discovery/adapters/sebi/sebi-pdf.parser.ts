import pdf from 'pdf-parse';

import type {
  SebiExtractedField,
  SebiFieldEvidence,
  SebiPdfIssueObservation,
} from './sebi.types';

export class SebiPdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SebiPdfParseError';
  }
}

export type SebiPdfParseOptions = {
  externalId: string;
  sourceUrl?: string | null;
};

// Strict statutory CIN pattern: 21 characters
// e.g. U27109HR1974PLC007126, U31402GJ1990PLC149769
const CIN_REGEX = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;

/**
 * Placeholder glyphs commonly used in draft SEBI filings (DRHP/RHP before pricing).
 * Examples: [●], [•], [], [], [ . ]
 */
const PLACEHOLDER_REGEX = /\[\s*[●•.\s\-]?\s*\]/;

export function isPlaceholder(val: string): boolean {
  if (!val) return true;
  return PLACEHOLDER_REGEX.test(val.trim());
}

/**
 * Normalizes text extracted from PDF conservatively.
 * Replaces non-breaking spaces and standardizes line breaks while retaining structure.
 */
export function normalizePdfText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Extracts magnitude multiplier for Indian currency representations.
 */
export function parseMagnitudeMultiplier(unitStr: string): number | null {
  const norm = unitStr.toLowerCase().trim();
  if (norm.startsWith('million')) return 1_000_000;
  if (norm.startsWith('lakh')) return 100_000;
  if (norm.startsWith('crore')) return 10_000_000;
  return null;
}

/**
 * Helper to convert date strings to ISO YYYY-MM-DD.
 * e.g., "TUESDAY, SEPTEMBER 15, 2026", "15-09-2026", "15/09/2026"
 */
export function parseDateToIso(dateStr: string): string | null {
  if (!dateStr || isPlaceholder(dateStr)) return null;

  const monthMap: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  const cleaned = dateStr.replace(/^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/i, '').trim();

  // Pattern 1: SEPTEMBER 15, 2026 or 15TH SEPTEMBER 2026
  const monthNameMatch = /([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(cleaned);
  if (monthNameMatch && monthNameMatch[1] && monthNameMatch[2] && monthNameMatch[3]) {
    const monthKey = monthNameMatch[1].toLowerCase();
    const m = monthMap[monthKey];
    if (m) {
      const day = monthNameMatch[2].padStart(2, '0');
      const year = monthNameMatch[3];
      return `${year}-${m}-${day}`;
    }
  }

  const dayMonthMatch = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9}),?\s+(\d{4})/i.exec(cleaned);
  if (dayMonthMatch && dayMonthMatch[1] && dayMonthMatch[2] && dayMonthMatch[3]) {
    const monthKey = dayMonthMatch[2].toLowerCase();
    const m = monthMap[monthKey];
    if (m) {
      const day = dayMonthMatch[1].padStart(2, '0');
      const year = dayMonthMatch[3];
      return `${year}-${m}-${day}`;
    }
  }

  // Pattern 2: 15-09-2026 or 15/09/2026
  const numericMatch = /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(cleaned);
  if (numericMatch && numericMatch[1] && numericMatch[2] && numericMatch[3]) {
    const day = numericMatch[1].padStart(2, '0');
    const month = numericMatch[2].padStart(2, '0');
    const year = numericMatch[3];
    return `${year}-${month}-${day}`;
  }

  return null;
}

/**
 * Extracts CIN deterministically from PDF text.
 */
export function extractCin(text: string): SebiExtractedField<string> {
  const normalizedText = normalizePdfText(text);

  const cinCandidates = new Set<string>();
  const evidenceList: string[] = [];

  // Match labeled CIN lines first: CIN: U27109HR1974PLC007126 or CIN - U2710...
  const labeledRegex = /CIN\s*[:|\-]?\s*([A-Z0-9\s\n]{21,35})/gi;
  let labelMatch: RegExpExecArray | null;

  while ((labelMatch = labeledRegex.exec(normalizedText)) !== null) {
    const rawMatch = labelMatch[1] || '';
    const cleaned = rawMatch.toUpperCase().replace(/[\s\r\n\t]/g, '');
    const cinSub = cleaned.slice(0, 21);
    if (CIN_REGEX.test(cinSub)) {
      cinCandidates.add(cinSub);
      evidenceList.push(labelMatch[0].trim());
    }
  }

  // Also scan for any standalone 21-char CIN statutory patterns in text
  const standaloneRegex = /\b([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/g;
  let standaloneMatch: RegExpExecArray | null;

  while ((standaloneMatch = standaloneRegex.exec(normalizedText)) !== null) {
    const cinVal = standaloneMatch[1]!;
    cinCandidates.add(cinVal);
    evidenceList.push(standaloneMatch[0]);
  }

  if (cinCandidates.size === 0) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: 'No valid 21-character statutory CIN found in document',
    };
  }

  if (cinCandidates.size > 1) {
    const evidence: SebiFieldEvidence = {
      rawTextSnippet: evidenceList.slice(0, 3).join(' | '),
    };
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Multiple distinct CINs detected in document: ${Array.from(cinCandidates).join(', ')}`,
      evidence,
    };
  }

  const singleCin = Array.from(cinCandidates)[0]!;
  return {
    value: singleCin,
    status: 'EXTRACTED',
    evidence: {
      rawTextSnippet: evidenceList[0] || singleCin,
    },
  };
}

/**
 * Extracts Legal Company Name deterministically from cover/header section.
 */
export function extractLegalName(text: string): SebiExtractedField<string> {
  const normalizedText = normalizePdfText(text);
  const headerSection = normalizedText.slice(0, 8000);

  // Check for ambiguous entity declarations (e.g., selling shareholders / promoters listed as issuer)
  const isAmbiguousIssuer =
    /(?:SELLING SHAREHOLDER|PROMOTER GROUP|SUBSIDIARY|GUARANTOR)\s+NAME/i.test(
      headerSection,
    );

  // Pattern 1: "OUR COMPANY WAS INCORPORATED AS ... UNDER THE NAME [NAME]"
  const incMatch =
    /(?:INCORPORATED AS|NAME OF OUR COMPANY WAS|OUR COMPANY WAS INCORPORATED AS)\s+['"]?([^'\n\r"]+?\bLIMITED\b)['"]?/i.exec(
      headerSection,
    );

  if (incMatch && incMatch[1]) {
    const candidate = incMatch[1].replace(/\s+/g, ' ').trim();
    return {
      value: candidate,
      status: 'EXTRACTED',
      evidence: { rawTextSnippet: incMatch[0] },
    };
  }

  // Cover header search: "NAME OF THE ISSUER COMPANY" or "[Company Name] Limited"
  const coverNameMatch =
    /\b([A-Z0-9\s().&-]+?\b(?:LIMITED|PRIVATE LIMITED))\b(?=[\s\r\n]+(?:\(|OUR COMPANY|REGISTERED OFFICE|CIN:))/i.exec(
      headerSection,
    );

  if (coverNameMatch && coverNameMatch[1]) {
    const cleaned = coverNameMatch[1].replace(/\s+/g, ' ').trim();

    if (
      !/SEBI|RED HERRING|DRAFT RED HERRING|PROSPECTUS|ABRIDGED|TABLE OF CONTENTS/i.test(
        cleaned,
      )
    ) {
      return {
        value: cleaned,
        status: 'EXTRACTED',
        evidence: { rawTextSnippet: coverNameMatch[0] },
      };
    }
  }

  // CIN vicinity search: CIN line followed or preceded by legal name
  const cinVicinityMatch =
    /(?:CIN\s*[:|-]?\s*[A-Z0-9]{21}\s*[\r\n]+)\s*([A-Z0-9\s().&-]+?\bLIMITED\b)/i.exec(
      headerSection,
    );

  if (cinVicinityMatch && cinVicinityMatch[1]) {
    const cleaned = cinVicinityMatch[1].replace(/\s+/g, ' ').trim();
    return {
      value: cleaned,
      status: 'EXTRACTED',
      evidence: { rawTextSnippet: cinVicinityMatch[0] },
    };
  }

  if (isAmbiguousIssuer) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning:
        'Multiple entity names found (promoters/selling shareholders/subsidiaries)',
    };
  }

  return {
    value: null,
    status: 'UNRESOLVED',
    warning: 'Could not deterministically extract legal company name',
  };
}

/**
 * Extracts Face Value deterministically.
 */
export function extractFaceValue(text: string): SebiExtractedField<number> {
  const normalizedText = normalizePdfText(text);

  const faceValueRegex =
    /face\s+value\s+of\s+(?:₹|Rs\.?|INR)?\s*(\d+(?:\.\d+)?)\s*(?:each|\/-)/gi;
  let match: RegExpExecArray | null;

  while ((match = faceValueRegex.exec(normalizedText)) !== null) {
    const valStr = match[1];
    if (valStr) {
      const val = parseFloat(valStr);
      if (!isNaN(val) && val > 0) {
        return {
          value: val,
          status: 'EXTRACTED',
          evidence: { rawTextSnippet: match[0] },
        };
      }
    }
  }

  return {
    value: null,
    status: 'UNRESOLVED',
    warning: 'Explicit face value not found',
  };
}

/**
 * Extracts priceBandLow and priceBandHigh deterministically.
 */
export function extractPriceBand(text: string): {
  low: SebiExtractedField<number>;
  high: SebiExtractedField<number>;
} {
  const normalizedText = normalizePdfText(text);

  const unresolvedPair = (warningMsg: string) => ({
    low: { value: null, status: 'UNRESOLVED' as const, warning: warningMsg },
    high: { value: null, status: 'UNRESOLVED' as const, warning: warningMsg },
  });

  // Range pattern 1: Price Band: ₹ 175 to ₹ 185 per Equity Share / Price Band of Rs. 175 to Rs. 185
  const rangeRegex =
    /\b(?:price\s+band|price\s+range)\s*(?:of|:)?\s*[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(?:to|-|and)\s*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(?:per|\/-|each)?/gi;

  let match = rangeRegex.exec(normalizedText);

  // Pattern 2: Floor Price of ₹ 175 ... Cap Price of ₹ 185
  if (!match) {
    const floorCapRegex =
      /\bfloor\s+price\s+(?:of|:)?\s*[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)(?:(?!\bcap\s+price\b)[\s\S])*?\bcap\s+price\s+(?:of|:)?\s*[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)/i;
    match = floorCapRegex.exec(normalizedText);
  }

  // Pattern 3: Fixed Price Issue e.g. "Offer Price of ₹ 180 per Equity Share" or "Issue Price: Rs. 180 per Equity Share"
  if (!match) {
    const fixedPriceRegex =
      /\b(?:fixed\s+price|offer\s+price|issue\s+price)\s*(?:of|:)?\s*[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(?:per|\/-|each)?/i;
    const fixedMatch = fixedPriceRegex.exec(normalizedText);
    if (fixedMatch && fixedMatch[1]) {
      const raw = fixedMatch[1].trim();
      if (isPlaceholder(raw)) {
        return unresolvedPair('Fixed issue price is an unfinalized placeholder');
      }
      const val = parseFloat(raw.replace(/,/g, ''));
      if (!isNaN(val) && val > 0) {
        return {
          low: {
            value: val,
            status: 'EXTRACTED',
            evidence: { rawTextSnippet: fixedMatch[0] },
          },
          high: {
            value: val,
            status: 'EXTRACTED',
            evidence: { rawTextSnippet: fixedMatch[0] },
          },
        };
      }
    }
  }

  // Check for isolated Floor Price or isolated Cap Price
  if (!match) {
    const hasIsolatedFloor = /\bfloor\s+price\b/i.test(normalizedText);
    const hasIsolatedCap = /\bcap\s+price\b/i.test(normalizedText);
    if (hasIsolatedFloor || hasIsolatedCap) {
      return unresolvedPair('Isolated floor/cap price endpoint without complete range');
    }
    return unresolvedPair('Price band range not found');
  }

  const rawLow = match[1] ? match[1].trim() : '';
  const rawHigh = match[2] ? match[2].trim() : '';

  if (isPlaceholder(rawLow) || isPlaceholder(rawHigh)) {
    return unresolvedPair('Price band endpoint is an unfinalized placeholder');
  }

  const lowVal = parseFloat(rawLow.replace(/,/g, ''));
  const highVal = parseFloat(rawHigh.replace(/,/g, ''));

  if (isNaN(lowVal) || isNaN(highVal) || lowVal <= 0 || highVal <= 0) {
    return unresolvedPair(`Invalid numeric price band range '${rawLow} - ${rawHigh}'`);
  }

  if (lowVal > highVal) {
    return unresolvedPair(`Invalid price band: floor price (${lowVal}) > cap price (${highVal})`);
  }

  return {
    low: {
      value: lowVal,
      status: 'EXTRACTED',
      evidence: { rawTextSnippet: match[0] },
    },
    high: {
      value: highVal,
      status: 'EXTRACTED',
      evidence: { rawTextSnippet: match[0] },
    },
  };
}

/**
 * Extracts lotSize deterministically (shares per market/bid lot).
 */
export function extractLotSize(text: string): SebiExtractedField<number> {
  const normalizedText = normalizePdfText(text);

  const lotRegex =
    /\b(?:bid\s+lot|market\s+lot|minimum\s+bid\s+quantity)\s*(?:of|:|-)?\s*([\[\]●•\d,.]+)\s*(?:equity\s+shares)?/gi;

  const candidateLots: number[] = [];
  const evidenceList: string[] = [];

  let match: RegExpExecArray | null;

  while ((match = lotRegex.exec(normalizedText)) !== null) {
    const rawVal = match[1] ? match[1].trim() : '';

    if (isPlaceholder(rawVal)) {
      return {
        value: null,
        status: 'UNRESOLVED',
        warning: 'Lot size is an unfinalized placeholder',
        evidence: { rawTextSnippet: match[0] },
      };
    }

    const val = parseInt(rawVal.replace(/,/g, ''), 10);

    const isOneLotPhrase = /1\s+(?:market\s+)?lot\b/i.test(match[0]);
    if (!isNaN(val) && val > 1 && !isOneLotPhrase) {
      candidateLots.push(val);
      evidenceList.push(match[0]);
    }
  }

  const uniqueLots = Array.from(new Set(candidateLots));

  if (uniqueLots.length === 0) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: 'Lot size not found',
    };
  }

  if (uniqueLots.length > 1) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Multiple ambiguous lot sizes found: ${uniqueLots.join(', ')}`,
      evidence: { rawTextSnippet: evidenceList.join(' | ') },
    };
  }

  return {
    value: uniqueLots[0]!,
    status: 'EXTRACTED',
    evidence: { rawTextSnippet: evidenceList[0] || String(uniqueLots[0]) },
  };
}

/**
 * Extracts issueOpenDate deterministically.
 */
export function extractIssueOpenDate(text: string): SebiExtractedField<string> {
  const normalizedText = normalizePdfText(text);

  const openRegex =
    /\b(?:bid\/offer|issue|offer)\s+opens\s+on\s*[:|-]?\s*([a-z0-9\s,/.\-]+?)(?=\s*(?:and\s+closes|bid\/offer\s+closes|issue\s+closes|closing|\n|\.|$))/gi;

  let match: RegExpExecArray | null;

  while ((match = openRegex.exec(normalizedText)) !== null) {
    // Ensure this match line/phrase is NOT for anchor investors
    if (/anchor\s+investor/i.test(match[0])) {
      continue;
    }

    const rawDate = match[1] ? match[1].trim() : '';

    if (isPlaceholder(rawDate)) {
      return {
        value: null,
        status: 'UNRESOLVED',
        warning: 'Issue open date is an unfinalized placeholder',
        evidence: { rawTextSnippet: match[0] },
      };
    }

    const isoDate = parseDateToIso(rawDate);
    if (isoDate) {
      return {
        value: isoDate,
        status: 'EXTRACTED',
        evidence: { rawTextSnippet: match[0] },
      };
    }
  }

  return {
    value: null,
    status: 'UNRESOLVED',
    warning: 'Issue open date not found',
  };
}

/**
 * Extracts issueCloseDate deterministically.
 */
export function extractIssueCloseDate(text: string): SebiExtractedField<string> {
  const normalizedText = normalizePdfText(text);

  const closeRegex =
    /\b(?:bid\/offer|issue|offer)\s+closes\s+on\s*[:|-]?\s*([a-z0-9\s,/.\-]+?)(?=\s*(?:and\s+|\n|\.|$))/gi;

  let match: RegExpExecArray | null;

  while ((match = closeRegex.exec(normalizedText)) !== null) {
    if (/anchor\s+investor|allotment|refund|listing/i.test(match[0])) {
      continue;
    }

    const rawDate = match[1] ? match[1].trim() : '';

    if (isPlaceholder(rawDate)) {
      return {
        value: null,
        status: 'UNRESOLVED',
        warning: 'Issue close date is an unfinalized placeholder',
        evidence: { rawTextSnippet: match[0] },
      };
    }

    const isoDate = parseDateToIso(rawDate);
    if (isoDate) {
      return {
        value: isoDate,
        status: 'EXTRACTED',
        evidence: { rawTextSnippet: match[0] },
      };
    }
  }

  return {
    value: null,
    status: 'UNRESOLVED',
    warning: 'Issue close date not found',
  };
}

/**
 * Helper to locate the "DETAILS OF THE OFFER" section text.
 */
export function getOfferDetailsSection(text: string): string {
  const normalizedText = normalizePdfText(text);
  const headings = [
    /DETAILS OF THE OFFER/i,
    /STRUCTURE OF THE OFFER/i,
    /SUMMARY OF THE OFFER/i,
    /THE OFFER/i,
  ];

  for (const heading of headings) {
    const match = heading.exec(normalizedText);
    if (match) {
      const start = match.index;
      return normalizedText.slice(start, start + 8000);
    }
  }

  return normalizedText;
}

/**
 * Extracts share count for fresh issue, OFS, or total offer.
 * Strictly separates shares from INR amounts.
 */
export function extractShareCount(
  text: string,
  category: 'FRESH' | 'OFS' | 'TOTAL',
): SebiExtractedField<number> {
  const sectionText = getOfferDetailsSection(text);

  let categoryPattern: RegExp;

  if (category === 'FRESH') {
    categoryPattern =
      /(?:fresh\s+issue|fresh\s+offer)\s+of\s+up\s+to\s+([\[\]●•\s\d,]+)\s+equity\s+shares/i;
  } else if (category === 'OFS') {
    categoryPattern =
      /(?:offer\s+for\s+sale|ofs)\s+of\s+up\s+to\s+([\[\]●•\s\d,]+)\s+equity\s+shares/i;
  } else {
    categoryPattern =
      /(?:initial\s+public\s+offer|total\s+offer)\s+of\s+up\s+to\s+([\[\]●•\s\d,]+)\s+equity\s+shares/i;
  }

  let match = categoryPattern.exec(sectionText);

  if (!match && category === 'TOTAL') {
    categoryPattern =
      /\boffer\s+of\s+up\s+to\s+([\[\]●•\s\d,]+)\s+equity\s+shares/i;
    match = categoryPattern.exec(sectionText);
  }

  if (!match || !match[1]) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Share count for category ${category} not found`,
    };
  }

  const rawCaptured = match[1].trim();

  if (isPlaceholder(rawCaptured)) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Share count for category ${category} is an unfinalized placeholder`,
      evidence: { rawTextSnippet: match[0] },
    };
  }

  const digitsOnly = rawCaptured.replace(/,/g, '').replace(/\s+/g, '');
  const count = parseInt(digitsOnly, 10);

  if (isNaN(count) || count <= 0) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Invalid numeric share count '${rawCaptured}' for ${category}`,
    };
  }

  return {
    value: count,
    status: 'EXTRACTED',
    evidence: { rawTextSnippet: match[0] },
  };
}

/**
 * Extracts INR size for fresh issue, OFS, or total offer.
 * Strictly separates INR amounts from share counts and evaluates magnitude units (million, lakh, crore).
 */
export function extractInrAmount(
  text: string,
  category: 'FRESH' | 'OFS' | 'TOTAL',
): SebiExtractedField<number> {
  const sectionText = getOfferDetailsSection(text);

  let categoryRegex: RegExp;

  if (category === 'FRESH') {
    categoryRegex =
      /(?:fresh\s+issue|fresh\s+offer)(?:(?!\boffer\s+for\s+sale\b|\bofs\b)[\s\S])*?aggregating\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
  } else if (category === 'OFS') {
    categoryRegex =
      /(?:offer\s+for\s+sale|\bofs\b)(?:(?!\bfresh\s+issue\b)[\s\S])*?aggregating\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
  } else {
    categoryRegex =
      /(?:initial\s+public\s+offer|total\s+offer)(?:(?!\bfresh\s+issue\b|\boffer\s+for\s+sale\b|\bofs\b)[\s\S])*?aggregating\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
  }

  let match = categoryRegex.exec(sectionText);

  if (!match) {
    if (category === 'FRESH') {
      categoryRegex =
        /fresh\s+issue\s+of\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
    } else if (category === 'OFS') {
      categoryRegex =
        /(?:offer\s+for\s+sale|ofs)\s+of\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
    } else {
      categoryRegex =
        /(?:initial\s+public\s+offer|total\s+offer)\s+aggregating\s+(?:up\s+to\s+)?[\s\r\n]*(?:₹|Rs\.?|INR)?[\s\r\n]*([\[\]●•\d,.]+)\s*(million|lakhs?|crores?)/i;
    }
    match = categoryRegex.exec(sectionText);
  }

  if (!match || !match[1] || !match[2]) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `INR size for category ${category} not found`,
    };
  }

  const rawCaptured = match[1].trim();

  if (isPlaceholder(rawCaptured)) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `INR size for category ${category} is an unfinalized placeholder`,
      evidence: { rawTextSnippet: match[0] },
    };
  }

  const numericVal = parseFloat(rawCaptured.replace(/,/g, ''));
  const multiplier = parseMagnitudeMultiplier(match[2]);

  if (isNaN(numericVal) || numericVal <= 0 || multiplier === null) {
    return {
      value: null,
      status: 'UNRESOLVED',
      warning: `Invalid INR amount format '${rawCaptured} ${match[2]}' for ${category}`,
    };
  }

  const totalInr = Math.round(numericVal * multiplier);

  return {
    value: totalInr,
    status: 'EXTRACTED',
    evidence: { rawTextSnippet: match[0] },
  };
}

/**
 * Main parser entry point: parses raw PDF bytes deterministically into a structured SebiPdfIssueObservation.
 */
export async function parseSebiPdfBuffer(
  pdfBuffer: Buffer,
  options: SebiPdfParseOptions,
): Promise<SebiPdfIssueObservation> {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new SebiPdfParseError('PDF buffer is empty or invalid');
  }

  let textData: string;
  try {
    const pdfParsed = await pdf(pdfBuffer);
    textData = pdfParsed.text;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SebiPdfParseError(`Failed to extract text from PDF: ${msg}`);
  }

  return parseSebiExtractedText(textData, options);
}

/**
 * Deterministic text parser operating on extracted PDF text strings.
 */
export function parseSebiExtractedText(
  rawText: string,
  options: SebiPdfParseOptions,
): SebiPdfIssueObservation {
  const text = normalizePdfText(rawText);

  const cin = extractCin(text);
  const legalName = extractLegalName(text);
  const faceValue = extractFaceValue(text);

  const priceBand = extractPriceBand(text);
  const lotSize = extractLotSize(text);

  const freshIssueShareCount = extractShareCount(text, 'FRESH');
  const ofsShareCount = extractShareCount(text, 'OFS');
  const issueShareCount = extractShareCount(text, 'TOTAL');

  const freshIssueSize = extractInrAmount(text, 'FRESH');
  const ofsSize = extractInrAmount(text, 'OFS');
  const issueSize = extractInrAmount(text, 'TOTAL');

  const issueOpenDate = extractIssueOpenDate(text);
  const issueCloseDate = extractIssueCloseDate(text);

  const warnings: string[] = [];

  // Validate Share Count consistency (Fresh + OFS === Total) without auto-correcting
  if (
    freshIssueShareCount.value !== null &&
    ofsShareCount.value !== null &&
    issueShareCount.value !== null
  ) {
    const expectedSum = freshIssueShareCount.value + ofsShareCount.value;
    if (expectedSum !== issueShareCount.value) {
      const warnMsg = `Share count discrepancy: Fresh (${freshIssueShareCount.value}) + OFS (${ofsShareCount.value}) = ${expectedSum}, but Total is reported as ${issueShareCount.value}`;
      warnings.push(warnMsg);
      issueShareCount.status = 'MISMATCH_WARNING';
      issueShareCount.warning = warnMsg;
    }
  }

  // Validate INR Amount consistency (Fresh + OFS === Total) without auto-correcting
  if (
    freshIssueSize.value !== null &&
    ofsSize.value !== null &&
    issueSize.value !== null
  ) {
    const expectedSum = freshIssueSize.value + ofsSize.value;
    if (expectedSum !== issueSize.value) {
      const warnMsg = `INR amount discrepancy: Fresh (₹${freshIssueSize.value}) + OFS (₹${ofsSize.value}) = ₹${expectedSum}, but Total is reported as ₹${issueSize.value}`;
      warnings.push(warnMsg);
      issueSize.status = 'MISMATCH_WARNING';
      issueSize.warning = warnMsg;
    }
  }

  return {
    externalId: options.externalId,
    sourceUrl: options.sourceUrl,
    extractedAt: new Date().toISOString(),
    legalName,
    cin,
    faceValue,
    priceBandLow: priceBand.low,
    priceBandHigh: priceBand.high,
    issueShareCount,
    freshIssueShareCount,
    ofsShareCount,
    lotSize,
    issueSize,
    freshIssueSize,
    ofsSize,
    issueOpenDate,
    issueCloseDate,
    warnings,
  };
}
