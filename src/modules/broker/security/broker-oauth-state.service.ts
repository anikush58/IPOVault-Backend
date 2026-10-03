import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface OAuthStateRecord {
  userId: string;
  brokerAccountId: string;
  expiresAt: number;
  clientRedirectUri?: string;
}

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Validates whether a client redirect URI belongs to an allowlisted scheme (Expo Go or custom native scheme).
 * Rejects arbitrary external domains, javascript/data schemes, and CRLF injection attempts.
 */
export function isValidClientRedirectUri(uri?: string | null): boolean {
  if (!uri || typeof uri !== 'string') return false;
  const trimmed = uri.trim();
  if (!trimmed || trimmed.length > 512) return false;
  // Reject CRLF or control characters to prevent HTTP response / header injection
  if (/[\r\n\0\t]/.test(trimmed)) return false;

  // Allow native app scheme (e.g., ipovault://broker-callback)
  if (trimmed.startsWith('ipovault://')) return true;

  // Allow Expo Go development schemes (e.g., exp://192.168.1.5:8081/--/broker-callback)
  if (trimmed.startsWith('exp://') || trimmed.startsWith('exps://')) return true;

  return false;
}

@Injectable()
export class BrokerOAuthStateService {
  private readonly stateStore = new Map<string, OAuthStateRecord>();

  /**
   * Generates a cryptographically random state token, binds it to userId, brokerAccountId,
   * and optional validated clientRedirectUri, stores it server-side with a short TTL, and returns the token string.
   */
  generateState(
    userId: string,
    brokerAccountId: string,
    clientRedirectUriOrTtl?: string | number,
    ttlMs: number = DEFAULT_STATE_TTL_MS,
  ): string {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException(
        'User ID is required for OAuth state generation',
      );
    }
    if (
      !brokerAccountId ||
      typeof brokerAccountId !== 'string' ||
      !brokerAccountId.trim()
    ) {
      throw new BadRequestException(
        'Broker Account ID is required for OAuth state generation',
      );
    }

    this.cleanExpired();

    let clientRedirectUri: string | undefined;
    let effectiveTtl = ttlMs;

    if (typeof clientRedirectUriOrTtl === 'number') {
      effectiveTtl = clientRedirectUriOrTtl;
    } else if (
      typeof clientRedirectUriOrTtl === 'string' &&
      isValidClientRedirectUri(clientRedirectUriOrTtl)
    ) {
      clientRedirectUri = clientRedirectUriOrTtl.trim();
    }

    const stateToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + effectiveTtl;

    this.stateStore.set(stateToken, {
      userId: userId.trim(),
      brokerAccountId: brokerAccountId.trim(),
      expiresAt,
      ...(clientRedirectUri ? { clientRedirectUri } : {}),
    });

    return stateToken;
  }

  /**
   * Validates and consumes the state token (single-use).
   * Verifies that the state exists and has not expired.
   * If expectedUserId and/or expectedBrokerAccountId are provided, validates that they match.
   * In-flight state is invalidated immediately upon retrieval.
   * Returns the bound OAuthStateRecord.
   */
  validateAndConsumeState(
    stateToken: string | undefined | null,
    expectedUserId?: string,
    expectedBrokerAccountId?: string,
  ): OAuthStateRecord {
    if (!stateToken || typeof stateToken !== 'string' || !stateToken.trim()) {
      throw new BadRequestException('OAuth state parameter is required');
    }

    const token = stateToken.trim();
    const record = this.stateStore.get(token);

    // Enforce single-use: Invalidate immediately regardless of subsequent validation results
    if (record) {
      this.stateStore.delete(token);
    }

    if (!record) {
      throw new BadRequestException('Invalid or already used OAuth state');
    }

    if (Date.now() > record.expiresAt) {
      throw new BadRequestException('OAuth state has expired');
    }

    if (
      expectedUserId &&
      record.userId !== expectedUserId.trim()
    ) {
      throw new BadRequestException(
        'OAuth state mismatch for user or broker account',
      );
    }

    if (
      expectedBrokerAccountId &&
      record.brokerAccountId !== expectedBrokerAccountId.trim()
    ) {
      throw new BadRequestException(
        'OAuth state mismatch for user or broker account',
      );
    }

    return record;
  }

  /**
   * Purges expired entries from the in-memory map.
   */
  private cleanExpired(): void {
    const now = Date.now();
    for (const [token, record] of this.stateStore.entries()) {
      if (now > record.expiresAt) {
        this.stateStore.delete(token);
      }
    }
  }

  /**
   * Clear all records (useful for test isolation).
   */
  clear(): void {
    this.stateStore.clear();
  }
}
