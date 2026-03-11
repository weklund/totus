import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

/**
 * Check if PostgreSQL is reachable before running tests.
 */
async function isPostgresReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  const testPool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });

  try {
    const client = await testPool.connect();
    client.release();
    return true;
  } catch {
    return false;
  } finally {
    await testPool.end();
  }
}

const canConnect = await isPostgresReachable();

describe.skipIf(!canConnect)("database schema", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Helper to query column info for a table
  async function getTableColumns(tableName: string) {
    const result = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName],
    );
    return result.rows;
  }

  // Helper to query indexes for a table
  async function getTableIndexes(tableName: string) {
    const result = await pool.query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = $1
       ORDER BY indexname`,
      [tableName],
    );
    return result.rows;
  }

  // Helper to query CHECK constraints for a table
  async function getCheckConstraints(tableName: string) {
    const result = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = $1::regclass AND contype = 'c'
       ORDER BY conname`,
      [tableName],
    );
    return result.rows;
  }

  // Helper to query FK constraints for a table
  async function getForeignKeys(tableName: string) {
    const result = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = $1::regclass AND contype = 'f'
       ORDER BY conname`,
      [tableName],
    );
    return result.rows;
  }

  // =========================================================================
  // pgcrypto extension
  // =========================================================================

  describe("pgcrypto extension", () => {
    it("is enabled", async () => {
      const result = await pool.query(
        "SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].extname).toBe("pgcrypto");
    });

    it("gen_random_uuid() is available", async () => {
      const result = await pool.query("SELECT gen_random_uuid() AS uuid");
      expect(result.rows[0].uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  // =========================================================================
  // Table existence
  // =========================================================================

  describe("table existence", () => {
    const expectedTables = [
      "users",
      "provider_connections",
      "health_data_daily",
      "health_data_series",
      "health_data_periods",
      "metric_source_preferences",
      "share_grants",
      "audit_events",
    ];

    it.each(expectedTables)("table '%s' exists", async (tableName) => {
      const result = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [tableName],
      );
      expect(result.rows).toHaveLength(1);
    });

    it("oura_connections table no longer exists", async () => {
      const result = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'oura_connections'",
      );
      expect(result.rows).toHaveLength(0);
    });
  });

  // =========================================================================
  // users table
  // =========================================================================

  describe("users table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("users");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("character varying");
      expect(colMap.id.character_maximum_length).toBe(64);
      expect(colMap.id.is_nullable).toBe("NO");

      expect(colMap.display_name.data_type).toBe("character varying");
      expect(colMap.display_name.character_maximum_length).toBe(100);
      expect(colMap.display_name.is_nullable).toBe("NO");

      expect(colMap.kms_key_arn.data_type).toBe("character varying");
      expect(colMap.kms_key_arn.character_maximum_length).toBe(256);
      expect(colMap.kms_key_arn.is_nullable).toBe("NO");

      expect(colMap.created_at.data_type).toBe("timestamp with time zone");
      expect(colMap.created_at.is_nullable).toBe("NO");

      expect(colMap.updated_at.data_type).toBe("timestamp with time zone");
      expect(colMap.updated_at.is_nullable).toBe("NO");
    });

    it("has primary key on id", async () => {
      const indexes = await getTableIndexes("users");
      const pk = indexes.find(
        (i: Record<string, string>) => i.indexname === "users_pkey",
      );
      expect(pk).toBeDefined();
      expect(pk.indexdef).toContain("(id)");
    });
  });

  // =========================================================================
  // provider_connections table
  // =========================================================================

  describe("provider_connections table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("provider_connections");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("uuid");
      expect(colMap.user_id.data_type).toBe("character varying");
      expect(colMap.provider.data_type).toBe("character varying");
      expect(colMap.auth_type.data_type).toBe("character varying");
      expect(colMap.auth_enc.data_type).toBe("bytea");
      expect(colMap.token_expires_at.data_type).toBe(
        "timestamp with time zone",
      );
      expect(colMap.status.data_type).toBe("character varying");
      expect(colMap.status.is_nullable).toBe("NO");
      expect(colMap.daily_cursor.data_type).toBe("character varying");
      expect(colMap.series_cursor.data_type).toBe("character varying");
      expect(colMap.periods_cursor.data_type).toBe("character varying");
      expect(colMap.sync_status.data_type).toBe("character varying");
      expect(colMap.sync_status.is_nullable).toBe("NO");
      expect(colMap.sync_error.data_type).toBe("text");
      expect(colMap.created_at.data_type).toBe("timestamp with time zone");
      expect(colMap.updated_at.data_type).toBe("timestamp with time zone");
    });

    it("has UNIQUE constraint on (user_id, provider)", async () => {
      const indexes = await getTableIndexes("provider_connections");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_provider_connections_user_provider",
      );
      expect(uq).toBeDefined();
      expect(uq.indexdef).toContain("UNIQUE");
      expect(uq.indexdef).toContain("user_id");
      expect(uq.indexdef).toContain("provider");
    });

    it("has CHECK constraint on status/sync combo", async () => {
      const checks = await getCheckConstraints("provider_connections");
      const comboCheck = checks.find(
        (c: Record<string, string>) =>
          c.conname === "chk_valid_status_sync_combo",
      );
      expect(comboCheck).toBeDefined();
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("provider_connections");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });

    it("has correct indexes", async () => {
      const indexes = await getTableIndexes("provider_connections");
      const indexNames = indexes.map(
        (i: Record<string, string>) => i.indexname,
      );
      expect(indexNames).toContain("idx_provider_connections_user_id");
      expect(indexNames).toContain("idx_provider_connections_active_sync");
      expect(indexNames).toContain("idx_provider_connections_token_expiry");
    });
  });

  // =========================================================================
  // health_data_daily table (renamed from health_data)
  // =========================================================================

  describe("health_data_daily table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("health_data_daily");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("bigint");
      expect(colMap.user_id.data_type).toBe("character varying");
      expect(colMap.metric_type.data_type).toBe("character varying");
      expect(colMap.date.data_type).toBe("date");
      expect(colMap.value_encrypted.data_type).toBe("bytea");
      expect(colMap.source.data_type).toBe("character varying");
      expect(colMap.source_id.data_type).toBe("character varying");
      expect(colMap.source_id.is_nullable).toBe("YES");
    });

    it("has UNIQUE constraint on (user_id, metric_type, date, source)", async () => {
      const indexes = await getTableIndexes("health_data_daily");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_health_data_daily_user_metric_date_source",
      );
      expect(uq).toBeDefined();
      expect(uq.indexdef).toContain("user_id");
      expect(uq.indexdef).toContain("metric_type");
      expect(uq.indexdef).toContain("date");
      expect(uq.indexdef).toContain("source");
    });

    it("has composite indexes", async () => {
      const indexes = await getTableIndexes("health_data_daily");
      const indexNames = indexes.map(
        (i: Record<string, string>) => i.indexname,
      );
      expect(indexNames).toContain("idx_health_data_daily_user_metric_date");
      expect(indexNames).toContain("idx_health_data_daily_user_metric_summary");
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("health_data_daily");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });

    it("enforces unique constraint on duplicate data", async () => {
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ('test_hd_unique', 'Test', 'arn:test') ON CONFLICT DO NOTHING",
      );

      // Insert first row
      await pool.query(
        `INSERT INTO health_data_daily (user_id, metric_type, date, value_encrypted, source)
         VALUES ('test_hd_unique', 'sleep_score', '2026-01-01', '\\x01', 'oura')`,
      );

      // Insert duplicate should fail
      await expect(
        pool.query(
          `INSERT INTO health_data_daily (user_id, metric_type, date, value_encrypted, source)
           VALUES ('test_hd_unique', 'sleep_score', '2026-01-01', '\\x02', 'oura')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);

      // Cleanup
      await pool.query("DELETE FROM users WHERE id = 'test_hd_unique'");
    });
  });

  // =========================================================================
  // health_data_series table (partitioned)
  // =========================================================================

  describe("health_data_series table", () => {
    it("is partitioned by range on recorded_at", async () => {
      const result = await pool.query(
        `SELECT partstrat FROM pg_partitioned_table
         WHERE partrelid = 'health_data_series'::regclass`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].partstrat).toBe("r"); // range
    });

    it("has monthly partitions from 2024-01 through 2027-12", async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename LIKE 'health_data_series_20%'
         ORDER BY tablename`,
      );
      // 4 years * 12 months = 48 partitions
      expect(result.rows.length).toBe(48);
      expect(result.rows[0].tablename).toBe("health_data_series_2024_01");
      expect(result.rows[result.rows.length - 1].tablename).toBe(
        "health_data_series_2027_12",
      );
    });

    it("has a default partition", async () => {
      const result = await pool.query(
        `SELECT tablename FROM pg_tables
         WHERE schemaname = 'public' AND tablename = 'health_data_series_default'`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it("has composite PK (id, recorded_at)", async () => {
      const indexes = await getTableIndexes("health_data_series");
      const pk = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "health_data_series_pkey",
      );
      expect(pk).toBeDefined();
      expect(pk.indexdef).toContain("id");
      expect(pk.indexdef).toContain("recorded_at");
    });

    it("has UNIQUE constraint on (user_id, metric_type, recorded_at, source)", async () => {
      const indexes = await getTableIndexes("health_data_series");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_series_user_metric_time_source",
      );
      expect(uq).toBeDefined();
    });
  });

  // =========================================================================
  // health_data_periods table
  // =========================================================================

  describe("health_data_periods table", () => {
    it("has correct columns including generated duration_sec", async () => {
      const columns = await getTableColumns("health_data_periods");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("bigint");
      expect(colMap.user_id.data_type).toBe("character varying");
      expect(colMap.event_type.data_type).toBe("character varying");
      expect(colMap.subtype.data_type).toBe("character varying");
      expect(colMap.started_at.data_type).toBe("timestamp with time zone");
      expect(colMap.ended_at.data_type).toBe("timestamp with time zone");
      expect(colMap.duration_sec.data_type).toBe("integer");
      expect(colMap.metadata_enc.data_type).toBe("bytea");
      expect(colMap.source.data_type).toBe("character varying");
    });

    it("has CHECK constraint (ended_at > started_at)", async () => {
      const checks = await getCheckConstraints("health_data_periods");
      const endCheck = checks.find(
        (c: Record<string, string>) =>
          c.conname === "chk_period_end_after_start",
      );
      expect(endCheck).toBeDefined();
    });

    it("has UNIQUE constraint on (user_id, event_type, started_at, source)", async () => {
      const indexes = await getTableIndexes("health_data_periods");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_periods_user_type_start_source",
      );
      expect(uq).toBeDefined();
    });

    it("has GIST index for overlap queries", async () => {
      const indexes = await getTableIndexes("health_data_periods");
      const gist = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "idx_periods_user_timerange",
      );
      expect(gist).toBeDefined();
      expect(gist.indexdef).toContain("USING gist");
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("health_data_periods");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });
  });

  // =========================================================================
  // metric_source_preferences table
  // =========================================================================

  describe("metric_source_preferences table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("metric_source_preferences");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.user_id.data_type).toBe("character varying");
      expect(colMap.metric_type.data_type).toBe("character varying");
      expect(colMap.provider.data_type).toBe("character varying");
      expect(colMap.updated_at.data_type).toBe("timestamp with time zone");
    });

    it("has composite PK on (user_id, metric_type)", async () => {
      const indexes = await getTableIndexes("metric_source_preferences");
      const pk = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "metric_source_preferences_pkey",
      );
      expect(pk).toBeDefined();
      expect(pk.indexdef).toContain("user_id");
      expect(pk.indexdef).toContain("metric_type");
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("metric_source_preferences");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });
  });

  // =========================================================================
  // btree_gist extension
  // =========================================================================

  describe("btree_gist extension", () => {
    it("is enabled", async () => {
      const result = await pool.query(
        "SELECT extname FROM pg_extension WHERE extname = 'btree_gist'",
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].extname).toBe("btree_gist");
    });
  });

  // =========================================================================
  // share_grants table
  // =========================================================================

  describe("share_grants table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("share_grants");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("uuid");
      expect(colMap.token.data_type).toBe("character varying");
      expect(colMap.owner_id.data_type).toBe("character varying");
      expect(colMap.allowed_metrics.data_type).toBe("ARRAY");
      expect(colMap.data_start.data_type).toBe("date");
      expect(colMap.data_end.data_type).toBe("date");
      expect(colMap.grant_expires.data_type).toBe("timestamp with time zone");
      expect(colMap.view_count.data_type).toBe("integer");
    });

    it("has UNIQUE constraint on token", async () => {
      const indexes = await getTableIndexes("share_grants");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "share_grants_token_unique",
      );
      expect(uq).toBeDefined();
      expect(uq.indexdef).toContain("UNIQUE");
    });

    it("has partial index on active tokens", async () => {
      const indexes = await getTableIndexes("share_grants");
      const activeIdx = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "idx_share_grants_active_token",
      );
      expect(activeIdx).toBeDefined();
      expect(activeIdx.indexdef).toContain("WHERE");
      expect(activeIdx.indexdef).toContain("revoked_at IS NULL");
    });

    it("has CHECK constraint on date range (data_end >= data_start)", async () => {
      const checks = await getCheckConstraints("share_grants");
      const dateCheck = checks.find(
        (c: Record<string, string>) =>
          c.conname === "chk_share_grants_date_range",
      );
      expect(dateCheck).toBeDefined();
    });

    it("has CHECK constraint on metrics non-empty", async () => {
      const checks = await getCheckConstraints("share_grants");
      const metricsCheck = checks.find(
        (c: Record<string, string>) =>
          c.conname === "chk_share_grants_metrics_nonempty",
      );
      expect(metricsCheck).toBeDefined();
    });

    it("rejects data_end < data_start", async () => {
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ('test_sg_dates', 'Test', 'arn:test') ON CONFLICT DO NOTHING",
      );

      await expect(
        pool.query(
          `INSERT INTO share_grants (owner_id, token, label, allowed_metrics, data_start, data_end, grant_expires)
           VALUES ('test_sg_dates', 'tok_date_check', 'Test', ARRAY['sleep_score'], '2026-03-08', '2026-03-01', now() + interval '30 days')`,
        ),
      ).rejects.toThrow(/check/i);

      // Cleanup
      await pool.query("DELETE FROM users WHERE id = 'test_sg_dates'");
    });

    it("rejects empty allowed_metrics array", async () => {
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ('test_sg_metrics', 'Test', 'arn:test') ON CONFLICT DO NOTHING",
      );

      await expect(
        pool.query(
          `INSERT INTO share_grants (owner_id, token, label, allowed_metrics, data_start, data_end, grant_expires)
           VALUES ('test_sg_metrics', 'tok_metrics_check', 'Test', ARRAY[]::text[], '2026-01-01', '2026-03-01', now() + interval '30 days')`,
        ),
      ).rejects.toThrow(/check/i);

      // Cleanup
      await pool.query("DELETE FROM users WHERE id = 'test_sg_metrics'");
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("share_grants");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });
  });

  // =========================================================================
  // audit_events table
  // =========================================================================

  describe("audit_events table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("audit_events");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("bigint");
      expect(colMap.owner_id.data_type).toBe("character varying");
      expect(colMap.actor_type.data_type).toBe("character varying");
      expect(colMap.grant_id.data_type).toBe("uuid");
      expect(colMap.event_type.data_type).toBe("character varying");
      expect(colMap.resource_detail.data_type).toBe("jsonb");
      expect(colMap.ip_address.data_type).toBe("inet");
    });

    it("owner_id is NOT a foreign key", async () => {
      const fks = await getForeignKeys("audit_events");
      expect(fks).toHaveLength(0);
    });

    it("has CHECK constraint on actor_type", async () => {
      const checks = await getCheckConstraints("audit_events");
      const actorCheck = checks.find(
        (c: Record<string, string>) => c.conname === "chk_audit_actor_type",
      );
      expect(actorCheck).toBeDefined();
    });

    it("has correct indexes", async () => {
      const indexes = await getTableIndexes("audit_events");
      const indexNames = indexes.map(
        (i: Record<string, string>) => i.indexname,
      );
      expect(indexNames).toContain("idx_audit_events_owner_created");
      expect(indexNames).toContain("idx_audit_events_grant_created");
      expect(indexNames).toContain("idx_audit_events_owner_type_created");
    });

    it("has partial index on grant_id", async () => {
      const indexes = await getTableIndexes("audit_events");
      const grantIdx = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "idx_audit_events_grant_created",
      );
      expect(grantIdx).toBeDefined();
      expect(grantIdx.indexdef).toContain("WHERE");
      expect(grantIdx.indexdef).toContain("grant_id IS NOT NULL");
    });

    it("rejects invalid actor_type values", async () => {
      await expect(
        pool.query(
          `INSERT INTO audit_events (owner_id, actor_type, event_type)
           VALUES ('test_actor', 'invalid_type', 'test.event')`,
        ),
      ).rejects.toThrow(/check/i);
    });
  });

  // =========================================================================
  // Foreign key cascades
  // =========================================================================

  describe("foreign key cascades", () => {
    const testUserId = "test_cascade_user";

    beforeAll(async () => {
      // Create a test user with child records
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ($1, 'Cascade Test', 'arn:test')",
        [testUserId],
      );

      // Create provider connection
      await pool.query(
        `INSERT INTO provider_connections (user_id, provider, auth_type, auth_enc, token_expires_at)
         VALUES ($1, 'oura', 'oauth2', '\\x01', now() + interval '1 hour')`,
        [testUserId],
      );

      // Create health data
      await pool.query(
        `INSERT INTO health_data_daily (user_id, metric_type, date, value_encrypted, source)
         VALUES ($1, 'sleep_score', '2026-01-01', '\\x01', 'oura')`,
        [testUserId],
      );

      // Create share grant
      await pool.query(
        `INSERT INTO share_grants (owner_id, token, label, allowed_metrics, data_start, data_end, grant_expires)
         VALUES ($1, 'tok_cascade_test', 'Test', ARRAY['sleep_score'], '2026-01-01', '2026-03-01', now() + interval '30 days')`,
        [testUserId],
      );

      // Create audit event (uses owner_id, NOT a FK)
      await pool.query(
        `INSERT INTO audit_events (owner_id, actor_type, actor_id, event_type)
         VALUES ($1, 'owner', $1, 'test.cascade')`,
        [testUserId],
      );
    });

    it("deleting a user cascades to provider_connections", async () => {
      // Verify child records exist before deletion
      const connBefore = await pool.query(
        "SELECT COUNT(*) AS cnt FROM provider_connections WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(connBefore.rows[0].cnt)).toBe(1);

      // Delete user
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);

      // Verify child records are gone
      const connAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM provider_connections WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(connAfter.rows[0].cnt)).toBe(0);
    });

    it("deleting a user cascades to health_data_daily", async () => {
      const hdAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM health_data_daily WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(hdAfter.rows[0].cnt)).toBe(0);
    });

    it("deleting a user cascades to share_grants", async () => {
      const sgAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM share_grants WHERE owner_id = $1",
        [testUserId],
      );
      expect(parseInt(sgAfter.rows[0].cnt)).toBe(0);
    });

    it("audit events persist after user deletion (owner_id is NOT a FK)", async () => {
      const auditAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM audit_events WHERE owner_id = $1",
        [testUserId],
      );
      expect(parseInt(auditAfter.rows[0].cnt)).toBeGreaterThan(0);

      // Cleanup audit events manually (must disable immutability trigger first)
      await pool.query(
        "ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable",
      );
      await pool.query("DELETE FROM audit_events WHERE owner_id = $1", [
        testUserId,
      ]);
      await pool.query(
        "ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable",
      );
    });
  });

  // =========================================================================
  // provider_connections UNIQUE enforcement
  // =========================================================================

  describe("provider_connections unique (user_id, provider) enforcement", () => {
    const testUserId = "test_pc_unique";

    afterAll(async () => {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    });

    it("rejects duplicate (user_id, provider) in provider_connections", async () => {
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ($1, 'Test', 'arn:test') ON CONFLICT DO NOTHING",
        [testUserId],
      );

      await pool.query(
        `INSERT INTO provider_connections (user_id, provider, auth_type, auth_enc, token_expires_at)
         VALUES ($1, 'oura', 'oauth2', '\\x01', now() + interval '1 hour')`,
        [testUserId],
      );

      await expect(
        pool.query(
          `INSERT INTO provider_connections (user_id, provider, auth_type, auth_enc, token_expires_at)
           VALUES ($1, 'oura', 'oauth2', '\\x02', now() + interval '2 hours')`,
          [testUserId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });

    it("allows different providers for the same user", async () => {
      // oura was already inserted above; dexcom should work
      await pool.query(
        `INSERT INTO provider_connections (user_id, provider, auth_type, auth_enc, token_expires_at)
         VALUES ($1, 'dexcom', 'oauth2', '\\x01', now() + interval '1 hour')`,
        [testUserId],
      );

      const result = await pool.query(
        "SELECT COUNT(*) AS cnt FROM provider_connections WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(result.rows[0].cnt)).toBeGreaterThanOrEqual(2);
    });
  });
});
