import {
  date,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * Tracks which insight types a user has dismissed for which dates.
 * No encryption needed — stores only the fact of dismissal, not health content.
 * Composite PK on (user_id, insight_type, reference_date).
 *
 * See: /docs/dashboard-backend-lld.md §3.4
 */
export const dismissedInsights = pgTable(
  "dismissed_insights",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    insightType: varchar("insight_type", { length: 64 }).notNull(),
    referenceDate: date("reference_date").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.userId, table.insightType, table.referenceDate],
    }),
  ],
);
