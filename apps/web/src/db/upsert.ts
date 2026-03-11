/**
 * Health data upsert utilities.
 *
 * Implements ON CONFLICT ... DO UPDATE semantics for all health data tables:
 * - health_data_daily: daily aggregate metrics
 * - health_data_series: intraday time-series readings
 * - health_data_periods: bounded-duration events
 *
 * See: /docs/integrations-pipeline-lld.md §3
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { healthDataDaily, healthDataSeries, healthDataPeriods } from "./schema";

// ─── Daily Data ─────────────────────────────────────────────

/**
 * A single daily health data row to be upserted.
 */
export interface HealthDataRow {
  userId: string;
  metricType: string;
  date: string;
  valueEncrypted: Buffer;
  source: string;
  sourceId?: string | null;
}

/**
 * Upsert daily health data rows.
 * ON CONFLICT (user_id, metric_type, date, source) DO UPDATE.
 */
export async function upsertDailyData(
  database: NodePgDatabase,
  rows: HealthDataRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await database
    .insert(healthDataDaily)
    .values(
      rows.map((row) => ({
        userId: row.userId,
        metricType: row.metricType,
        date: row.date,
        valueEncrypted: row.valueEncrypted,
        source: row.source,
        sourceId: row.sourceId ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        healthDataDaily.userId,
        healthDataDaily.metricType,
        healthDataDaily.date,
        healthDataDaily.source,
      ],
      set: {
        valueEncrypted: sql`excluded.value_encrypted`,
        sourceId: sql`excluded.source_id`,
        importedAt: sql`now()`,
      },
    });

  return result.rowCount ?? rows.length;
}

/** @deprecated Use upsertDailyData instead */
export const upsertHealthData = upsertDailyData;

// ─── Series Data ────────────────────────────────────────────

/**
 * A single series (intraday) reading to be upserted.
 */
export interface SeriesDataRow {
  userId: string;
  metricType: string;
  recordedAt: Date;
  valueEncrypted: Buffer;
  source: string;
  sourceId?: string | null;
}

/**
 * Upsert series health data rows.
 * ON CONFLICT (user_id, metric_type, recorded_at, source) DO UPDATE.
 */
export async function upsertSeriesData(
  database: NodePgDatabase,
  rows: SeriesDataRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await database
    .insert(healthDataSeries)
    .values(
      rows.map((row) => ({
        userId: row.userId,
        metricType: row.metricType,
        recordedAt: row.recordedAt,
        valueEncrypted: row.valueEncrypted,
        source: row.source,
        sourceId: row.sourceId ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        healthDataSeries.userId,
        healthDataSeries.metricType,
        healthDataSeries.recordedAt,
        healthDataSeries.source,
      ],
      set: {
        valueEncrypted: sql`excluded.value_encrypted`,
        sourceId: sql`excluded.source_id`,
        importedAt: sql`now()`,
      },
    });

  return result.rowCount ?? rows.length;
}

// ─── Period Data ────────────────────────────────────────────

/**
 * A single period event to be upserted.
 */
export interface PeriodDataRow {
  userId: string;
  eventType: string;
  subtype?: string | null;
  startedAt: Date;
  endedAt: Date;
  metadataEnc?: Buffer | null;
  source: string;
  sourceId?: string | null;
}

/**
 * Upsert period health data rows.
 * ON CONFLICT (user_id, event_type, started_at, source) DO UPDATE.
 */
export async function upsertPeriodData(
  database: NodePgDatabase,
  rows: PeriodDataRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await database
    .insert(healthDataPeriods)
    .values(
      rows.map((row) => ({
        userId: row.userId,
        eventType: row.eventType,
        subtype: row.subtype ?? null,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        metadataEnc: row.metadataEnc ?? null,
        source: row.source,
        sourceId: row.sourceId ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [
        healthDataPeriods.userId,
        healthDataPeriods.eventType,
        healthDataPeriods.startedAt,
        healthDataPeriods.source,
      ],
      set: {
        subtype: sql`excluded.subtype`,
        endedAt: sql`excluded.ended_at`,
        metadataEnc: sql`excluded.metadata_enc`,
        sourceId: sql`excluded.source_id`,
        importedAt: sql`now()`,
      },
    });

  return result.rowCount ?? rows.length;
}
