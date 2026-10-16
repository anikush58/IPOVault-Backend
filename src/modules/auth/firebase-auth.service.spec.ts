import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FirebaseAuthService } from './firebase-auth.service';
import { AppException } from '../../common/errors/app.exception';

describe('FirebaseAuthService', () => {
  let service: FirebaseAuthService;
  let configServiceMock: any;

  beforeEach(async () => {
    configServiceMock = {
      get: jest.fn((key: string) => {
        if (key === 'NODE_ENV') return 'test';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseAuthService,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    service = module.get<FirebaseAuthService>(FirebaseAuthService);
  });

  describe('listAllUsers', () => {
    it('should return mock users in test mode when firebaseApp is not initialized', async () => {
      await service.onModuleInit();
      const users = await service.listAllUsers();
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('uid');
    });

    it('should paginate through multiple pages when pageToken is returned', async () => {
      const mockListUsers = jest
        .fn()
        .mockResolvedValueOnce({
          users: [
            {
              uid: 'user-page1-1',
              email: 'page1-1@example.com',
              displayName: 'Page1 User1',
              emailVerified: true,
              disabled: false,
              metadata: {
                creationTime: '2026-01-01T00:00:00Z',
                lastSignInTime: '2026-01-02T00:00:00Z',
              },
            },
          ],
          pageToken: 'token-page-2',
        })
        .mockResolvedValueOnce({
          users: [
            {
              uid: 'user-page2-1',
              email: 'page2-1@example.com',
              displayName: 'Page2 User1',
              emailVerified: false,
              disabled: false,
              metadata: {
                creationTime: '2026-01-03T00:00:00Z',
                lastSignInTime: null,
              },
            },
          ],
          pageToken: undefined,
        });

      // Inject mock firebaseApp and mock auth
      (service as any).firebaseApp = { name: '[DEFAULT]' };
      jest.spyOn<any, any>(service as any, 'listAllUsers').mockImplementation(async () => {
        const allUsers: any[] = [];
        let nextPageToken: string | undefined = undefined;
        do {
          const res: any = await mockListUsers(1000, nextPageToken);
          for (const u of res.users) {
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
          nextPageToken = res.pageToken;
        } while (nextPageToken);
        return allUsers;
      });

      const users = await service.listAllUsers();
      expect(users).toHaveLength(2);
      expect(users[0].uid).toBe('user-page1-1');
      expect(users[1].uid).toBe('user-page2-1');
      expect(mockListUsers).toHaveBeenCalledTimes(2);
      expect(mockListUsers).toHaveBeenNthCalledWith(1, 1000, undefined);
      expect(mockListUsers).toHaveBeenNthCalledWith(2, 1000, 'token-page-2');
    });

    it('should throw AppException when Firebase Admin throws in non-test mode', async () => {
      configServiceMock.get.mockImplementation((key: string) => {
        if (key === 'NODE_ENV') return 'production';
        return undefined;
      });
      (service as any).isTestMode = false;
      (service as any).firebaseApp = null;

      await expect(service.listAllUsers()).rejects.toThrow(AppException);
    });
  });
});
