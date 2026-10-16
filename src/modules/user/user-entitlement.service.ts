import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseAuthService } from '../auth/firebase-auth.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { UserListQueryDto } from './dto/user-entitlement.dto';

export type UserAccessTierType = 'NON_PRO' | 'PRO';

export interface UserSummaryItem {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt?: string | null;
  tier: UserAccessTierType;
  isPro: boolean;
  grantedAt?: string | null;
  revokedAt?: string | null;
  grantedBy?: string | null;
  notes?: string | null;
}

export interface UserDetailView extends UserSummaryItem {
  auditLogs: Array<{
    id: string;
    previousTier: UserAccessTierType;
    newTier: UserAccessTierType;
    changedBy: string;
    reason?: string | null;
    ipAddress?: string | null;
    createdAt: string;
  }>;
}

@Injectable()
export class UserEntitlementService {
  private readonly logger = new Logger(UserEntitlementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebaseAuthService: FirebaseAuthService,
  ) {}

  /**
   * Retrieves the canonical entitlement tier for a specific user ID.
   * Server-authoritative: Defaults to NON_PRO if no explicit entitlement record exists.
   */
  async getEntitlement(userId: string): Promise<{
    userId: string;
    tier: UserAccessTierType;
    isPro: boolean;
    grantedAt?: Date | null;
    revokedAt?: Date | null;
    updatedAt: Date;
  }> {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authenticated user ID is required',
        401,
      );
    }

    const cleanUserId = userId.trim();
    const entitlement = await this.prisma.userEntitlement.findUnique({
      where: { userId: cleanUserId },
    });

    if (!entitlement) {
      return {
        userId: cleanUserId,
        tier: 'NON_PRO',
        isPro: false,
        grantedAt: null,
        revokedAt: null,
        updatedAt: new Date(),
      };
    }

    return {
      userId: cleanUserId,
      tier: entitlement.tier as UserAccessTierType,
      isPro: entitlement.tier === 'PRO',
      grantedAt: entitlement.grantedAt,
      revokedAt: entitlement.revokedAt,
      updatedAt: entitlement.updatedAt,
    };
  }

  /**
   * Admin-only query: lists registered users with search, tier filtering, and pagination.
   * Merges Firebase identity with server-side entitlements and database users.
   * SECURITY: Strictly zero exposure of sensitive fields (no PANs, passwords, tokens, broker credentials).
   */
  async listUsers(query: UserListQueryDto): Promise<{
    users: UserSummaryItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    counts: {
      total: number;
      pro: number;
      nonPro: number;
    };
  }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    // 1. Fetch registered users from Firebase Auth (supports pagination beyond 1,000)
    const fbUsers =
      typeof (this.firebaseAuthService as any).listAllUsers === 'function'
        ? await (this.firebaseAuthService as any).listAllUsers()
        : (await this.firebaseAuthService.listUsers()).users;

    // 2. Fetch all entitlement records from database
    const entitlements = await this.prisma.userEntitlement.findMany();
    const entitlementMap = new Map(entitlements.map((e) => [e.userId, e]));

    // 3. Map Firebase users, merging entitlement records (default to NON_PRO)
    // Never synthesize fake users from DB models or entitlement records alone.
    const enrichedList: UserSummaryItem[] = (fbUsers as any[]).map((u) => {
      const ent = entitlementMap.get(u.uid);
      const tier: UserAccessTierType =
        (ent?.tier as UserAccessTierType) || 'NON_PRO';
      return {
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || null,
        createdAt: u.creationTime || new Date().toISOString(),
        lastSignInAt: u.lastSignInTime || null,
        tier,
        isPro: tier === 'PRO',
        grantedAt: ent?.grantedAt ? ent.grantedAt.toISOString() : null,
        revokedAt: ent?.revokedAt ? ent.revokedAt.toISOString() : null,
        grantedBy: ent?.grantedBy || null,
        notes: ent?.notes || null,
      };
    });

    // Global counts before query filtering
    const globalCounts = {
      total: enrichedList.length,
      pro: enrichedList.filter((u) => u.tier === 'PRO').length,
      nonPro: enrichedList.filter((u) => u.tier === 'NON_PRO').length,
    };

    // Filter by text search
    let filtered = enrichedList;
    if (query.q && query.q.trim()) {
      const qLower = query.q.trim().toLowerCase();
      filtered = filtered.filter(
        (u) =>
          u.uid.toLowerCase().includes(qLower) ||
          (u.email && u.email.toLowerCase().includes(qLower)) ||
          (u.displayName && u.displayName.toLowerCase().includes(qLower)),
      );
    }

    // Filter by tier
    if (query.tier && query.tier !== 'ALL') {
      filtered = filtered.filter((u) => u.tier === query.tier);
    }

    // Sort by registration date descending
    filtered.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    // Pagination
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const pagedUsers = filtered.slice(startIndex, startIndex + limit);

    return {
      users: pagedUsers,
      total,
      page,
      limit,
      totalPages,
      counts: globalCounts,
    };
  }

  /**
   * Admin-only query: retrieves full user profile, entitlement state, and audit logs.
   * SECURITY: Strictly zero exposure of sensitive fields (no PANs, passwords, tokens, broker credentials).
   */
  async getUserDetail(userId: string): Promise<UserDetailView> {
    if (!userId || !userId.trim()) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'User ID is required',
        400,
      );
    }

    const cleanUserId = userId.trim();

    // 1. Fetch Firebase user info if available
    const fbUser = await this.firebaseAuthService.getUser(cleanUserId);

    // 2. Fetch database entitlement
    const entitlement = await this.prisma.userEntitlement.findUnique({
      where: { userId: cleanUserId },
    });

    // 3. Fetch audit logs
    const auditLogs = await this.prisma.userEntitlementAuditLog.findMany({
      where: { userId: cleanUserId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (!fbUser && !entitlement) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `User ${cleanUserId} not found`,
        404,
      );
    }

    const tier: UserAccessTierType = (entitlement?.tier as UserAccessTierType) || 'NON_PRO';

    return {
      uid: cleanUserId,
      email: fbUser?.email || null,
      displayName: fbUser?.displayName || null,
      createdAt: fbUser?.creationTime || (entitlement?.createdAt ? entitlement.createdAt.toISOString() : new Date().toISOString()),
      lastSignInAt: fbUser?.lastSignInTime || null,
      tier,
      isPro: tier === 'PRO',
      grantedAt: entitlement?.grantedAt ? entitlement.grantedAt.toISOString() : null,
      revokedAt: entitlement?.revokedAt ? entitlement.revokedAt.toISOString() : null,
      grantedBy: entitlement?.grantedBy || null,
      notes: entitlement?.notes || null,
      auditLogs: auditLogs.map((log) => ({
        id: log.id,
        previousTier: log.previousTier as UserAccessTierType,
        newTier: log.newTier as UserAccessTierType,
        changedBy: log.changedBy,
        reason: log.reason,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Admin-only mutation: Grants or revokes Pro entitlement for an individual user.
   * Transactional update with server-side audit logging.
   */
  async updateUserEntitlement(
    targetUserId: string,
    newTier: UserAccessTierType,
    adminActor: string,
    reason?: string,
    ipAddress?: string,
  ): Promise<{
    success: boolean;
    userId: string;
    previousTier: UserAccessTierType;
    newTier: UserAccessTierType;
    updatedAt: Date;
  }> {
    if (!targetUserId || !targetUserId.trim()) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Target user ID is required',
        400,
      );
    }
    if (newTier !== 'PRO' && newTier !== 'NON_PRO') {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        "Tier must be either 'PRO' or 'NON_PRO'",
        400,
      );
    }

    const cleanUserId = targetUserId.trim();
    const actor = adminActor?.trim() || 'admin';

    // Retrieve existing tier
    const existing = await this.prisma.userEntitlement.findUnique({
      where: { userId: cleanUserId },
    });
    const previousTier: UserAccessTierType = (existing?.tier as UserAccessTierType) || 'NON_PRO';

    const now = new Date();

    // Execute transactional update + audit log
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userEntitlement.upsert({
        where: { userId: cleanUserId },
        create: {
          userId: cleanUserId,
          tier: newTier,
          grantedBy: newTier === 'PRO' ? actor : null,
          grantedAt: newTier === 'PRO' ? now : null,
          revokedAt: newTier === 'NON_PRO' ? now : null,
          notes: reason || null,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          tier: newTier,
          grantedBy: newTier === 'PRO' ? actor : existing?.grantedBy || null,
          grantedAt: newTier === 'PRO' ? now : existing?.grantedAt || null,
          revokedAt: newTier === 'NON_PRO' ? now : null,
          notes: reason || existing?.notes || null,
          updatedAt: now,
        },
      });

      const auditLog = await tx.userEntitlementAuditLog.create({
        data: {
          entitlementId: updated.id,
          userId: cleanUserId,
          previousTier,
          newTier,
          changedBy: actor,
          reason: reason || null,
          ipAddress: ipAddress || null,
          createdAt: now,
        },
      });

      return { updated, auditLog };
    });

    // Optionally update Firebase custom claims if Firebase Admin is available
    await this.firebaseAuthService.setCustomUserClaims(cleanUserId, {
      pro: newTier === 'PRO',
      updatedAt: now.getTime(),
    });

    this.logger.log(
      `[AUDIT] Entitlement changed for user '${cleanUserId}': ${previousTier} -> ${newTier} by admin '${actor}'. Reason: ${reason || 'None'}. LogId: ${result.auditLog.id}`,
    );

    return {
      success: true,
      userId: cleanUserId,
      previousTier,
      newTier,
      updatedAt: result.updated.updatedAt,
    };
  }
}
