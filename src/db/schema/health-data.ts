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
 * Encrypted health metric data points.
 * One row per user/metric/date/source.
 * Value is envelope-encrypted (KMS-encrypted DEK + AES-256-GCM encrypted JSON).
 */
export const healthData = pgTable(
  "health_data",
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
    unique("uq_health_data_user_metric_date_source").on(
      table.userId,
      table.metricType,
      table.date,
      table.source,
    ),
    index("idx_health_data_user_metric_date").on(
      table.userId,
      table.metricType,
      table.date,
    ),
    index("idx_health_data_user_metric_summary").on(
      table.userId,
      table.metricType,
    ),
  ],
);
