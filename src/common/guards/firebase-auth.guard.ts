import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { FirebaseAuthService } from '../../modules/auth/firebase-auth.service';
import { AuthenticatedUser } from '../../modules/auth/auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly firebaseAuthService: FirebaseAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authorization header with Bearer token is required',
        401,
      );
    }

    const trimmed = authHeader.trim();
    if (!trimmed.toLowerCase().startsWith('bearer ')) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Invalid Authorization format. Expected Bearer <token>',
        401,
      );
    }

    const token = trimmed.slice(7).trim();
    if (!token) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Firebase Bearer token is empty',
        401,
      );
    }

    // Cryptographically verify the token and derive user UID strictly from the token
    const user = await this.firebaseAuthService.verifyIdToken(token);
    request.user = user;

    return true;
  }
}
