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
    /\b([A-Z0-9\s().&-]+?\b(?:LIMITED|PRIVATE LIMITED))\b(?=\s*[\r\n]+(?:\(|OUR COMPANY|REGISTERED OFFICE|CIN:))/i.exec(
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
    // Fallback pattern for total offer: "OFFER OF UP TO X EQUITY SHARES" when not preceded by FRESH or OFS
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

  // Fallback pattern if aggregating phrase format differs slightly
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

  const freshIssueShareCount = extractShareCount(text, 'FRESH');
  const ofsShareCount = extractShareCount(text, 'OFS');
  const issueShareCount = extractShareCount(text, 'TOTAL');

  const freshIssueSize = extractInrAmount(text, 'FRESH');
  const ofsSize = extractInrAmount(text, 'OFS');
  const issueSize = extractInrAmount(text, 'TOTAL');

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
    issueShareCount,
    freshIssueShareCount,
    ofsShareCount,
    issueSize,
    freshIssueSize,
    ofsSize,
    warnings,
  };
}
