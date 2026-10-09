import { validateEnv } from './env';

const validDatabaseUrl =
  'postgresql://ipovault:ipovault@localhost:5432/ipovault';
const validEncryptionSecret = 'a'.repeat(32);
const validHashSecret = 'b'.repeat(16);

describe('validateEnv', () => {
  it('applies defaults when DATABASE_URL and secrets are provided', () => {
    const env = validateEnv({
      DATABASE_URL: validDatabaseUrl,
      ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
      ALLOTMENT_HASH_SECRET: validHashSecret,
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toBe('http://localhost:3000');
    expect(env.DATABASE_URL).toBe(validDatabaseUrl);
    expect(env.ALLOTMENT_ENCRYPTION_SECRET).toBe(validEncryptionSecret);
    expect(env.ALLOTMENT_HASH_SECRET).toBe(validHashSecret);
  });

  it('parses and coerces provided values in test environment', () => {
    const env = validateEnv({
      NODE_ENV: 'test',
      PORT: '4000',
      LOG_LEVEL: 'debug',
      CORS_ORIGINS: 'http://localhost:8080',
      DATABASE_URL: 'postgres://ipovault:ipovault@localhost:5432/ipovault_test',
      ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
      ALLOTMENT_HASH_SECRET: validHashSecret,
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
    expect(() =>
      validateEnv({
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'mysql://localhost:3306/ipovault',
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'local',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() =>
      validateEnv({
        PORT: 'abc',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a PORT outside the valid range', () => {
    expect(() =>
      validateEnv({
        PORT: '0',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
    expect(() =>
      validateEnv({
        PORT: '70000',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects missing ALLOTMENT_ENCRYPTION_SECRET in development/production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/ALLOTMENT_ENCRYPTION_SECRET is required/);
  });

  it('rejects short ALLOTMENT_ENCRYPTION_SECRET (< 32 chars)', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: 'short_secret',
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/ALLOTMENT_ENCRYPTION_SECRET must be at least 32 characters/);
  });

  it('rejects missing ALLOTMENT_HASH_SECRET in development/production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
      }),
    ).toThrow(/ALLOTMENT_HASH_SECRET is required/);
  });

  it('rejects short ALLOTMENT_HASH_SECRET (< 16 chars)', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: validDatabaseUrl,
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: 'short',
      }),
    ).toThrow(/ALLOTMENT_HASH_SECRET must be at least 16 characters/);
  });

  it('rejects missing BROKER_TOKEN_ENCRYPTION_SECRET in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: validDatabaseUrl,
        CONSOLE_SESSION_SECRET: 'production-secret-console',
        ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
        ALLOTMENT_HASH_SECRET: validHashSecret,
      }),
    ).toThrow(/BROKER_TOKEN_ENCRYPTION_SECRET is required in production environment/);
  });

  it('accepts valid BROKER_TOKEN_ENCRYPTION_SECRET in production', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: validDatabaseUrl,
      CONSOLE_SESSION_SECRET: 'production-secret-console',
      BROKER_TOKEN_ENCRYPTION_SECRET: 'a'.repeat(32),
      ALLOTMENT_ENCRYPTION_SECRET: validEncryptionSecret,
      ALLOTMENT_HASH_SECRET: validHashSecret,
    });

    expect(env.BROKER_TOKEN_ENCRYPTION_SECRET).toBe('a'.repeat(32));
  });
});
