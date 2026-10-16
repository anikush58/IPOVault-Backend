import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { UserEntitlementService } from '../user/user-entitlement.service';
import {
  updateUserEntitlementSchema,
  userListQuerySchema,
} from '../user/dto/user-entitlement.dto';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUserController {
  constructor(
    private readonly userEntitlementService: UserEntitlementService,
  ) {}

  /**
   * Admin-only: list registered users with pagination, tier filtering, and search.
   */
  @Get()
  async listUsers(@Query() query: Record<string, unknown>) {
    const validated = userListQuerySchema.parse(query);
    return this.userEntitlementService.listUsers(validated);
  }

  /**
   * Admin-only: get individual user profile, entitlement, and audit log.
   */
  @Get(':uid')
  async getUserDetail(@Param('uid') uid: string) {
    if (!uid || !uid.trim()) {
      throw new BadRequestException('User ID is required');
    }
    return this.userEntitlementService.getUserDetail(uid);
  }

  /**
   * Admin-only: grant or revoke Pro entitlement for a specific user.
   */
  @Post(':uid/entitlement')
  async updateUserEntitlement(
    @Param('uid') uid: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ) {
    const validated = updateUserEntitlementSchema.parse(body);
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || '';
    return this.userEntitlementService.updateUserEntitlement(
      uid,
      validated.tier,
      'admin-api-key',
      validated.reason,
      ip,
    );
  }
}
