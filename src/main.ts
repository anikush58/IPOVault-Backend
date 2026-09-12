import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableShutdownHooks();
  configureApp(app);

  await app.listen(env.PORT, '127.0.0.1');
  console.log(`Backend server running on http://127.0.0.1:${env.PORT}`);
}

void bootstrap();
