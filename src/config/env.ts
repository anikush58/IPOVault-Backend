import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      { message: 'must be a PostgreSQL connection URL' },
    ),
  NSE_IPO_ENDPOINT: z.string().url().optional(),
  SEBI_IPO_ENDPOINT: z.string().url().optional(),
  SEBI_MAX_PDF_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50_000_000),
  SEBI_INTER_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(0),
  SEBI_START_PAGE: z.coerce.number().int().positive().default(1),
  SEBI_MAX_PAGES: z.coerce.number().int().positive().default(1),
  ENABLE_DATA_CONSOLE: z.coerce.boolean().optional().default(true),
  NOTIFICATION_WORKER_ENABLED: z.coerce.boolean().optional().default(true),
  NOTIFICATION_WORKER_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(50),
  NOTIFICATION_WORKER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .default(10_000),
  NOTIFICATION_WORKER_STALE_LEASE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(300_000),
  DISCOVERY_SCHEDULER_ENABLED: z.coerce.boolean().optional().default(false),
  DISCOVERY_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(21_600_000),
  DISCOVERY_SCHEDULER_INITIAL_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(0),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(
  config: Record<string, unknown> = process.env,
): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return result.data;
}
