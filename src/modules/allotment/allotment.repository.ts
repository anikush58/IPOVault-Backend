import { Injectable, Logger } from '@nestjs/common';
import { AllotmentResultStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  AllotmentIdentifierType,
  NormalizedAllotmentResult,
} from './allotment.types';
import { hashIdentifier, maskIdentifier } from './allotment.utils';

@Injectable()
export class AllotmentRepository {
  private readonly logger = new Logger(AllotmentRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Logs an allotment check attempt to PostgreSQL allotment_check_logs table.
   * Ensures sensitive identifiers (PAN / Application No) are HMAC-hashed & masked.
   */
  async logCheckAttempt(
    ipoId: string,
    identifierType: AllotmentIdentifierType,
    rawIdentifierValue: string,
    result: NormalizedAllotmentResult,
    latencyMs?: number,
  ): Promise<void> {
    const hashed = hashIdentifier(rawIdentifierValue);
    const masked = maskIdentifier(rawIdentifierValue, identifierType);

    const prismaStatus = (AllotmentResultStatus[
      result.status as keyof typeof AllotmentResultStatus
    ] || AllotmentResultStatus.UNKNOWN) as AllotmentResultStatus;

    try {
      const source = result.sourceCode
        ? await this.prisma.source.findUnique({
            where: { code: result.sourceCode },
          })
        : null;

      await this.prisma.allotmentCheckLog.create({
        data: {
          ipoId,
          sourceId: source?.id || null,
          identifierType:
            identifierType as unknown as import('@prisma/client').AllotmentIdentifierType,
          identifierHash: hashed,
          maskedId: masked,
          status: prismaStatus,
          sharesApplied: result.sharesApplied ?? null,
          sharesAllotted: result.sharesAllotted ?? null,
          latencyMs: latencyMs ?? null,
          errorMessage: result.errorMessage ?? null,
          checkedAt: result.checkedAt || new Date(),
        },
      });

      this.logger.log(
        `Logged allotment check attempt for IPO ${ipoId} (Source: ${result.sourceCode}, Status: ${result.status}, Masked: ${masked})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to log allotment check attempt for IPO ${ipoId}: ${msg}`,
      );
    }
  }

  async findHistoryByIdentifier(ipoId: string, rawIdentifierValue: string) {
    const hashed = hashIdentifier(rawIdentifierValue);
    return this.prisma.allotmentCheckLog.findMany({
      where: {
        ipoId,
        identifierHash: hashed,
      },
      orderBy: {
        checkedAt: 'desc',
      },
      take: 10,
    });
  }

  async findUserJobsWithItems(userId: string) {
    return this.prisma.allotmentCheckJob.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findIposPriceBands(ipoIds: string[]) {
    if (ipoIds.length === 0) return [];
    return this.prisma.ipo.findMany({
      where: { id: { in: ipoIds } },
      select: { id: true, priceBandHigh: true },
    });
  }

  async findUserSavedPans(userId: string) {
    return this.prisma.userSavedPan.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findUserJobsForIpo(userId: string, ipoId: string) {
    return this.prisma.allotmentCheckJob.findMany({
      where: { userId, ipoId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async findIposMetadata(ipoIds: string[]) {
    if (ipoIds.length === 0) return [];
    return this.prisma.ipo.findMany({
      where: { id: { in: ipoIds } },
      select: {
        id: true,
        symbol: true,
        priceBandHigh: true,
        lotSize: true,
        company: {
          select: { displayName: true, legalName: true },
        },
      },
    });
  }
}
