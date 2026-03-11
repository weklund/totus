# PostgreSQL Partitioning with Drizzle ORM

## Status: No native Drizzle support (issue #2854 open)

## Recommended Approach: Hybrid

1. Define table in Drizzle schema (for TypeScript types)
2. Use raw SQL migration for PARTITION BY clause
3. Queries work transparently (PG handles partition pruning)

## Schema Definition

```ts
export const healthDataSeries = pgTable(
  "health_data_series",
  {
    id: bigserial("id", { mode: "bigint" }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    metricType: varchar("metric_type", { length: 64 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    valueEncrypted: bytea("value_encrypted").notNull(),
    source: varchar("source", { length: 32 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.id, t.recordedAt] })],
);
```

## Raw SQL Migration

```sql
DROP TABLE IF EXISTS "health_data_series";
CREATE TABLE "health_data_series" (...) PARTITION BY RANGE ("recorded_at");
CREATE TABLE health_data_series_2026_01 PARTITION OF health_data_series
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
-- ... more months
CREATE TABLE health_data_series_default PARTITION OF health_data_series DEFAULT;
```

## Partition Management

```ts
async function ensurePartitions(db, monthsAhead = 3) {
  for (let i = 0; i < monthsAhead; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const name = `health_data_series_${start.getFullYear()}_${String(start.getMonth() + 1).padStart(2, "0")}`;
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF health_data_series FOR VALUES FROM ('${start}') TO ('${end}');`,
      ),
    );
  }
}
```

## Key Gotchas

1. Partition key MUST be in primary key (composite PK required)
2. Don't use drizzle-kit push after partitioned tables exist
3. Only use drizzle-kit generate + migrate with hand-written SQL
4. bigserial sequence shared across all partitions (IDs globally unique)
5. No FK constraints on partitioned tables (enforce in app layer)
6. Default partition catches data outside defined ranges
7. Indexes on parent auto-apply to all partitions
