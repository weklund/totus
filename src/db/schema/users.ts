import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Users table.
 * Stores registered Totus users. ID is the Clerk user ID (e.g., "user_2xABC123").
 */
export const users = pgTable("users", {
  id: varchar("id", { length: 64 }).primaryKey(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  kmsKeyArn: varchar("kms_key_arn", { length: 256 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
