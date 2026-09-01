import { HealthService } from './health.service';
import { PrismaService } from '../database/prisma.service';

describe('HealthService', () => {
  it('returns ok when PostgreSQL responds', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('propagates database errors for the controller to map to 503', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    const service = new HealthService(prisma as unknown as PrismaService);

    await expect(service.check()).rejects.toThrow('connect ECONNREFUSED');
  });
});
