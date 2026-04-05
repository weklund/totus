import {
  bigserial,
  check,
  index,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Manual event markers created by users (meals, workouts, travel, etc.).
 * Labels and notes are encrypted; event_type and timestamps are plaintext
 * for filtering and time-range queries.
 *
 * See: /docs/dashboard-backend-lld.md §3.3
 */
export const userAnnotations = pgTable(
  "user_annotations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    labelEncrypted: bytea("label_encrypted").notNull(),
    noteEncrypted: bytea("note_encrypted"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_annotations_user_time").on(table.userId, table.occurredAt),
    check(
      "chk_annotation_type",
      sql`event_type IN ('meal', 'workout', 'travel', 'alcohol', 'medication', 'supplement', 'custom')`,
    ),
    check(
      "chk_annotation_duration",
      sql`${table.endedAt} IS NULL OR ${table.endedAt} > ${table.occurredAt}`,
    ),
  ],
);
