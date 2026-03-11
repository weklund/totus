/**
 * Health data upsert utility.
 *
 * Implements ON CONFLICT ... DO UPDATE semantics for health data:
 * if a row with the same (user_id, metric_type, date, source) exists,
 * update value_encrypted, source_id, and imported_at instead of
 * creating a duplicate.
 *
 * See: /docs/api-database-lld.md Section 9.7
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { healthData } from "./schema";

/**
 * A single health data row to be upserted.
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
 * Upsert health data rows into the database.
 *
 * Uses ON CONFLICT (user_id, metric_type, date, source) DO UPDATE
 * to update the existing row's value_encrypted, source_id, and imported_at
 * when a conflict is detected.
 *
 * @param database - Drizzle database instance
 * @param rows - Array of health data rows to upsert
 * @returns The number of rows affected
 */
export async function upsertHealthData(
  database: NodePgDatabase,
  rows: HealthDataRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const result = await database
    .insert(healthData)
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
        healthData.userId,
        healthData.metricType,
        healthData.date,
        healthData.source,
      ],
      set: {
        valueEncrypted: sql`excluded.value_encrypted`,
        sourceId: sql`excluded.source_id`,
        importedAt: sql`now()`,
      },
    });

  return result.rowCount ?? rows.length;
}
