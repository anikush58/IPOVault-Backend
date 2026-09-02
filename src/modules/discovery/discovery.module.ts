import { Module } from '@nestjs/common';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { MatchingService } from './matching.service';
import { NseHttpClient } from './adapters/nse/nse.fetcher';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { NseDiscoveryFlow } from './nse-discovery.flow';

@Module({
  providers: [
    DiscoveryRecordRepository,
    MatchingService,
    CanonicalizerService,
    DiscoveryService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
  ],
  exports: [
    DiscoveryService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
  ],
})
export class DiscoveryModule {}
