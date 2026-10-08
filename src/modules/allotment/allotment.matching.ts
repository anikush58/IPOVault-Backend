import {
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
} from './allotment.types';

export interface CleanCompanyCandidate {
  code: string;
  name: string;
  symbol?: string;
  cleanKey: string;
  aliasKey: string;
  tokens: string[];
}

/**
 * Calculates standard Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1,     // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Repeatedly strips trailing offering and corporate suffixes from a raw company name.
 */
export function stripOfferingAndCorporateSuffixes(name: string): string {
  let clean = name.toLowerCase().trim();

  // Normalize conjunctions & symbols so "&" and "and" match seamlessly across data sources
  clean = clean.replace(/&/g, ' and ').replace(/['’]/g, '');

  let changed = true;
  while (changed) {
    const prev = clean;
    clean = clean
      .replace(
        /[\s\-_,.]+(ipo|sme\s+ipo|sme|rights\s+issue|buyback|fpo|reit|invit)$/i,
        '',
      )
      .replace(
        /[\s\-_,.]+(private\s+limited|pvt\s*\.?\s*ltd\.?|limited|ltd\.?)$/i,
        '',
      )
      .trim();
    changed = clean !== prev;
  }

  return clean;
}

/**
 * Normalizes a company name into a contiguous lowercase alphanumeric string.
 */
export function normalizeName(name: string): string {
  const stripped = stripOfferingAndCorporateSuffixes(name);
  return stripped.replace(/[^a-z0-9]/g, '').trim();
}

/**
 * Extracts meaningful individual lowercase tokens from a company name after stripping suffixes.
 */
export function extractMeaningfulTokens(name: string): string[] {
  const stripped = stripOfferingAndCorporateSuffixes(name);
  const rawTokens = stripped.split(/[^a-z0-9]+/i);
  return rawTokens.filter((tok) => tok.length > 0);
}

/**
 * Applies deterministic canonical spelling corrections for common registrar typos.
 */
export function applyRegistrarSpellingAliases(str: string): string {
  if (!str) return '';

  return str
    .replace(/managment/g, 'management')
    .replace(/onemi/g, 'oneemi')
    .replace(/technoforg\b/g, 'technoforge')
    .replace(/techology/g, 'technology')
    .replace(/solutons/g, 'solutions')
    .replace(/enterpirses/g, 'enterprises');
}

/**
 * Evaluates whether two token sequences match under conservative typo-tolerant safety rules.
 *
 * Rules:
 * 1. Token counts must be identical.
 * 2. Tokens of length <= 4 must match 100% exactly (No edit distance allowed for short identifiers).
 * 3. Tokens of length >= 5 (with at least one token length >= 6) allow maximum Levenshtein distance <= 1.
 * 4. Leading token must match exactly if <= 4 chars, or distance <= 1 if >= 5 chars.
 */
export function isTokenMatchSafely(
  targetTokens: string[],
  candidateTokens: string[],
): boolean {
  if (
    !targetTokens ||
    !candidateTokens ||
    targetTokens.length === 0 ||
    candidateTokens.length === 0
  ) {
    return false;
  }

  if (targetTokens.length !== candidateTokens.length) {
    return false;
  }

  // Lead token validation
  const leadTarget = targetTokens[0];
  const leadCandidate = candidateTokens[0];

  if (leadTarget.length <= 4 || leadCandidate.length <= 4) {
    if (leadTarget !== leadCandidate) {
      return false;
    }
  }

  // Pairwise token validation
  for (let i = 0; i < targetTokens.length; i++) {
    const t = targetTokens[i];
    const c = candidateTokens[i];

    if (t === c) {
      continue;
    }

    // Short identifier invariance: length <= 4 requires 100% exact match
    if (t.length <= 4 || c.length <= 4) {
      return false;
    }

    // Require both tokens length >= 5 and at least one >= 6 for 1-char typo tolerance
    if (t.length < 5 || c.length < 5 || Math.max(t.length, c.length) < 6) {
      return false;
    }

    const dist = levenshteinDistance(t, c);
    if (dist > 1) {
      return false;
    }
  }

  return true;
}

/**
 * Normalizes raw discovery items into structured CleanCompanyCandidate objects.
 */
export function parseCompanyCandidates(items: unknown[]): CleanCompanyCandidate[] {
  const candidates: CleanCompanyCandidate[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    let code = String(
      rec.clientId ||
        rec.client_id ||
        rec.clientid ||
        rec.code ||
        rec.company_id ||
        rec.id ||
        rec.value ||
        '',
    ).trim();

    const name = String(
      rec.name ||
        rec.company_name ||
        rec.companyName ||
        rec.companyname ||
        rec.caption ||
        rec.text ||
        rec.label ||
        '',
    ).trim();

    const symbol = rec.symbol
      ? String(rec.symbol).trim().toUpperCase()
      : undefined;

    // If code is empty or is a UUID, but we have a valid company name, fallback code to name
    if (
      (!code ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          code,
        )) &&
      name &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        name,
      )
    ) {
      code = name;
    }

    if (code && name) {
      const cleanKey = normalizeName(name);
      const aliasKey = applyRegistrarSpellingAliases(cleanKey);
      const tokens = extractMeaningfulTokens(name);

      candidates.push({
        code,
        name,
        symbol,
        cleanKey,
        aliasKey,
        tokens,
      });
    }
  }

  return candidates;
}

/**
 * Core pure multi-tier conservative registrar company matcher.
 *
 * Matching Priority:
 * 1. Exact Symbol match (if both sides provide symbol).
 * 2. Tier 1: Strict Exact Normalized Name match.
 * 3. Tier 2: Canonical Spelling Alias match.
 * 4. Tier 3: Conservative Token Typo Fallback (Single Candidate Isolation required).
 * 5. Tier 4: Prefix / Substring Containment Isolation Match.
 * 6. Returns NEEDS_REVIEW if multiple candidates match at any tier.
 * 7. Returns NOT_YET_AVAILABLE if zero candidates match.
 */
export function matchRegistrarCompany(
  items: unknown[],
  request: CheckAllotmentRequest,
  registrarCode: string,
  registrarName: string,
  checkedAt: Date = new Date(),
): string | NormalizedAllotmentResult {
  const candidates = parseCompanyCandidates(items);

  const targetSymbol = request.symbol?.trim().toUpperCase();
  const targetLegalName = request.companyLegalName || '';
  const targetDisplayName = request.companyName || '';

  const targetLegalKey = normalizeName(targetLegalName);
  const targetDisplayKey = normalizeName(targetDisplayName);

  const targetLegalTokens = extractMeaningfulTokens(targetLegalName);
  const targetDisplayTokens = extractMeaningfulTokens(targetDisplayName);

  // ============================================================
  // STEP 1: Exact Symbol Match (Highest Priority)
  // ============================================================
  if (targetSymbol) {
    const symbolMatches = candidates.filter(
      (c) => c.symbol && c.symbol === targetSymbol,
    );

    if (symbolMatches.length === 1) {
      return symbolMatches[0].code;
    }
    if (symbolMatches.length > 1) {
      return {
        status: AllotmentStatus.NEEDS_REVIEW,
        sourceCode: registrarCode,
        checkedAt,
        errorMessage: `Multiple ambiguous matches found by symbol '${targetSymbol}' in ${registrarName} live list`,
      };
    }
  }

  // ============================================================
  // STEP 2: Tier 1 Strict Exact Normalized Name Match
  // ============================================================
  const exactMatches = candidates.filter((c) => {
    return (
      (targetLegalKey.length > 0 && c.cleanKey === targetLegalKey) ||
      (targetDisplayKey.length > 0 && c.cleanKey === targetDisplayKey)
    );
  });

  if (exactMatches.length === 1) {
    return exactMatches[0].code;
  }
  if (exactMatches.length > 1) {
    return {
      status: AllotmentStatus.NEEDS_REVIEW,
      sourceCode: registrarCode,
      checkedAt,
      errorMessage: `Multiple ambiguous matches found by company name in ${registrarName} live list`,
    };
  }

  // ============================================================
  // STEP 3: Tier 2 Canonical Spelling Alias Match
  // ============================================================
  const aliasLegalKey = applyRegistrarSpellingAliases(targetLegalKey);
  const aliasDisplayKey = applyRegistrarSpellingAliases(targetDisplayKey);

  if (aliasLegalKey || aliasDisplayKey) {
    const aliasMatches = candidates.filter((c) => {
      return (
        (aliasLegalKey.length > 0 && c.aliasKey === aliasLegalKey) ||
        (aliasDisplayKey.length > 0 && c.aliasKey === aliasDisplayKey)
      );
    });

    if (aliasMatches.length === 1) {
      return aliasMatches[0].code;
    }
    if (aliasMatches.length > 1) {
      return {
        status: AllotmentStatus.NEEDS_REVIEW,
        sourceCode: registrarCode,
        checkedAt,
        errorMessage: `Multiple ambiguous alias matches found in ${registrarName} live list`,
      };
    }
  }

  // ============================================================
  // STEP 4: Tier 3 Conservative Token Typo Fallback
  // ============================================================
  const tokenMatches = candidates.filter((c) => {
    return (
      (targetLegalTokens.length > 0 &&
        isTokenMatchSafely(targetLegalTokens, c.tokens)) ||
      (targetDisplayTokens.length > 0 &&
        isTokenMatchSafely(targetDisplayTokens, c.tokens))
    );
  });

  // Candidate Isolation Rule: Fallback must produce strictly 1 candidate
  if (tokenMatches.length === 1) {
    return tokenMatches[0].code;
  }
  if (tokenMatches.length > 1) {
    return {
      status: AllotmentStatus.NEEDS_REVIEW,
      sourceCode: registrarCode,
      checkedAt,
      errorMessage: `Multiple similar candidates found in ${registrarName} live list. Manual review required.`,
    };
  }

  // ============================================================
  // STEP 4B: Tier 4 Single Candidate Isolation Prefix / Containment Match
  // ============================================================
  const containmentMatches = candidates.filter((c) => {
    const dKey = targetDisplayKey;
    const lKey = targetLegalKey;
    return (
      (dKey.length >= 4 && (c.cleanKey.startsWith(dKey) || dKey.startsWith(c.cleanKey))) ||
      (lKey.length >= 4 && (c.cleanKey.startsWith(lKey) || lKey.startsWith(c.cleanKey)))
    );
  });

  if (containmentMatches.length === 1) {
    return containmentMatches[0].code;
  }
  if (containmentMatches.length > 1) {
    return {
      status: AllotmentStatus.NEEDS_REVIEW,
      sourceCode: registrarCode,
      checkedAt,
      errorMessage: `Multiple similar candidates found by prefix in ${registrarName} live list. Manual review required.`,
    };
  }

  // ============================================================
  // STEP 5: Zero candidates found -> NOT_YET_AVAILABLE
  // ============================================================
  return {
    status: AllotmentStatus.NOT_YET_AVAILABLE,
    sourceCode: registrarCode,
    checkedAt,
    errorMessage: `IPO not found in ${registrarName} live active list`,
  };
}
