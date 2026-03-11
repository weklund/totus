import { pgTable, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * User-set preferred data source per metric type.
 * Used for source resolution at query time.
 *
 * Composite PK on (user_id, metric_type) — no surrogate UUID needed.
 *
 * See: /docs/integrations-pipeline-lld.md §3.2
 */
export const metricSourcePreferences = pgTable(
  "metric_source_preferences",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    metricType: varchar("metric_type", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 32 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.metricType] })],
);
