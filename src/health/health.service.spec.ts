import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';

describe('HealthService', () => {
  it('returns liveness status without database query', () => {
    const prisma = { $queryRaw: jest.fn() };
    const service = new HealthService(prisma as unknown as PrismaService);

    expect(service.checkLiveness()).toEqual({
      status: 'ok',
      database: 'up',
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns readiness status when PostgreSQL responds', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('propagates database errors during readiness check for controller to map to 503', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.checkReadiness()).rejects.toThrow(
      'connect ECONNREFUSED',
    );
  });
});
