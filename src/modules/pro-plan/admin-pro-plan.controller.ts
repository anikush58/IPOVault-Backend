import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { ProPlanService } from './pro-plan.service';
import {
  createProPlanSchema,
  proPlanQuerySchema,
  updateProPlanSchema,
} from './dto/pro-plan.dto';

@Controller('admin/pro-plans')
@UseGuards(AdminGuard)
export class AdminProPlanController {
  constructor(private readonly proPlanService: ProPlanService) {}

  @Get()
  async listPlans(@Query() query: Record<string, unknown>) {
    const validated = proPlanQuerySchema.parse(query);
    return this.proPlanService.listAdminPlans(validated);
  }

  @Post()
  async createPlan(@Body() body: Record<string, unknown>) {
    const validated = createProPlanSchema.parse(body);
    return this.proPlanService.createPlan(validated);
  }

  @Get(':id')
  async getPlanDetail(@Param('id') id: string) {
    return this.proPlanService.getPlanById(id);
  }

  @Patch(':id')
  async updatePlan(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const validated = updateProPlanSchema.parse(body);
    return this.proPlanService.updatePlan(id, validated);
  }

  @Post(':id/publish')
  async publishPlan(@Param('id') id: string) {
    return this.proPlanService.publishPlan(id);
  }

  @Post(':id/unpublish')
  async unpublishPlan(@Param('id') id: string) {
    return this.proPlanService.unpublishPlan(id);
  }

  @Post(':id/archive')
  async archivePlan(@Param('id') id: string) {
    return this.proPlanService.archivePlan(id);
  }
}
