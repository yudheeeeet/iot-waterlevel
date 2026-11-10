import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 * A missing, placeholder or invalid variable stops the process with a message that names it.
 */
const notPlaceholder = (name: string) => (v: string) => !v.includes('GANTI_') || `${name} masih berisi nilai contoh (GANTI_…)`;

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Shared by the api, the worker and the CLI scripts. */
export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL wajib diisi (contoh: postgres://user:pass@localhost:5432/baruna_dev)' })
    .min(1, 'DATABASE_URL wajib diisi')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL harus diawali postgres:// atau postgresql://')
    .refine((v) => notPlaceholder('DATABASE_URL')(v) === true, 'DATABASE_URL masih berisi nilai contoh (GANTI_…)'),
});

/** Extra variables needed only by the HTTP api. */
export const ApiEnvSchema = BaseEnvSchema.extend({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  JWT_SECRET: z
    .string({ error: 'JWT_SECRET wajib diisi (minimal 32 karakter acak)' })
    .min(32, 'JWT_SECRET minimal 32 karakter')
    .refine((v) => !v.includes('GANTI_'), 'JWT_SECRET masih berisi nilai contoh (GANTI_…)'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** Secure cookie flag; defaults to true in production. */
  COOKIE_SECURE: bool.optional(),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;
export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Konfigurasi environment tidak valid:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Pure parser, used by tests and by the loaders below. */
export function parseEnv<S extends z.ZodType>(source: Record<string, string | undefined>, schema: S): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new EnvError(issues);
  }
  return result.data;
}

function load<S extends z.ZodType>(schema: S): z.infer<S> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  try {
    return parseEnv(process.env, schema);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Loads `.env` (if present) and validates the variables shared by every process. */
export const loadEnv = (): BaseEnv => load(BaseEnvSchema);
/** Loads `.env` (if present) and validates everything the HTTP api needs. */
export const loadApiEnv = (): ApiEnv => load(ApiEnvSchema);
