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

  it('rejects unauthenticated requests to /console/api/ipo-guru/provenance/preview', () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ENABLE_DATA_CONSOLE') return true;
        if (key === 'CONSOLE_SESSION_SECRET') return 'test-secret';
        return undefined;
      }),
    } as unknown as ConfigService<Env, true>;

    const guard = new ConsoleEnabledGuard(configService);
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/api/v1/console/api/ipo-guru/provenance/preview',
          headers: {},
        }),
      }),
    } as any;

    expect(() => guard.canActivate(mockContext)).toThrow('Console authentication required');
  });

  it('accepts authenticated requests with valid session token', () => {
    const { createSessionToken } = require('./console.guard');
    const secret = 'test-secret';
    const validToken = createSessionToken('admin', secret);

    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ENABLE_DATA_CONSOLE') return true;
        if (key === 'CONSOLE_SESSION_SECRET') return secret;
        return undefined;
      }),
    } as unknown as ConfigService<Env, true>;

    const guard = new ConsoleEnabledGuard(configService);
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/api/v1/console/api/ipo-guru/provenance/apply',
          headers: {
            authorization: `Bearer ${validToken}`,
          },
        }),
      }),
    } as any;

    expect(guard.canActivate(mockContext)).toBe(true);
  });
});
