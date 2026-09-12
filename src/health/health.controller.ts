import {
  Controller,
  Get,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  HealthService,
  LivenessStatus,
  ReadinessStatus,
} from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('health')
  checkLiveness(): LivenessStatus {
    return this.healthService.checkLiveness();
  }

  @Get('ready')
  async checkReadiness(): Promise<ReadinessStatus> {
    try {
      return await this.healthService.checkReadiness();
    } catch {
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Database is unavailable',
        database: 'down',
      });
    }
  }
}
