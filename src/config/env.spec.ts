import { validateEnv } from './env';

const validDatabaseUrl =
  'postgresql://ipovault:ipovault@localhost:5432/ipovault';

describe('validateEnv', () => {
  it('applies defaults when DATABASE_URL is provided', () => {
    const env = validateEnv({ DATABASE_URL: validDatabaseUrl });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toBe('http://localhost:3000');
    expect(env.DATABASE_URL).toBe(validDatabaseUrl);
  });

  it('parses and coerces provided values', () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      CORS_ORIGINS: 'http://localhost:8080',
      DATABASE_URL: 'postgres://ipovault:ipovault@localhost:5432/ipovault_test',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('debug');
    expect(env.CORS_ORIGINS).toBe('http://localhost:8080');
    expect(env.DATABASE_URL).toBe(
      'postgres://ipovault:ipovault@localhost:5432/ipovault_test',
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'mysql://localhost:3306/ipovault' }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'local', DATABASE_URL: validDatabaseUrl }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() =>
      validateEnv({ PORT: 'abc', DATABASE_URL: validDatabaseUrl }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() =>
      validateEnv({ PORT: '0', DATABASE_URL: validDatabaseUrl }),
    ).toThrow(/Invalid environment configuration/);
    expect(() =>
      validateEnv({ PORT: '70000', DATABASE_URL: validDatabaseUrl }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() =>
      validateEnv({ LOG_LEVEL: 'verbose', DATABASE_URL: validDatabaseUrl }),
    ).toThrow(/Invalid environment configuration/);
  });
});
