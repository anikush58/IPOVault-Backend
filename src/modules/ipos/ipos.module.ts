import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IpoController } from './ipo.controller';
import { IpoRepository } from './ipo.repository';
import { IpoService } from './ipo.service';

@Module({
  imports: [DatabaseModule, DiscoveryModule],
  controllers: [IpoController],
  providers: [IpoService, IpoRepository],
})
export class IposModule {}
