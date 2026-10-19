import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateProPlanDto,
  MobileProPlanResponse,
  ProPlanQueryDto,
  UpdateProPlanDto,
} from './dto/pro-plan.dto';

@Injectable()
export class ProPlanService implements OnModuleInit {
  private readonly logger = new Logger(ProPlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultPlansIfEmpty();
  }

  /**
   * Seeds default monthly & annual plans if no plans exist yet.
   * Ensures the mobile app has reliable default plans on first launch.
   */
  async seedDefaultPlansIfEmpty(): Promise<void> {
    try {
      const count = await this.prisma.proPlan.count();
      if (count > 0) return;

      this.logger.log('No Pro Plans found in database. Seeding canonical defaults...');

      const defaultBenefits = [
        {
          title: 'Record IPO Applications',
          description:
            'Record IPO applications with family member linkages, lot sizes, and cut-off price tracking.',
          icon: 'layers',
          displayOrder: 1,
        },
        {
          title: 'Bulk Application Management',
          description:
            'Streamlined multi-profile workflow to record and organize IPO applications across family accounts.',
          icon: 'users',
          displayOrder: 2,
        },
        {
          title: 'Manage Applications',
          description:
            'Manage applications, view portfolio summaries, and track realized and unrealized investment outcomes.',
          icon: 'pie-chart',
          displayOrder: 3,
        },
        {
          title: 'Track Application Status',
          description:
            'Track application status, monitor allotment results, and view detailed portfolio insights.',
          icon: 'trending-up',
          displayOrder: 4,
        },
        {
          title: 'Bank Account Management',
          description:
            'Organize bank details, account limits, and linked UPI IDs for fast reference when recording applications.',
          icon: 'credit-card',
          displayOrder: 5,
        },
        {
          title: 'Ad-Free Experience',
          description: 'Browse IPOVault without promotional advertisements.',
          icon: 'shield',
          displayOrder: 6,
        },
      ];

      // Monthly Plan
      await this.prisma.proPlan.create({
        data: {
          code: 'pro_monthly',
          name: 'Monthly Pro',
          description:
            'Flexible month-to-month access to complete IPO recording, family management, and portfolio insights.',
          duration: 'Monthly',
          durationDays: 30,
          priceInr: new Prisma.Decimal('499.00'),
          comparisonPriceInr: new Prisma.Decimal('699.00'),
          status: 'PUBLISHED',
          displayOrder: 1,
          isPopular: false,
          features: defaultBenefits.map((b) => b.title),
          benefits: {
            create: defaultBenefits,
          },
        },
      });

      // Annual Plan
      await this.prisma.proPlan.create({
        data: {
          code: 'pro_annual',
          name: 'Annual Pro',
          description:
            'Best value for active investors. Full IPOVault Pro tools for a full year of upcoming IPOs.',
          duration: 'Annual',
          durationDays: 365,
          priceInr: new Prisma.Decimal('3999.00'),
          comparisonPriceInr: new Prisma.Decimal('5999.00'),
          status: 'PUBLISHED',
          displayOrder: 2,
          isPopular: true,
          badge: 'Save 33%',
          features: defaultBenefits.map((b) => b.title),
          benefits: {
            create: defaultBenefits,
          },
        },
      });

      this.logger.log('Canonical Pro Plans successfully seeded.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Default Pro Plan seeding skipped/failed: ${msg}`);
    }
  }

  /**
   * Admin-only: list all plans including drafts and archived with benefits.
   * Deterministic ordering by displayOrder ASC, createdAt ASC.
   */
  async listAdminPlans(query?: ProPlanQueryDto) {
    const where: Prisma.ProPlanWhereInput = {};

    if (query?.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query?.q && query.q.trim()) {
      const search = query.q.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const plans = await this.prisma.proPlan.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    return plans.map((plan) => this.serializeAdminPlan(plan));
  }

  /**
   * Admin-only: get individual plan details by ID.
   */
  async getPlanById(id: string) {
    const plan = await this.prisma.proPlan.findUnique({
      where: { id },
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    if (!plan) {
      throw new NotFoundException(`Pro plan with ID "${id}" not found`);
    }

    return this.serializeAdminPlan(plan);
  }

  /**
   * Admin-only: create a new plan with ordered benefits.
   * Enforces unique plan code and non-negative pricing.
   * SECURITY/INTEGRITY: Never modifies or grants user entitlements.
   */
  async createPlan(dto: CreateProPlanDto) {
    const existing = await this.prisma.proPlan.findUnique({
      where: { code: dto.code.trim().toLowerCase() },
    });

    if (existing) {
      throw new ConflictException(
        `A plan with code "${dto.code}" already exists. Please choose a unique code.`,
      );
    }

    const benefitsData = (dto.benefits || []).map((b, idx) => ({
      title: b.title.trim(),
      description: b.description?.trim() || null,
      icon: b.icon?.trim() || null,
      displayOrder: typeof b.displayOrder === 'number' ? b.displayOrder : idx + 1,
    }));

    const featuresList =
      dto.features && dto.features.length > 0
        ? dto.features
        : benefitsData.map((b) => b.title);

    const created = await this.prisma.$transaction(async (tx) => {
      return tx.proPlan.create({
        data: {
          code: dto.code.trim().toLowerCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          duration: dto.duration.trim(),
          durationDays: dto.durationDays ?? null,
          priceInr: new Prisma.Decimal(dto.priceInr.toFixed(2)),
          comparisonPriceInr:
            dto.comparisonPriceInr !== undefined && dto.comparisonPriceInr !== null
              ? new Prisma.Decimal(dto.comparisonPriceInr.toFixed(2))
              : null,
          status: dto.status || 'DRAFT',
          displayOrder: dto.displayOrder ?? 0,
          isPopular: Boolean(dto.isPopular),
          badge: dto.badge?.trim() || null,
          features: featuresList,
          benefits: {
            create: benefitsData,
          },
        },
        include: {
          benefits: {
            orderBy: { displayOrder: 'asc' },
          },
        },
      });
    });

    this.logger.log(`Created Pro Plan "${created.name}" (${created.code}) with status ${created.status}`);
    return this.serializeAdminPlan(created);
  }

  /**
   * Admin-only: update an existing plan and replace/update its benefits.
   * SECURITY/INTEGRITY: Never touches user entitlements.
   */
  async updatePlan(id: string, dto: UpdateProPlanDto) {
    const existing = await this.prisma.proPlan.findUnique({
      where: { id },
      include: { benefits: true },
    });

    if (!existing) {
      throw new NotFoundException(`Pro plan with ID "${id}" not found`);
    }

    if (dto.code && dto.code.trim().toLowerCase() !== existing.code) {
      const codeConflict = await this.prisma.proPlan.findUnique({
        where: { code: dto.code.trim().toLowerCase() },
      });
      if (codeConflict && codeConflict.id !== id) {
        throw new ConflictException(`A plan with code "${dto.code}" already exists.`);
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // If benefits array is provided in update, replace them
      if (Array.isArray(dto.benefits)) {
        await tx.proPlanBenefit.deleteMany({
          where: { planId: id },
        });

        if (dto.benefits.length > 0) {
          await tx.proPlanBenefit.createMany({
            data: dto.benefits.map((b, idx) => ({
              planId: id,
              title: b.title.trim(),
              description: b.description?.trim() || null,
              icon: b.icon?.trim() || null,
              displayOrder: typeof b.displayOrder === 'number' ? b.displayOrder : idx + 1,
            })),
          });
        }
      }

      const updateData: Prisma.ProPlanUpdateInput = {};

      if (dto.code !== undefined) updateData.code = dto.code.trim().toLowerCase();
      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.description !== undefined) updateData.description = dto.description?.trim() || null;
      if (dto.duration !== undefined) updateData.duration = dto.duration.trim();
      if (dto.durationDays !== undefined) updateData.durationDays = dto.durationDays;
      if (dto.priceInr !== undefined && dto.priceInr !== null) {
        updateData.priceInr = new Prisma.Decimal(dto.priceInr.toFixed(2));
      }
      if (dto.comparisonPriceInr !== undefined) {
        updateData.comparisonPriceInr =
          dto.comparisonPriceInr !== null
            ? new Prisma.Decimal(dto.comparisonPriceInr.toFixed(2))
            : null;
      }
      if (dto.status !== undefined) updateData.status = dto.status;
      if (dto.displayOrder !== undefined && dto.displayOrder !== null) {
        updateData.displayOrder = dto.displayOrder;
      }

      if (dto.isPopular !== undefined) updateData.isPopular = dto.isPopular;
      if (dto.badge !== undefined) updateData.badge = dto.badge?.trim() || null;
      if (dto.features !== undefined) updateData.features = dto.features;

      return tx.proPlan.update({
        where: { id },
        data: updateData,
        include: {
          benefits: {
            orderBy: { displayOrder: 'asc' },
          },
        },
      });
    });

    this.logger.log(`Updated Pro Plan "${updated.name}" (${updated.code})`);
    return this.serializeAdminPlan(updated);
  }

  /**
   * Admin-only: publish a plan making it active in the mobile app.
   */
  async publishPlan(id: string) {
    const existing = await this.prisma.proPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Pro plan with ID "${id}" not found`);
    }

    const plan = await this.prisma.proPlan.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        archivedAt: null,
      },
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    this.logger.log(`Published Pro Plan "${plan.name}" (${plan.code})`);
    return this.serializeAdminPlan(plan);
  }

  /**
   * Admin-only: unpublish a plan, reverting it to draft state.
   */
  async unpublishPlan(id: string) {
    const existing = await this.prisma.proPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Pro plan with ID "${id}" not found`);
    }

    const plan = await this.prisma.proPlan.update({
      where: { id },
      data: {
        status: 'DRAFT',
      },
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    this.logger.log(`Unpublished Pro Plan "${plan.name}" (${plan.code})`);
    return this.serializeAdminPlan(plan);
  }

  /**
   * Admin-only: soft-archive a plan without destructive deletion.
   * Archived plans are hidden from mobile users and console active lists.
   */
  async archivePlan(id: string) {
    const existing = await this.prisma.proPlan.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Pro plan with ID "${id}" not found`);
    }

    const plan = await this.prisma.proPlan.update({
      where: { id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    this.logger.log(`Archived Pro Plan "${plan.name}" (${plan.code})`);
    return this.serializeAdminPlan(plan);
  }

  /**
   * Mobile-facing public read-only endpoint:
   * Returns only published plans in deterministic display order.
   * Strips all internal metadata and administrative controls.
   * NEVER returns draft or archived plans.
   */
  async listPublishedPlans(): Promise<MobileProPlanResponse[]> {
    const plans = await this.prisma.proPlan.findMany({
      where: {
        status: 'PUBLISHED',
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        benefits: {
          orderBy: { displayOrder: 'asc' },
        },
      },
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      duration: plan.duration,
      durationDays: plan.durationDays,
      priceInr: Number(plan.priceInr),
      comparisonPriceInr:
        plan.comparisonPriceInr !== null ? Number(plan.comparisonPriceInr) : null,
      isPopular: plan.isPopular,
      badge: plan.badge,
      displayOrder: plan.displayOrder,
      features: plan.features || [],
      benefits: plan.benefits.map((b) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        icon: b.icon,
        displayOrder: b.displayOrder,
      })),
    }));
  }

  /**
   * Serializes an internal Prisma plan into a rich admin representation.
   */
  private serializeAdminPlan(plan: any) {
    return {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      duration: plan.duration,
      durationDays: plan.durationDays,
      priceInr: Number(plan.priceInr),
      comparisonPriceInr:
        plan.comparisonPriceInr !== null ? Number(plan.comparisonPriceInr) : null,
      status: plan.status,
      displayOrder: plan.displayOrder,
      isPopular: plan.isPopular,
      badge: plan.badge,
      features: plan.features || [],
      createdAt: plan.createdAt ? plan.createdAt.toISOString() : null,
      updatedAt: plan.updatedAt ? plan.updatedAt.toISOString() : null,
      archivedAt: plan.archivedAt ? plan.archivedAt.toISOString() : null,
      benefits: (plan.benefits || []).map((b: any) => ({
        id: b.id,
        planId: b.planId,
        title: b.title,
        description: b.description,
        icon: b.icon,
        displayOrder: b.displayOrder,
        createdAt: b.createdAt ? b.createdAt.toISOString() : null,
        updatedAt: b.updatedAt ? b.updatedAt.toISOString() : null,
      })),
    };
  }
}
