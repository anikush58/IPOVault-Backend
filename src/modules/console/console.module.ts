import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IposModule } from '../ipos/ipos.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { NotificationModule } from '../notifications/notification.module';
import { AllotmentModule } from '../allotment/allotment.module';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { ConsoleEnabledGuard } from './console.guard';

import { AdminModule } from '../admin/admin.module';
import { IpoGuruModule } from '../ipo-guru/ipo-guru.module';
import { UserModule } from '../user/user.module';
import { ProPlanModule } from '../pro-plan/pro-plan.module';

@Module({
  imports: [
    DatabaseModule,
    IposModule,
    AnalyticsModule,
    DiscoveryModule,
    NotificationModule,
    AllotmentModule,
    AdminModule,
    IpoGuruModule,
    UserModule,
    ProPlanModule,
  ],

  controllers: [ConsoleController],
  providers: [ConsoleService, ConsoleEnabledGuard],
  exports: [ConsoleService],
})
export class ConsoleModule {}
