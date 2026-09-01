import { validateEnv } from './env';

describe('validateEnv', () => {
  it('applies defaults for an empty config', () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toBe('http://localhost:3000');
  });

  it('parses and coerces provided values', () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      CORS_ORIGINS: 'http://localhost:8080',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.CORS_ORIGINS).toBe('http://localhost:8080');
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'local' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() => validateEnv({ PORT: '0' })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => validateEnv({ PORT: '70000' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => validateEnv({ LOG_LEVEL: 'verbose' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
