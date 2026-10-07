import { Injectable, Logger } from '@nestjs/common';
import { SourceHealthStatus } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { DiscoveryService } from '../../discovery.service';
import { SourceRegistryService } from '../../source-registry.service';
import { BSE_SME_SOURCE_CODE, NSE_EMERGE_SOURCE_CODE } from '../source-adapter';
import { SmeSourceAdapter } from './sme-discovery.adapter';
import { SmeDiscoveryFetcher } from './sme-discovery.fetcher';
import { SmeDiscoveryResult, SmeFilingItem } from './sme-discovery.types';

@Injectable()
export class SmeDiscoveryFlow {
  private readonly logger = new Logger(SmeDiscoveryFlow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sourceRegistry: SourceRegistryService,
    private readonly fetcher: SmeDiscoveryFetcher,
    private readonly adapter: SmeSourceAdapter,
    private readonly discoveryService: DiscoveryService,
  ) {}

  /**
   * Discovers and ingests BSE SME filings.
   */
  async ingestBseSme(
    filings?: SmeFilingItem[],
    fetchImpl?: typeof fetch,
  ): Promise<SmeDiscoveryResult> {
    const source = await this.sourceRegistry.ensureSource(BSE_SME_SOURCE_CODE);
    const items = filings || (await this.fetcher.fetchBseSmeFilings(fetchImpl));
    return this.processFilings(source.id, BSE_SME_SOURCE_CODE, items);
  }

  /**
   * Discovers and ingests NSE Emerge filings.
   */
  async ingestNseEmerge(
    filings?: SmeFilingItem[],
    fetchImpl?: typeof fetch,
  ): Promise<SmeDiscoveryResult> {
    const source = await this.sourceRegistry.ensureSource(NSE_EMERGE_SOURCE_CODE);
    const items = filings || (await this.fetcher.fetchNseEmergeFilings(fetchImpl));
    return this.processFilings(source.id, NSE_EMERGE_SOURCE_CODE, items);
  }

  /**
   * Ingests both BSE SME and NSE Emerge feeds in live operation.
   */
  async ingestLive(fetchImpl?: typeof fetch): Promise<{
    bse: SmeDiscoveryResult;
    nse: SmeDiscoveryResult;
  }> {
    const [bse, nse] = await Promise.allSettled([
      this.ingestBseSme(undefined, fetchImpl),
      this.ingestNseEmerge(undefined, fetchImpl),
    ]);

    return {
      bse:
        bse.status === 'fulfilled'
          ? bse.value
          : {
              sourceCode: BSE_SME_SOURCE_CODE,
              totalDiscovered: 0,
              createdRecordsCount: 0,
              duplicateCount: 0,
              failedCount: 1,
              records: [],
            },
      nse:
        nse.status === 'fulfilled'
          ? nse.value
          : {
              sourceCode: NSE_EMERGE_SOURCE_CODE,
              totalDiscovered: 0,
              createdRecordsCount: 0,
              duplicateCount: 0,
              failedCount: 1,
              records: [],
            },
    };
  }

  /**
   * Processes a list of SME filing items through the discovery pipeline.
   */
  private async processFilings(
    sourceId: string,
    sourceCode: string,
    items: SmeFilingItem[],
  ): Promise<SmeDiscoveryResult> {
    const now = new Date();
    const result: SmeDiscoveryResult = {
      sourceCode,
      totalDiscovered: items.length,
      createdRecordsCount: 0,
      duplicateCount: 0,
      failedCount: 0,
      records: [],
    };

    if (items.length === 0) {
      this.logger.log(`No filings discovered for source '${sourceCode}'.`);
      await this.prisma.source
        .update({
          where: { id: sourceId },
          data: { lastCheckedAt: now },
        })
        .catch(() => {});
      return result;
    }

    const observations = this.adapter.observe(items, {
      sourceId,
      discoveredAt: now,
    });

    let hasErrors = false;

    for (const observation of observations) {
      try {
        const processResult = await this.discoveryService.process(observation);
        result.records.push({
          discoveryRecordId: processResult.discoveryRecordId,
          companyName: observation.companyName || '',
          outcome: processResult.outcome,
        });

        if (processResult.outcome === 'CREATED' || processResult.outcome === 'MATCHED') {
          result.createdRecordsCount++;
        } else if (processResult.outcome === 'DUPLICATE') {
          result.duplicateCount++;
        } else if (processResult.outcome === 'ERROR' || processResult.outcome === 'REJECTED') {
          result.failedCount++;
          hasErrors = true;
        }
      } catch (err: unknown) {
        result.failedCount++;
        hasErrors = true;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed processing observation for '${observation.companyName}': ${msg}`,
        );
      }
    }

    await this.prisma.source
      .update({
        where: { id: sourceId },
        data: {
          lastCheckedAt: now,
          ...(hasErrors
            ? { lastFailureAt: now, healthStatus: SourceHealthStatus.DEGRADED }
            : { lastSuccessAt: now, healthStatus: SourceHealthStatus.HEALTHY }),
        },
      })
      .catch(() => {});

    this.logger.log(
      `SME Ingestion for '${sourceCode}' completed: ${result.createdRecordsCount} created/matched, ${result.duplicateCount} duplicate, ${result.failedCount} failed`,
    );

    return result;
  }
}
