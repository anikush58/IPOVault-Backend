import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { Env } from '../config/env';
import {
  SebiDiscoveryFlow,
  SebiIngestionResult,
} from '../modules/discovery/adapters/sebi/sebi-discovery.flow';

export function formatSebiLiveIngestSummary(
  result: SebiIngestionResult,
): string {
  const lines = [
    `SEBI discovery ingest summary:`,
    `- Discovered filing observations: ${result.totalDiscovered}`,
    `- Listing duplicates skipped: ${result.duplicateCount}`,
    `- New listing records created: ${result.createdRecordsCount}`,
    `- PDF documents downloaded: ${result.downloadedDocumentsCount}`,
    `- PDF documents skipped (already processed): ${result.skippedDocumentsCount}`,
    `- PDF document failures: ${result.failedDownloadsCount}`,
    `- Canonical IPOs created: ${result.canonicalCreatedCount}`,
    `- Canonical IPOs matched: ${result.canonicalMatchedCount}`,
  ];

  return lines.join('\n');
}

export async function runSebiLiveIngest(
  app: { get: (token: any) => any },
  startPageOrNum?: number,
  maxPagesOrDownload?: number | boolean,
  downloadDocumentOrWrite?: boolean | ((line: string) => void),
  writeParam: (line: string) => void = console.log,
): Promise<SebiIngestionResult> {
  const flow = app.get(SebiDiscoveryFlow) as SebiDiscoveryFlow;
  const config = app.get(ConfigService) as ConfigService<Env, true>;

  let actualStartPage =
    typeof startPageOrNum === 'number' ? startPageOrNum : undefined;
  let actualMaxPages: number | undefined = undefined;
  let actualDownloadDocument = true;
  let write = writeParam;

  if (typeof maxPagesOrDownload === 'boolean') {
    actualDownloadDocument = maxPagesOrDownload;
    if (typeof downloadDocumentOrWrite === 'function') {
      write = downloadDocumentOrWrite;
    }
  } else if (typeof maxPagesOrDownload === 'number') {
    actualMaxPages = maxPagesOrDownload;
    if (typeof downloadDocumentOrWrite === 'boolean') {
      actualDownloadDocument = downloadDocumentOrWrite;
    }
  }

  const effectiveStartPage =
    actualStartPage ?? config?.get('SEBI_START_PAGE', { infer: true }) ?? 1;
  const effectiveMaxPages =
    actualMaxPages ?? config?.get('SEBI_MAX_PAGES', { infer: true }) ?? 1;
  const interRequestDelayMs =
    config?.get('SEBI_INTER_REQUEST_DELAY_MS', { infer: true }) ?? 0;

  const result = await flow.run(
    effectiveStartPage,
    effectiveMaxPages,
    undefined,
    actualDownloadDocument,
    true,
    interRequestDelayMs,
  );
  write(formatSebiLiveIngestSummary(result));
  return result;
}

async function main(): Promise<void> {
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });
    await runSebiLiveIngest(app);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}

if (require.main === module) {
  void main();
}
