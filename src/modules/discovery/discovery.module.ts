import { Module } from '@nestjs/common';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { MatchingService } from './matching.service';
import { NseHttpClient } from './adapters/nse/nse.fetcher';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';
import { NseDiscoveryFlow } from './nse-discovery.flow';
import { SebiHttpClient } from './adapters/sebi/sebi.fetcher';
import { SebiSourceAdapter } from './adapters/sebi/sebi.adapter';
import { SebiDiscoveryFlow } from './adapters/sebi/sebi-discovery.flow';

import { ReconciliationService } from './reconciliation.service';
import { DiscoveryFreshnessService } from './discovery-freshness.service';

@Module({
  providers: [
    DiscoveryRecordRepository,
    MatchingService,
    CanonicalizerService,
    DiscoveryFreshnessService,
    ReconciliationService,
    DiscoveryService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
    SebiSourceAdapter,
    SebiHttpClient,
    SebiDiscoveryFlow,
  ],
  exports: [
    DiscoveryService,
    DiscoveryFreshnessService,
    ReconciliationService,
    NseSourceAdapter,
    NseHttpClient,
    NseDiscoveryFlow,
    SebiSourceAdapter,
    SebiHttpClient,
    SebiSourceAdapter,
    SebiHttpClient,
    SebiDiscoveryFlow,
  ],
})
export class DiscoveryModule {}
