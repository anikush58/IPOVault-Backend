import { Controller, Get } from '@nestjs/common';
import { ProPlanService } from './pro-plan.service';
import { MobileProPlanResponse } from './dto/pro-plan.dto';

@Controller('pro-plans')
export class PublicProPlanController {
  constructor(private readonly proPlanService: ProPlanService) {}

  /**
   * Public mobile-facing endpoint returning active published plans.
   * Deterministic ordering by displayOrder ASC, createdAt ASC.
   * Strips administrative and internal metadata.
   */
  @Get()
  async getPublishedPlans(): Promise<MobileProPlanResponse[]> {
    return this.proPlanService.listPublishedPlans();
  }
}
