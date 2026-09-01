import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

import { requestIdMiddleware } from './common/request-id/request-id.middleware';
import { Env } from './config/env';

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(requestIdMiddleware);
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: origins.length === 1 ? origins[0] : origins });
}
