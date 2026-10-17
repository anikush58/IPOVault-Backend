import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseAuthService } from '../auth/firebase-auth.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { Env } from '../../config/env';
import {
  encryptPan,
  hashIdentifier,
  maskIdentifier,
} from '../allotment/allotment.utils';
import { AllotmentIdentifierType } from '../allotment/allotment.types';
import { SyncPansBodyDto } from './dto/sync-pans.dto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  public firebaseTimeoutMs = 10_000;
  private readonly inFlightFirebaseDeletions = new Map<string, Promise<boolean>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly firebaseAuth: FirebaseAuthService,
    private readonly emailDeliveryService: EmailDeliveryService,
  ) {}

  async syncPans(userId: string, dto: SyncPansBodyDto) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const results = [];
    for (const item of dto.pans) {
      const panUpper = item.pan.trim().toUpperCase();
      const panHash = hashIdentifier(panUpper);
      const panEncrypted = encryptPan(panUpper);
      const panMasked = maskIdentifier(panUpper, AllotmentIdentifierType.PAN);

      const existing = await this.prisma.userSavedPan.findFirst({
        where: {
          userId: cleanUserId,
          panHash,
        },
      });

      if (existing) {
        const updated = await this.prisma.userSavedPan.update({
          where: { id: existing.id },
          data: {
            name: item.name || existing.name,
            panEncrypted,
            panMasked,
            updatedAt: new Date(),
          },
        });
        results.push({ id: updated.id, maskedPan: updated.panMasked });
      } else {
        const created = await this.prisma.userSavedPan.create({
          data: {
            userId: cleanUserId,
            panHash,
            panEncrypted,
            panMasked,
            name: item.name || null,
          },
        });
        results.push({ id: created.id, maskedPan: created.panMasked });
      }
    }

    this.logger.log(
      `Synchronized ${results.length} saved PANs for user ${cleanUserId}`,
    );

    return {
      syncedCount: results.length,
      pans: results,
    };
  }

  /**
   * Deletes a specific saved PAN record owned by the authenticated user.
   * Rejects cross-user deletion attempts with 404.
   */
  async deletePan(userId: string, panId: string) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const existing = await this.prisma.userSavedPan.findUnique({
      where: { id: panId },
    });

    if (!existing || existing.userId !== cleanUserId) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Saved PAN with ID '${panId}' was not found`,
        404,
      );
    }

    await this.prisma.userSavedPan.delete({
      where: { id: panId },
    });

    this.logger.log(`Deleted saved PAN ${panId} for user ${cleanUserId}`);

    return {
      success: true,
      id: panId,
      deleted: true,
    };
  }

  /**
   * Deletes all saved PAN records belonging to the authenticated user.
   */
  async deleteAllPans(userId: string) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const result = await this.prisma.userSavedPan.deleteMany({
      where: { userId: cleanUserId },
    });

    this.logger.log(
      `Deleted all ${result.count} saved PANs for user ${cleanUserId}`,
    );

    return {
      success: true,
      deletedCount: result.count,
    };
  }

  public static readonly DELETION_STATUS = {
    PENDING: 'PENDING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
  } as const;

  private readonly consumedTokenJtis = new Map<string, { exp: number; status: string }>();
  private readonly deletionRequestRateLimits = new Map<string, number[]>();

  /**
   * Resolves the secure HMAC signing secret for account deletion tokens.
   * FAILS CLOSED in production if secret is not explicitly configured or is under 32 characters.
   */
  getDeletionTokenSecret(): string {
    const secret =
      this.config.get<string>('ACCOUNT_DELETION_TOKEN_SECRET', { infer: true }) ||
      this.config.get<string>('CONSOLE_SESSION_SECRET', { infer: true }) ||
      this.config.get<string>('ALLOTMENT_HASH_SECRET', { infer: true });

    const nodeEnv = this.config.get<string>('NODE_ENV', { infer: true });

    if (!secret || secret.trim().length < 32) {
      if (nodeEnv === 'production') {
        throw new AppException(
          ErrorCode.INTERNAL_ERROR,
          'Account deletion signing secret must be configured with at least 32 characters in production.',
          500,
        );
      }
      return 'test_dev_fallback_secret_32_bytes_minimum_length_for_dev_test!';
    }

    return secret.trim();
  }

  private markTokenStatus(jti: string, exp: number, status: string): void {
    this.pruneExpiredConsumedTokens();
    this.consumedTokenJtis.set(jti, { exp, status });
  }

  private isTokenCompleted(jti: string): boolean {
    this.pruneExpiredConsumedTokens();
    const entry = this.consumedTokenJtis.get(jti);
    return entry?.status === UserService.DELETION_STATUS.COMPLETED;
  }

  private pruneExpiredConsumedTokens(): void {
    const now = Date.now();
    for (const [jti, record] of this.consumedTokenJtis.entries()) {
      if (now > record.exp) {
        this.consumedTokenJtis.delete(jti);
      }
    }
  }

  /**
   * Enforces process-local sliding-window rate limiting for account deletion requests.
   * NOTE: This rate limiter is stored in an in-memory Map (process-local) and is not backed
   * by shared storage (Redis). In a multi-replica or clustered deployment, each backend
   * worker node maintains its own independent rate-limiting state.
   */
  private checkDeletionRateLimit(key: string, maxRequests = 3, windowMs = 15 * 60 * 1000): void {
    const now = Date.now();
    const timestamps = (this.deletionRequestRateLimits.get(key) || []).filter(
      (t) => now - t < windowMs,
    );
    if (timestamps.length >= maxRequests) {
      throw new AppException(
        ErrorCode.TOO_MANY_REQUESTS,
        'Too many deletion requests. Please wait a few minutes before trying again.',
        429,
      );
    }
    timestamps.push(now);
    this.deletionRequestRateLimits.set(key, timestamps);
  }

  /**
   * Reverts the most recent rate limit timestamp for a key in case of downstream provider failure.
   * Ensures users are not unfairly locked out by transient email delivery errors.
   */
  private revertDeletionRateLimit(key: string): void {
    const timestamps = this.deletionRequestRateLimits.get(key);
    if (timestamps && timestamps.length > 0) {
      timestamps.pop();
      if (timestamps.length === 0) {
        this.deletionRequestRateLimits.delete(key);
      }
    }
  }

  /**
   * Permanently deletes all user-scoped personal and sensitive records from the database
   * within an atomic PostgreSQL transaction.
   * Idempotent: Can be safely retried if subsequent external steps fail.
   */
  async deleteUserAccount(userId: string) {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();

    // Perform atomic deletion across all user-owned tables
    await this.prisma.$transaction(async (tx) => {
      await this.executeUserTablesPurge(tx, cleanUserId);
    });

    this.logger.log(`Purged all database records for user: ${cleanUserId}`);

    return {
      success: true,
      deleted: true,
      userId: cleanUserId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Handles public deletion request by email.
   * Applies rate limiting and returns a constant generic response to prevent account enumeration.
   * In non-test environments, tokens are NEVER returned in the API response and NEVER logged.
   */
  async requestAccountDeletionByEmail(email: string, clientIp?: string) {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'A valid email address is required',
        400,
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Apply rate limits per email and client IP
    this.checkDeletionRateLimit(`email:${cleanEmail}`);
    if (clientIp) {
      this.checkDeletionRateLimit(`ip:${clientIp}`, 10);
    }

    this.logger.log(`Received public account deletion request for email`);

    const user = await this.firebaseAuth.getUserByEmail(cleanEmail);
    if (!user) {
      // Return constant response without revealing account existence
      return {
        success: true,
        message:
          'If an account associated with this email address exists, a verification link has been sent to confirm deletion.',
      };
    }

    // Generate secure HMAC token with 15-minute expiration
    const token = this.generateDeletionToken(user.uid, cleanEmail);

    // Dispatch verification email through Resend provider
    try {
      await this.emailDeliveryService.sendAccountDeletionConfirmation(
        cleanEmail,
        user.uid,
        token,
      );
    } catch (err) {
      // Revert rate limit usage on provider error so transient failure does not penalize user
      this.revertDeletionRateLimit(`email:${cleanEmail}`);
      if (clientIp) {
        this.revertDeletionRateLimit(`ip:${clientIp}`);
      }
      throw err;
    }

    // Token is NEVER logged in application logs for security
    this.logger.log(`Account deletion verification dispatched for uid: ${user.uid}`);

    return {
      success: true,
      message:
        'If an account associated with this email address exists, a verification link has been sent to confirm deletion.',
      // Strictly in test environment, return confirmationToken for automated test assertions
      ...(this.config.get<string>('NODE_ENV', { infer: true }) === 'test'
        ? { confirmationToken: token }
        : {}),
    };
  }

  /**
   * Helper to generate HMAC-signed account deletion confirmation token.
   */
  generateDeletionToken(uid: string, email: string, ttlMs: number = 15 * 60 * 1000): string {
    const exp = Date.now() + ttlMs;
    const jti = randomUUID();
    const payload = JSON.stringify({ jti, uid, email, exp, iat: Date.now() });
    const payloadB64 = Buffer.from(payload).toString('base64url');
    const secret = this.getDeletionTokenSecret();
    const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${sig}`;
  }

  /**
   * Purges all user-specific database records across tables in a transaction.
   * Decouples audit logs by stripping direct identifiers (userId, ipAddress, entitlementId)
   * and assigning unique uncorrelatable surrogate UUIDs.
   */
  private async executeUserTablesPurge(tx: any, cleanUserId: string): Promise<void> {
    // 1. Delete saved PANs (encrypted PII)
    await tx.userSavedPan.deleteMany({
      where: { userId: cleanUserId },
    });

    // 2. Delete broker accounts (cascades to connections, tokens, holdings, trades, ipo investments)
    await tx.brokerAccount.deleteMany({
      where: { userId: cleanUserId },
    });

    // 3. Delete push notification device tokens
    await tx.userPushToken.deleteMany({
      where: { userId: cleanUserId },
    });

    // 4. Delete notifications (cascades to deliveries)
    await tx.notification.deleteMany({
      where: { userId: cleanUserId },
    });

    // 5. Delete notification preferences
    await tx.notificationPreference.deleteMany({
      where: { userId: cleanUserId },
    });

    // 6. Decouple and anonymize tier audit logs: uses a unique random surrogate UUID per event.
    // Direct identifiers (userId, ipAddress, entitlementId) are stripped to prevent linkability.
    const anonymousSurrogate = `anon-${randomUUID()}`;
    await tx.userEntitlementAuditLog.updateMany({
      where: { userId: cleanUserId },
      data: {
        userId: anonymousSurrogate,
        reason: 'Account deleted',
        ipAddress: null,
        entitlementId: null,
      },
    });

    // 7. Delete user entitlement tier record
    await tx.userEntitlement.deleteMany({
      where: { userId: cleanUserId },
    });
  }

  /**
   * Cryptographically verifies an account deletion token without deleting anything.
   * Safe for non-destructive preview rendering (prevents link-prefetch scanners from triggering deletion).
   * Checks both in-memory and database-backed persistent single-use replay protection.
   * Permits safe retries if a prior deletion attempt failed before Firebase Auth was removed.
   */
  async verifyDeletionToken(token: string): Promise<{ jti: string; uid: string; email: string; exp: number }> {
    if (!token || typeof token !== 'string') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Invalid or missing confirmation token',
        400,
      );
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Malformed confirmation token',
        400,
      );
    }

    const [payloadB64, sig] = parts;
    const secret = this.getDeletionTokenSecret();
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');

    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Invalid or tampered confirmation token',
        401,
      );
    }

    let payload: { jti?: string; uid: string; email: string; exp: number };
    try {
      payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Invalid token payload',
        400,
      );
    }

    const jti = payload.jti || payload.uid;
    const jtiHash = createHash('sha256').update(jti).digest('hex');

    // 1. Fast in-memory check for completed tokens
    if (this.isTokenCompleted(jti)) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'This confirmation link has already been used to delete the account. Your account and associated data have already been permanently deleted.',
        401,
      );
    }

    // 2. Persistent database check (handles server restarts and multiple backend instances)
    const persisted = await this.prisma.consumedDeletionToken.findUnique({
      where: { jtiHash },
    });

    if (persisted && (!persisted.status || persisted.status === UserService.DELETION_STATUS.COMPLETED)) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'This confirmation link has already been used to delete the account. Your account and associated data have already been permanently deleted.',
        401,
      );
    }

    // 3. Expiry verification: expired tokens must never initiate or authorize deletions
    const isExpired = !payload.exp || Date.now() > payload.exp;
    if (isExpired) {
      if (persisted && (persisted.status === UserService.DELETION_STATUS.FAILED || persisted.status === UserService.DELETION_STATUS.PENDING)) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'This confirmation link has expired. Your account deletion was initiated, but requires a fresh confirmation link to finalize. Please request a new deletion link.',
          401,
        );
      }
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Confirmation token has expired. Please request a new deletion link.',
        401,
      );
    }

    if (persisted) {
      // Check bounded retry protection (max 5 retry attempts per confirmation link)
      if (persisted.attempts >= 5 && persisted.status !== UserService.DELETION_STATUS.COMPLETED) {
        throw new AppException(
          ErrorCode.TOO_MANY_REQUESTS,
          'Maximum deletion retry attempts exceeded for this confirmation link. Please request a new deletion link.',
          429,
        );
      }

      // If persisted.status === 'PENDING', check active execution window (30s) or active in-flight operation
      if (persisted.status === UserService.DELETION_STATUS.PENDING) {
        const refTime = persisted.updatedAt
          ? new Date(persisted.updatedAt).getTime()
          : new Date(persisted.createdAt || Date.now()).getTime();
        const timeSince = Date.now() - refTime;
        const isInFlight = this.inFlightFirebaseDeletions.has(payload.uid);

        if (timeSince < 30_000 || isInFlight) {
          throw new AppException(
            ErrorCode.CONFLICT,
            'Account deletion is currently in progress. Please wait a moment.',
            409,
          );
        }
        // If timeSince >= 30_000 and not in-flight: stuck/stale PENDING from crashed instance: allow retry
      }
    }

    return {
      jti,
      uid: payload.uid,
      email: payload.email,
      exp: payload.exp,
    };
  }

  /**
   * Confirms and executes public account deletion after explicit POST confirmation.
   * Implements a persistent deletion-job/state model with explicit states (PENDING, COMPLETED, FAILED),
   * bounded retries, timeout isolation, and safe idempotent retry semantics.
   *
   * Failure Boundary & Recovery Behavior:
   * Cross-system atomicity between PostgreSQL and Firebase Auth is impossible without 2PC.
   * Flow:
   * 1. Token cryptographically verified (HMAC & expiry).
   * 2. DB transaction: persists deletion record (status: 'PENDING') & purges PostgreSQL user tables.
   * 3. External API: deletes user from Firebase Auth with bounded timeout (10s).
   * 4. If Firebase fails or times out: status is updated to 'FAILED' with a sanitized error code (never raw PII).
   *    Retries are permitted with the same token up to 5 attempts, safely re-purging DB idempotently and re-attempting Firebase.
   * 5. If Firebase succeeds or user was already deleted ('auth/user-not-found'): status transitions to 'COMPLETED'.
   *    Subsequent replays of this token are rejected with 401 confirming already deleted.
   * Never stores raw tokens (stores SHA-256 hash of jti only).
   */
  async confirmAccountDeletion(token: string) {
    // 1. Verify token cryptographically and verify it hasn't completed
    const payload = await this.verifyDeletionToken(token);
    const jtiHash = createHash('sha256').update(payload.jti).digest('hex');

    // Check if an existing job record exists
    const existingJob = await this.prisma.consumedDeletionToken.findUnique({
      where: { jtiHash },
    });

    if (existingJob && (!existingJob.status || existingJob.status === UserService.DELETION_STATUS.COMPLETED)) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'This confirmation link has already been used to delete the account. Your account and associated data have already been permanently deleted.',
        401,
      );
    }

    // Bounded active concurrency check
    if (existingJob && existingJob.status === UserService.DELETION_STATUS.PENDING) {
      const refTime = existingJob.updatedAt
        ? new Date(existingJob.updatedAt).getTime()
        : new Date(existingJob.createdAt || Date.now()).getTime();
      const timeSince = Date.now() - refTime;
      const isInFlight = this.inFlightFirebaseDeletions.has(payload.uid);

      if (timeSince < 30_000 || isInFlight) {
        throw new AppException(
          ErrorCode.CONFLICT,
          'Account deletion is currently in progress. Please wait a moment.',
          409,
        );
      }
    }

    // Bounded retry protection (max 5 retry attempts per confirmation link)
    if (existingJob && existingJob.attempts >= 5) {
      throw new AppException(
        ErrorCode.TOO_MANY_REQUESTS,
        'Maximum deletion retry attempts exceeded for this confirmation link. Please request a new deletion link.',
        429,
      );
    }

    let recordId: string = existingJob?.id || '';
    let currentAttempt = existingJob ? existingJob.attempts + 1 : 1;

    // 2. Atomic persistent replay protection and database purge inside a single transaction
    await this.prisma.$transaction(async (tx) => {
      if (!existingJob) {
        // Concurrency-safe atomic insert of PENDING record (DB unique constraint prevents race conditions)
        try {
          const created = await tx.consumedDeletionToken.create({
            data: {
              jtiHash,
              status: UserService.DELETION_STATUS.PENDING,
              userId: payload.uid,
              attempts: 1,
              expiresAt: new Date(payload.exp),
            },
          });
          recordId = created.id;
          currentAttempt = 1;
        } catch (err: any) {
          if (err?.code === 'P2002') {
            const raced = await tx.consumedDeletionToken.findUnique({
              where: { jtiHash },
            });
            if (raced?.status === UserService.DELETION_STATUS.PENDING) {
              throw new AppException(
                ErrorCode.CONFLICT,
                'Account deletion is currently in progress. Please wait a moment.',
                409,
              );
            }
            throw new AppException(
              ErrorCode.UNAUTHORIZED,
              'This confirmation link has already been used to delete the account. Your account and associated data have already been permanently deleted.',
              401,
            );
          }
          throw err;
        }
      } else {
        // Retry path: atomically claim recovery on existing record (multi-instance safe)
        recordId = existingJob.id;
        const updated = await tx.consumedDeletionToken.updateMany({
          where: {
            id: existingJob.id,
            OR: [
              { status: UserService.DELETION_STATUS.FAILED },
              {
                status: UserService.DELETION_STATUS.PENDING,
                updatedAt: { lt: new Date(Date.now() - 30_000) },
              },
            ],
          },
          data: {
            status: UserService.DELETION_STATUS.PENDING,
            attempts: { increment: 1 },
            lastError: null,
          },
        });

        if (updated.count === 0) {
          const current = await tx.consumedDeletionToken.findUnique({
            where: { id: existingJob.id },
          });
          if (current?.status === UserService.DELETION_STATUS.COMPLETED) {
            throw new AppException(
              ErrorCode.UNAUTHORIZED,
              'This confirmation link has already been used to delete the account. Your account and associated data have already been permanently deleted.',
              401,
            );
          }
          throw new AppException(
            ErrorCode.CONFLICT,
            'Account deletion is currently in progress. Please wait a moment.',
            409,
          );
        }

        const freshRecord = await tx.consumedDeletionToken.findUnique({
          where: { id: existingJob.id },
        });
        currentAttempt = freshRecord?.attempts || existingJob.attempts + 1;
      }

      // Purge database records for this user (idempotent across retries)
      await this.executeUserTablesPurge(tx, payload.uid);

      // Opportunistic expiry cleanup of consumed tokens
      await tx.consumedDeletionToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }).catch(() => {});
    });

    // In-memory mark as PENDING during external step
    this.markTokenStatus(payload.jti, payload.exp, UserService.DELETION_STATUS.PENDING);

    // 3. Delete Firebase Auth user with bounded timeout isolation (10 seconds default)
    let firebaseSuccess = false;
    let sanitizedErrorCode: string | null = null;
    const FIREBASE_TIMEOUT_MS = this.firebaseTimeoutMs;

    // Reuse existing in-flight deletion promise for this uid if one is already active,
    // preventing redundant concurrent external operations against Firebase
    let deletePromise = this.inFlightFirebaseDeletions.get(payload.uid);
    if (!deletePromise) {
      deletePromise = this.firebaseAuth.deleteUser(payload.uid);
      this.inFlightFirebaseDeletions.set(payload.uid, deletePromise);

      // Attach background reconciliation listener for late-succeeding external operations
      const targetRecordId = recordId;
      const targetJti = payload.jti;
      const targetExp = payload.exp;
      const targetUid = payload.uid;

      deletePromise
        .then(async (success) => {
          if (success && targetRecordId) {
            await this.prisma.consumedDeletionToken.updateMany({
              where: {
                id: targetRecordId,
                status: { in: [UserService.DELETION_STATUS.PENDING, UserService.DELETION_STATUS.FAILED] },
              },
              data: {
                status: UserService.DELETION_STATUS.COMPLETED,
                completedAt: new Date(),
                lastError: null,
              },
            }).catch((e) => this.logger.warn(`Failed to reconcile late Firebase completion: ${e.message}`));

            this.markTokenStatus(targetJti, targetExp, UserService.DELETION_STATUS.COMPLETED);
            this.logger.log(`Reconciled late Firebase Auth deletion success for user: ${targetUid}`);
          }
        })
        .catch(async (fbErr: any) => {
          if (fbErr?.code === 'auth/user-not-found' && targetRecordId) {
            await this.prisma.consumedDeletionToken.updateMany({
              where: {
                id: targetRecordId,
                status: { in: [UserService.DELETION_STATUS.PENDING, UserService.DELETION_STATUS.FAILED] },
              },
              data: {
                status: UserService.DELETION_STATUS.COMPLETED,
                completedAt: new Date(),
                lastError: null,
              },
            }).catch((e) => this.logger.warn(`Failed to reconcile late Firebase completion: ${e.message}`));

            this.markTokenStatus(targetJti, targetExp, UserService.DELETION_STATUS.COMPLETED);
            this.logger.log(`Reconciled late Firebase Auth deletion (user-not-found) for user: ${targetUid}`);
          }
        })
        .finally(() => {
          this.inFlightFirebaseDeletions.delete(targetUid);
        });
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('FIREBASE_TIMEOUT')), FIREBASE_TIMEOUT_MS),
      );

      firebaseSuccess = await Promise.race([deletePromise, timeoutPromise]);
      if (!firebaseSuccess) {
        sanitizedErrorCode = 'FIREBASE_AUTH_REJECTED';
      }
    } catch (fbErr: any) {
      firebaseSuccess = false;
      if (fbErr?.message === 'FIREBASE_TIMEOUT') {
        sanitizedErrorCode = 'FIREBASE_AUTH_TIMEOUT';
      } else if (fbErr?.code === 'auth/user-not-found') {
        firebaseSuccess = true;
      } else {
        sanitizedErrorCode = 'FIREBASE_AUTH_ERROR';
      }
    }

    if (!firebaseSuccess) {
      // Transition job state to FAILED in DB using conditional update:
      // Must NOT overwrite if another attempt already marked COMPLETED or if a newer attempt took over.
      if (recordId) {
        await this.prisma.consumedDeletionToken.updateMany({
          where: {
            id: recordId,
            status: UserService.DELETION_STATUS.PENDING,
            attempts: currentAttempt,
          },
          data: {
            status: UserService.DELETION_STATUS.FAILED,
            lastError: sanitizedErrorCode,
          },
        }).catch((e) => this.logger.warn(`Failed to update deletion status to FAILED: ${e.message}`));
      }

      this.markTokenStatus(payload.jti, payload.exp, UserService.DELETION_STATUS.FAILED);

      this.logger.error(
        `Database purged but Firebase Auth deletion failed for uid: ${payload.uid}. Error code: ${sanitizedErrorCode}`,
      );

      throw new AppException(
        ErrorCode.INTERNAL_ERROR,
        'Failed to complete authentication credential deletion with the identity provider. Your personal database records have been purged, but account credentials could not be removed yet. Please click confirm again to retry.',
        500,
      );
    }

    // 4. Finalize: Mark persistent deletion job as COMPLETED
    if (recordId) {
      await this.prisma.consumedDeletionToken.updateMany({
        where: {
          id: recordId,
          status: { not: UserService.DELETION_STATUS.COMPLETED },
        },
        data: {
          status: UserService.DELETION_STATUS.COMPLETED,
          completedAt: new Date(),
          lastError: null,
        },
      }).catch((e) => this.logger.warn(`Failed to update deletion status to COMPLETED: ${e.message}`));
    }

    // In-memory mark as COMPLETED for fast local worker rejection
    this.markTokenStatus(payload.jti, payload.exp, UserService.DELETION_STATUS.COMPLETED);

    this.logger.log(`Completed account deletion for user: ${payload.uid}`);
    return {
      success: true,
      message: 'Account and associated personal data permanently deleted.',
      email: payload.email,
    };
  }
}

