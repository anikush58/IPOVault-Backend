import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import * as crypto from 'crypto';
import { Request } from 'express';

export const CONSOLE_SESSION_COOKIE = 'ipovault_console_session';

export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const list: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts[0]?.trim();
    if (key) {
      list[key] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

export function createSessionToken(
  username: string,
  secret: string,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000,
): string {
  const expiresAt = Date.now() + ttlMs;
  const payload = `${username}.${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
): { valid: boolean; username?: string } {
  if (!token || typeof token !== 'string') return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };
  const [username, expiresAtStr, signature] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || Date.now() > expiresAt) return { valid: false };

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${username}.${expiresAtStr}`)
    .digest('hex');

  const bufExpected = Buffer.from(expectedSignature, 'utf8');
  const bufSig = Buffer.from(signature, 'utf8');

  if (bufExpected.length !== bufSig.length) return { valid: false };
  if (!crypto.timingSafeEqual(bufExpected, bufSig)) return { valid: false };

  return { valid: true, username };
}

export function timingSafeCompare(a?: string, b?: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getConsoleSessionSecret(
  configService: ConfigService<Env, true>,
): string {
  const secret = configService.get('CONSOLE_SESSION_SECRET', { infer: true });
  if (secret) {
    return secret;
  }
  const isProd =
    configService.get('NODE_ENV', { infer: true }) === 'production';
  if (isProd) {
    throw new UnauthorizedException(
      'CONSOLE_SESSION_SECRET is required in production',
    );
  }
  return 'ipovault-console-secret-dev';
}

@Injectable()
export class ConsoleEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  canActivate(context?: ExecutionContext): boolean {
    const enabled = this.configService.get('ENABLE_DATA_CONSOLE', {
      infer: true,
    });
    if (enabled === false) {
      throw new NotFoundException('Data console is disabled');
    }

    if (!context) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req) return true;

    const path = req.path || req.url || '';

    // Public console routes (favicon, login endpoint, or initial HTML loader)
    if (
      path.includes('favicon.png') ||
      path.includes('favicon.ico') ||
      path.endsWith('/login') ||
      path.includes('/console/api/login') ||
      path.endsWith('/console') ||
      path.endsWith('/console/')
    ) {
      return true;
    }

    // All operational /api/v1/console/api/* data routes require valid signed session cookie
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies[CONSOLE_SESSION_COOKIE];

    if (!token) {
      throw new UnauthorizedException('Console authentication required');
    }

    const secret = getConsoleSessionSecret(this.configService);

    const verification = verifySessionToken(token, secret);
    if (!verification.valid) {
      throw new UnauthorizedException('Console session expired or invalid');
    }

    return true;
  }
}
