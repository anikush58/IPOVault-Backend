import { Injectable, Logger } from '@nestjs/common';
import { DiscoveryStatus, SourceType } from '@prisma/client';

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
  failedDownloadsCount: number;
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
    page = 1,
    fetchImpl?: typeof fetch,
    downloadDocument = false,
    processCanonicalization = true,
  ): Promise<SebiIngestionResult> {
    this.logger.log(`Starting SEBI official filing discovery flow (page ${page})...`);

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

    const discoveredAt = new Date();
    const doc = await this.client.fetchListing(page, fetchImpl);
    const observations = this.adapter.observe(doc, {
      sourceId: source.id,
      discoveredAt,
    });

    this.logger.log(
      `Discovered ${observations.length} filing observations from SEBI listing response`,
    );

    let duplicateCount = 0;
    let createdRecordsCount = 0;
    let downloadedDocumentsCount = 0;
    let failedDownloadsCount = 0;

    for (const obs of observations) {
      const contentHash = hashPayload(obs.rawPayload);
      const duplicate = await this.recordsRepository.findDuplicate(
        source.id,
        obs.externalId,
        contentHash,
      );

      if (duplicate) {
        duplicateCount++;
        continue;
      }

      const record = await this.recordsRepository.create(obs, contentHash);
      createdRecordsCount++;

      const payload = obs.rawPayload as unknown as Record<string, any>;
      const metadata = (payload.source ? payload : obs.rawPayload) as unknown as SebiFilingMetadata;
      const docUrl = metadata.documentUrl || metadata.detailUrl;

      if (downloadDocument && docUrl) {
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

        try {
          const downloadResult = await this.client.downloadDocument(
            docUrl,
            fetchImpl,
          );

          downloadedDocumentsCount++;
          // Persist document metadata evidence on discovery record
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

              if (processCanonicalization) {
                const pdfPayload = sebiPdfObservationToRawPayload(
                  pdfObs,
                  obs.companyName || undefined,
                  metadata.filingDate,
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
                this.logger.log(
                  `Processed SEBI PDF observation through DiscoveryService for filing ${obs.externalId}: ${discoveryResult.outcome} (IPO ID: ${discoveryResult.ipoId})`,
                );
              }
            } catch (parseErr: unknown) {
              const parseMsg =
                parseErr instanceof Error
                  ? parseErr.message
                  : String(parseErr);
              this.logger.warn(
                `SEBI PDF parsing failed for filing ${obs.externalId}: ${parseMsg}`,
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

    return {
      totalDiscovered: observations.length,
      duplicateCount,
      createdRecordsCount,
      downloadedDocumentsCount,
      failedDownloadsCount,
    };
  }
}
