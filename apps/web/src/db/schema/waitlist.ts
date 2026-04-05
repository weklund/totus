import { pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Waitlist signups from the landing page.
 * Captures email + device interest for demand validation.
 */
export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  devices: varchar("devices", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
