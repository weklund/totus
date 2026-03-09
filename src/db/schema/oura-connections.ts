import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { bytea } from "./custom-types";

/**
 * Oura Ring OAuth connections.
 * Tokens are encrypted with the user's DEK (envelope encryption).
 * One connection per user (UNIQUE on user_id).
 */
export const ouraConnections = pgTable(
  "oura_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessTokenEnc: bytea("access_token_enc").notNull(),
    refreshTokenEnc: bytea("refresh_token_enc").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
    }).notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncCursor: varchar("sync_cursor", { length: 256 }),
    syncStatus: varchar("sync_status", { length: 16 })
      .notNull()
      .default("idle"),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("uq_oura_connections_user").on(table.userId),
    index("idx_oura_connections_user_id").on(table.userId),
    check(
      "chk_oura_sync_status",
      sql`${table.syncStatus} IN ('idle', 'syncing', 'error')`,
    ),
  ],
);
