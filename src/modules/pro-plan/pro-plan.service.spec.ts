import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProPlanService } from './pro-plan.service';
import { PrismaService } from '../../database/prisma.service';

describe('ProPlanService', () => {
  let service: ProPlanService;
  let prismaMock: {
    proPlan: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    proPlanBenefit: {
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    userEntitlement: {
      update: jest.Mock;
      create: jest.Mock;
    };
    userEntitlementAuditLog: {
      create: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const sampleBenefit = {
    id: 'benefit-1',
    planId: 'plan-uuid-1',
    title: 'Record IPO Applications',
    description: 'Track applications locally across family members',
    icon: 'layers',
    displayOrder: 1,
    createdAt: new Date('2026-10-19T10:00:00Z'),
    updatedAt: new Date('2026-10-19T10:00:00Z'),
  };

  const samplePlan = {
    id: 'plan-uuid-1',
    code: 'pro_monthly',
    name: 'Monthly Pro',
    description: 'Flexible monthly subscription',
    duration: 'Monthly',
    durationDays: 30,
    priceInr: new Prisma.Decimal('499.00'),
    comparisonPriceInr: new Prisma.Decimal('699.00'),
    status: 'PUBLISHED' as const,
    displayOrder: 1,
    isPopular: false,
    badge: null,
    features: ['Record IPO Applications'],
    createdAt: new Date('2026-10-19T10:00:00Z'),
    updatedAt: new Date('2026-10-19T10:00:00Z'),
    archivedAt: null,
    benefits: [sampleBenefit],
  };

  beforeEach(async () => {
    prismaMock = {
      proPlan: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      proPlanBenefit: {
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
      userEntitlement: {
        update: jest.fn(),
        create: jest.fn(),
      },
      userEntitlementAuditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => {
        return cb(prismaMock);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProPlanService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ProPlanService>(ProPlanService);
  });

  describe('listAdminPlans & Stable Ordering', () => {
    it('returns all plans sorted deterministically by displayOrder ASC, createdAt ASC', async () => {
      const plan2 = {
        ...samplePlan,
        id: 'plan-uuid-2',
        code: 'pro_annual',
        name: 'Annual Pro',
        displayOrder: 2,
        benefits: [],
      };

      prismaMock.proPlan.findMany.mockResolvedValue([samplePlan, plan2]);

      const result = await service.listAdminPlans();

      expect(prismaMock.proPlan.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: { benefits: { orderBy: { displayOrder: 'asc' } } },
      });
      expect(result).toHaveLength(2);
      expect(result[0].code).toBe('pro_monthly');
      expect(result[1].code).toBe('pro_annual');
    });

    it('filters plans by status when specified', async () => {
      prismaMock.proPlan.findMany.mockResolvedValue([samplePlan]);

      await service.listAdminPlans({ status: 'PUBLISHED' });

      expect(prismaMock.proPlan.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'PUBLISHED' }),
        }),
      );
    });
  });

  describe('createPlan', () => {
    it('creates a new plan with ordered benefits transactionally', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(null);
      prismaMock.proPlan.create.mockResolvedValue(samplePlan);

      const dto = {
        code: 'pro_monthly',
        name: 'Monthly Pro',
        duration: 'Monthly',
        durationDays: 30,
        priceInr: 499,
        comparisonPriceInr: 699,
        displayOrder: 1,
        benefits: [
          {
            title: 'Record IPO Applications',
            description: 'Track applications locally across family members',
            icon: 'layers',
            displayOrder: 1,
          },
        ],
      };

      const result = await service.createPlan(dto);

      expect(prismaMock.proPlan.create).toHaveBeenCalled();
      expect(result.code).toBe('pro_monthly');
      expect(result.priceInr).toBe(499);
      expect(result.comparisonPriceInr).toBe(699);
    });

    it('throws ConflictException if plan code already exists', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(samplePlan);

      await expect(
        service.createPlan({
          code: 'pro_monthly',
          name: 'Another Monthly',
          duration: 'Monthly',
          priceInr: 499,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updatePlan', () => {
    it('updates plan fields and replaces benefits in transaction', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(samplePlan);
      const updatedPlan = {
        ...samplePlan,
        name: 'Monthly Pro Plan (Updated)',
        priceInr: new Prisma.Decimal('599.00'),
      };
      prismaMock.proPlan.update.mockResolvedValue(updatedPlan);

      const result = await service.updatePlan('plan-uuid-1', {
        name: 'Monthly Pro Plan (Updated)',
        priceInr: 599,
        benefits: [
          {
            title: 'Updated Benefit Title',
            description: 'New benefit desc',
            icon: 'shield',
            displayOrder: 1,
          },
        ],
      });

      expect(prismaMock.proPlanBenefit.deleteMany).toHaveBeenCalledWith({
        where: { planId: 'plan-uuid-1' },
      });
      expect(prismaMock.proPlanBenefit.createMany).toHaveBeenCalledWith({
        data: [
          {
            planId: 'plan-uuid-1',
            title: 'Updated Benefit Title',
            description: 'New benefit desc',
            icon: 'shield',
            displayOrder: 1,
          },
        ],
      });
      expect(result.name).toBe('Monthly Pro Plan (Updated)');
      expect(result.priceInr).toBe(599);
    });

    it('throws NotFoundException if plan does not exist', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePlan('non-existent-uuid', { name: 'Non Existent' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Publish, Unpublish & Soft Archive', () => {
    it('publishPlan sets status to PUBLISHED and clears archivedAt', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue({
        ...samplePlan,
        status: 'DRAFT',
      });
      prismaMock.proPlan.update.mockResolvedValue({
        ...samplePlan,
        status: 'PUBLISHED',
        archivedAt: null,
      });

      const res = await service.publishPlan('plan-uuid-1');

      expect(prismaMock.proPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-uuid-1' },
          data: { status: 'PUBLISHED', archivedAt: null },
        }),
      );
      expect(res.status).toBe('PUBLISHED');
    });

    it('unpublishPlan sets status to DRAFT', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(samplePlan);
      prismaMock.proPlan.update.mockResolvedValue({
        ...samplePlan,
        status: 'DRAFT',
      });

      const res = await service.unpublishPlan('plan-uuid-1');

      expect(prismaMock.proPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-uuid-1' },
          data: { status: 'DRAFT' },
        }),
      );
      expect(res.status).toBe('DRAFT');
    });

    it('archivePlan performs soft-archive with status ARCHIVED and archivedAt timestamp', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(samplePlan);
      prismaMock.proPlan.update.mockResolvedValue({
        ...samplePlan,
        status: 'ARCHIVED',
        archivedAt: new Date('2026-10-19T12:00:00Z'),
      });

      const res = await service.archivePlan('plan-uuid-1');

      expect(prismaMock.proPlan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-uuid-1' },
          data: expect.objectContaining({ status: 'ARCHIVED' }),
        }),
      );
      expect(res.status).toBe('ARCHIVED');
    });
  });

  describe('Mobile-Facing listPublishedPlans', () => {
    it('returns ONLY published plans, strips internal administrative fields, and formats prices', async () => {
      prismaMock.proPlan.findMany.mockResolvedValue([samplePlan]);

      const mobilePlans = await service.listPublishedPlans();

      expect(prismaMock.proPlan.findMany).toHaveBeenCalledWith({
        where: { status: 'PUBLISHED' },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: { benefits: { orderBy: { displayOrder: 'asc' } } },
      });

      expect(mobilePlans).toHaveLength(1);
      const plan = mobilePlans[0];
      expect(plan.id).toBe('plan-uuid-1');
      expect(plan.code).toBe('pro_monthly');
      expect(plan.name).toBe('Monthly Pro');
      expect(plan.priceInr).toBe(499);
      expect(plan.comparisonPriceInr).toBe(699);
      expect(plan.duration).toBe('Monthly');
      expect(plan.benefits).toHaveLength(1);
      expect(plan.benefits[0].title).toBe('Record IPO Applications');

      // Verify NO administrative fields leaked
      expect((plan as any).createdAt).toBeUndefined();
      expect((plan as any).updatedAt).toBeUndefined();
      expect((plan as any).archivedAt).toBeUndefined();
      expect((plan as any).status).toBeUndefined();
    });
  });

  describe('CRITICAL SECURITY: Entitlement Isolation Guarantee', () => {
    it('creating, updating, publishing, or archiving plans NEVER modifies user entitlements or audit logs', async () => {
      prismaMock.proPlan.findUnique.mockResolvedValue(null);
      prismaMock.proPlan.create.mockResolvedValue(samplePlan);

      await service.createPlan({
        code: 'pro_monthly',
        name: 'Monthly Pro',
        duration: 'Monthly',
        priceInr: 499,
      });

      prismaMock.proPlan.findUnique.mockResolvedValue(samplePlan);
      prismaMock.proPlan.update.mockResolvedValue(samplePlan);

      await service.updatePlan('plan-uuid-1', { priceInr: 599 });
      await service.publishPlan('plan-uuid-1');
      await service.unpublishPlan('plan-uuid-1');
      await service.archivePlan('plan-uuid-1');

      // Strictly verify that UserEntitlement and UserEntitlementAuditLog were NEVER touched
      expect(prismaMock.userEntitlement.update).not.toHaveBeenCalled();
      expect(prismaMock.userEntitlement.create).not.toHaveBeenCalled();
      expect(prismaMock.userEntitlementAuditLog.create).not.toHaveBeenCalled();
    });
  });
});
