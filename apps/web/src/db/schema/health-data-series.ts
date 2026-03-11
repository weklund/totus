import {
  bigserial,
  index,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { bytea } from "./custom-types";

/**
 * Encrypted intraday time-series health readings.
 * (CGM glucose, heart rate, SpO2 intervals, HRV samples)
 *
 * This table is range-partitioned by recorded_at (monthly).
 * Partitions are created via raw SQL migration, not via Drizzle push.
 * Drizzle schema defines the column types for TypeScript.
 *
 * IMPORTANT: id is not globally unique across partitions.
 * Always include a recorded_at range predicate alongside id lookups.
 *
 * See: /docs/integrations-pipeline-lld.md §3.4
 */
export const healthDataSeries = pgTable(
  "health_data_series",
  {
    id: bigserial("id", { mode: "bigint" }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    metricType: varchar("metric_type", { length: 64 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    valueEncrypted: bytea("value_encrypted").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 256 }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.recordedAt] }),
    unique("uq_series_user_metric_time_source").on(
      table.userId,
      table.metricType,
      table.recordedAt,
      table.source,
    ),
    index("idx_series_user_metric_time").on(
      table.userId,
      table.metricType,
      table.recordedAt,
    ),
  ],
);
