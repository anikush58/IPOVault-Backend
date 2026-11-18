import express from 'express';
import { join } from 'path';
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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

  // Serve static Web Admin Portal at /admin
  app.use('/admin', express.static(join(process.cwd(), 'public', 'admin')));

  // Serve public Account Deletion Portal at /delete-account (Google Play Compliance)
  app.use(
    '/delete-account',
    express.static(join(process.cwd(), 'public', 'delete-account')),
  );

  // Serve public Terms of Service at /terms (Google Play Compliance)
  app.use(
    '/terms',
    express.static(join(process.cwd(), 'public', 'terms')),
  );

  // Serve app-ads.txt for Google AdMob crawlers and developer domain verification
  app.use('/app-ads.txt', (_req: express.Request, res: express.Response) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('google.com, pub-3768316467682663, DIRECT, f08c47fec0942fa0\n');
  });

  // Redirect /console to /api/v1/console
  app.use('/console', (req: express.Request, res: express.Response) => {
    res.redirect(301, '/api/v1/console' + (req.url === '/' ? '' : req.url));
  });

  app.setGlobalPrefix('api/v1');
  const isDev = config.get('NODE_ENV', { infer: true }) === 'development';
  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, origin?: boolean | string) => void,
    ) => {
      if (!requestOrigin || isDev) {
        return callback(null, true);
      }
      if (origins.includes('*') || origins.includes(requestOrigin)) {
        return callback(null, requestOrigin);
      }
      if (/^https?:\/\/([a-z0-9-]+\.)*getipovault\.in(:[0-9]+)?$/i.test(requestOrigin)) {
        return callback(null, requestOrigin);
      }
      return callback(null, origins.length === 1 ? origins[0] : false);
    },
    credentials: true,
  });
}
