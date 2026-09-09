import {
  SebiFilingMetadata,
  SebiFilingRelationship,
  SebiFilingType,
} from './sebi.types';

export class SebiParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SebiParseError';
  }
}

export function classifySebiFilingType(title: string): SebiFilingType {
  const upper = title.toUpperCase();

  if (
    upper.includes('PRICE BAND ADVERTISEMENT') ||
    upper.includes('PRICE BAND AD') ||
    upper.includes('PRICE BAND ANNOUNCEMENT') ||
    upper.includes('PRICE BAND NOTICE')
  ) {
    return 'PRICE_BAND_ADVERTISEMENT';
  }
  if (upper.includes('ABRIDGED PROSPECTUS')) return 'ABRIDGED_PROSPECTUS';
  if (upper.includes('ADDENDUM')) return 'ADDENDUM';
  if (upper.includes('CORRIGENDUM')) return 'CORRIGENDUM';
  if (upper.includes('DRHP') || upper.includes('DRAFT RED HERRING')) return 'DRHP';
  if (upper.includes('RHP') || upper.includes('RED HERRING')) return 'RHP';
  if (upper.includes('PROSPECTUS')) return 'PROSPECTUS';

  return 'OTHER';
}

export function inferSebiFilingRelationship(
  filingType: SebiFilingType,
  companyName: string,
): SebiFilingRelationship {
  const targetCompanyKey = companyName
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^A-Z0-9]/g, '');

  if (filingType === 'RHP' || filingType === 'ABRIDGED_PROSPECTUS') {
    return {
      parentFilingType: 'DRHP',
      relationshipType: 'SUPERSEDES_DRHP',
      targetCompanyKey,
    };
  }

  if (filingType === 'PRICE_BAND_ADVERTISEMENT') {
    return {
      parentFilingType: 'RHP',
      relationshipType: 'AMENDS_RHP',
      targetCompanyKey,
    };
  }

  if (filingType === 'ADDENDUM' || filingType === 'CORRIGENDUM') {
    return {
      parentFilingType: 'RHP',
      relationshipType: 'SUPPLEMENTS_RHP',
      targetCompanyKey,
    };
  }

  return {
    parentFilingType: null,
    relationshipType: 'UNRESOLVED',
    targetCompanyKey,
  };
}

export function parseSebiDate(dateStr: string): string {
  const trimmed = dateStr.trim();
  if (!trimmed) return new Date().toISOString().split('T')[0]!;

  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const parts = trimmed.match(/([a-z]{3})\s+(\d{1,2}),?\s+(\d{4})/i);
  if (parts) {
    const m = monthMap[parts[1]!.toLowerCase()];
    const dayP = parts[2]!.padStart(2, '0');
    const yr = parts[3]!;
    if (m) return `${yr}-${m}-${dayP}`;
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().split('T')[0]!;
}

export function extractCompanyNameFromTitle(title: string): string {
  // Removes filing suffixes like "- RHP", "- DRHP", "- Corrigendum", "Abridged Prospectus", etc.
  let cleaned = title
    .replace(/<[^>]+>/g, ' ') // Strip HTML tags
    .replace(
      /\s*[-–—]\s*(RHP|DRHP|Prospectus|Addendum|Corrigendum|Abridged Prospectus|Price Band Advertisement).*/gi,
      '',
    )
    .replace(/\s*\(India\)\s*/gi, ' India ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || title.trim();
}

export function parseSebiListingHtml(htmlText: string): SebiFilingMetadata[] {
  if (!htmlText || typeof htmlText !== 'string' || !htmlText.trim()) {
    throw new SebiParseError('SEBI listing HTML is empty or invalid');
  }

  // Row regex to capture Date and Title HTML
  const rowRegex =
    /<tr\s+[^>]*class=["'][^"']*odd[^"']*["'][^>]*>\s*<td>([^<]+)<\/td>\s*<td>([\s\S]*?)<\/td>\s*<\/tr>/gi;

  const filings: SebiFilingMetadata[] = [];
  let match: RegExpExecArray | null;

  while ((match = rowRegex.exec(htmlText)) !== null) {
    const rawDate = (match[1] || '').trim();
    const rawTitleTd = (match[2] || '').trim();

    // Extract detail link: <a href='...' title='...'>Title Text</a>
    const hrefMatch = /href=['"]([^'"]+)['"]/i.exec(rawTitleTd);
    const titleAttrMatch = /title=['"]([^'"]+)['"]/i.exec(rawTitleTd);
    const textMatch = />([^<]+)</i.exec(rawTitleTd);

    const detailUrl = hrefMatch ? hrefMatch[1]!.trim() : '';
    let titleText = titleAttrMatch ? titleAttrMatch[1]!.trim() : '';

    if (!titleText && textMatch) {
      titleText = textMatch[1]!.trim();
    }

    if (!detailUrl || !titleText) {
      continue; // Skip invalid row
    }

    // Extract externalId from URL (e.g. ..._104328.html -> 104328)
    const idMatch = /_(\d+)\.html/i.exec(detailUrl);
    const externalId = idMatch ? idMatch[1]! : detailUrl;

    // Check if direct PDF URL is present in rawTitleTd
    const pdfMatch = /href=\s*['"](https?:\/\/[^'"]+\.pdf)['"]/i.exec(rawTitleTd);
    const documentUrl = pdfMatch ? pdfMatch[1]! : undefined;

    const companyName = extractCompanyNameFromTitle(titleText);
    const filingType = classifySebiFilingType(titleText);
    const filingDate = parseSebiDate(rawDate);
    const filingRelationship = inferSebiFilingRelationship(
      filingType,
      companyName,
    );

    filings.push({
      externalId,
      companyName,
      filingTitle: titleText,
      filingType,
      filingDate,
      detailUrl,
      documentUrl,
      filingRelationship,
    });
  }

  return filings;
}
