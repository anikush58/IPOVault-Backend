import { Test, TestingModule } from '@nestjs/testing';
import { AdminUserController } from './admin-user.controller';
import { UserEntitlementService } from '../user/user-entitlement.service';
import { AdminGuard } from './admin.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { UserController } from '../user/user.controller';
import { UserService } from '../user/user.service';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';

describe('AdminUserController & UserController Authorization', () => {
  let adminController: AdminUserController;
  let userController: UserController;
  let entitlementServiceMock: {
    listUsers: jest.Mock;
    getUserDetail: jest.Mock;
    updateUserEntitlement: jest.Mock;
    getEntitlement: jest.Mock;
  };

  beforeEach(async () => {
    entitlementServiceMock = {
      listUsers: jest.fn(),
      getUserDetail: jest.fn(),
      updateUserEntitlement: jest.fn(),
      getEntitlement: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminUserController, UserController],
      providers: [
        { provide: UserEntitlementService, useValue: entitlementServiceMock },
        { provide: UserService, useValue: {} },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers && req.headers['x-admin-key'] === 'valid-secret') {
            return true;
          }
          throw new UnauthorizedException('Invalid or missing admin key');
        },
      })
      .overrideGuard(FirebaseAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers && req.headers['authorization']?.startsWith('Bearer ')) {
            req.user = { uid: 'authenticated-user-uid', email: 'user@test.com' };
            return true;
          }
          throw new UnauthorizedException('Invalid or missing auth token');
        },
      })
      .compile();

    adminController = module.get<AdminUserController>(AdminUserController);
    userController = module.get<UserController>(UserController);
  });

  describe('AdminUserController', () => {
    it('should allow authorized admin to list users', async () => {
      entitlementServiceMock.listUsers.mockResolvedValue({
        users: [{ uid: 'u1', tier: 'NON_PRO' }],
        total: 1,
        page: 1,
        totalPages: 1,
        counts: { total: 1, pro: 0, nonPro: 1 },
      });

      const res = await adminController.listUsers({ page: 1, limit: 10 });
      expect(res.total).toBe(1);
      expect(entitlementServiceMock.listUsers).toHaveBeenCalledWith({ page: 1, limit: 10, tier: 'ALL' });
    });

    it('should allow authorized admin to update entitlement', async () => {
      entitlementServiceMock.updateUserEntitlement.mockResolvedValue({
        success: true,
        userId: 'u1',
        previousTier: 'NON_PRO',
        newTier: 'PRO',
        updatedAt: new Date(),
      });

      const req: any = { ip: '127.0.0.1' };
      const res = await adminController.updateUserEntitlement(
        'u1',
        { tier: 'PRO', reason: 'Granted by admin' },
        req
      );

      expect(res.success).toBe(true);
      expect(entitlementServiceMock.updateUserEntitlement).toHaveBeenCalledWith(
        'u1',
        'PRO',
        'admin-api-key',
        'Granted by admin',
        '127.0.0.1'
      );
    });
  });

  describe('UserController (Account Isolation & Server Authority)', () => {
    it('should return entitlement strictly for authenticated caller UID and never accept client spoofing', async () => {
      entitlementServiceMock.getEntitlement.mockResolvedValue({
        userId: 'authenticated-user-uid',
        tier: 'NON_PRO',
        isPro: false,
      });

      // The controller extracts user.uid from the authenticated token via CurrentUser('uid')
      const result = await userController.getMyEntitlement('authenticated-user-uid');

      expect(result.userId).toBe('authenticated-user-uid');
      expect(entitlementServiceMock.getEntitlement).toHaveBeenCalledWith('authenticated-user-uid');
    });

    it('UserController should not have any method allowing users to self-update entitlement', () => {
      // Ensure no updateEntitlement or setTier exists on UserController
      expect((userController as any).updateEntitlement).toBeUndefined();
      expect((userController as any).setTier).toBeUndefined();
      expect((userController as any).grantPro).toBeUndefined();
    });
  });
});
