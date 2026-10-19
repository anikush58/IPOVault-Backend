import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProPlanService } from './pro-plan.service';
import { AdminProPlanController } from './admin-pro-plan.controller';
import { PublicProPlanController } from './public-pro-plan.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminProPlanController, PublicProPlanController],
  providers: [ProPlanService],
  exports: [ProPlanService],
})
export class ProPlanModule {}
