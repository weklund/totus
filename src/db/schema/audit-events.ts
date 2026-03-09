import {
  bigserial,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Immutable audit log.
 * INSERT and SELECT only — no UPDATE or DELETE permitted.
 * owner_id is NOT a foreign key to users(id) because audit events
 * must persist after account deletion.
 * grant_id is NOT a foreign key — grant may be deleted while audit persists.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ownerId: varchar("owner_id", { length: 64 }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull(),
    actorId: varchar("actor_id", { length: 64 }),
    grantId: uuid("grant_id"),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }),
    resourceDetail: jsonb("resource_detail"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    sessionId: varchar("session_id", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chk_audit_actor_type",
      sql`${table.actorType} IN ('owner', 'viewer', 'system')`,
    ),
    index("idx_audit_events_owner_created").on(table.ownerId, table.createdAt),
    index("idx_audit_events_grant_created")
      .on(table.grantId, table.createdAt)
      .where(sql`${table.grantId} IS NOT NULL`),
    index("idx_audit_events_owner_type_created").on(
      table.ownerId,
      table.eventType,
      table.createdAt,
    ),
  ],
);
