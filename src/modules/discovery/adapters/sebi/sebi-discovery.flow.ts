import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryStatus, SourceHealthStatus, SourceType } from '@prisma/client';

import { PrismaService } from '../../../../database/prisma.service';
import { DiscoveryRecordRepository } from '../../discovery-record.repository';
import { DiscoveryService } from '../../discovery.service';
import { IncomingObservation } from '../../discovery.types';
import { hashPayload } from '../../hash-payload';
import { SEBI_SOURCE_CODE } from '../source-adapter';
import { sebiPdfObservationToRawPayload, SebiSourceAdapter } from './sebi.adapter';
import { isOfficialSebiUrl, SebiHttpClient } from './sebi.fetcher';
import { parseSebiPdfBuffer } from './sebi-pdf.parser';
import { SebiFilingMetadata } from './sebi.types';

export type SebiIngestionResult = {
  totalDiscovered: number;
  duplicateCount: number;
  createdRecordsCount: number;
  downloadedDocumentsCount: number;
  skippedDocumentsCount: number;
  failedDownloadsCount: number;
  canonicalCreatedCount: number;
  canonicalMatchedCount: number;
};

@Injectable()
export class SebiDiscoveryFlow {
  private readonly logger = new Logger(SebiDiscoveryFlow.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recordsRepository: DiscoveryRecordRepository,
    private readonly client: SebiHttpClient,
    private readonly adapter: SebiSourceAdapter,
    private readonly discoveryService: DiscoveryService,
  ) {}

  async run(
    p1 = 1,
    p2?: number | typeof fetch,
    p3?: typeof fetch | boolean,
    p4?: boolean,
    p5?: boolean | number,
    p6 = 0,
  ): Promise<SebiIngestionResult> {
    let actualStartPage = typeof p1 === 'number' && p1 > 0 ? p1 : 1;
    let actualMaxPages = 1;
    let actualFetchImpl: typeof fetch | undefined = undefined;
    let actualDownloadDocument = false;
    let actualProcessCanonicalization = true;
    let actualInterRequestDelayMs = 0;

    if (typeof p2 === 'function') {
      actualMaxPages = 1;
      actualFetchImpl = p2;
      actualDownloadDocument = typeof p3 === 'boolean' ? p3 : false;
      actualProcessCanonicalization = typeof p4 === 'boolean' ? p4 : true;
      actualInterRequestDelayMs = typeof p5 === 'number' ? p5 : 0;
    } else {
      actualMaxPages = typeof p2 === 'number' && p2 > 0 ? p2 : 1;
      actualFetchImpl = typeof p3 === 'function' ? p3 : undefined;
      actualDownloadDocument = typeof p4 === 'boolean' ? p4 : false;
      actualProcessCanonicalization = typeof p5 === 'boolean' ? p5 : true;
      actualInterRequestDelayMs = typeof p6 === 'number' ? p6 : 0;
    }

    const now = new Date();

    // Ensure SEBI source exists in DB
    let source = await this.prisma.source.findUnique({
      where: { code: SEBI_SOURCE_CODE },
    });

    if (!source) {
      source = await this.prisma.source.create({
        data: {
          code: SEBI_SOURCE_CODE,
          name: 'Securities and Exchange Board of India (SEBI)',
          sourceType: SourceType.OFFICIAL_FILING,
          baseUrl: 'https://www.sebi.gov.in',
          priority: 1,
          enabled: true,
        },
      });
    }

    let totalDiscovered = 0;
    let duplicateCount = 0;
    let createdRecordsCount = 0;
    let downloadedDocumentsCount = 0;
    let skippedDocumentsCount = 0;
    let failedDownloadsCount = 0;
    let canonicalCreatedCount = 0;
    let canonicalMatchedCount = 0;
    let pageFetchFailures = 0;
    let successfulPagesCount = 0;

    const endPage = actualStartPage + actualMaxPages - 1;

    for (let page = actualStartPage; page <= endPage; page++) {
      this.logger.log(
        `Starting SEBI official filing discovery flow (page ${page} of ${endPage})...`,
      );

      let doc;
      try {
        doc = await this.client.fetchListing(page, actualFetchImpl);
        successfulPagesCount++;
      } catch (err: unknown) {
        pageFetchFailures++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to fetch SEBI listing page ${page}: ${msg}`);

        if (actualMaxPages === 1) {
          await this.prisma.source.update({
            where: { id: source.id },
            data: {
              lastCheckedAt: now,
              lastFailureAt: now,
              healthStatus: SourceHealthStatus.FAILING,
            },
          });
          throw err;
        }
        continue;
      }

      const discoveredAt = new Date();
      const observations = this.adapter.observe(doc, {
        sourceId: source.id,
        discoveredAt,
      });

      this.logger.log(
        `Discovered ${observations.length} filing observations from SEBI listing response (page ${page})`,
      );

      if (observations.length === 0 && actualMaxPages > 1) {
        this.logger.log(
          `No filings found on SEBI listing page ${page}. Stopping multi-page traversal.`,
        );
        break;
      }

      totalDiscovered += observations.length;

      for (const obs of observations) {
        const contentHash = hashPayload(obs.rawPayload);
        const duplicate = await this.recordsRepository.findDuplicate(
          source.id,
          obs.externalId,
          contentHash,
        );

        let record;
        let isAlreadyProcessedDuplicate = false;
        if (duplicate) {
          duplicateCount++;
          record = duplicate;
          if (
            duplicate.status === DiscoveryStatus.CREATED ||
            duplicate.status === DiscoveryStatus.MATCHED
          ) {
            isAlreadyProcessedDuplicate = true;
          }
        } else {
          record = await this.recordsRepository.create(obs, contentHash);
          createdRecordsCount++;
        }

        // PART B: Process listing observation through DiscoveryService if not already processed
        if (actualProcessCanonicalization && !isAlreadyProcessedDuplicate) {
          try {
            const listingResult = await this.discoveryService.process(obs);
            if (listingResult.outcome === 'CREATED') {
              canonicalCreatedCount++;
            } else if (listingResult.outcome === 'MATCHED') {
              canonicalMatchedCount++;
            }
          } catch (procErr: unknown) {
            const msg = procErr instanceof Error ? procErr.message : String(procErr);
            this.logger.warn(`Failed to process SEBI listing observation ${obs.externalId}: ${msg}`);
          }
        }

        const payload = obs.rawPayload as unknown as Record<string, any>;
        const metadata = (
          payload.source ? payload : obs.rawPayload
        ) as unknown as SebiFilingMetadata;
        const docUrl =
          metadata.documentUrl ||
          metadata.detailUrl ||
          (payload.source as Record<string, any> | undefined)?.reference;

        if (actualDownloadDocument && docUrl) {
          if (!isOfficialSebiUrl(docUrl)) {
            this.logger.warn(
              `Rejecting document download from non-SEBI URL '${docUrl}' for filing ${obs.externalId}`,
            );
            failedDownloadsCount++;
            await this.recordsRepository.mark(
              record.id,
              DiscoveryStatus.REJECTED,
              'Non-SEBI document URL rejected',
            );
            continue;
          }

          // Pre-download check: Skip PDF download if a processed PDF observation already exists for this filing
          const existingProcessed =
            await this.recordsRepository.findProcessedRecord(
              source.id,
              obs.externalId,
              docUrl,
            );

          if (existingProcessed) {
            this.logger.log(
              `Skipping PDF download for filing ${obs.externalId}: detailed observation already processed (Record ID: ${existingProcessed.id})`,
            );
            skippedDocumentsCount++;
            continue;
          }

          if (downloadedDocumentsCount > 0 && actualInterRequestDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, actualInterRequestDelayMs),
            );
          }

          try {
            const downloadResult = await this.client.downloadDocument(
              docUrl,
              actualFetchImpl,
            );

            downloadedDocumentsCount++;
            await this.recordsRepository.mark(
              record.id,
              DiscoveryStatus.NEW,
              undefined,
            );

            if (
              downloadResult.documentBuffer &&
              downloadResult.contentType.toLowerCase().includes('pdf')
            ) {
              try {
                const pdfObs = await parseSebiPdfBuffer(
                  downloadResult.documentBuffer,
                  { externalId: obs.externalId || '', sourceUrl: docUrl },
                );
                this.logger.log(
                  `Parsed SEBI PDF observation for filing ${obs.externalId}: CIN=${pdfObs.cin.value || 'UNRESOLVED'}, LegalName=${pdfObs.legalName.value || 'UNRESOLVED'}, PriceBand=${pdfObs.priceBandLow.value}-${pdfObs.priceBandHigh.value}, LotSize=${pdfObs.lotSize.value}, OpenDate=${pdfObs.issueOpenDate.value}, CloseDate=${pdfObs.issueCloseDate.value}`,
                );

                if (actualProcessCanonicalization) {
                  const pdfPayload = sebiPdfObservationToRawPayload(
                    pdfObs,
                    obs.companyName || undefined,
                    metadata.filingDate,
                    metadata.filingType,
                  );

                  const pdfObservation: IncomingObservation = {
                    sourceId: source.id,
                    externalId: obs.externalId,
                    sourceReference: docUrl,
                    companyName: pdfObs.legalName.value || obs.companyName,
                    rawPayload: pdfPayload,
                    discoveredAt,
                  };

                  const discoveryResult = await this.discoveryService.process(
                    pdfObservation,
                  );

                  if (discoveryResult.outcome === 'CREATED') {
                    canonicalCreatedCount++;
                  } else if (discoveryResult.outcome === 'MATCHED') {
                    canonicalMatchedCount++;
                  }

                  this.logger.log(
                    `Processed SEBI PDF observation through DiscoveryService for filing ${obs.externalId}: ${discoveryResult.outcome} (IPO ID: ${discoveryResult.ipoId})`,
                  );
                }
              } catch (parseErr: unknown) {
                failedDownloadsCount++;
                const parseMsg =
                  parseErr instanceof Error
                    ? parseErr.message
                    : String(parseErr);
                this.logger.warn(
                  `SEBI PDF parsing failed for filing ${obs.externalId}: ${parseMsg}`,
                );
                await this.recordsRepository.mark(
                  record.id,
                  DiscoveryStatus.ERROR,
                  `SEBI PDF parsing failed: ${parseMsg}`,
                );
              }
            }

            this.logger.log(
              `Downloaded SEBI document for filing ${obs.externalId}: ${downloadResult.contentLength} bytes (${downloadResult.contentType})`,
            );
          } catch (err: unknown) {
            failedDownloadsCount++;
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(
              `Document download failed for SEBI filing ${obs.externalId}: ${msg}`,
            );
            await this.recordsRepository.mark(
              record.id,
              DiscoveryStatus.ERROR,
              `Document download failed: ${msg}`,
            );
          }
        }
      }
    }

    if (successfulPagesCount === 0 && actualMaxPages > 0) {
      await this.prisma.source.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: now,
          lastFailureAt: now,
          healthStatus: SourceHealthStatus.FAILING,
        },
      });
      throw new Error(
        `All ${actualMaxPages} SEBI listing page requests failed`,
      );
    }

    const hasFailures = failedDownloadsCount > 0 || pageFetchFailures > 0;
    await this.prisma.source.update({
      where: { id: source.id },
      data: {
        lastCheckedAt: now,
        lastSuccessAt: now,
        ...(hasFailures
          ? {
              lastFailureAt: now,
              healthStatus: SourceHealthStatus.DEGRADED,
            }
          : {
              healthStatus: SourceHealthStatus.HEALTHY,
            }),
      },
    });

    return {
      totalDiscovered,
      duplicateCount,
      createdRecordsCount,
      downloadedDocumentsCount,
      skippedDocumentsCount,
      failedDownloadsCount,
      canonicalCreatedCount,
      canonicalMatchedCount,
    };
  }
}
