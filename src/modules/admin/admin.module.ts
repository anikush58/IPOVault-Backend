import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { UserModule } from '../user/user.module';
import { AdminIpoController } from './admin-ipo.controller';
import { AdminUserController } from './admin-user.controller';
import { AdminIpoService } from './admin-ipo.service';
import { AdminValidationService } from './admin-validation.service';
import { AdminProvenanceResolver } from './admin-provenance.resolver';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [DatabaseModule, ConfigModule, EnrichmentModule, UserModule],
  controllers: [AdminIpoController, AdminUserController],
  providers: [
    AdminIpoService,
    AdminValidationService,
    AdminProvenanceResolver,
    AdminGuard,
  ],
  exports: [
    AdminIpoService,
    AdminValidationService,
    AdminProvenanceResolver,
    AdminGuard,
  ],
})
export class AdminModule {}
