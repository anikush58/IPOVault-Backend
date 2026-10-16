import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserEntitlementService } from './user-entitlement.service';
import { syncPansBodySchema } from './dto/sync-pans.dto';
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('user')
@UseGuards(FirebaseAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userEntitlementService: UserEntitlementService,
  ) {}

  /**
   * Retrieves the canonical entitlement tier for the authenticated user.
   * Client identity is strictly derived from the verified Firebase Auth token.
   */
  @Get('entitlement')
  @HttpCode(HttpStatus.OK)
  async getMyEntitlement(@CurrentUser('uid') userId: string) {
    return this.userEntitlementService.getEntitlement(userId);
  }

  @Post('pans/sync')
  @HttpCode(HttpStatus.OK)
  async syncPans(
    @Body() body: unknown,
    @CurrentUser('uid') userId: string,
  ) {
    const validated = syncPansBodySchema.parse(body);
    return this.userService.syncPans(userId, validated);
  }

  @Delete('pans/:id')
  @HttpCode(HttpStatus.OK)
  async deletePan(
    @Param('id') id: string,
    @CurrentUser('uid') userId: string,
  ) {
    return this.userService.deletePan(userId, id);
  }

  @Delete('pans')
  @HttpCode(HttpStatus.OK)
  async deleteAllPans(@CurrentUser('uid') userId: string) {
    return this.userService.deleteAllPans(userId);
  }
}
