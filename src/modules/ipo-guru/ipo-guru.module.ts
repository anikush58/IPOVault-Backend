import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { AdminValidationService } from '../admin/admin-validation.service';
import { IpoGuruService } from './ipo-guru.service';
import { IpoGuruSchedulerService } from './ipo-guru-scheduler.service';

@Module({
  imports: [DatabaseModule, EnrichmentModule],
  providers: [IpoGuruService, IpoGuruSchedulerService, AdminValidationService],
  exports: [IpoGuruService, IpoGuruSchedulerService],
})
export class IpoGuruModule {}
