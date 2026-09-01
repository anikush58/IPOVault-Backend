import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma.service';

export const prismaStub = {
  $connect: async () => undefined,
  $disconnect: async () => undefined,
  $queryRaw: async () => [{ '?column?': 1 }],
  onModuleInit: async () => undefined,
  onModuleDestroy: async () => undefined,
};

export async function createTestApp(
  extraControllers: Type<unknown>[] = [],
  prisma: object = prismaStub,
): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleFixture.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
