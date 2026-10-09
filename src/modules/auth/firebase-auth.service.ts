import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Env } from '../../config/env';
import { AuthenticatedUser } from './auth.types';

@Injectable()
export class FirebaseAuthService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAuthService.name);
  private firebaseApp: any = null;
  private isTestMode = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.config.get<string>('NODE_ENV', { infer: true });
    this.isTestMode = nodeEnv === 'test';

    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID', {
      infer: true,
    });
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL', {
      infer: true,
    });
    let privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY', {
      infer: true,
    });

    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    try {
      const { initializeApp, cert, getApps } = await import(
        'firebase-admin/app'
      );
      const existingApps = getApps();
      if (existingApps.length > 0) {
        this.firebaseApp = existingApps[0];
        this.logger.log('Firebase Admin already initialized; reusing instance.');
      } else if (projectId && clientEmail && privateKey) {
        this.firebaseApp = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
          projectId,
        });
        this.logger.log(
          `Firebase Admin initialized with service account for project: ${projectId}`,
        );
      } else if (projectId) {
        this.firebaseApp = initializeApp({
          projectId,
        });
        this.logger.log(
          `Firebase Admin initialized with application default credentials for project: ${projectId}`,
        );
      } else if (!this.isTestMode) {
        try {
          this.firebaseApp = initializeApp();
          this.logger.log('Firebase Admin initialized with default credentials.');
        } catch {
          this.logger.warn(
            'Firebase credentials not configured. Production/Staging require FIREBASE_PROJECT_ID.',
          );
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to initialize Firebase Admin: ${msg}`);
      if (!this.isTestMode && nodeEnv === 'production') {
        throw err;
      }
    }
  }

  /**
   * Cryptographically verifies a Firebase ID Token from Authorization header.
   * Derives user identity strictly from the verified token claims.
   */
  async verifyIdToken(token: string): Promise<AuthenticatedUser> {
    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication token is required',
        401,
      );
    }

    const cleanToken = token.trim();

    // In non-production test mode, support mock/test token pattern for deterministic unit & e2e testing
    if (this.isTestMode) {
      if (
        cleanToken.startsWith('test-token:') ||
        cleanToken.startsWith('mock-token:')
      ) {
        const uid = cleanToken.split(':')[1]?.trim();
        if (uid) {
          return {
            uid,
            email: `${uid}@test.ipovault.in`,
            emailVerified: true,
          };
        }
      }
      if (
        cleanToken.startsWith('test-token-') ||
        cleanToken.startsWith('mock-token-')
      ) {
        const uid = cleanToken.replace(/^(test-token-|mock-token-)/, '').trim();
        if (uid) {
          return {
            uid,
            email: `${uid}@test.ipovault.in`,
            emailVerified: true,
          };
        }
      }
    }

    if (!this.firebaseApp) {
      if (this.isTestMode) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'Invalid or unrecognized Firebase ID token',
          401,
        );
      }
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Firebase authentication service is not configured on server',
        401,
      );
    }

    try {
      const { getAuth } = await import('firebase-admin/auth');
      const decoded = await getAuth(this.firebaseApp).verifyIdToken(
        cleanToken,
        true,
      );

      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
        name: decoded.name,
        picture: decoded.picture,
        authTime: decoded.auth_time,
        iss: decoded.iss,
        aud: decoded.aud,
        sub: decoded.sub,
      };
    } catch (err: any) {
      const errorCode = err?.code || '';
      const errorMsg = err?.message || String(err);

      if (errorCode === 'auth/id-token-expired') {
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'Firebase ID token has expired. Please refresh your session.',
          401,
        );
      }

      if (
        errorCode === 'auth/id-token-revoked' ||
        errorCode === 'auth/user-disabled'
      ) {
        throw new AppException(
          ErrorCode.UNAUTHORIZED,
          'Firebase ID token has been revoked or user is disabled.',
          401,
        );
      }

      this.logger.warn(`Firebase token verification failed: ${errorMsg}`);
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Invalid Firebase authentication token',
        401,
      );
    }
  }
}
