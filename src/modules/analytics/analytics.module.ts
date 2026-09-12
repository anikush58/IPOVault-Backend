import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * AnalyticsModule
 *
 * Phase 30.7 Analytics REST API Surface.
 * Exposes read-only analytics capabilities under /api/v1/analytics.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
