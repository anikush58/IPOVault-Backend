import { Module } from '@nestjs/common';

import { IpoController } from './ipo.controller';
import { IpoRepository } from './ipo.repository';
import { IpoService } from './ipo.service';

@Module({
  controllers: [IpoController],
  providers: [IpoService, IpoRepository],
})
export class IposModule {}
