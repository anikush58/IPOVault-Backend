import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IposModule } from '../ipos/ipos.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { NotificationModule } from '../notifications/notification.module';
import { AllotmentModule } from '../allotment/allotment.module';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';

@Module({
  imports: [
    DatabaseModule,
    IposModule,
    AnalyticsModule,
    DiscoveryModule,
    NotificationModule,
    AllotmentModule,
  ],
  controllers: [ConsoleController],
  providers: [ConsoleService],
  exports: [ConsoleService],
})
export class ConsoleModule {}
