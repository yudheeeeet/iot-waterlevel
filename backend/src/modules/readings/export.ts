import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Sql } from '../../db/client.js';
import { parseInput } from '../../shared/validation.js';
import { parseRange } from './range.js';

/**
 * PRD RD-6: export of STORED readings (not carried forward) for one device, max 90 days, every role.
 * Streams rows from a DB cursor straight into the response, so memory stays flat for long ranges.
 */
export const EXPORT_COLUMNS = ['device_id', 'waktu_wib', 'timestamp_utc', 'distance_cm', 'distance_m', 'status'] as const;
const CURSOR_ROWS = 2_000;

const Format = z.object({ format: z.enum(['csv', 'xlsx'], { error: 'format harus csv atau xlsx' }).default('csv') });

/**
 * "2026-11-15 09:00:21" in Asia/Jakarta. WIB is a fixed UTC+7 (no daylight saving), so plain arithmetic
 * is exact and far cheaper than Intl per row (43 200 rows for 30 days).
 */
const WIB_OFFSET_MS = 7 * 3600_000;
export function wib(d: Date): string {
  return new Date(d.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

interface Row {
  ts: Date;
  level: string;
  status: string;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Readable;
}

export function exportReadings(sql: Sql, deviceId: string, query: unknown, now = new Date()): ExportFile {
  const { format } = parseInput(Format, { format: (query as { format?: unknown } | null)?.format });
  const { from, to } = parseRange(query, now);
  const day = (d: Date) => wib(d).slice(0, 10);
  const filename = `${deviceId}_readings_${day(from)}_${day(to)}.${format}`;

  const rows = () =>
    sql<Row[]>`
      select ts, level_cm as level, status from readings
      where device_id = ${deviceId} and channel = 1 and ts >= ${from} and ts < ${to}
      order by ts`.cursor(CURSOR_ROWS);
  const values = (r: Row) => {
    const cm = Number(r.level);
    return [deviceId, wib(r.ts), r.ts.toISOString(), cm, +(cm / 100).toFixed(4), r.status] as const;
  };

  if (format === 'csv') {
    async function* csv() {
      yield '﻿' + EXPORT_COLUMNS.join(',') + '\r\n'; // BOM: Excel opens UTF-8 correctly
      for await (const batch of rows()) yield batch.map((r) => values(r).join(',')).join('\r\n') + '\r\n';
    }
    return { filename, contentType: 'text/csv; charset=utf-8', body: Readable.from(csv()) };
  }

  const out = new PassThrough();
  void (async () => {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true });
    const ws = wb.addWorksheet('Readings', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'device_id', key: 'device_id', width: 14 },
      { header: 'waktu_wib', key: 'waktu_wib', width: 20 },
      { header: 'timestamp_utc', key: 'timestamp_utc', width: 26 },
      { header: 'distance_cm', key: 'distance_cm', width: 13, style: { numFmt: '0.00' } },
      { header: 'distance_m', key: 'distance_m', width: 12, style: { numFmt: '0.0000' } },
      { header: 'status', key: 'status', width: 10 },
    ];
    for await (const batch of rows()) for (const r of batch) ws.addRow([...values(r)]).commit();
    ws.commit();
    const info = wb.addWorksheet('Info');
    info.addRow(['Device', deviceId]).commit();
    info.addRow(['Dari (WIB)', wib(from)]).commit();
    info.addRow(['Sampai (WIB)', wib(to)]).commit();
    info.addRow(['Diekspor (WIB)', wib(now)]).commit();
    info.addRow(['Catatan', 'Berisi titik yang tersimpan saja. Nilai yang tidak berubah disimpan ulang tiap 15 menit, jadi jeda antar baris bukan berarti data hilang.']).commit();
    info.addRow(['Jarak', 'distance = jarak sensor ke permukaan air; makin kecil = air makin tinggi.']).commit();
    info.commit();
    await wb.commit();
  })().catch((err: unknown) => out.destroy(err as Error));
  return { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: out };
}
