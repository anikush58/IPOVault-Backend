import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';

@Injectable()
export class ConsoleEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  canActivate(): boolean {
    const enabled = this.configService.get('ENABLE_DATA_CONSOLE', {
      infer: true,
    });
    if (enabled === false) {
      throw new NotFoundException('Data console is disabled');
    }
    return true;
  }
}
