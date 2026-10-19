import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminProPlanController } from './admin-pro-plan.controller';
import { PublicProPlanController } from './public-pro-plan.controller';
import { ProPlanService } from './pro-plan.service';
import { AdminGuard } from '../admin/admin.guard';

describe('AdminProPlanController & PublicProPlanController', () => {
  let adminController: AdminProPlanController;
  let publicController: PublicProPlanController;
  let proPlanServiceMock: {
    listAdminPlans: jest.Mock;
    getPlanById: jest.Mock;
    createPlan: jest.Mock;
    updatePlan: jest.Mock;
    publishPlan: jest.Mock;
    unpublishPlan: jest.Mock;
    archivePlan: jest.Mock;
    listPublishedPlans: jest.Mock;
  };

  const sampleMobilePlan = {
    id: 'plan-uuid-1',
    code: 'pro_monthly',
    name: 'Monthly Pro',
    description: 'Flexible monthly subscription',
    duration: 'Monthly',
    durationDays: 30,
    priceInr: 499,
    comparisonPriceInr: 699,
    isPopular: false,
    badge: null,
    displayOrder: 1,
    features: ['Record IPO Applications'],
    benefits: [
      {
        id: 'benefit-1',
        title: 'Record IPO Applications',
        description: 'Track applications locally',
        icon: 'layers',
        displayOrder: 1,
      },
    ],
  };

  beforeEach(async () => {
    proPlanServiceMock = {
      listAdminPlans: jest.fn(),
      getPlanById: jest.fn(),
      createPlan: jest.fn(),
      updatePlan: jest.fn(),
      publishPlan: jest.fn(),
      unpublishPlan: jest.fn(),
      archivePlan: jest.fn(),
      listPublishedPlans: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminProPlanController, PublicProPlanController],
      providers: [
        { provide: ProPlanService, useValue: proPlanServiceMock },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers && req.headers['x-admin-key'] === 'valid-admin-secret') {
            return true;
          }
          throw new UnauthorizedException('Invalid or missing admin key');
        },
      })
      .compile();

    adminController = module.get<AdminProPlanController>(AdminProPlanController);
    publicController = module.get<PublicProPlanController>(PublicProPlanController);
  });

  describe('Admin Authorization & Controller Endpoints', () => {
    it('allows admin CRUD and publishing operations when valid admin key is provided', async () => {
      proPlanServiceMock.listAdminPlans.mockResolvedValue([sampleMobilePlan]);
      proPlanServiceMock.createPlan.mockResolvedValue(sampleMobilePlan);
      proPlanServiceMock.publishPlan.mockResolvedValue({ ...sampleMobilePlan, status: 'PUBLISHED' });
      proPlanServiceMock.unpublishPlan.mockResolvedValue({ ...sampleMobilePlan, status: 'DRAFT' });
      proPlanServiceMock.archivePlan.mockResolvedValue({ ...sampleMobilePlan, status: 'ARCHIVED' });

      const list = await adminController.listPlans({});
      expect(list).toHaveLength(1);

      const created = await adminController.createPlan({
        code: 'pro_monthly',
        name: 'Monthly Pro',
        duration: 'Monthly',
        priceInr: 499,
      });
      expect(created.code).toBe('pro_monthly');

      const pub = await adminController.publishPlan('plan-uuid-1');
      expect(pub.status).toBe('PUBLISHED');

      const unpub = await adminController.unpublishPlan('plan-uuid-1');
      expect(unpub.status).toBe('DRAFT');

      const archived = await adminController.archivePlan('plan-uuid-1');
      expect(archived.status).toBe('ARCHIVED');
    });

    it('rejects plan creation with invalid code format or negative price via Zod schema', async () => {
      await expect(
        adminController.createPlan({
          code: 'INVALID CODE WITH SPACES',
          name: 'Invalid Plan',
          duration: 'Monthly',
          priceInr: 499,
        }),
      ).rejects.toThrow();

      await expect(
        adminController.createPlan({
          code: 'valid_code',
          name: 'Negative Price Plan',
          duration: 'Monthly',
          priceInr: -50,
        }),
      ).rejects.toThrow();
    });
  });

  describe('Public Mobile Controller', () => {
    it('returns published plans from service without requiring admin authentication', async () => {
      proPlanServiceMock.listPublishedPlans.mockResolvedValue([sampleMobilePlan]);

      const plans = await publicController.getPublishedPlans();

      expect(proPlanServiceMock.listPublishedPlans).toHaveBeenCalled();
      expect(plans).toHaveLength(1);
      expect(plans[0].code).toBe('pro_monthly');
      expect(plans[0].priceInr).toBe(499);
      expect(plans[0].benefits).toHaveLength(1);
    });
  });
});
