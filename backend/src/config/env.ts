import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Environment configuration, validated once at startup.
 * A missing or invalid variable stops the process with a message that names it.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL wajib diisi (contoh: postgres://user:pass@localhost:5432/baruna_dev)' })
    .min(1, 'DATABASE_URL wajib diisi')
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'DATABASE_URL harus diawali postgres:// atau postgresql://'),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Konfigurasi environment tidak valid:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Pure parser, used by tests and by loadEnv(). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new EnvError(issues);
  }
  return result.data;
}

let cached: Env | undefined;

/** Loads `.env` (if present) into process.env, then validates. Exits the process on invalid config. */
export function loadEnv(): Env {
  if (cached) return cached;
  if (existsSync('.env')) process.loadEnvFile('.env');
  try {
    cached = parseEnv(process.env);
    return cached;
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
