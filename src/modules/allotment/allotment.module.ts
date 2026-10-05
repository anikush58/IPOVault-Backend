import { forwardRef, Module } from '@nestjs/common';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { MaashitlaRegistrarAdapter } from './adapters/maashitla-registrar.adapter';
import { SkylineRegistrarAdapter } from './adapters/skyline-registrar.adapter';
import { PurvaRegistrarAdapter } from './adapters/purva-registrar.adapter';
import { BigshareRegistrarAdapter } from './adapters/bigshare-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentController } from './allotment.controller';
import { AllotmentJobService } from './allotment-job.service';
import { AllotmentIntelligenceService } from './allotment-intelligence.service';
import { AllotmentRepository } from './allotment.repository';
import { AllotmentService } from './allotment.service';
import { RegistrarResolver } from './registrar.resolver';

import { KfinIdentityDiscoveryAdapter } from './discovery/kfin-identity-discovery.adapter';
import { MufgIdentityDiscoveryAdapter } from './discovery/mufg-identity-discovery.adapter';
import { SourceIdentitySyncService } from './discovery/source-identity-sync.service';
import { RegistrarIdentitySyncSchedulerService } from './discovery/registrar-identity-sync-scheduler.service';
import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [forwardRef(() => NotificationModule)],
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
    PurvaRegistrarAdapter,
    BigshareRegistrarAdapter,
    KfinIdentityDiscoveryAdapter,
    MufgIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
    RegistrarIdentitySyncSchedulerService,
  ],
  exports: [
    AllotmentService,
    AllotmentJobService,
    AllotmentIntelligenceService,
    AllotmentRepository,
    RegistrarResolver,
    RegistrarAdapterRegistry,
    KfinIdentityDiscoveryAdapter,
    MufgIdentityDiscoveryAdapter,
    SourceIdentitySyncService,
    RegistrarIdentitySyncSchedulerService,
  ],
})
export class AllotmentModule {}
