import {
  bigserial,
  date,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Materialized baseline cache for 30-day rolling statistics per metric.
 * One row per (user, metric, reference_date). The encrypted payload contains
 * avg_30d, stddev_30d, upper, lower, and sample_count.
 *
 * See: /docs/dashboard-backend-lld.md §3.1
 */
export const metricBaselines = pgTable(
  "metric_baselines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricType: varchar("metric_type", { length: 64 }).notNull(),
    referenceDate: date("reference_date").notNull(),
    valueEncrypted: bytea("value_encrypted").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_baselines_user_metric_date").on(
      table.userId,
      table.metricType,
      table.referenceDate,
    ),
    index("idx_baselines_user_date").on(table.userId, table.referenceDate),
  ],
);
