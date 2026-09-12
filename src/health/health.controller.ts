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
import {
  DiscoverySchedulerHealth,
  DiscoverySchedulerService,
} from '../modules/discovery/discovery-scheduler.service';

@Controller()
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly discoverySchedulerService: DiscoverySchedulerService,
  ) {}

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

  @Get('health/discovery')
  getDiscoveryHealth(): DiscoverySchedulerHealth {
    return this.discoverySchedulerService.getHealth();
  }
}
