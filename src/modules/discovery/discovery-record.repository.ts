import { Injectable } from '@nestjs/common';
import { DiscoveryStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { IncomingObservation } from './discovery.types';

@Injectable()
export class DiscoveryRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDuplicate(
    sourceId: string,
    externalId: string | null,
    contentHash: string,
  ) {
    return this.prisma.discoveryRecord.findFirst({
      where:
        externalId === null
          ? { sourceId, contentHash, externalId: null }
          : { sourceId, externalId, contentHash },
    });
  }

  async findProcessedRecord(
    sourceId: string,
    externalId: string | null,
    sourceReference?: string | null,
  ) {
    if (!externalId) {
      return null;
    }
    return this.prisma.discoveryRecord.findFirst({
      where: {
        sourceId,
        externalId,
        ...(sourceReference ? { sourceReference } : {}),
        status: {
          in: [
            DiscoveryStatus.CREATED,
            DiscoveryStatus.MATCHED,
          ],
        },
      },
    });
  }

  async create(input: IncomingObservation, contentHash: string) {
    return this.prisma.discoveryRecord.create({
      data: {
        sourceId: input.sourceId,
        externalId: input.externalId,
        sourceReference: input.sourceReference,
        companyName: input.companyName,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
        contentHash,
        discoveredAt: input.discoveredAt,
        status: DiscoveryStatus.NEW,
      },
    });
  }

  async mark(
    id: string,
    status: DiscoveryStatus,
    errorMessage: string | null = null,
  ) {
    return this.prisma.discoveryRecord.update({
      where: { id },
      data: {
        status,
        errorMessage,
        processedAt: new Date(),
      },
    });
  }
}
