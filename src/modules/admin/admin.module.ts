import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { AdminIpoController } from './admin-ipo.controller';
import { AdminIpoService } from './admin-ipo.service';
import { AdminExtractionService } from './admin-extraction.service';
import { AdminValidationService } from './admin-validation.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [AdminIpoController],
  providers: [
    AdminIpoService,
    AdminExtractionService,
    AdminValidationService,
    AdminGuard,
  ],
  exports: [AdminIpoService, AdminValidationService, AdminGuard],
})
export class AdminModule {}
