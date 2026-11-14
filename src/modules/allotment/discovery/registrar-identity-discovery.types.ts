/**
 * Represents an issue entry discovered from an official registrar portal.
 */
export interface DiscoveredRegistrarIssue {
  externalId: string;
  externalName: string;
  registrarCode: string;
  discoveredAt: Date;
  isStale?: boolean;
  rawPayload?: Record<string, unknown>;
}

/**
 * Result status for a single source identity synchronization attempt.
 */
export enum SourceIdentitySyncStatus {
  NO_CHANGE = 'NO_CHANGE',
  DISCOVERED = 'DISCOVERED',
  EXTERNAL_ID_CHANGED = 'EXTERNAL_ID_CHANGED',
  UNRESOLVED = 'UNRESOLVED',
  SKIPPED = 'SKIPPED',
}

/**
 * Audit result of synchronizing a single discovered registrar issue.
 */
export interface SourceIdentitySyncRecordResult {
  status: SourceIdentitySyncStatus;
  registrarCode: string;
  externalId: string;
  externalName: string;
  ipoId?: string;
  companyName?: string;
  previousExternalId?: string;
  newExternalId?: string;
  reason?: string;
}

/**
 * Summary of a full registrar source identity synchronization run.
 */
export interface RegistrarSourceIdentitySyncSummary {
  registrarCode: string;
  totalDiscovered: number;
  noChangeCount: number;
  discoveredCount: number;
  changedCount: number;
  unresolvedCount: number;
  skippedCount?: number;
  isStale?: boolean;
  syncRecords: SourceIdentitySyncRecordResult[];
  executedAt: Date;
}

/**
 * Generic interface that all registrar discovery adapters must implement.
 */
export interface IRegistrarIdentityDiscoveryAdapter {
  readonly registrarCode: string;
  readonly name: string;

  /**
   * Fetches and returns all active issues exposed by the official registrar source.
   */
  discoverIssues(): Promise<DiscoveredRegistrarIssue[]>;
}
