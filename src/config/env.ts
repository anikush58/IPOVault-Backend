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
  ADMIN_API_KEY: z.string().optional(),
  CONSOLE_ADMIN_USERNAME: z.string().optional().default('admin'),
  CONSOLE_ADMIN_PASSWORD: z.string().optional(),
  CONSOLE_SESSION_SECRET: z.string().optional(),
  BROKER_TOKEN_ENCRYPTION_SECRET: z.string().optional(),
  UPSTOX_API_KEY: z.string().optional(),
  UPSTOX_API_SECRET: z.string().optional(),
  UPSTOX_REDIRECT_URI: z
    .string()
    .optional()
    .default(
      'https://api.getipovault.in/api/v1/broker-accounts/connect/upstox/callback',
    ),
  UPSTOX_BASE_URL: z.string().optional().default('https://api.upstox.com/v2'),
  DHAN_API_KEY: z.string().optional(),
  DHAN_API_SECRET: z.string().optional(),
  DHAN_REDIRECT_URI: z
    .string()
    .optional()
    .default(
      'https://api.getipovault.in/api/v1/broker-accounts/connect/dhan/callback',
    ),
  DHAN_BASE_URL: z.string().optional().default('https://api.dhan.co/v2'),
  DHAN_AUTH_BASE_URL: z.string().optional().default('https://auth.dhan.co'),
  FYERS_APP_ID: z.string().optional(),
  FYERS_SECRET_KEY: z.string().optional(),
  FYERS_REDIRECT_URI: z
    .string()
    .optional()
    .default(
      'https://api.getipovault.in/api/v1/broker-accounts/connect/fyers/callback',
    ),
  FYERS_BASE_URL: z
    .string()
    .optional()
    .default('https://api-t1.fyers.in/api/v3'),
  ZERODHA_API_KEY: z.string().optional(),
  ZERODHA_API_SECRET: z.string().optional(),
  ZERODHA_REDIRECT_URI: z.string().optional(),
  ZERODHA_BASE_URL: z.string().optional().default('https://api.kite.trade'),
  ZERODHA_LOGIN_URL: z
    .string()
    .optional()
    .default('https://kite.zerodha.com/connect/login'),
  GROWW_API_KEY: z.string().optional(),
  GROWW_API_SECRET: z.string().optional(),
  GROWW_REDIRECT_URI: z.string().optional(),
  GROWW_BASE_URL: z
    .string()
    .optional()
    .default('https://api.groww.in/v1'),
  GROWW_AUTH_BASE_URL: z
    .string()
    .optional()
    .default('https://groww.in/oauth'),
  BROKER_SYNC_SCHEDULER_ENABLED: z.coerce.boolean().optional().default(false),
  BROKER_SYNC_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(60_000),
  /** IPO Guru v2 API key — 10 req/day, 1 req/min. */
  IPOGURU_API_KEY: z.string().optional(),
  IPOGURU_SCHEDULER_ENABLED: z.coerce.boolean().optional().default(true),
  IPOGURU_SCHEDULER_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15_000),
  /** AI Missing-field enrichment API keys */
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
})
.superRefine((val, ctx) => {
  if (val.NODE_ENV === 'production' && !val.CONSOLE_SESSION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CONSOLE_SESSION_SECRET'],
      message: 'CONSOLE_SESSION_SECRET is required in production environment',
    });
  }
  if (val.NODE_ENV === 'production' && !val.BROKER_TOKEN_ENCRYPTION_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['BROKER_TOKEN_ENCRYPTION_SECRET'],
      message:
        'BROKER_TOKEN_ENCRYPTION_SECRET is required in production environment',
    });
  }
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
