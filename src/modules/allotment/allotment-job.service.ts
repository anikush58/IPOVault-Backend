import { Injectable, Logger } from '@nestjs/common';
import { AllotmentJobStatus, AllotmentResultStatus } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../database/prisma.service';
import { AllotmentService } from './allotment.service';
import { AllotmentIdentifierType, AllotmentStatus } from './allotment.types';
import { decryptPan, hashIdentifier, maskIdentifier } from './allotment.utils';
import { RegistrarResolver } from './registrar.resolver';

export interface CreateJobDto {
  ipoId: string;
  identifierType?: AllotmentIdentifierType;
  identifierValues?: string[];
}

@Injectable()
export class AllotmentJobService {
  private readonly logger = new Logger(AllotmentJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: RegistrarResolver,
    private readonly allotmentService: AllotmentService,
  ) {}

  /**
   * Initiates a bulk allotment check job for an IPO across user's saved PANs or explicitly provided identifiers.
   */
  async createJob(dto: CreateJobDto, userId?: string) {
    const {
      ipoId,
      identifierValues: explicitValues,
      identifierType = AllotmentIdentifierType.PAN,
    } = dto;

    let targetValues: string[] = [];

    if (explicitValues && explicitValues.length > 0) {
      targetValues = explicitValues;
    } else if (userId) {
      // Load saved PANs for authenticated user
      const savedPans = await this.prisma.userSavedPan.findMany({
        where: { userId },
      });

      targetValues = savedPans.map((sp) => decryptPan(sp.panEncrypted));
    }

    if (!targetValues || targetValues.length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'No saved PANs found for user and no explicit identifiers provided.',
        400,
      );
    }

    const ipo = await this.prisma.ipo.findUnique({
      where: { id: ipoId },
    });

    if (!ipo) {
      throw new AppException(
        ErrorCode.IPO_NOT_FOUND,
        `IPO with ID '${ipoId}' was not found`,
        404,
      );
    }

    const resolved = await this.resolver.resolveAdapter(ipoId);

    if (!resolved || !resolved.adapter) {
      throw new AppException(
        ErrorCode.REGISTRAR_UNSUPPORTED,
        `Automated checking is not supported for IPO '${ipoId}'. Registrar adapter is missing or unsupported.`,
        400,
      );
    }

    // Create persistent job record bound to userId
    const job = await this.prisma.allotmentCheckJob.create({
      data: {
        ipoId,
        userId: userId || null,
        status: AllotmentJobStatus.QUEUED,
        totalChecks: targetValues.length,
        processedChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        items: {
          create: targetValues.map((val) => ({
            identifierType:
              identifierType as unknown as import('@prisma/client').AllotmentIdentifierType,
            identifierHash: hashIdentifier(val),
            maskedId: maskIdentifier(val, identifierType),
            status: AllotmentResultStatus.UNKNOWN,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    this.logger.log(
      `Created bulk allotment job ${job.id} for IPO ${ipoId} (User: ${userId || 'ANONYMOUS'}, ${targetValues.length} items queued)`,
    );

    // Trigger async job execution with transient targetValues in RAM
    void this.processJob(
      job.id,
      targetValues,
      resolved?.adapter?.defaultConcurrency || 5,
    );

    return job;
  }

  /**
   * Retrieves current status, progress, and results of a bulk allotment check job.
   * Enforces strict user ownership verification.
   */
  async getJob(jobId: string, userId?: string) {
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

    // Ownership check: User A cannot read User B's job
    if (job.userId && userId && job.userId !== userId) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Job with ID '${jobId}' was not found`,
        404,
      );
    }

    const progressMessage = `Checking ${job.processedChecks} of ${job.totalChecks}...`;

    return {
      id: job.id,
      userId: job.userId,
      ipoId: job.ipoId,
      status: job.status,
      totalChecks: job.totalChecks,
      processedChecks: job.processedChecks,
      successfulChecks: job.successfulChecks,
      failedChecks: job.failedChecks,
      progressMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      items: job.items.map((item) => ({
        id: item.id,
        maskedId: item.maskedId,
        status: item.status,
        sharesApplied: item.sharesApplied,
        sharesAllotted: item.sharesAllotted,
        errorMessage: item.errorMessage,
        checkedAt: item.checkedAt,
      })),
    };
  }

  /**
   * Retries failed items in an existing bulk job.
   * Enforces user ownership verification.
   */
  async retryFailedItems(
    jobId: string,
    userId?: string,
    identifierValuesMap?: Record<string, string>,
  ) {
    const job = await this.prisma.allotmentCheckJob.findUnique({
      where: { id: jobId },
      include: { items: true },
    });

    if (!job) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Job with ID '${jobId}' was not found`,
        404,
      );
    }

    // Ownership check
    if (job.userId && userId && job.userId !== userId) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `Job with ID '${jobId}' was not found`,
        404,
      );
    }

    const failedItems = job.items.filter(
      (item) =>
        item.status === AllotmentResultStatus.SOURCE_UNAVAILABLE ||
        item.status === AllotmentResultStatus.RATE_LIMITED ||
        item.status === AllotmentResultStatus.TEMPORARY_ERROR ||
        item.status === AllotmentResultStatus.UNKNOWN,
    );

    if (failedItems.length === 0) {
      return this.getJob(jobId, userId);
    }

    // Reset job status to RUNNING
    await this.prisma.allotmentCheckJob.update({
      where: { id: jobId },
      data: {
        status: AllotmentJobStatus.RUNNING,
      },
    });

    let valuesToRetry: string[] = [];

    if (identifierValuesMap && Object.keys(identifierValuesMap).length > 0) {
      valuesToRetry = failedItems
        .map(
          (item) =>
            identifierValuesMap[item.maskedId] ||
            identifierValuesMap[item.identifierHash],
        )
        .filter((v): v is string => Boolean(v));
    } else if (job.userId) {
      // Decrypt saved PANs for user matching failed items
      const savedPans = await this.prisma.userSavedPan.findMany({
        where: { userId: job.userId },
      });

      const decryptedList = savedPans.map((sp) => decryptPan(sp.panEncrypted));
      const failedHashes = new Set(failedItems.map((it) => it.identifierHash));

      valuesToRetry = decryptedList.filter((val) =>
        failedHashes.has(hashIdentifier(val)),
      );
    }

    if (valuesToRetry.length > 0) {
      const resolved = await this.resolver.resolveAdapter(job.ipoId);
      void this.processJob(
        jobId,
        valuesToRetry,
        resolved?.adapter?.defaultConcurrency || 5,
      );
    }

    return this.getJob(jobId, userId);
  }

  /**
   * Internal job processor executing per-registrar controlled concurrency workers.
   */
  private async processJob(
    jobId: string,
    rawValues: string[],
    concurrency: number,
  ) {
    try {
      await this.prisma.allotmentCheckJob.update({
        where: { id: jobId },
        data: { status: AllotmentJobStatus.RUNNING },
      });

      const job = await this.prisma.allotmentCheckJob.findUnique({
        where: { id: jobId },
        include: { items: true },
      });

      if (!job) return;

      // Controlled concurrency pool execution
      const queue = [...rawValues];
      const workers: Promise<void>[] = [];

      for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const val = queue.shift();
              if (!val) break;

              const hashed = hashIdentifier(val);
              const item = job.items.find((it) => it.identifierHash === hashed);

              const startTime = Date.now();
              const result = await this.allotmentService.checkAllotment({
                ipoId: job.ipoId,
                identifierType:
                  (item?.identifierType as AllotmentIdentifierType) ||
                  AllotmentIdentifierType.PAN,
                identifierValue: val,
              });

              const latencyMs = Date.now() - startTime;
              const isBusinessOrInfoSuccess =
                result.status === AllotmentStatus.ALLOTTED ||
                result.status === AllotmentStatus.PARTIALLY_ALLOTTED ||
                result.status === AllotmentStatus.NOT_ALLOTTED ||
                result.status === AllotmentStatus.APPLICATION_NOT_FOUND ||
                result.status === AllotmentStatus.NOT_YET_AVAILABLE;

              const prismaStatus = (AllotmentResultStatus[
                result.status as keyof typeof AllotmentResultStatus
              ] || AllotmentResultStatus.UNKNOWN) as AllotmentResultStatus;

              // Update item record
              if (item) {
                await this.prisma.allotmentCheckJobItem.update({
                  where: { id: item.id },
                  data: {
                    status: prismaStatus,
                    sharesApplied: result.sharesApplied ?? null,
                    sharesAllotted: result.sharesAllotted ?? null,
                    latencyMs,
                    errorMessage: result.errorMessage ?? null,
                    checkedAt: new Date(),
                  },
                });
              }

              // Update job progress counters atomically
              await this.prisma.allotmentCheckJob.update({
                where: { id: jobId },
                data: {
                  processedChecks: { increment: 1 },
                  successfulChecks: isBusinessOrInfoSuccess
                    ? { increment: 1 }
                    : undefined,
                  failedChecks: !isBusinessOrInfoSuccess
                    ? { increment: 1 }
                    : undefined,
                },
              });
            }
          })(),
        );
      }

      await Promise.all(workers);

      // Final job status evaluation
      const updatedJob = await this.prisma.allotmentCheckJob.findUnique({
        where: { id: jobId },
      });

      if (updatedJob) {
        let finalStatus: AllotmentJobStatus;
        if (updatedJob.failedChecks === 0) {
          finalStatus = AllotmentJobStatus.COMPLETED;
        } else if (updatedJob.successfulChecks > 0) {
          finalStatus = AllotmentJobStatus.COMPLETED_WITH_ERRORS;
        } else {
          finalStatus = AllotmentJobStatus.FAILED;
        }

        await this.prisma.allotmentCheckJob.update({
          where: { id: jobId },
          data: { status: finalStatus },
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Job execution failed for job ${jobId}: ${msg}`);
      await this.prisma.allotmentCheckJob.update({
        where: { id: jobId },
        data: {
          status: AllotmentJobStatus.FAILED,
          errorMessage: msg,
        },
      });
    }
  }
}
