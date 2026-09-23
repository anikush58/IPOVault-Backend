import { Module } from '@nestjs/common';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentController } from './allotment.controller';
import { AllotmentJobService } from './allotment-job.service';
import { AllotmentIntelligenceService } from './allotment-intelligence.service';
import { AllotmentRepository } from './allotment.repository';
import { AllotmentService } from './allotment.service';
import { RegistrarResolver } from './registrar.resolver';

import { KfinIdentityDiscoveryAdapter } from './discovery/kfin-identity-discovery.adapter';
import { SourceIdentitySyncService } from './discovery/source-identity-sync.service';

@Module({
  controllers: [AllotmentController],
  providers: [
    AllotmentService,
    AllotmentJobService,
    AllotmentIntelligenceService,
    AllotmentRepository,
    RegistrarResolver,
    RegistrarAdapterRegistry,
    KfinRegistrarAdapter,
    MufgIntimeRegistrarAdapter,
    MaashitlaRegistrarAdapter,
    SkylineRegistrarAdapter,
    KfinIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
  ],
  exports: [
    AllotmentService,
    AllotmentJobService,
    AllotmentIntelligenceService,
    AllotmentRepository,
    RegistrarResolver,
    RegistrarAdapterRegistry,
    KfinIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
  ],
})
export class AllotmentModule {}
