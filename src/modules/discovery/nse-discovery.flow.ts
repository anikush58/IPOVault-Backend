import { Injectable } from '@nestjs/common';

import { ObserveContext } from './adapters/source-adapter';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { DiscoveryService } from './discovery.service';
import { DiscoveryProcessResult } from './discovery.types';

@Injectable()
export class NseDiscoveryFlow {
  constructor(
    private readonly adapter: NseSourceAdapter,
    private readonly discovery: DiscoveryService,
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
}
