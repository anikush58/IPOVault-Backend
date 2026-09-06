import { Module } from '@nestjs/common';
import { KfinRegistrarAdapter } from './adapters/kfin-registrar.adapter';
import { MufgIntimeRegistrarAdapter } from './adapters/mufg-intime-registrar.adapter';
import { RegistrarAdapterRegistry } from './adapters/registrar-adapter.registry';
import { AllotmentController } from './allotment.controller';
import { AllotmentJobService } from './allotment-job.service';
import { AllotmentRepository } from './allotment.repository';
import { AllotmentService } from './allotment.service';
import { RegistrarResolver } from './registrar.resolver';

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
  ],
  exports: [
    AllotmentService,
    AllotmentJobService,
    AllotmentRepository,
    RegistrarAdapterRegistry,
  ],
})
export class AllotmentModule {}
