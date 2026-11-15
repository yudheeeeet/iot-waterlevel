import type { z } from 'zod';
import { AppError } from './errors.js';

/** Parses request input with Zod; invalid input becomes a 400 VALIDATION_ERROR with field-level details. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, details);
  }
  return result.data;
}
