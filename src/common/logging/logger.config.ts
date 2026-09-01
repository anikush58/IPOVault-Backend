import { ConfigService } from '@nestjs/config';
import { Params } from 'nestjs-pino';

import { Env } from '../../config/env';

export function createLoggerParams(config: ConfigService<Env, true>): Params {
  const nodeEnv = config.get('NODE_ENV', { infer: true });
  const logLevel = config.get('LOG_LEVEL', { infer: true });

  return {
    pinoHttp: {
      level: nodeEnv === 'test' ? 'silent' : logLevel,
      genReqId: (req) => {
        const fromMiddleware =
          'requestId' in req && typeof req.requestId === 'string'
            ? req.requestId
            : undefined;

        return fromMiddleware ?? (req as { id?: string }).id ?? '';
      },
      customProps: (req) => ({
        requestId:
          (req as { requestId?: string }).requestId ??
          (req as { id?: string }).id,
      }),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
        ],
        remove: true,
      },
      transport:
        nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'SYS:standard',
              },
            }
          : undefined,
    },
  };
}
