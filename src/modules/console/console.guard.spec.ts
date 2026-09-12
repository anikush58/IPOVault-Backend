import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleEnabledGuard } from './console.guard';
import { Env } from '../../config/env';

describe('ConsoleEnabledGuard', () => {
  it('allows access when ENABLE_DATA_CONSOLE is true', () => {
    const configService = {
      get: jest.fn().mockReturnValue(true),
    } as unknown as ConfigService<Env, true>;

    const guard = new ConsoleEnabledGuard(configService);
    expect(guard.canActivate()).toBe(true);
  });

  it('throws NotFoundException when ENABLE_DATA_CONSOLE is false', () => {
    const configService = {
      get: jest.fn().mockReturnValue(false),
    } as unknown as ConfigService<Env, true>;

    const guard = new ConsoleEnabledGuard(configService);
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});
