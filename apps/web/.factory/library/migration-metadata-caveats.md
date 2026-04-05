# Drizzle Migration Metadata Caveats

## Scope

Observed during scrutiny review of `database-schemas-and-migration` for milestone `foundation`.

## Findings

- `drizzle/0003_dashboard-tables.sql` can define new tables while `drizzle/meta/0003_snapshot.json` omits them.
- When SQL migration content and snapshot metadata diverge, future `npm run db:generate` runs may produce incorrect diffs or rename prompts.

## Practical Impact

- Treat `drizzle/meta/_journal.json` and `drizzle/meta/*_snapshot.json` as part of migration correctness, not just `drizzle/*.sql`.
- Validate that each new migration snapshot includes the same structural objects introduced by the paired SQL migration.
