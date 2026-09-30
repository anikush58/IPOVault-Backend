import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

export interface OAuthStateRecord {
  userId: string;
  brokerAccountId: string;
  expiresAt: number;
}

const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class BrokerOAuthStateService {
  private readonly stateStore = new Map<string, OAuthStateRecord>();

  /**
   * Generates a cryptographically random state token, binds it to userId and brokerAccountId,
   * stores it server-side with a short TTL, and returns the token string.
   */
  generateState(
    userId: string,
    brokerAccountId: string,
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

    const stateToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + ttlMs;

    this.stateStore.set(stateToken, {
      userId: userId.trim(),
      brokerAccountId: brokerAccountId.trim(),
      expiresAt,
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
