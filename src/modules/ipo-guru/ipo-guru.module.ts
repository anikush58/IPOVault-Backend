import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IpoGuruService } from './ipo-guru.service';
import { IpoGuruSchedulerService } from './ipo-guru-scheduler.service';

@Module({
  imports: [DatabaseModule],
  providers: [IpoGuruService, IpoGuruSchedulerService],
  exports: [IpoGuruService, IpoGuruSchedulerService],
})
export class IpoGuruModule {}
