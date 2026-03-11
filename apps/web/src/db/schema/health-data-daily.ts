import {
  bigserial,
  date,
  index,
  pgTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Encrypted daily aggregate health metrics.
 * One row per user/metric/date/source.
 * Renamed from health_data; existing data unchanged.
 *
 * See: /docs/integrations-pipeline-lld.md §3.3
 */
export const healthDataDaily = pgTable(
  "health_data_daily",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricType: varchar("metric_type", { length: 64 }).notNull(),
    date: date("date").notNull(),
    valueEncrypted: bytea("value_encrypted").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 256 }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_health_data_daily_user_metric_date_source").on(
      table.userId,
      table.metricType,
      table.date,
      table.source,
    ),
    index("idx_health_data_daily_user_metric_date").on(
      table.userId,
      table.metricType,
      table.date,
    ),
    index("idx_health_data_daily_user_metric_summary").on(
      table.userId,
      table.metricType,
    ),
  ],
);
