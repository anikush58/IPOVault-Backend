import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { AdminIpoController } from './admin-ipo.controller';
import { AdminIpoService } from './admin-ipo.service';
import { AdminValidationService } from './admin-validation.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [AdminIpoController],
  providers: [
    AdminIpoService,
    AdminValidationService,
    AdminGuard,
  ],
  exports: [AdminIpoService, AdminValidationService, AdminGuard],
})
export class AdminModule {}
