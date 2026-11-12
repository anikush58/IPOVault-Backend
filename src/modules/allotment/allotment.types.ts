/**
 * Business and technical status outcomes for allotment checks.
 * Technical errors and pending states are NEVER conflated with NOT_ALLOTTED.
 */
export enum AllotmentStatus {
  // Category 1: Business Results
  ALLOTTED = 'ALLOTTED',
  PARTIALLY_ALLOTTED = 'PARTIALLY_ALLOTTED',
  NOT_ALLOTTED = 'NOT_ALLOTTED',

  // Category 2: Informational Outcomes
  NOT_YET_AVAILABLE = 'NOT_YET_AVAILABLE',
  APPLICATION_NOT_FOUND = 'APPLICATION_NOT_FOUND',
  INVALID_IDENTIFIER = 'INVALID_IDENTIFIER',
  IPO_NOT_FOUND = 'IPO_NOT_FOUND',
  REGISTRAR_UNRESOLVED = 'REGISTRAR_UNRESOLVED',
  REGISTRAR_UNSUPPORTED = 'REGISTRAR_UNSUPPORTED',
  UNSUPPORTED_IDENTIFIER = 'UNSUPPORTED_IDENTIFIER',
  NEEDS_REVIEW = 'NEEDS_REVIEW',

  // Category 3: Technical & System Outcomes
  SOURCE_UNAVAILABLE = 'SOURCE_UNAVAILABLE',
  SOURCE_RESPONSE_INVALID = 'SOURCE_RESPONSE_INVALID',
  CAPTCHA_REQUIRED = 'CAPTCHA_REQUIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  CONFLICTING_RESULTS = 'CONFLICTING_RESULTS',
  TEMPORARY_ERROR = 'TEMPORARY_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Supported identification types for checking allotment status.
 */
export enum AllotmentIdentifierType {
  PAN = 'PAN',
  APPLICATION_NUMBER = 'APPLICATION_NUMBER',
  DP_CLIENT_ID = 'DP_CLIENT_ID',
}

/**
 * Bulk job execution lifecycle status.
 */
export enum AllotmentJobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_ERRORS = 'COMPLETED_WITH_ERRORS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Generic user-assisted challenge structure.
 */
export interface CaptchaChallenge {
  challengeType:
    'IMAGE_CAPTCHA' | 'AUDIO_CAPTCHA' | 'SLIDER' | 'THIRD_PARTY_TOKEN';
  challengeId: string;
  challengeData?: Record<string, unknown>;
  expiresAt?: Date;
}

/**
 * Incoming request parameters for checking allotment status.
 */
export interface CheckAllotmentRequest {
  ipoId: string;
  registrarIpoCode?: string;
  identifierType: AllotmentIdentifierType;
  identifierValue: string; // Plaintext identifier, kept in-memory only
  captchaToken?: string;
  sessionId?: string;
  companyName?: string;
  companyLegalName?: string;
  symbol?: string;
  category?: string;
  applicationNumber?: string;
  skipForceRefresh?: boolean;
  requireLiveActiveList?: boolean;
}

/**
 * Category-level allotment breakdown for an applicant.
 */
export interface CategoryAllotmentResult {
  category?: string;
  rawCategory?: string;
  status: AllotmentStatus;
  sharesApplied?: number;
  sharesAllotted: number;
  allotmentPrice?: number;
  amountApplied?: number;
  amountRefunded?: number;
  applicationNumber?: string;
}

/**
 * Normalized result structure returned by registrar adapters.
 */
export interface NormalizedAllotmentResult {
  status: AllotmentStatus;
  sharesApplied?: number;
  sharesAllotted?: number;
  allotmentPrice?: number;
  amountApplied?: number;
  amountRefunded?: number;
  applicantName?: string;
  sourceCode: string;
  sourceTimestamp?: Date;
  checkedAt: Date;
  rawResponseRef?: string;
  errorMessage?: string;
  captchaChallenge?: CaptchaChallenge;
  categoryResults?: CategoryAllotmentResult[];
}

/**
 * Common Registrar Adapter Interface.
 */
export interface IRegistrarAdapter {
  readonly code: string;
  readonly name: string;
  readonly defaultConcurrency: number;
  readonly supportedIdentifiers: Set<AllotmentIdentifierType>;
  supportsIdentifier(type: AllotmentIdentifierType): boolean;
  checkAllotment(
    request: CheckAllotmentRequest,
  ): Promise<NormalizedAllotmentResult>;
  resolveRegistrarIpoCode?(
    request: CheckAllotmentRequest,
  ): Promise<string | NormalizedAllotmentResult>;
}

/**
 * Per-registrar concurrency policy configuration.
 */
export interface RegistrarConcurrencyConfig {
  [registrarCode: string]: number;
}

const UUID_REGISTRAR_CODE_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLACEHOLDER_REGISTRAR_CODE_REGEX =
  /^(TBD|TO\s+BE\s+DECIDED|N\s*\/\s*A|NA|NONE|NIL|NULL|UNDEFINED|PENDING|UNKNOWN|NOT\s+APPLICABLE|NOT\s+AVAILABLE|-+|●|\[●\])$/i;

/**
 * Returns true when a raw registrar IPO code is a usable non-UUID, non-placeholder identifier.
 */
export function isValidRegistrarIpoCode(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !UUID_REGISTRAR_CODE_REGEX.test(trimmed) &&
    !PLACEHOLDER_REGISTRAR_CODE_REGEX.test(trimmed)
  );
}

/**
 * Returns a trimmed registrar IPO code when valid, or undefined for UUIDs and placeholders.
 */
export function sanitizeRegistrarIpoCode(value: unknown): string | undefined {
  return isValidRegistrarIpoCode(value) ? value.trim() : undefined;
}
