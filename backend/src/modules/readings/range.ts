import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { parseInput } from '../../shared/validation.js';
import { DEFAULT_RANGE_MS, MAX_RANGE_MS } from './series.js';

const Query = z.object({
  from: z.iso.datetime({ offset: true, error: 'from harus tanggal ISO-8601' }).optional(),
  to: z.iso.datetime({ offset: true, error: 'to harus tanggal ISO-8601' }).optional(),
});

/** ?from&to → validated range. Default: the last 24 h up to now. Maximum 90 days. */
export function parseRange(query: unknown, now = new Date()): { from: Date; to: Date } {
  const q = parseInput(Query, query ?? {});
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - DEFAULT_RANGE_MS);
  if (from.getTime() >= to.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, [{ field: 'from', message: 'from harus sebelum to' }]);
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, [{ field: 'to', message: 'Rentang maksimal 90 hari' }]);
  }
  return { from, to };
}
