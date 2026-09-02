import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { NseDiscoveryFlow } from '../modules/discovery/nse-discovery.flow';
import { DiscoveryProcessResult } from '../modules/discovery/discovery.types';

export function formatNseLiveIngestSummary(
  results: DiscoveryProcessResult[],
): string {
  const lines = [`NSE live ingest: ${results.length} result(s)`];

  for (const result of results) {
    const ipoPart = result.ipoId ? ` ipoId=${result.ipoId}` : '';
    lines.push(
      `- ${result.outcome} discoveryRecordId=${result.discoveryRecordId}${ipoPart}`,
    );
  }

  return lines.join('\n');
}

export async function runNseLiveIngest(
  app: { get: (type: typeof NseDiscoveryFlow) => NseDiscoveryFlow },
  write: (line: string) => void = console.log,
): Promise<DiscoveryProcessResult[]> {
  const flow = app.get(NseDiscoveryFlow);
  const results = await flow.ingestLive();
  write(formatNseLiveIngestSummary(results));
  return results;
}

async function main(): Promise<void> {
  let app:
    | Awaited<ReturnType<typeof NestFactory.createApplicationContext>>
    | undefined;

  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      bufferLogs: true,
    });
    await runNseLiveIngest(app);
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
