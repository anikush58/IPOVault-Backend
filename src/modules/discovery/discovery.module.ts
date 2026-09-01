import { Module } from '@nestjs/common';

import { CanonicalizerService } from './canonicalizer.service';
import { DiscoveryRecordRepository } from './discovery-record.repository';
import { DiscoveryService } from './discovery.service';
import { MatchingService } from './matching.service';

@Module({
  providers: [
    DiscoveryRecordRepository,
    MatchingService,
    CanonicalizerService,
    DiscoveryService,
  ],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
