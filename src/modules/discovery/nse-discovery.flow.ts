import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ObserveContext, NSE_SOURCE_CODE } from './adapters/source-adapter';
import { NseHttpClient } from './adapters/nse/nse.fetcher';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { DiscoveryService } from './discovery.service';
import { DiscoveryProcessResult } from './discovery.types';

@Injectable()
export class NseDiscoveryFlow {
  constructor(
    private readonly adapter: NseSourceAdapter,
    private readonly discovery: DiscoveryService,
    private readonly http: NseHttpClient,
    private readonly prisma: PrismaService,
  ) {}

  async ingest(
    raw: unknown,
    context: ObserveContext,
  ): Promise<DiscoveryProcessResult> {
    const observations = this.adapter.observe(raw, context);
    let last: DiscoveryProcessResult | undefined;

    for (const observation of observations) {
      last = await this.discovery.process(observation);
    }

    if (!last) {
      throw new Error('NSE payload contained no issues');
    }

    return last;
  }

  async ingestLive(
    discoveredAt: Date = new Date(),
  ): Promise<DiscoveryProcessResult[]> {
    const source = await this.prisma.source.findUnique({
      where: { code: NSE_SOURCE_CODE },
    });

    if (!source) {
      throw new Error(
        'NSE source is not configured. Seed a sources row with code "nse" before live ingestion.',
      );
    }

    const document = await this.http.fetchIpoDocument();
    const observations = this.adapter.observe(document.body, {
      sourceId: source.id,
      discoveredAt,
    });

    const results: DiscoveryProcessResult[] = [];
    for (const observation of observations) {
      results.push(await this.discovery.process(observation));
    }

    return results;
  }
}
