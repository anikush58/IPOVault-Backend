import { Test, TestingModule } from '@nestjs/testing';
import { UserEntitlementService } from './user-entitlement.service';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseAuthService } from '../auth/firebase-auth.service';
import { UserAccessTier } from '@prisma/client';

describe('UserEntitlementService', () => {
  let service: UserEntitlementService;
  let prismaMock: any;
  let firebaseAuthMock: any;

  beforeEach(async () => {
    prismaMock = {
      userEntitlement: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      userEntitlementAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      userSavedPan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      brokerAccount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      notificationPreference: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb(prismaMock);
      }),
    };

    firebaseAuthMock = {
      getUser: jest.fn(),
      listUsers: jest.fn(),
      setCustomUserClaims: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserEntitlementService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: FirebaseAuthService, useValue: firebaseAuthMock },
      ],
    }).compile();

    service = module.get<UserEntitlementService>(UserEntitlementService);
  });

  describe('getEntitlement', () => {
    it('should return default NON_PRO tier when user has no explicit entitlement record', async () => {
      prismaMock.userEntitlement.findUnique.mockResolvedValue(null);

      const result = await service.getEntitlement('user-123');

      expect(result).toEqual({
        userId: 'user-123',
        tier: 'NON_PRO',
        isPro: false,
        grantedAt: null,
        revokedAt: null,
        updatedAt: expect.any(Date),
      });
      expect(prismaMock.userEntitlement.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
    });

    it('should return PRO tier when user has active PRO record', async () => {
      const grantedAt = new Date('2026-01-01');
      const updatedAt = new Date('2026-01-02');
      prismaMock.userEntitlement.findUnique.mockResolvedValue({
        userId: 'user-pro',
        tier: UserAccessTier.PRO,
        grantedAt,
        grantedBy: 'admin-super',
        revokedAt: null,
        notes: 'VIP customer',
        updatedAt,
      });

      const result = await service.getEntitlement('user-pro');

      expect(result).toEqual({
        userId: 'user-pro',
        tier: 'PRO',
        isPro: true,
        grantedAt,
        revokedAt: null,
        updatedAt,
      });
      // Ensure notes or internal fields are not leaked in the minimal entitlement payload
      expect((result as any).notes).toBeUndefined();
    });

    it('should return NON_PRO when user record has tier NON_PRO and was previously revoked', async () => {
      const revokedAt = new Date('2026-03-01');
      const updatedAt = new Date('2026-03-02');
      prismaMock.userEntitlement.findUnique.mockResolvedValue({
        userId: 'user-revoked',
        tier: UserAccessTier.NON_PRO,
        grantedAt: new Date('2026-01-01'),
        grantedBy: 'admin-1',
        revokedAt,
        updatedAt,
      });

      const result = await service.getEntitlement('user-revoked');

      expect(result).toEqual({
        userId: 'user-revoked',
        tier: 'NON_PRO',
        isPro: false,
        grantedAt: expect.any(Date),
        revokedAt,
        updatedAt,
      });
    });
  });

  describe('updateUserEntitlement', () => {
    it('should grant PRO access, update claims, and record an audit log transactionally', async () => {
      firebaseAuthMock.getUser.mockResolvedValue({
        uid: 'user-target',
        email: 'investor@example.com',
        displayName: 'Investor One',
      });
      prismaMock.userEntitlement.findUnique.mockResolvedValue(null); // Previous tier is default NON_PRO

      const updatedRecord = {
        userId: 'user-target',
        tier: UserAccessTier.PRO,
        grantedAt: new Date(),
        grantedBy: 'admin-console',
        revokedAt: null,
        notes: null,
        updatedAt: new Date(),
      };
      prismaMock.userEntitlement.upsert.mockResolvedValue(updatedRecord);
      prismaMock.userEntitlementAuditLog.create.mockResolvedValue({ id: 'audit-1' });

      const result = await service.updateUserEntitlement(
        'user-target',
        'PRO',
        'admin-console',
        'Upgraded subscription',
        '127.0.0.1'
      );

      expect(result.success).toBe(true);
      expect(result.previousTier).toBe('NON_PRO');
      expect(result.newTier).toBe('PRO');

      expect(prismaMock.userEntitlement.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-target' },
          create: expect.objectContaining({
            userId: 'user-target',
            tier: UserAccessTier.PRO,
            grantedBy: 'admin-console',
          }),
        })
      );

      expect(prismaMock.userEntitlementAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-target',
          previousTier: UserAccessTier.NON_PRO,
          newTier: UserAccessTier.PRO,
          changedBy: 'admin-console',
          reason: 'Upgraded subscription',
          ipAddress: '127.0.0.1',
        }),
      });

      expect(firebaseAuthMock.setCustomUserClaims).toHaveBeenCalledWith('user-target', {
        pro: true,
        updatedAt: expect.any(Number),
      });
    });

    it('should revoke PRO access safely to NON_PRO without destroying user records', async () => {
      firebaseAuthMock.getUser.mockResolvedValue({
        uid: 'user-target',
        email: 'investor@example.com',
      });
      prismaMock.userEntitlement.findUnique.mockResolvedValue({
        userId: 'user-target',
        tier: UserAccessTier.PRO,
        grantedAt: new Date('2026-01-01'),
        grantedBy: 'admin-console',
        revokedAt: null,
        updatedAt: new Date('2026-01-01'),
      });

      const updatedRecord = {
        userId: 'user-target',
        tier: UserAccessTier.NON_PRO,
        grantedAt: new Date('2026-01-01'),
        grantedBy: 'admin-console',
        revokedAt: new Date(),
        notes: null,
        updatedAt: new Date(),
      };
      prismaMock.userEntitlement.upsert.mockResolvedValue(updatedRecord);
      prismaMock.userEntitlementAuditLog.create.mockResolvedValue({ id: 'audit-2' });

      const result = await service.updateUserEntitlement(
        'user-target',
        'NON_PRO',
        'admin-operator',
        'Refund requested',
        '192.168.1.1'
      );

      expect(result.success).toBe(true);
      expect(result.previousTier).toBe('PRO');
      expect(result.newTier).toBe('NON_PRO');

      expect(prismaMock.userEntitlementAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-target',
          previousTier: UserAccessTier.PRO,
          newTier: UserAccessTier.NON_PRO,
          changedBy: 'admin-operator',
          reason: 'Refund requested',
        }),
      });

      expect(firebaseAuthMock.setCustomUserClaims).toHaveBeenCalledWith('user-target', {
        pro: false,
        updatedAt: expect.any(Number),
      });
    });

    it('should throw error if target user ID is invalid', async () => {
      await expect(
        service.updateUserEntitlement('', 'PRO', 'admin')
      ).rejects.toThrow();
    });
  });

  describe('listUsers', () => {
    it('should list paginated users, join entitlement status, and never leak sensitive fields', async () => {
      firebaseAuthMock.listUsers.mockResolvedValue({
        users: [
          {
            uid: 'u1',
            email: 'u1@test.com',
            displayName: 'User One',
            creationTime: '2026-01-01T00:00:00Z',
            lastSignInTime: '2026-02-01T00:00:00Z',
            passwordHash: 'SECRET_HASH',
            tokensValidAfterTime: '12345',
          },
          {
            uid: 'u2',
            email: 'u2@test.com',
            displayName: 'User Two',
            creationTime: '2026-01-02T00:00:00Z',
            lastSignInTime: null,
          },
        ],
      });

      prismaMock.userEntitlement.findMany.mockResolvedValue([
        {
          userId: 'u1',
          tier: UserAccessTier.PRO,
          grantedAt: new Date('2026-01-10'),
          grantedBy: 'admin',
          revokedAt: null,
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const result = await service.listUsers({ page: 1, limit: 10, tier: 'ALL' });

      expect(result.users).toHaveLength(2);
      expect(result.counts.pro).toBe(1);
      expect(result.counts.nonPro).toBe(1);

      // Verify u1 is PRO and u2 defaults to NON_PRO
      const u1 = result.users.find((u) => u.uid === 'u1')!;
      const u2 = result.users.find((u) => u.uid === 'u2')!;
      expect(u1.tier).toBe('PRO');
      expect(u1.isPro).toBe(true);
      expect(u2.tier).toBe('NON_PRO');
      expect(u2.isPro).toBe(false);

      // Verify strict sensitive data containment
      expect((u1 as any).passwordHash).toBeUndefined();
      expect((u1 as any).tokensValidAfterTime).toBeUndefined();
      expect((u1 as any).password).toBeUndefined();
      expect((u1 as any).pan).toBeUndefined();
    });

    it('should filter correctly when tier is PRO', async () => {
      firebaseAuthMock.listUsers.mockResolvedValue({
        users: [
          { uid: 'u1', email: 'u1@test.com', creationTime: '2026-01-01' },
          { uid: 'u2', email: 'u2@test.com', creationTime: '2026-01-02' },
        ],
      });

      prismaMock.userEntitlement.findMany.mockResolvedValue([
        { userId: 'u1', tier: UserAccessTier.PRO, createdAt: new Date('2026-01-01') },
      ]);

      const result = await service.listUsers({ page: 1, limit: 10, tier: 'PRO' });

      expect(result.users).toHaveLength(1);
      expect(result.users[0].uid).toBe('u1');
      expect(result.users[0].tier).toBe('PRO');
    });

    it('should never create fake users or infer registrations from entitlement records alone', async () => {
      // Firebase has only 1 registered user
      firebaseAuthMock.listUsers.mockResolvedValue({
        users: [{ uid: 'real-user', email: 'real@ipovault.in', creationTime: '2026-01-01' }],
      });

      // PostgreSQL has entitlement records for real-user and an orphaned/deleted user
      prismaMock.userEntitlement.findMany.mockResolvedValue([
        { userId: 'real-user', tier: UserAccessTier.PRO, createdAt: new Date('2026-01-01') },
        { userId: 'orphaned-legacy-user', tier: UserAccessTier.PRO, createdAt: new Date('2025-01-01') },
      ]);

      const result = await service.listUsers({ page: 1, limit: 10, tier: 'ALL' });

      // Must strictly list only the 1 registered Firebase user
      expect(result.users).toHaveLength(1);
      expect(result.users[0].uid).toBe('real-user');
      expect(result.total).toBe(1);
      expect(result.counts.total).toBe(1);
      expect(result.counts.pro).toBe(1);
      expect(result.counts.nonPro).toBe(0);
      // Ensure no synthetic fake email was generated
      expect(result.users.some((u) => u.uid === 'orphaned-legacy-user')).toBe(false);
      expect(result.users.some((u) => u.email?.includes('registered.ipovault.in'))).toBe(false);
    });

    it('should support pagination beyond 1,000 users when listAllUsers is available', async () => {
      // Simulate 1,050 registered Firebase users
      const mock1050Users = Array.from({ length: 1050 }, (_, i) => ({
        uid: `fb-user-${i + 1}`,
        email: `user${i + 1}@example.com`,
        displayName: `User ${i + 1}`,
        creationTime: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      }));

      firebaseAuthMock.listAllUsers = jest.fn().mockResolvedValue(mock1050Users);
      prismaMock.userEntitlement.findMany.mockResolvedValue([
        { userId: 'fb-user-1', tier: UserAccessTier.PRO, createdAt: new Date() },
        { userId: 'fb-user-2', tier: UserAccessTier.PRO, createdAt: new Date() },
      ]);

      const page1 = await service.listUsers({ page: 1, limit: 20, tier: 'ALL' });
      expect(page1.total).toBe(1050);
      expect(page1.totalPages).toBe(53);
      expect(page1.counts.total).toBe(1050);
      expect(page1.counts.pro).toBe(2);
      expect(page1.counts.nonPro).toBe(1048);
      expect(page1.users).toHaveLength(20);

      const page2 = await service.listUsers({ page: 2, limit: 20, tier: 'ALL' });
      expect(page2.users).toHaveLength(20);
      expect(page2.page).toBe(2);
    });

    it('should search users by email, displayName, and UID', async () => {
      firebaseAuthMock.listUsers.mockResolvedValue({
        users: [
          { uid: 'alpha-uid-99', email: 'alice@investor.com', displayName: 'Alice Wonder' },
          { uid: 'beta-uid-88', email: 'bob@trader.com', displayName: 'Bob Builder' },
          { uid: 'gamma-uid-77', email: 'charlie@gmail.com', displayName: 'Charlie Brown' },
        ],
      });
      prismaMock.userEntitlement.findMany.mockResolvedValue([]);

      // Search by partial email
      const resByEmail = await service.listUsers({ page: 1, limit: 10, q: 'investor.com', tier: 'ALL' });
      expect(resByEmail.users).toHaveLength(1);
      expect(resByEmail.users[0].uid).toBe('alpha-uid-99');

      // Search by partial displayName
      const resByName = await service.listUsers({ page: 1, limit: 10, q: 'Builder', tier: 'ALL' });
      expect(resByName.users).toHaveLength(1);
      expect(resByName.users[0].uid).toBe('beta-uid-88');

      // Search by partial UID
      const resByUid = await service.listUsers({ page: 1, limit: 10, q: 'gamma-uid', tier: 'ALL' });
      expect(resByUid.users).toHaveLength(1);
      expect(resByUid.users[0].uid).toBe('gamma-uid-77');
    });

    it('should filter by NON_PRO tier and maintain accurate global counts', async () => {
      firebaseAuthMock.listUsers.mockResolvedValue({
        users: [
          { uid: 'u1', email: 'u1@test.com' },
          { uid: 'u2', email: 'u2@test.com' },
          { uid: 'u3', email: 'u3@test.com' },
        ],
      });
      prismaMock.userEntitlement.findMany.mockResolvedValue([
        { userId: 'u1', tier: UserAccessTier.PRO },
      ]);

      const res = await service.listUsers({ page: 1, limit: 10, tier: 'NON_PRO' });
      expect(res.users).toHaveLength(2);
      expect(res.users.map((u) => u.uid)).toEqual(expect.arrayContaining(['u2', 'u3']));
      // Global counts must reflect unfiltered numbers
      expect(res.counts.total).toBe(3);
      expect(res.counts.pro).toBe(1);
      expect(res.counts.nonPro).toBe(2);
    });
  });

  describe('getUserDetail', () => {
    it('should return user details and reverse-chronological audit log history', async () => {
      firebaseAuthMock.getUser.mockResolvedValue({
        uid: 'u-audit',
        email: 'audit@test.com',
        displayName: 'Audit User',
        creationTime: '2026-01-01',
      });

      prismaMock.userEntitlement.findUnique.mockResolvedValue({
        userId: 'u-audit',
        tier: UserAccessTier.PRO,
        grantedAt: new Date('2026-01-10'),
        grantedBy: 'admin',
        revokedAt: null,
        notes: 'Important account',
        createdAt: new Date('2026-01-01'),
      });

      prismaMock.userEntitlementAuditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          previousTier: UserAccessTier.NON_PRO,
          newTier: UserAccessTier.PRO,
          changedBy: 'admin',
          reason: 'Initial setup',
          createdAt: new Date('2026-01-10'),
          ipAddress: '10.0.0.1',
        },
      ]);

      const detail = await service.getUserDetail('u-audit');

      expect(detail.uid).toBe('u-audit');
      expect(detail.tier).toBe('PRO');
      expect(detail.notes).toBe('Important account');
      expect(detail.auditLogs).toHaveLength(1);
      expect(detail.auditLogs[0].reason).toBe('Initial setup');
    });

    it('should return null for email and displayName if not in Firebase without fabricating fake emails', async () => {
      firebaseAuthMock.getUser.mockResolvedValue({
        uid: 'u-no-email',
        email: undefined,
        displayName: undefined,
        creationTime: '2026-01-01',
      });
      prismaMock.userEntitlement.findUnique.mockResolvedValue({
        userId: 'u-no-email',
        tier: UserAccessTier.NON_PRO,
        createdAt: new Date('2026-01-01'),
      });
      prismaMock.userEntitlementAuditLog.findMany.mockResolvedValue([]);

      const detail = await service.getUserDetail('u-no-email');
      expect(detail.uid).toBe('u-no-email');
      expect(detail.email).toBeNull();
      expect(detail.displayName).toBeNull();
    });

    it('should throw 404 NOT_FOUND if user does not exist in Firebase or database', async () => {
      firebaseAuthMock.getUser.mockResolvedValue(null);
      prismaMock.userEntitlement.findUnique.mockResolvedValue(null);

      await expect(service.getUserDetail('unknown-uid')).rejects.toThrow('User unknown-uid not found');
    });
  });
});
