import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Provider connections — OAuth connections to health data providers.
 * Replaces oura_connections. One row per (user, provider) pair.
 * Tokens are encrypted with the user's DEK (envelope encryption).
 *
 * See: /docs/integrations-pipeline-lld.md §3.1
 */
export const providerConnections = pgTable(
  "provider_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    authType: varchar("auth_type", { length: 16 }).notNull(),
    authEnc: bytea("auth_enc").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    dailyCursor: varchar("daily_cursor", { length: 256 }),
    seriesCursor: varchar("series_cursor", { length: 256 }),
    periodsCursor: varchar("periods_cursor", { length: 256 }),
    syncStatus: varchar("sync_status", { length: 16 })
      .notNull()
      .default("idle"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_provider_connections_user_provider").on(
      table.userId,
      table.provider,
    ),
    index("idx_provider_connections_user_id").on(table.userId),
    index("idx_provider_connections_active_sync")
      .on(table.status, table.syncStatus)
      .where(sql`${table.status} = 'active'`),
    index("idx_provider_connections_token_expiry")
      .on(table.tokenExpiresAt)
      .where(
        sql`${table.status} = 'active' AND ${table.tokenExpiresAt} IS NOT NULL`,
      ),
    check(
      "chk_valid_status_sync_combo",
      sql`NOT (${table.status} IN ('expired', 'paused') AND ${table.syncStatus} = 'syncing')`,
    ),
  ],
);
