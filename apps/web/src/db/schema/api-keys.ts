import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * API keys table.
 *
 * Stores API keys for programmatic access (CLI, MCP Server).
 * The long token (secret) is stored as a SHA-256 hash only.
 * The short token (first 8 chars) is stored in plaintext for lookup and display.
 *
 * See: /docs/cli-mcp-server-lld.md Section 7.3
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    shortToken: varchar("short_token", { length: 16 }).notNull().unique(),
    longTokenHash: varchar("long_token_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Fast lookup by short_token for authentication — partial index on non-revoked keys
    // Note: expires_at check is done at application level (now() is not IMMUTABLE for index predicates)
    index("idx_api_keys_active_short_token")
      .on(table.shortToken)
      .where(sql`${table.revokedAt} IS NULL`),
    // User's key management list
    index("idx_api_keys_user_created").on(table.userId, table.createdAt),
  ],
);
