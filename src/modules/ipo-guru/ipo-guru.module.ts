import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { IpoGuruService } from './ipo-guru.service';
import { IpoGuruSchedulerService } from './ipo-guru-scheduler.service';

@Module({
  imports: [DatabaseModule, EnrichmentModule],
  providers: [IpoGuruService, IpoGuruSchedulerService],
  exports: [IpoGuruService, IpoGuruSchedulerService],
})
export class IpoGuruModule {}
