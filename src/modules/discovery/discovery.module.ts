import { Module } from '@nestjs/common';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { MatchingService } from './matching.service';
import { NseSourceAdapter } from './adapters/nse/nse.adapter';

@Module({
  providers: [
    DiscoveryRecordRepository,
    MatchingService,
    CanonicalizerService,
    DiscoveryService,
    NseSourceAdapter,
  ],
  exports: [DiscoveryService, NseSourceAdapter],
})
export class DiscoveryModule {}
