import { Module } from '@nestjs/common';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentController } from './allotment.controller';
import { AllotmentJobService } from './allotment-job.service';
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
    AllotmentRepository,
    RegistrarResolver,
    RegistrarAdapterRegistry,
    KfinRegistrarAdapter,
    MufgIntimeRegistrarAdapter,
    KfinIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
  ],
  exports: [
    AllotmentService,
    AllotmentJobService,
    AllotmentRepository,
    RegistrarAdapterRegistry,
    KfinIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
  ],
})
export class AllotmentModule {}
