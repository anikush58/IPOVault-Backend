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

  /**
   * Retrieves all registered users from Firebase Authentication by paginating through all pages.
   * Handles pagination beyond the first 1,000 users using pageToken.
   */
  async listAllUsers(): Promise<
    Array<{
      uid: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
      disabled?: boolean;
      creationTime?: string;
      lastSignInTime?: string;
    }>
  > {
    if (this.firebaseApp) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const auth = getAuth(this.firebaseApp);
        const allUsers: Array<{
          uid: string;
          email?: string;
          displayName?: string;
          emailVerified?: boolean;
          disabled?: boolean;
          creationTime?: string;
          lastSignInTime?: string;
        }> = [];
        let nextPageToken: string | undefined = undefined;

        do {
          const listResult = await auth.listUsers(1000, nextPageToken);
          for (const u of listResult.users) {
            allUsers.push({
              uid: u.uid,
              email: u.email,
              displayName: u.displayName,
              emailVerified: u.emailVerified,
              disabled: u.disabled,
              creationTime: u.metadata?.creationTime,
              lastSignInTime: u.metadata?.lastSignInTime,
            });
          }
          nextPageToken = listResult.pageToken;
        } while (nextPageToken);

        return allUsers;
      } catch (err: any) {
        this.logger.error(`Failed to list all users from Firebase: ${err.message}`);
        throw new AppException(
          ErrorCode.INTERNAL_ERROR,
          `Failed to retrieve registered users from Firebase: ${err.message}`,
          500,
        );
      }
    }

    if (this.isTestMode) {
      const mockResult = await this.listUsers();
      return mockResult.users;
    }

    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      'Firebase Admin authentication service is not configured on server',
      500,
    );
  }

  /**
   * Retrieves a list of users from Firebase Authentication.
   * In non-production test mode without Firebase configured, returns deterministic mock users.
   */
  async listUsers(maxResults = 1000, pageToken?: string): Promise<{
    users: Array<{
      uid: string;
      email?: string;
      displayName?: string;
      emailVerified?: boolean;
      disabled?: boolean;
      creationTime?: string;
      lastSignInTime?: string;
    }>;
    pageToken?: string;
  }> {
    if (this.firebaseApp) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const listResult = await getAuth(this.firebaseApp).listUsers(
          maxResults,
          pageToken,
        );
        return {
          users: listResult.users.map((u) => ({
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            emailVerified: u.emailVerified,
            disabled: u.disabled,
            creationTime: u.metadata?.creationTime,
            lastSignInTime: u.metadata?.lastSignInTime,
          })),
          pageToken: listResult.pageToken,
        };
      } catch (err: any) {
        this.logger.error(`Failed to list users from Firebase: ${err.message}`);
        if (!this.isTestMode) {
          throw new AppException(
            ErrorCode.INTERNAL_ERROR,
            `Failed to list users from Firebase: ${err.message}`,
            500,
          );
        }
      }
    }

    // Fallback in test / dev mode
    if (this.isTestMode) {
      return {
        users: [
          {
            uid: 'user-default-1',
            email: 'investor@ipovault.in',
            displayName: 'Investor One',
            emailVerified: true,
            disabled: false,
            creationTime: '2026-09-01T10:00:00.000Z',
            lastSignInTime: '2026-10-15T18:30:00.000Z',
          },
          {
            uid: 'user-default-2',
            email: 'trader@ipovault.in',
            displayName: 'Alpha Trader',
            emailVerified: true,
            disabled: false,
            creationTime: '2026-09-15T12:00:00.000Z',
            lastSignInTime: '2026-10-14T09:15:00.000Z',
          },
          {
            uid: 'user-default-3',
            email: 'retail@ipovault.in',
            displayName: 'Retail Explorer',
            emailVerified: false,
            disabled: false,
            creationTime: '2026-10-01T08:00:00.000Z',
            lastSignInTime: '2026-10-12T14:20:00.000Z',
          },
        ],
      };
    }

    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      'Firebase Admin authentication service is not configured on server',
      500,
    );
  }

  /**
   * Retrieves single user record from Firebase Authentication.
   */
  async getUser(uid: string): Promise<{
    uid: string;
    email?: string;
    displayName?: string;
    creationTime?: string;
    lastSignInTime?: string;
  } | null> {
    if (this.firebaseApp) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        const u = await getAuth(this.firebaseApp).getUser(uid);
        return {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          creationTime: u.metadata?.creationTime,
          lastSignInTime: u.metadata?.lastSignInTime,
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Optionally updates custom claims on Firebase Auth user.
   */
  async setCustomUserClaims(
    uid: string,
    claims: Record<string, any> | null,
  ): Promise<void> {
    if (this.firebaseApp) {
      try {
        const { getAuth } = await import('firebase-admin/auth');
        await getAuth(this.firebaseApp).setCustomUserClaims(uid, claims);
      } catch (err: any) {
        this.logger.warn(
          `Failed to set custom claims for user ${uid}: ${err.message}`,
        );
      }
    }
  }
}
