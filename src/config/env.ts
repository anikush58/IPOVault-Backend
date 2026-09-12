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
