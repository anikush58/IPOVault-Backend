import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  app.use(
    (
      _req: unknown,
      res: { setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
      next();
    },
  );
  app.setGlobalPrefix('api/v1');
  const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
  app.enableCors({
    origin: isDev ? true : origins.length === 1 ? origins[0] : origins,
  });
}
