import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../database/prisma.service';
import {
  aggregateIpoIntelligence,
  aggregateJobIntelligence,
  aggregatePanIntelligence,
  aggregateUserHistoryIntelligence,
  aggregateUserIntelligence,
} from './allotment-intelligence.calculator';
import { AllotmentRepository } from './allotment.repository';
import {
  IpoUserAllotmentIntelligenceResponseDto,
  JobAllotmentIntelligenceResponseDto,
  UserAllotmentHistoryResponseDto,
  UserAllotmentIntelligenceResponseDto,
  UserPanIntelligenceResponseDto,
} from './dto/allotment.dto';

@Injectable()
export class AllotmentIntelligenceService {
  constructor(
    private readonly repository: AllotmentRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Retrieves authenticated user-scoped overall allotment summary intelligence.
   * Aggregates historical win rates, capital utilization, and per-PAN statistics.
   */
  async getUserSummaryIntelligence(
    userId?: string,
  ): Promise<UserAllotmentIntelligenceResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required to view user allotment intelligence',
        401,
      );
    }

    const [jobs, savedPans] = await Promise.all([
      this.repository.findUserJobsWithItems(userId),
      this.repository.findUserSavedPans(userId),
    ]);

    const ipoIds = Array.from(new Set(jobs.map((j) => j.ipoId)));
    const ipoPrices = await this.repository.findIposPriceBands(ipoIds);

    const ipoPriceMap = new Map<string, Prisma.Decimal | null>();
    for (const ipo of ipoPrices) {
      ipoPriceMap.set(ipo.id, ipo.priceBandHigh);
    }

    return aggregateUserIntelligence({
      userId,
      jobs,
      savedPans,
      ipoPriceMap,
    });
  }

  /**
   * Retrieves job-specific allotment intelligence summary for a given bulk check job.
   * Enforces user ownership — returns 404 if the job belongs to another user.
   */
  async getJobIntelligence(
    jobId: string,
    userId?: string,
  ): Promise<JobAllotmentIntelligenceResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required to view job allotment intelligence',
        401,
      );
    }

    const job = await this.prisma.allotmentCheckJob.findUnique({
      where: { id: jobId },
      include: {
        items: true,
      },
    });

    if (!job) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Job with ID '${jobId}' was not found`,
        404,
      );
    }

    if (job.userId && job.userId !== userId) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Job with ID '${jobId}' was not found`,
        404,
      );
    }

    const savedPans = await this.repository.findUserSavedPans(userId);

    let ipoPrice: Prisma.Decimal | null = null;
    try {
      const ipo = await this.prisma.ipo.findUnique({
        where: { id: job.ipoId },
        select: { priceBandHigh: true },
      });
      ipoPrice = ipo?.priceBandHigh ?? null;
    } catch {
      ipoPrice = null;
    }

    return aggregateJobIntelligence({
      job,
      savedPans,
      ipoPrice,
    });
  }

  /**
   * Retrieves authenticated user-scoped deduplicated allotment history across all checked IPOs.
   */
  async getUserAllotmentHistory(
    userId?: string,
  ): Promise<UserAllotmentHistoryResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required to view allotment history',
        401,
      );
    }

    const [jobs, savedPans] = await Promise.all([
      this.repository.findUserJobsWithItems(userId),
      this.repository.findUserSavedPans(userId),
    ]);

    const ipoIds = Array.from(new Set(jobs.map((j) => j.ipoId)));
    const iposMeta = await this.repository.findIposMetadata(ipoIds);

    const ipoMap = new Map<
      string,
      {
        symbol: string | null;
        companyName: string | null;
        priceBandHigh: Prisma.Decimal | null;
        lotSize: number | null;
      }
    >();

    for (const ipo of iposMeta) {
      ipoMap.set(ipo.id, {
        symbol: ipo.symbol ?? null,
        companyName: ipo.company?.displayName ?? ipo.company?.legalName ?? null,
        priceBandHigh: ipo.priceBandHigh ?? null,
        lotSize: ipo.lotSize ?? null,
      });
    }

    return aggregateUserHistoryIntelligence({
      userId,
      jobs,
      savedPans,
      ipoMap,
    });
  }

  /**
   * Retrieves per-PAN user-scoped deduplicated allotment intelligence for all saved PANs.
   */
  async getUserPanIntelligence(
    userId?: string,
  ): Promise<UserPanIntelligenceResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required to view PAN allotment intelligence',
        401,
      );
    }

    const [jobs, savedPans] = await Promise.all([
      this.repository.findUserJobsWithItems(userId),
      this.repository.findUserSavedPans(userId),
    ]);

    const ipoIds = Array.from(new Set(jobs.map((j) => j.ipoId)));
    const iposMeta = await this.repository.findIposMetadata(ipoIds);

    const ipoMap = new Map<
      string,
      {
        symbol: string | null;
        companyName: string | null;
        priceBandHigh: Prisma.Decimal | null;
        lotSize: number | null;
      }
    >();

    for (const ipo of iposMeta) {
      ipoMap.set(ipo.id, {
        symbol: ipo.symbol ?? null,
        companyName: ipo.company?.displayName ?? ipo.company?.legalName ?? null,
        priceBandHigh: ipo.priceBandHigh ?? null,
        lotSize: ipo.lotSize ?? null,
      });
    }

    return aggregatePanIntelligence({
      userId,
      jobs,
      savedPans,
      ipoMap,
    });
  }

  /**
   * Retrieves per-IPO user-scoped deduplicated allotment intelligence.
   * Validates IPO existence and returns user's deduplicated observation metrics.
   */
  async getIpoAllotmentIntelligence(
    ipoId: string,
    userId?: string,
  ): Promise<IpoUserAllotmentIntelligenceResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required to view IPO allotment intelligence',
        401,
      );
    }

    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
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

    if (!ipo) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `IPO with ID '${ipoId}' was not found`,
        404,
      );
    }

    const [jobs, savedPans] = await Promise.all([
      this.repository.findUserJobsForIpo(userId, ipoId),
      this.repository.findUserSavedPans(userId),
    ]);

    return aggregateIpoIntelligence({
      ipo: {
        id: ipo.id,
        symbol: ipo.symbol ?? null,
        companyName: ipo.company?.displayName ?? ipo.company?.legalName ?? null,
        priceBandHigh: ipo.priceBandHigh ?? null,
        lotSize: ipo.lotSize ?? null,
      },
      jobs,
      savedPans,
    });
  }
}
