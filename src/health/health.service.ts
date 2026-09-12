import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service';

export type LivenessStatus = {
  status: 'ok';
};

export type ReadinessStatus = {
  status: 'ok';
  database: 'up';
};

export type HealthStatus = LivenessStatus | ReadinessStatus;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  checkLiveness(): LivenessStatus {
    return { status: 'ok' };
  }

  async checkReadiness(): Promise<ReadinessStatus> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'up' };
  }

  async check(): Promise<ReadinessStatus> {
    return this.checkReadiness();
  }
}
