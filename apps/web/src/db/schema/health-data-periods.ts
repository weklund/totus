import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Encrypted bounded-duration health events:
 * sleep stages, workouts, fasting windows, meals.
 *
 * duration_sec is a generated column computed from ended_at - started_at.
 * The GIST index for overlap queries requires the btree_gist extension.
 *
 * See: /docs/integrations-pipeline-lld.md §3.5
 */
export const healthDataPeriods = pgTable(
  "health_data_periods",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    subtype: varchar("subtype", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationSec: integer("duration_sec").generatedAlwaysAs(
      sql`(EXTRACT(EPOCH FROM ended_at - started_at))::INTEGER`,
    ),
    metadataEnc: bytea("metadata_enc"),
    source: varchar("source", { length: 32 }).notNull(),
    sourceId: varchar("source_id", { length: 256 }),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chk_period_end_after_start",
      sql`${table.endedAt} > ${table.startedAt}`,
    ),
    unique("uq_periods_user_type_start_source").on(
      table.userId,
      table.eventType,
      table.startedAt,
      table.source,
    ),
    // Note: The GIST index on tstzrange(started_at, ended_at) is created
    // via raw SQL migration (requires btree_gist extension).
    index("idx_periods_user_type_time").on(
      table.userId,
      table.eventType,
      table.startedAt,
      table.endedAt,
    ),
  ],
);
