import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AllotmentModule } from '../allotment/allotment.module';
import { NotificationModule } from '../notifications/notification.module';
import { IpoController } from './ipo.controller';
import { IpoRepository } from './ipo.repository';
import { IpoService } from './ipo.service';
import { IpoTimelineSchedulerService } from './ipo-timeline-scheduler.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule, AllotmentModule, NotificationModule],
  controllers: [IpoController],
  providers: [IpoService, IpoRepository, IpoTimelineSchedulerService],
  exports: [IpoService, IpoRepository, IpoTimelineSchedulerService],
})
export class IposModule {}
