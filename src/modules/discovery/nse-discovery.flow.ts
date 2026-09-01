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

  ingest(
    raw: unknown,
    context: ObserveContext,
  ): Promise<DiscoveryProcessResult> {
    const observation = this.adapter.observe(raw, context);
    return this.discovery.process(observation);
  }
}
