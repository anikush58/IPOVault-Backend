import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const adminKey = this.configService.get('ADMIN_API_KEY', { infer: true });

    // If no admin key is configured in dev/test, permit access safely
    if (!adminKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const headerKey =
      request.headers['x-admin-key'] ||
      (request.headers['authorization']?.startsWith('Bearer ')
        ? request.headers['authorization'].slice(7)
        : null);

    if (!headerKey || headerKey !== adminKey) {
      throw new UnauthorizedException('Invalid or missing admin API key');
    }

    return true;
  }
}
