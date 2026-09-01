import { Injectable } from '@nestjs/common';
import { DiscoveryStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryProcessResult, IncomingObservation } from './discovery.types';
import { hashPayload } from './hash-payload';
import { MatchingService } from './matching.service';
import { normalizeDiscoveredIpo } from './normalize';
import { validateDiscoveredIpo } from './validate';

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly records: DiscoveryRecordRepository,
    private readonly matching: MatchingService,
    private readonly canonicalizer: CanonicalizerService,
  ) {}

  async process(
    observation: IncomingObservation,
  ): Promise<DiscoveryProcessResult> {
    const contentHash = hashPayload(observation.rawPayload);
    const duplicate = await this.records.findDuplicate(
      observation.sourceId,
      observation.externalId,
      contentHash,
    );

    if (duplicate) {
      return {
        outcome: 'DUPLICATE',
        discoveryRecordId: duplicate.id,
        ipoId: null,
      };
    }

    const record = await this.records.create(observation, contentHash);

    try {
      const discovered = normalizeDiscoveredIpo(observation.rawPayload);
      const validation = validateDiscoveredIpo(discovered);

      if (!validation.ok) {
        await this.records.mark(
          record.id,
          DiscoveryStatus.REJECTED,
          validation.message,
        );
        return {
          outcome: 'REJECTED',
          discoveryRecordId: record.id,
          ipoId: null,
        };
      }

      const match = await this.matching.match(discovered, observation.sourceId);

      if (match.decision === 'REJECT') {
        await this.records.mark(
          record.id,
          DiscoveryStatus.REJECTED,
          match.reason,
        );
        return {
          outcome: 'REJECTED',
          discoveryRecordId: record.id,
          ipoId: null,
        };
      }

      await this.records.mark(record.id, DiscoveryStatus.PROCESSING);

      const result = await this.prisma.$transaction((tx) =>
        this.canonicalizer.apply(tx, {
          discovered,
          match,
          sourceId: observation.sourceId,
          sourceReference: observation.sourceReference,
          retrievedAt: observation.discoveredAt,
        }),
      );

      await this.records.mark(
        record.id,
        result.created ? DiscoveryStatus.CREATED : DiscoveryStatus.MATCHED,
      );

      return {
        outcome: result.created ? 'CREATED' : 'MATCHED',
        discoveryRecordId: record.id,
        ipoId: result.ipoId,
      };
    } catch (error) {
      await this.records.mark(
        record.id,
        DiscoveryStatus.ERROR,
        'canonicalization failed',
      );
      throw error;
    }
  }
}
