import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseAuthService } from '../auth/firebase-auth.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

describe('UserService', () => {
  let service: UserService;
  let prismaMock: any;
  let configMock: any;
  let firebaseAuthMock: any;
  let emailDeliveryServiceMock: any;

  beforeAll(() => {
    process.env.ALLOTMENT_ENCRYPTION_SECRET =
      'test_encryption_secret_key_32_bytes!';
    process.env.ALLOTMENT_HASH_SECRET = 'test_hash_secret_at_least_32_bytes_long!';
  });

  beforeEach(async () => {
    prismaMock = {
      $transaction: jest.fn(async (cb: any) => {
        return cb(prismaMock);
      }),
      userSavedPan: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      brokerAccount: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userPushToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notification: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notificationPreference: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userEntitlementAuditLog: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      userEntitlement: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      consumedDeletionToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'consumed-token-1' }),
        update: jest.fn().mockResolvedValue({ id: 'consumed-token-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    configMock = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        if (key === 'ALLOTMENT_HASH_SECRET' || key === 'ACCOUNT_DELETION_TOKEN_SECRET') {
          return 'test_hash_secret_at_least_32_bytes_long!';
        }
        return null;
      }),
    };

    firebaseAuthMock = {
      getUserByEmail: jest.fn(),
      deleteUser: jest.fn().mockResolvedValue(true),
    };

    emailDeliveryServiceMock = {
      sendAccountDeletionConfirmation: jest
        .fn()
        .mockResolvedValue({ id: 'mock-email-id-123' }),
      buildConfirmationUrl: jest.fn(
        (token: string) =>
          `https://getipovault.in/api/v1/user/confirm-deletion?token=${token}`,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: ConfigService,
          useValue: configMock,
        },
        {
          provide: FirebaseAuthService,
          useValue: firebaseAuthMock,
        },
        {
          provide: EmailDeliveryService,
          useValue: emailDeliveryServiceMock,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('syncPans', () => {
    it('should create new UserSavedPan if not existing', async () => {
      prismaMock.userSavedPan.findFirst.mockResolvedValue(null);
      prismaMock.userSavedPan.create.mockResolvedValue({
        id: 'pan-1',
        panMasked: 'ABCDE****F',
      });

      const res = await service.syncPans('user-1', {
        pans: [{ pan: 'ABCDE1234F', name: 'Test User' }],
      });

      expect(res.syncedCount).toBe(1);
      expect(res.pans[0].maskedPan).toBe('ABCDE****F');
      expect(prismaMock.userSavedPan.create).toHaveBeenCalled();
    });

    it('should update existing UserSavedPan if found', async () => {
      prismaMock.userSavedPan.findFirst.mockResolvedValue({
        id: 'existing-1',
        name: 'Old Name',
      });
      prismaMock.userSavedPan.update.mockResolvedValue({
        id: 'existing-1',
        panMasked: 'ABCDE****F',
      });

      const res = await service.syncPans('user-1', {
        pans: [{ pan: 'ABCDE1234F', name: 'Updated Name' }],
      });

      expect(res.syncedCount).toBe(1);
      expect(prismaMock.userSavedPan.update).toHaveBeenCalled();
    });
  });

  describe('deletePan (Data Minimization)', () => {
    it('should successfully delete a single PAN owned by authenticated user', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue({
        id: 'pan-123',
        userId: 'user-1',
      });
      prismaMock.userSavedPan.delete.mockResolvedValue({
        id: 'pan-123',
      });

      const res = await service.deletePan('user-1', 'pan-123');

      expect(res.success).toBe(true);
      expect(res.id).toBe('pan-123');
      expect(res.deleted).toBe(true);
      expect(prismaMock.userSavedPan.delete).toHaveBeenCalledWith({
        where: { id: 'pan-123' },
      });
    });

    it('should reject with 404 if User A attempts to delete User B PAN', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue({
        id: 'pan-user-b',
        userId: 'user-b',
      });

      await expect(
        service.deletePan('user-a', 'pan-user-b'),
      ).rejects.toThrow(AppException);

      expect(prismaMock.userSavedPan.delete).not.toHaveBeenCalled();
    });

    it('should reject with 404 if PAN record does not exist', async () => {
      prismaMock.userSavedPan.findUnique.mockResolvedValue(null);

      await expect(
        service.deletePan('user-a', 'non-existent'),
      ).rejects.toThrow(AppException);
    });
  });

  describe('deleteAllPans (Data Minimization)', () => {
    it('should delete all PANs strictly scoped to authenticated user', async () => {
      prismaMock.userSavedPan.deleteMany.mockResolvedValue({
        count: 5,
      });

      const res = await service.deleteAllPans('user-1');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(5);
      expect(prismaMock.userSavedPan.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('deleteUserAccount (Google Play Compliance - Transactional Full Wipe)', () => {
    it('should purge all user data across all tables atomically in a transaction', async () => {
      const res = await service.deleteUserAccount('user-target-123');

      expect(res.success).toBe(true);
      expect(res.deleted).toBe(true);
      expect(res.userId).toBe('user-target-123');

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.userSavedPan.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
      expect(prismaMock.brokerAccount.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
      expect(prismaMock.userPushToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
      expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
      expect(prismaMock.notificationPreference.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
      expect(prismaMock.userEntitlementAuditLog.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
        data: expect.objectContaining({
          reason: 'Account deleted',
          ipAddress: null,
          userId: expect.stringMatching(/^anon-[0-9a-f-]+$/),
        }),
      });
      expect(prismaMock.userEntitlement.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-target-123' },
      });
    });

    it('should assign distinct surrogate UUIDs to different deleted users (no shared constant identity)', async () => {
      await service.deleteUserAccount('user-first');
      const firstCallArg = prismaMock.userEntitlementAuditLog.updateMany.mock.calls[0][0].data.userId;

      await service.deleteUserAccount('user-second');
      const secondCallArg = prismaMock.userEntitlementAuditLog.updateMany.mock.calls[1][0].data.userId;

      expect(firstCallArg).not.toEqual(secondCallArg);
      expect(firstCallArg).toMatch(/^anon-/);
      expect(secondCallArg).toMatch(/^anon-/);
    });

    it('should reject with 401 if userId is empty or missing', async () => {
      await expect(service.deleteUserAccount('')).rejects.toThrow(AppException);
      await expect(service.deleteUserAccount('   ')).rejects.toThrow(AppException);
    });
  });

  describe('requestAccountDeletionByEmail (Public Web Deletion Intake)', () => {
    it('should return a generic success message even if email is unknown (no account enumeration)', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue(null);

      const res = await service.requestAccountDeletionByEmail('unknown@example.com');
      expect(res.success).toBe(true);
      expect(res.message).toContain('If an account associated with this email address exists');
    });

    it('should generate an HMAC token when user exists in test environment', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'user-exists-1',
        email: 'user@example.com',
      });

      const res = await service.requestAccountDeletionByEmail('user@example.com');
      expect(res.success).toBe(true);
      expect(res.confirmationToken).toBeDefined();
    });

    it('should reject invalid email format with 400', async () => {
      await expect(service.requestAccountDeletionByEmail('not-an-email')).rejects.toThrow(AppException);
    });

    it('should enforce rate limits on repeated requests for the same email address', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'user-spam-target',
        email: 'target@example.com',
      });

      // 3 requests allowed within window
      await service.requestAccountDeletionByEmail('target@example.com');
      await service.requestAccountDeletionByEmail('target@example.com');
      await service.requestAccountDeletionByEmail('target@example.com');

      // 4th request must be rejected with 429
      await expect(service.requestAccountDeletionByEmail('target@example.com')).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 429,
        }),
      );
    });

    it('should dispatch confirmation email via EmailDeliveryService with clean email, uid, and token', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'user-dispatch-1',
        email: 'dispatch@example.com',
      });

      const res = await service.requestAccountDeletionByEmail('Dispatch@Example.com');

      expect(res.success).toBe(true);
      expect(emailDeliveryServiceMock.sendAccountDeletionConfirmation).toHaveBeenCalledWith(
        'dispatch@example.com',
        'user-dispatch-1',
        res.confirmationToken,
      );
    });

    it('should fail closed with error and revert rate limit usage if email delivery fails', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'user-provider-fail',
        email: 'fail@example.com',
      });

      emailDeliveryServiceMock.sendAccountDeletionConfirmation.mockRejectedValueOnce(
        new AppException(ErrorCode.INTERNAL_ERROR, 'Resend rejected email', 500),
      );

      // Attempt 1 fails at email provider
      await expect(service.requestAccountDeletionByEmail('fail@example.com')).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 500,
        }),
      );

      // Since rate limit was reverted, user can make 3 fresh attempts without hitting 429 prematurely
      await service.requestAccountDeletionByEmail('fail@example.com');
      await service.requestAccountDeletionByEmail('fail@example.com');
      await service.requestAccountDeletionByEmail('fail@example.com');

      // 4th total successful attempt hits 429
      await expect(service.requestAccountDeletionByEmail('fail@example.com')).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 429,
        }),
      );
    });
  });

  describe('verifyDeletionToken (Non-Destructive Verification for GET / Link Scanners)', () => {
    it('should verify token without deleting user data or consuming the token', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'user-prefetch',
        email: 'prefetch@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('prefetch@example.com');
      const token = requestRes.confirmationToken!;

      // Simulates email prefetch bot scanning the link
      const verified = await service.verifyDeletionToken(token);
      expect(verified.uid).toBe('user-prefetch');
      expect(verified.email).toBe('prefetch@example.com');

      // Crucial: Deletion was NOT executed
      expect(prismaMock.userSavedPan.deleteMany).not.toHaveBeenCalled();
      expect(firebaseAuthMock.deleteUser).not.toHaveBeenCalled();

      // Crucial: Token can still be verified again or confirmed subsequently by real user
      const verifiedAgain = await service.verifyDeletionToken(token);
      expect(verifiedAgain.uid).toBe('user-prefetch');
    });

    it('should reject tampered token with 401', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-tamper',
        email: 'tamper@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('tamper@example.com');
      const [payload, sig] = requestRes.confirmationToken!.split('.');
      const tamperedToken = `${payload}.${sig}tampered`;

      await expect(service.verifyDeletionToken(tamperedToken)).rejects.toThrow(AppException);
    });

    it('should reject malformed token with 400', async () => {
      await expect(service.verifyDeletionToken('malformed-token')).rejects.toThrow(AppException);
    });
  });

  describe('confirmAccountDeletion (Explicit POST Confirmation & Replay Protection)', () => {
    it('should verify valid HMAC token and purge both database records and Firebase Auth user', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-to-delete',
        email: 'delete-me@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('delete-me@example.com');
      const token = requestRes.confirmationToken!;

      const confirmRes = await service.confirmAccountDeletion(token);
      expect(confirmRes.success).toBe(true);
      expect(confirmRes.email).toBe('delete-me@example.com');
      expect(firebaseAuthMock.deleteUser).toHaveBeenCalledWith('uid-to-delete');
      expect(prismaMock.userSavedPan.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'uid-to-delete' },
      });
      // Verifies token was stored in consumed_deletion_tokens as a hash with status PENDING, not raw token
      expect(prismaMock.consumedDeletionToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          jtiHash: expect.any(String),
          expiresAt: expect.any(Date),
          status: UserService.DELETION_STATUS.PENDING,
          userId: 'uid-to-delete',
        }),
      });
    });

    it('should reject replayed token after first successful confirmation (Single-Use Replay Protection)', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-replay',
        email: 'replay@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('replay@example.com');
      const token = requestRes.confirmationToken!;

      // First confirmation succeeds
      await service.confirmAccountDeletion(token);

      // Replay attempt with same token must fail with 401
      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used'),
        }),
      );
    });

    it('should reject replayed token across backend restarts via persistent database record', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-restart',
        email: 'restart@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('restart@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate database already having this token's jtiHash persisted from a prior instance
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValueOnce({
        id: 'persisted-jti-hash-1',
        jtiHash: 'hash-value',
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used'),
        }),
      );
    });

    it('should reject concurrent replay attempts via database unique constraint violation (P2002)', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-concurrent',
        email: 'concurrent@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('concurrent@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate concurrent transaction race: create throws unique constraint error P2002
      prismaMock.consumedDeletionToken.create.mockRejectedValueOnce({
        code: 'P2002',
        message: 'Unique constraint failed on the fields: (`jti_hash`)',
      });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used'),
        }),
      );
    });

    it('should trigger opportunistic cleanup of expired tokens during confirmation', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-cleanup',
        email: 'cleanup@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('cleanup@example.com');
      const token = requestRes.confirmationToken!;

      await service.confirmAccountDeletion(token);

      expect(prismaMock.consumedDeletionToken.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });

  describe('Failure Boundaries & Idempotent Recovery Verification', () => {
    it('should abort cleanly on database transaction failure without calling Firebase Auth', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-db-fail',
        email: 'db-fail@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('db-fail@example.com');
      const token = requestRes.confirmationToken!;

      prismaMock.$transaction.mockRejectedValueOnce(new Error('PostgreSQL connection terminated'));

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow('PostgreSQL connection terminated');
      expect(firebaseAuthMock.deleteUser).not.toHaveBeenCalled();
    });

    it('should not emit false success message when Firebase deletion fails and mark status as FAILED', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-fb-fail',
        email: 'fb-fail@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('fb-fail@example.com');
      const token = requestRes.confirmationToken!;

      // PostgreSQL transaction succeeds, but Firebase Auth deleteUser returns false
      firebaseAuthMock.deleteUser.mockResolvedValueOnce(false);

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 500,
          message: expect.stringContaining('Failed to complete authentication credential deletion'),
        }),
      );

      // Verifies job was updated to FAILED rather than COMPLETED
      expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserService.DELETION_STATUS.FAILED,
          }),
        }),
      );
    });

    it('should allow safe retry with the same token after Firebase failure without permanent rejection', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-retry',
        email: 'retry@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('retry@example.com');
      const token = requestRes.confirmationToken!;

      // 1. First attempt: Firebase fails
      firebaseAuthMock.deleteUser.mockResolvedValueOnce(false);
      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(AppException);

      // 2. Second attempt: User retries with the SAME token.
      // Mock findUnique to return the existing FAILED record
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'consumed-token-1',
        jtiHash: 'hash-retry',
        status: UserService.DELETION_STATUS.FAILED,
        attempts: 1,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
      });

      // Firebase now succeeds
      firebaseAuthMock.deleteUser.mockResolvedValueOnce(true);

      const retryRes = await service.confirmAccountDeletion(token);
      expect(retryRes.success).toBe(true);
      expect(retryRes.email).toBe('retry@example.com');

      // Verify persistent record transitioned to COMPLETED
      expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserService.DELETION_STATUS.COMPLETED,
          }),
        }),
      );
    });

    it('should allow retry after backend restart when prior attempt was FAILED', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-restart-recovery',
        email: 'restart-recovery@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('restart-recovery@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate a freshly booted backend node reading a FAILED deletion job from PostgreSQL
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'persisted-failed-job-1',
        jtiHash: 'some-hash',
        status: UserService.DELETION_STATUS.FAILED,
        attempts: 1,
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() + 60000),
      });

      firebaseAuthMock.deleteUser.mockResolvedValueOnce(true);

      const confirmRes = await service.confirmAccountDeletion(token);
      expect(confirmRes.success).toBe(true);
      expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'persisted-failed-job-1', status: { not: UserService.DELETION_STATUS.COMPLETED } },
          data: expect.objectContaining({
            status: UserService.DELETION_STATUS.COMPLETED,
          }),
        }),
      );
    });

    it('should reject replay with 401 and confirm completed deletion if client lost original response', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-lost-resp',
        email: 'lost-resp@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('lost-resp@example.com');
      const token = requestRes.confirmationToken!;

      // Deletion succeeded previously in DB and status is COMPLETED
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'completed-job-1',
        jtiHash: 'hash-lost-resp',
        status: UserService.DELETION_STATUS.COMPLETED,
        createdAt: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used to delete the account'),
        }),
      );
    });

    it('should reject concurrent confirmation with 409 Conflict when job is actively PENDING', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-race',
        email: 'race@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('race@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate another concurrent request actively running (status PENDING created 5 seconds ago)
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'active-pending-job',
        jtiHash: 'hash-race',
        status: UserService.DELETION_STATUS.PENDING,
        createdAt: new Date(Date.now() - 5000), // Fresh within 30s
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 409,
          message: expect.stringContaining('Account deletion is currently in progress'),
        }),
      );
    });

    it('should handle repeated deletion requests for an already-deleted account idempotently', async () => {
      // 1. Authenticated in-app deletion: running on an account with no database rows left
      const deleteRes = await service.deleteUserAccount('already-deleted-uid');
      expect(deleteRes.success).toBe(true);
      expect(deleteRes.deleted).toBe(true);

      // 2. Public deletion request by email: Firebase returns null (account already deleted)
      firebaseAuthMock.getUserByEmail.mockResolvedValueOnce(null);
      const publicRes = await service.requestAccountDeletionByEmail('already-deleted@example.com');
      expect(publicRes.success).toBe(true);
      expect(publicRes.message).toContain('If an account associated with this email address exists');
      // No token generated or returned
      expect((publicRes as any).confirmationToken).toBeUndefined();
    });

    it('should recover when a PENDING record is stale (>30s) after crash', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-stale-pending',
        email: 'stale-pending@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('stale-pending@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate a crashed server leaving a PENDING record created 45 seconds ago (> 30s)
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'stale-pending-record-1',
        jtiHash: 'hash-stale',
        status: UserService.DELETION_STATUS.PENDING,
        attempts: 1,
        createdAt: new Date(Date.now() - 45000),
        expiresAt: new Date(Date.now() + 60000),
      });

      firebaseAuthMock.deleteUser.mockResolvedValueOnce(true);

      const res = await service.confirmAccountDeletion(token);
      expect(res.success).toBe(true);

      // Verify attempts incremented
      expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'stale-pending-record-1' }),
          data: expect.objectContaining({
            attempts: { increment: 1 },
          }),
        }),
      );
    });

    it('should reject retry with 429 when max attempts (5) are reached', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-max-attempts',
        email: 'max-attempts@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('max-attempts@example.com');
      const token = requestRes.confirmationToken!;

      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'max-attempts-record',
        jtiHash: 'hash-max',
        status: UserService.DELETION_STATUS.FAILED,
        attempts: 5,
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 429,
          message: expect.stringContaining('Maximum deletion retry attempts exceeded'),
        }),
      );
    });

    it('should handle Firebase timeout gracefully with sanitized FIREBASE_AUTH_TIMEOUT error code', async () => {
      service.firebaseTimeoutMs = 50; // Use fast 50ms bounded timeout for unit test
      try {
        firebaseAuthMock.getUserByEmail.mockResolvedValue({
          uid: 'uid-fb-timeout',
          email: 'timeout@example.com',
        });

        const requestRes = await service.requestAccountDeletionByEmail('timeout@example.com');
        const token = requestRes.confirmationToken!;

        // Firebase hangs indefinitely (longer than 50ms)
        firebaseAuthMock.deleteUser.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(true), 5000)),
        );

        await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
          expect.objectContaining({
            httpStatus: 500,
            message: expect.stringContaining('Failed to complete authentication credential deletion'),
          }),
        );

        expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: UserService.DELETION_STATUS.FAILED,
              lastError: 'FIREBASE_AUTH_TIMEOUT',
            }),
          }),
        );
      } finally {
        service.firebaseTimeoutMs = 10_000;
      }
    });

    it('should treat auth/user-not-found as idempotent success during recovery', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-already-gone-fb',
        email: 'gone@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('gone@example.com');
      const token = requestRes.confirmationToken!;

      // Simulate Firebase throwing auth/user-not-found (e.g. backend crashed after Firebase deleted user on attempt 1)
      const userNotFoundError: any = new Error('User not found in Firebase Auth');
      userNotFoundError.code = 'auth/user-not-found';
      firebaseAuthMock.deleteUser.mockRejectedValueOnce(userNotFoundError);

      const res = await service.confirmAccountDeletion(token);
      expect(res.success).toBe(true);

      expect(prismaMock.consumedDeletionToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: UserService.DELETION_STATUS.COMPLETED,
            lastError: null,
          }),
        }),
      );
    });

    it('should differentiate expired token responses between unstarted, completed, and failed jobs', async () => {
      // 1. Token expired, never started in DB
      const expiredTokenUnstarted = (service as any).generateDeletionToken('unstarted-uid', 'unstarted@example.com', -10);
      await expect(service.confirmAccountDeletion(expiredTokenUnstarted)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('Confirmation token has expired. Please request a new deletion link.'),
        }),
      );

      // 2. Token expired, already COMPLETED in DB
      const expiredTokenCompleted = (service as any).generateDeletionToken('completed-uid', 'completed@example.com', -10);
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValueOnce({
        id: 'completed-expired-job',
        status: UserService.DELETION_STATUS.COMPLETED,
      });
      await expect(service.confirmAccountDeletion(expiredTokenCompleted)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used to delete the account'),
        }),
      );

      // 3. Token expired, was FAILED in DB (safe recovery guidance)
      const expiredTokenFailed = (service as any).generateDeletionToken('failed-uid', 'failed@example.com', -10);
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValueOnce({
        id: 'failed-expired-job',
        status: UserService.DELETION_STATUS.FAILED,
      });
      await expect(service.confirmAccountDeletion(expiredTokenFailed)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('This confirmation link has expired. Your account deletion was initiated'),
        }),
      );
    });

    it('should guarantee lastError stores sanitized codes and never leaks PII or tokens', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-pii-check',
        email: 'secret-email@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('secret-email@example.com');
      const token = requestRes.confirmationToken!;

      // Firebase throws error containing sensitive string
      firebaseAuthMock.deleteUser.mockRejectedValueOnce(
        new Error('Fatal error contacting auth backend for user secret-email@example.com with pan ABCDE1234F'),
      );

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(AppException);

      // Assert that the stored lastError is sanitized and does NOT contain email, PAN, or token
      const updateCall = prismaMock.consumedDeletionToken.updateMany.mock.calls.find(
        (call: any[]) => call[0].data?.status === UserService.DELETION_STATUS.FAILED,
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[0].data.lastError).toBe('FIREBASE_AUTH_ERROR');
      expect(updateCall[0].data.lastError).not.toContain('secret-email@example.com');
      expect(updateCall[0].data.lastError).not.toContain('ABCDE1234F');
      expect(updateCall[0].data.lastError).not.toContain(token);
    });

    it('should reconcile late Firebase success after timeout and transition record to COMPLETED', async () => {
      service.firebaseTimeoutMs = 30; // 30ms fast timeout
      try {
        firebaseAuthMock.getUserByEmail.mockResolvedValue({
          uid: 'uid-late-success',
          email: 'late-success@example.com',
        });

        const requestRes = await service.requestAccountDeletionByEmail('late-success@example.com');
        const token = requestRes.confirmationToken!;

        // Firebase takes 80ms to resolve (longer than 30ms timeout, but succeeds)
        firebaseAuthMock.deleteUser.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(true), 80)),
        );

        // Attempt 1: times out at 30ms and throws 500
        await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
          expect.objectContaining({
            httpStatus: 500,
            message: expect.stringContaining('Failed to complete authentication credential deletion'),
          }),
        );

        // Wait 100ms for background promise to finish resolving
        await new Promise((r) => setTimeout(r, 100));

        // Background reconciliation must have updated database to COMPLETED
        const completedCall = prismaMock.consumedDeletionToken.updateMany.mock.calls.find(
          (call: any[]) => call[0].data?.status === UserService.DELETION_STATUS.COMPLETED,
        );
        expect(completedCall).toBeDefined();
        expect(completedCall[0].data.lastError).toBeNull();
        expect(completedCall[0].data.completedAt).toBeInstanceOf(Date);

        // Verification of token now reflects COMPLETED (401 already deleted) rather than failure
        prismaMock.consumedDeletionToken.findUnique.mockResolvedValueOnce({
          id: 'consumed-token-1',
          status: UserService.DELETION_STATUS.COMPLETED,
        });

        await expect(service.verifyDeletionToken(token)).rejects.toThrow(
          expect.objectContaining({
            httpStatus: 401,
            message: expect.stringContaining('already been used to delete the account'),
          }),
        );
      } finally {
        service.firebaseTimeoutMs = 10_000;
      }
    });

    it('should deduplicate in-flight Firebase deletion when concurrent request occurs for same user', async () => {
      service.firebaseTimeoutMs = 200;
      try {
        firebaseAuthMock.getUserByEmail.mockResolvedValue({
          uid: 'uid-inflight-dedup',
          email: 'inflight@example.com',
        });

        const requestRes = await service.requestAccountDeletionByEmail('inflight@example.com');
        const token = requestRes.confirmationToken!;

        // Firebase takes 80ms
        firebaseAuthMock.deleteUser.mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(true), 80)),
        );

        // Request 1 starts
        const req1Promise = service.confirmAccountDeletion(token);

        // Give Request 1 10ms to register in-flight promise
        await new Promise((r) => setTimeout(r, 10));

        // Verify in-flight map has the promise
        expect((service as any).inFlightFirebaseDeletions.has('uid-inflight-dedup')).toBe(true);

        const res1 = await req1Promise;
        expect(res1.success).toBe(true);

        // Give background finally handler a tick to complete cleanup
        await new Promise((r) => setTimeout(r, 20));

        // Map is cleaned up after completion
        expect((service as any).inFlightFirebaseDeletions.has('uid-inflight-dedup')).toBe(false);
      } finally {
        service.firebaseTimeoutMs = 10_000;
      }
    });

    it('should reject with 409 Conflict if a stale PENDING deletion (>30s) is still in-flight on the same process', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-stale-but-active',
        email: 'stale-active@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('stale-active@example.com');
      const token = requestRes.confirmationToken!;

      // DB record is >30s old
      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'stale-record',
        jtiHash: 'hash-stale-active',
        status: UserService.DELETION_STATUS.PENDING,
        createdAt: new Date(Date.now() - 45000),
        updatedAt: new Date(Date.now() - 45000),
        attempts: 1,
        expiresAt: new Date(Date.now() + 60000),
      });

      // But operation is still actively in-flight in this process
      const activePromise = new Promise<boolean>(() => {});
      (service as any).inFlightFirebaseDeletions.set('uid-stale-but-active', activePromise);

      try {
        await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
          expect.objectContaining({
            httpStatus: 409,
            message: expect.stringContaining('Account deletion is currently in progress'),
          }),
        );
      } finally {
        (service as any).inFlightFirebaseDeletions.delete('uid-stale-but-active');
      }
    });

    it('should reject verifyDeletionToken with 429 when max retry attempts (5) are reached', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-verify-max',
        email: 'verify-max@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('verify-max@example.com');
      const token = requestRes.confirmationToken!;

      prismaMock.consumedDeletionToken.findUnique.mockResolvedValue({
        id: 'verify-max-record',
        jtiHash: 'hash-verify-max',
        status: UserService.DELETION_STATUS.FAILED,
        attempts: 5,
        createdAt: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() + 60000),
      });

      await expect(service.verifyDeletionToken(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 429,
          message: expect.stringContaining('Maximum deletion retry attempts exceeded'),
        }),
      );
    });

    it('should reject with 409 Conflict if another backend instance wins the atomic retry claim race (updated.count === 0)', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-multi-instance-race',
        email: 'multi-instance-race@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('multi-instance-race@example.com');
      const token = requestRes.confirmationToken!;

      // Initial read: job is FAILED
      prismaMock.consumedDeletionToken.findUnique
        .mockResolvedValueOnce({
          id: 'multi-instance-job',
          jtiHash: 'hash-multi-instance-race',
          status: UserService.DELETION_STATUS.FAILED,
          attempts: 1,
          createdAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce({
          // Fresh read after updateMany returns count: 0 (another instance claimed it and set PENDING)
          id: 'multi-instance-job',
          jtiHash: 'hash-multi-instance-race',
          status: UserService.DELETION_STATUS.PENDING,
          attempts: 2,
        });

      // Another instance won the updateMany race in DB
      prismaMock.consumedDeletionToken.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 409,
          message: expect.stringContaining('Account deletion is currently in progress'),
        }),
      );

      // Firebase deleteUser is never called by the losing instance
      expect(firebaseAuthMock.deleteUser).not.toHaveBeenCalled();
    });

    it('should reject with 401 if another backend instance already completed the deletion during the retry race', async () => {
      firebaseAuthMock.getUserByEmail.mockResolvedValue({
        uid: 'uid-multi-instance-complete',
        email: 'multi-instance-complete@example.com',
      });

      const requestRes = await service.requestAccountDeletionByEmail('multi-instance-complete@example.com');
      const token = requestRes.confirmationToken!;

      // Initial read: job was FAILED
      prismaMock.consumedDeletionToken.findUnique
        .mockResolvedValueOnce({
          id: 'multi-instance-complete-job',
          jtiHash: 'hash-multi-instance-complete',
          status: UserService.DELETION_STATUS.FAILED,
          attempts: 1,
          createdAt: new Date(Date.now() - 10000),
          expiresAt: new Date(Date.now() + 60000),
        })
        .mockResolvedValueOnce({
          // Fresh read after updateMany returns count: 0: other instance already finished COMPLETED
          id: 'multi-instance-complete-job',
          status: UserService.DELETION_STATUS.COMPLETED,
        });

      // Another instance won the updateMany race in DB
      prismaMock.consumedDeletionToken.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.confirmAccountDeletion(token)).rejects.toThrow(
        expect.objectContaining({
          httpStatus: 401,
          message: expect.stringContaining('already been used to delete the account'),
        }),
      );

      // Firebase deleteUser is never called by the losing instance
      expect(firebaseAuthMock.deleteUser).not.toHaveBeenCalled();
    });
  });

  describe('Signing Secret Hardening & Production Fail-Closed Behavior', () => {
    it('should fail closed with 500 in production when secret is missing or under 32 characters', () => {
      configMock.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return null; // Missing secret in production
      });

      expect(() => service.getDeletionTokenSecret()).toThrow(
        expect.objectContaining({
          httpStatus: 500,
          message: expect.stringContaining('must be configured with at least 32 characters in production'),
        }),
      );
    });
  });
});

