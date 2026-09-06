import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { UserService } from './user.service';
import { syncPansBodySchema } from './dto/sync-pans.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('pans/sync')
  @HttpCode(HttpStatus.OK)
  async syncPans(@Body() body: unknown, @Headers('x-user-id') userId?: string) {
    if (!userId) {
      throw new UnauthorizedException(
        'Authentication header x-user-id is required',
      );
    }
    const validated = syncPansBodySchema.parse(body);
    return this.userService.syncPans(userId, validated);
  }
}
