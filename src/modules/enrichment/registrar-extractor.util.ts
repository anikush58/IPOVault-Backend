import { IpoStatus, LifecycleEventType, PublicationStatus } from '@prisma/client';
import { normalizeRegistrarCode } from '../allotment/adapters/registrar-adapter.registry';
import { SebiSectionKey } from '../discovery/adapters/sebi/sebi-section.types';

const REGISTRAR_SUBSECTION_STOP_PATTERN =
  /\n\s*(?:BANKERS?\s+TO\s+THE\s+(?:OFFER|ISSUE)|SELF\s+CERTIFIED\s+SYNDICATE\s+BANKS?|SCSBS|SYNDICATE\s+MEMBERS?|STATUTORY\s+AUDITORS?|CREDIT\s+RATING|LEGAL\s+(?:ADVISORS?|COUNSEL)|DEBENTURE\s+TRUSTEE|APPRAISING\s+ENTITY|MONITORING\s+AGENCY|BOOK\s+RUNNING\s+LEAD\s+MANAGERS?|COMPLIANCE\s+OFFICER)\b/i;

const KNOWN_ADAPTER_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  {
    code: 'KFINTECH',
    pattern:
      /\b(?:kfin\s*tech(?:nologies)?(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?|karvy\s+fintech)\b|kfintech\.com/i,
  },
  {
    code: 'MUFG_INTIME',
    pattern:
      /\b(?:mufg\s*intime(?:\s+india)?|link\s*intime(?:\s*\(?india\)?)?(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?)\b|mpms\.mufg\.com|linkintime\.co\.in/i,
  },
  {
    code: 'BIGSHARE',
    pattern:
      /\bbigshare\s*services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b|bigshareonline\.com/i,
  },
  {
    code: 'MAASHITLA',
    pattern:
      /\bmaashitla\s*securities(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b|maashitla\.com/i,
  },
  {
    code: 'SKYLINE',
    pattern:
      /\bskyline\s*financial\s*services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b|skylinerta\.com/i,
  },
  {
    code: 'PURVA',
    pattern:
      /\bpurva\s*sharegistry(?:\s*\(?india\)?)?(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b|purvashare\.com/i,
  },
  {
    code: 'CAMEO',
    pattern:
      /\bcameo\s*corporate\s*services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b|cameoindia\.com/i,
  },
];

const SECONDARY_RTA_PATTERNS: Array<{ canonicalName: string; pattern: RegExp }> = [
  {
    canonicalName: 'Integrated Registry Management Services Private Limited',
    pattern: /\bintegrated\s+registry\s+management\s+services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'MAS Services Limited',
    pattern: /\bmas\s+services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'Beetal Financial & Computer Services Private Limited',
    pattern: /\bbeetal\s+financial(?:\s*(?:&|and)\s*computer\s+services)?(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'Alankit Assignments Limited',
    pattern: /\balankit\s+assignments(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'Satellite Corporate Services Private Limited',
    pattern: /\bsatellite\s+corporate\s+services(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'Accurate Securities & Registry Private Limited',
    pattern: /\baccurate\s+securities(?:\s*(?:&|and)\s*registry)?(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
  {
    canonicalName: 'MCS Share Transfer Agent Limited',
    pattern: /\bmcs\s+share\s+transfer\s+agent(?:\s+(?:private|pvt\.?)?\s*lim(?:ited|td\.?))?\b/i,
  },
];

const ACTIVE_FALLBACK_STATUSES = new Set<IpoStatus>([
  IpoStatus.UPCOMING,
  IpoStatus.OPEN,
  IpoStatus.CLOSING_TODAY,
  IpoStatus.CLOSED,
  IpoStatus.ALLOTMENT_PENDING,
]);

/**
 * Slices the registrar subsection out of a General Information / Summary RHP text block.
 */
export function extractRegistrarSubsectionWindow(text: string): string | null {
  if (!text || !text.trim()) {
    return null;
  }

  const headingMatch = text.match(
    /(?:REGISTRAR\s+TO\s+THE\s+(?:OFFER|ISSUE)|REGISTRAR\s+AND\s+(?:SHARE\s+)?TRANSFER\s+AGENT)/i,
  );
  if (!headingMatch || headingMatch.index === undefined) {
    return null;
  }

  const tail = text.slice(headingMatch.index, headingMatch.index + 1200);
  const stopMatch = tail.slice(headingMatch[0].length).match(REGISTRAR_SUBSECTION_STOP_PATTERN);
  if (stopMatch && stopMatch.index !== undefined) {
    return tail.slice(0, headingMatch[0].length + stopMatch.index);
  }
  return tail;
}

/**
 * Deterministically extracts canonical registrar code (or verified non-adapter RTA name)
 * from SEBI/BSE/NSE filing sections without calling an LLM.
 * Returns null when absent or ambiguous across conflicting registrars.
 */
export function extractRegistrarFromSections(
  sections: Partial<Record<SebiSectionKey, { content?: string } | string>>,
): string | null {
  const orderedKeys: SebiSectionKey[] = [
    'LEAD_MANAGERS_AND_GENERAL_INFO',
    'SUMMARY_OF_THE_ISSUE',
    'OUR_BUSINESS',
  ];

  for (const key of orderedKeys) {
    const rawEntry = sections[key];
    const content =
      typeof rawEntry === 'string' ? rawEntry : rawEntry?.content || '';
    if (!content) continue;

    const windowText = extractRegistrarSubsectionWindow(content);
    if (!windowText) continue;

    const matchedAdapterCodes = new Set<string>();
    for (const candidate of KNOWN_ADAPTER_PATTERNS) {
      if (candidate.pattern.test(windowText)) {
        matchedAdapterCodes.add(candidate.code);
      }
    }

    if (matchedAdapterCodes.size === 1) {
      return Array.from(matchedAdapterCodes)[0];
    }
    if (matchedAdapterCodes.size > 1) {
      return null;
    }

    const matchedSecondary = new Set<string>();
    for (const candidate of SECONDARY_RTA_PATTERNS) {
      if (candidate.pattern.test(windowText)) {
        matchedSecondary.add(candidate.canonicalName);
      }
    }
    if (matchedSecondary.size === 1) {
      return Array.from(matchedSecondary)[0];
    }
    if (matchedSecondary.size > 1) {
      return null;
    }
  }

  return null;
}

/**
 * Normalizes a candidate registrar string from AI extraction or filing metadata.
 * Rejects placeholders and empty values.
 */
export function sanitizeAndNormalizeRegistrar(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 3) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (
    [
      'n/a',
      'na',
      '-',
      '--',
      'tbd',
      'tba',
      'null',
      'undefined',
      'none',
      'unknown',
      'to be announced',
      'to be determined',
      'not available',
      'not applicable',
    ].includes(lower)
  ) {
    return null;
  }

  const normalized = normalizeRegistrarCode(trimmed);
  if (
    [
      'KFINTECH',
      'MUFG_INTIME',
      'BIGSHARE',
      'MAASHITLA',
      'SKYLINE',
      'PURVA',
      'CAMEO',
    ].includes(normalized)
  ) {
    return normalized;
  }

  return trimmed.slice(0, 150);
}

/**
 * Restricts active registrar AI web research fallback to PUBLISHED IPOs in active
 * pre-listing stages or LISTED within the last 30 days.
 */
export function isWithinActiveRegistrarWindow(
  ipo: {
    publicationStatus: PublicationStatus;
    status: IpoStatus;
    createdAt?: Date | null;
    lifecycleEvents?: Array<{
      eventType: LifecycleEventType;
      eventDate: Date;
    }> | null;
  },
  now: Date = new Date(),
): boolean {
  if (ipo.publicationStatus !== PublicationStatus.PUBLISHED) {
    return false;
  }
  if (ACTIVE_FALLBACK_STATUSES.has(ipo.status)) {
    return true;
  }
  if (ipo.status !== IpoStatus.LISTED) {
    return false;
  }

  const thirtyDaysMs = 30 * 86_400_000;
  const nowMs = now.getTime();
  const listingEvent = (ipo.lifecycleEvents || []).find(
    (e) => e.eventType === LifecycleEventType.LISTING,
  );
  if (listingEvent?.eventDate) {
    return nowMs - new Date(listingEvent.eventDate).getTime() <= thirtyDaysMs;
  }

  const closeEvent = (ipo.lifecycleEvents || []).find(
    (e) => e.eventType === LifecycleEventType.CLOSE,
  );
  if (closeEvent?.eventDate) {
    return nowMs - new Date(closeEvent.eventDate).getTime() <= thirtyDaysMs;
  }

  return false;
}
