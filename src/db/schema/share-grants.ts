import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Share permission grants.
 * Token is stored as SHA-256 hash; raw token exists only in the URL.
 * allowed_metrics is a PostgreSQL TEXT[] array.
 */
export const shareGrants = pgTable(
  "share_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 64 }).notNull().unique(),
    ownerId: varchar("owner_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 255 }).notNull(),
    note: varchar("note", { length: 1000 }),
    allowedMetrics: text("allowed_metrics").array().notNull(),
    dataStart: date("data_start").notNull(),
    dataEnd: date("data_end").notNull(),
    grantExpires: timestamp("grant_expires", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chk_share_grants_date_range",
      sql`${table.dataEnd} >= ${table.dataStart}`,
    ),
    check(
      "chk_share_grants_metrics_nonempty",
      sql`array_length(${table.allowedMetrics}, 1) IS NOT NULL AND array_length(${table.allowedMetrics}, 1) > 0`,
    ),
    // Partial index on non-revoked tokens for fast viewer validation.
    // Note: grant_expires > now() is not used in the predicate because
    // now() is STABLE, not IMMUTABLE, and PostgreSQL requires IMMUTABLE
    // functions in index predicates. Expiry is checked at the application level.
    index("idx_share_grants_active_token")
      .on(table.token)
      .where(sql`${table.revokedAt} IS NULL`),
    index("idx_share_grants_owner_created").on(table.ownerId, table.createdAt),
  ],
);
