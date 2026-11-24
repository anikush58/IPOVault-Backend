import {
  AllotmentStatus,
  CheckAllotmentRequest,
  NormalizedAllotmentResult,
  sanitizeRegistrarIpoCode,
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
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export const LEGAL_ISSUE_NOISE_TOKENS = new Set<string>([
  'limited',
  'ltd',
  'private',
  'pvt',
  'ipo',
  'sme',
  'mainboard',
  'equity',
  'shares',
  'rights',
  'issue',
  'fpo',
  'reit',
  'invit',
  'buyback',
]);

/**
 * Repeatedly strips trailing offering and corporate suffixes from a raw company name.
 * Strips both trailing and bracketed/parenthesized noise (e.g. '(IPO)', '[SME]', '- Equity Shares').
 * Note: Does NOT strip "India" as per strict domain matching requirements.
 */
export function stripOfferingAndCorporateSuffixes(name: string): string {
  let clean = name.toLowerCase().trim();

  // Normalize conjunctions & symbols so "&" and "and" match seamlessly across data sources
  clean = clean.replace(/&/g, ' and ').replace(/['’]/g, '');

  let changed = true;
  while (changed) {
    const prev = clean;
    clean = clean
      // Strip trailing bracketed/parenthesized offering & corporate terms
      .replace(
        /[\s\-_,.]*[\(\[\{]\s*(ipo|sme\s+ipo|sme|mainboard|equity(\s+shares)?|rights(\s+issue)?|buyback|fpo|reit|invit|issue)\s*[\)\]\}]$/i,
        '',
      )
      .replace(
        /[\s\-_,.]*[\(\[\{]\s*(private\s+limited|pvt\s*\.?\s*ltd\.?|limited|ltd\.?)\s*[\)\]\}]$/i,
        '',
      )
      // Strip trailing non-bracketed offering & corporate terms
      .replace(
        /[\s\-_,.]+(ipo|sme\s+ipo|sme|mainboard|equity(\s+shares)?|rights(\s+issue)?|buyback|fpo|reit|invit|issue)$/i,
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
 * Extracts meaningful individual lowercase tokens from a company name after stripping suffixes
 * and filtering out corporate/offering noise tokens while strictly preserving identifiers like 'india'.
 */
export function extractMeaningfulTokens(name: string): string[] {
  const stripped = stripOfferingAndCorporateSuffixes(name);
  const rawTokens = stripped.split(/[^a-z0-9]+/i);
  return rawTokens
    .map((tok) => tok.toLowerCase().trim())
    .filter((tok) => tok.length > 0 && !LEGAL_ISSUE_NOISE_TOKENS.has(tok));
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
 * Evaluates whether a target company name and candidate company name match under
 * Tier 4 containment rules with strict token overlap/alignment protection.
 *
 * Requirements:
 * 1. Both clean keys must have length >= 4.
 * 2. Prefix relationship on clean keys: candidateKey.startsWith(targetKey) || targetKey.startsWith(candidateKey).
 * 3. Both must have meaningful tokens.
 * 4. Lead tokens must align (exact match or near-match).
 * 5. Reject false matches where a company name with extra distinguishing words is matched
 *    against a shorter candidate via startsWith alone (e.g. 'Atlanta Electricals' vs 'Atlanta').
 *    Every token in both sequences must align pairwise.
 */
export function isContainmentMatchSafely(
  targetTokens: string[],
  targetKey: string,
  candidateTokens: string[],
  candidateKey: string,
): boolean {
  if (
    !targetKey ||
    !candidateKey ||
    targetKey.length < 4 ||
    candidateKey.length < 4 ||
    !targetTokens ||
    !candidateTokens ||
    targetTokens.length === 0 ||
    candidateTokens.length === 0
  ) {
    return false;
  }

  // Must have a prefix/containment relationship between clean keys
  const hasPrefixRelation =
    candidateKey.startsWith(targetKey) || targetKey.startsWith(candidateKey);
  if (!hasPrefixRelation) {
    return false;
  }

  // Lead token alignment guard
  const leadTarget = targetTokens[0];
  const leadCandidate = candidateTokens[0];
  const leadAligns =
    leadTarget === leadCandidate ||
    (leadTarget.length >= 4 &&
      leadCandidate.length >= 4 &&
      (leadTarget.startsWith(leadCandidate) ||
        leadCandidate.startsWith(leadTarget))) ||
    (leadTarget.length >= 5 &&
      leadCandidate.length >= 5 &&
      levenshteinDistance(leadTarget, leadCandidate) <= 1);

  if (!leadAligns) {
    return false;
  }

  // Token count alignment:
  // If one side has extra distinguishing tokens (e.g. ['atlanta', 'electricals'] vs ['atlanta']),
  // reject to prevent false matches between distinct corporate entities.
  if (targetTokens.length !== candidateTokens.length) {
    const isTruncation =
      candidateKey.length >= 20 &&
      targetKey.startsWith(candidateKey) &&
      candidateTokens.every((cTok, i) => {
        if (i < candidateTokens.length - 1) {
          return cTok === targetTokens[i];
        }
        return targetTokens[i]?.startsWith(cTok) && cTok.length >= 4;
      });

    if (!isTruncation) {
      return false;
    }
  } else {
    // Both sides have the same token count: verify pairwise token alignment
    for (let i = 0; i < targetTokens.length; i++) {
      const t = targetTokens[i];
      const c = candidateTokens[i];
      if (t === c) continue;

      const pairwiseAligns =
        (t.length >= 4 &&
          c.length >= 4 &&
          (t.startsWith(c) || c.startsWith(t))) ||
        (t.length >= 5 && c.length >= 5 && levenshteinDistance(t, c) <= 1);

      if (!pairwiseAligns) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Normalizes raw discovery items into structured CleanCompanyCandidate objects.
 */
export function parseCompanyCandidates(
  items: unknown[],
): CleanCompanyCandidate[] {
  const candidates: CleanCompanyCandidate[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    let code = String(
      rec.company_slug ||
        rec.slug ||
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
  // STEP 0: Pre-configured Registrar IPO Code Match (Absolute Highest Priority)
  // If the IPO already has a non-UUID registrarIpoCode configured, and that
  // exact code exists in the registrar's live candidate list, accept it immediately.
  // ============================================================
  const cleanReqCode = sanitizeRegistrarIpoCode(request.registrarIpoCode);
  if (cleanReqCode) {
    const rawReqCode = cleanReqCode.toLowerCase();
    const codeMatch = candidates.find(
      (c) => c.code.toLowerCase() === rawReqCode,
    );
    if (codeMatch) {
      return codeMatch.code;
    }
  }

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

    // If candidates lack explicit symbol metadata and no company names were provided,
    // evaluate single candidate isolation by matching symbol against candidate lead token or cleanKey
    if (
      targetLegalKey.length === 0 &&
      targetDisplayKey.length === 0 &&
      targetSymbol.length >= 3
    ) {
      const symLower = targetSymbol.toLowerCase();
      const symbolInNameMatches = candidates.filter(
        (c) =>
          c.cleanKey === symLower ||
          (c.tokens.length > 0 && c.tokens[0] === symLower) ||
          c.cleanKey.startsWith(symLower),
      );

      if (symbolInNameMatches.length === 1) {
        return symbolInNameMatches[0].code;
      }
      if (symbolInNameMatches.length > 1) {
        return {
          status: AllotmentStatus.NEEDS_REVIEW,
          sourceCode: registrarCode,
          checkedAt,
          errorMessage: `Multiple ambiguous matches found by symbol prefix '${targetSymbol}' in ${registrarName} live list`,
        };
      }
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
    const uniqueCodes = new Set(exactMatches.map((c) => c.code));
    if (uniqueCodes.size === 1) {
      return exactMatches[0].code;
    }
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
    return (
      (targetDisplayTokens.length > 0 &&
        isContainmentMatchSafely(
          targetDisplayTokens,
          targetDisplayKey,
          c.tokens,
          c.cleanKey,
        )) ||
      (targetLegalTokens.length > 0 &&
        isContainmentMatchSafely(
          targetLegalTokens,
          targetLegalKey,
          c.tokens,
          c.cleanKey,
        ))
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

/**
 * Resolves all valid registrar client IDs/codes for a company.
 * Handles single-code and multi-tranche IPOs (multiple client IDs for the same company).
 */
export function matchAllRegistrarCompanyCodes(
  items: unknown[],
  request: CheckAllotmentRequest,
  registrarCode: string,
  registrarName: string,
  checkedAt: Date = new Date(),
): string[] | NormalizedAllotmentResult {
  const candidates = parseCompanyCandidates(items);

  const targetSymbol = request.symbol?.trim().toUpperCase();
  const targetLegalName = request.companyLegalName || '';
  const targetDisplayName = request.companyName || '';

  const targetLegalKey = normalizeName(targetLegalName);
  const targetDisplayKey = normalizeName(targetDisplayName);

  // STEP 0: Pre-configured Registrar IPO Code Match
  const cleanReqCode = sanitizeRegistrarIpoCode(request.registrarIpoCode);
  if (cleanReqCode) {
    const rawReqCode = cleanReqCode.toLowerCase();
    const codeMatch = candidates.find(
      (c) => c.code.toLowerCase() === rawReqCode,
    );
    if (codeMatch) {
      return [codeMatch.code];
    }
  }

  // STEP 1: Exact Symbol Match
  if (targetSymbol) {
    const symbolMatches = candidates.filter(
      (c) => c.symbol && c.symbol === targetSymbol,
    );
    if (symbolMatches.length > 0) {
      const uniqueKeys = new Set(symbolMatches.map((c) => c.cleanKey));
      if (uniqueKeys.size === 1) {
        return Array.from(new Set(symbolMatches.map((c) => c.code)));
      }
      return {
        status: AllotmentStatus.NEEDS_REVIEW,
        sourceCode: registrarCode,
        checkedAt,
        errorMessage: `Multiple ambiguous matches found by symbol '${targetSymbol}' in ${registrarName} live list`,
      };
    }
  }

  // STEP 2: Tier 1 Strict Exact Normalized Name Match
  const exactMatches = candidates.filter((c) => {
    return (
      (targetLegalKey.length > 0 && c.cleanKey === targetLegalKey) ||
      (targetDisplayKey.length > 0 && c.cleanKey === targetDisplayKey)
    );
  });

  if (exactMatches.length > 0) {
    const uniqueKeys = new Set(exactMatches.map((c) => c.cleanKey));
    if (uniqueKeys.size === 1) {
      return Array.from(new Set(exactMatches.map((c) => c.code)));
    }
    return {
      status: AllotmentStatus.NEEDS_REVIEW,
      sourceCode: registrarCode,
      checkedAt,
      errorMessage: `Multiple ambiguous matches found by company name in ${registrarName} live list`,
    };
  }

  // STEP 3: Tier 2 Canonical Spelling Alias Match
  const aliasLegalKey = applyRegistrarSpellingAliases(targetLegalKey);
  const aliasDisplayKey = applyRegistrarSpellingAliases(targetDisplayKey);

  if (aliasLegalKey || aliasDisplayKey) {
    const aliasMatches = candidates.filter((c) => {
      return (
        (aliasLegalKey.length > 0 && c.aliasKey === aliasLegalKey) ||
        (aliasDisplayKey.length > 0 && c.aliasKey === aliasDisplayKey)
      );
    });

    if (aliasMatches.length > 0) {
      const uniqueKeys = new Set(aliasMatches.map((c) => c.aliasKey));
      if (uniqueKeys.size === 1) {
        return Array.from(new Set(aliasMatches.map((c) => c.code)));
      }
      return {
        status: AllotmentStatus.NEEDS_REVIEW,
        sourceCode: registrarCode,
        checkedAt,
        errorMessage: `Multiple ambiguous alias matches found in ${registrarName} live list`,
      };
    }
  }

  // Fallback to single matchRegistrarCompany for token/containment logic
  const single = matchRegistrarCompany(
    items,
    request,
    registrarCode,
    registrarName,
    checkedAt,
  );
  if (typeof single === 'string') {
    return [single];
  }
  return single;
}
