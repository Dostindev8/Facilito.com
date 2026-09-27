import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv({ path: path.resolve(process.cwd(), '.env') });
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const bool = (fallback: 'true' | 'false') =>
  z
    .string()
    .default(fallback)
    .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_HOST: z.string().default('127.0.0.1'),
  DATABASE_DRIVER: z.enum(['pg', 'pglite']).default('pglite'),
  DATABASE_URL: z.string().default(''),
  DATABASE_ADMIN_URL: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default('./.data/pglite'),
  REDIS_URL: z.string().default(''),
  JWT_PRIVATE_KEY_PATH: z.string().default('./secrets/jwt-private.pem'),
  JWT_PUBLIC_KEY_PATH: z.string().default('./secrets/jwt-public.pem'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  FIELD_ENCRYPTION_KEY: z.string().min(16),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_SECONDS: z.coerce.number().int().positive().default(900),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  COOKIE_SECURE: bool('false'),
  COOKIE_PATH: z.string().startsWith('/').default('/api/v1/auth'),
  AUTO_MIGRATE: bool('true'),
  UPLOAD_DIR: z.string().default('./.data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(2_097_152),
  LLM_PROVIDER: z.string().default('stub'),
  PSFE_PROVIDER: z.string().default('stub'),
  FEATURE_ECF_ENABLED: bool('false'),
  FEATURE_COPILOT_ENABLED: bool('true'),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  if (parsed.data.DATABASE_DRIVER === 'pg' && !parsed.data.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when DATABASE_DRIVER=pg');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvForTests(): void {
  cached = null;
}
