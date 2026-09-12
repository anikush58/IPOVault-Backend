import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableShutdownHooks();
  configureApp(app);

  await app.listen(env.PORT, '0.0.0.0');
  console.log(`Backend server running on http://0.0.0.0:${env.PORT}`);
}

void bootstrap();
