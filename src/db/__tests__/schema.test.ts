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
      "oura_connections",
      "health_data",
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
  // oura_connections table
  // =========================================================================

  describe("oura_connections table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("oura_connections");
      const colMap = Object.fromEntries(
        columns.map((c: Record<string, unknown>) => [c.column_name, c]),
      );

      expect(colMap.id.data_type).toBe("uuid");
      expect(colMap.user_id.data_type).toBe("character varying");
      expect(colMap.access_token_enc.data_type).toBe("bytea");
      expect(colMap.refresh_token_enc.data_type).toBe("bytea");
      expect(colMap.token_expires_at.data_type).toBe(
        "timestamp with time zone",
      );
      expect(colMap.sync_status.data_type).toBe("character varying");
      expect(colMap.sync_status.is_nullable).toBe("NO");
    });

    it("has UNIQUE constraint on user_id", async () => {
      const indexes = await getTableIndexes("oura_connections");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_oura_connections_user",
      );
      expect(uq).toBeDefined();
      expect(uq.indexdef).toContain("UNIQUE");
    });

    it("has CHECK constraint on sync_status", async () => {
      const checks = await getCheckConstraints("oura_connections");
      const syncCheck = checks.find(
        (c: Record<string, string>) => c.conname === "chk_oura_sync_status",
      );
      expect(syncCheck).toBeDefined();
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("oura_connections");
      const userFk = fks.find((f: Record<string, string>) =>
        f.definition.includes("REFERENCES users(id)"),
      );
      expect(userFk).toBeDefined();
      expect(userFk.definition).toContain("ON DELETE CASCADE");
    });

    it("rejects invalid sync_status values", async () => {
      // Insert a test user first
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ('test_sync_check', 'Test', 'arn:test') ON CONFLICT DO NOTHING",
      );

      await expect(
        pool.query(
          `INSERT INTO oura_connections (user_id, access_token_enc, refresh_token_enc, token_expires_at, sync_status)
           VALUES ('test_sync_check', '\\x01', '\\x01', now() + interval '1 hour', 'invalid_status')`,
        ),
      ).rejects.toThrow(/check/i);

      // Cleanup
      await pool.query("DELETE FROM users WHERE id = 'test_sync_check'");
    });
  });

  // =========================================================================
  // health_data table
  // =========================================================================

  describe("health_data table", () => {
    it("has correct columns", async () => {
      const columns = await getTableColumns("health_data");
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
      const indexes = await getTableIndexes("health_data");
      const uq = indexes.find(
        (i: Record<string, string>) =>
          i.indexname === "uq_health_data_user_metric_date_source",
      );
      expect(uq).toBeDefined();
      expect(uq.indexdef).toContain("user_id");
      expect(uq.indexdef).toContain("metric_type");
      expect(uq.indexdef).toContain("date");
      expect(uq.indexdef).toContain("source");
    });

    it("has composite indexes", async () => {
      const indexes = await getTableIndexes("health_data");
      const indexNames = indexes.map(
        (i: Record<string, string>) => i.indexname,
      );
      expect(indexNames).toContain("idx_health_data_user_metric_date");
      expect(indexNames).toContain("idx_health_data_user_metric_summary");
    });

    it("has FK to users with CASCADE", async () => {
      const fks = await getForeignKeys("health_data");
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
        `INSERT INTO health_data (user_id, metric_type, date, value_encrypted, source)
         VALUES ('test_hd_unique', 'sleep_score', '2026-01-01', '\\x01', 'oura')`,
      );

      // Insert duplicate should fail
      await expect(
        pool.query(
          `INSERT INTO health_data (user_id, metric_type, date, value_encrypted, source)
           VALUES ('test_hd_unique', 'sleep_score', '2026-01-01', '\\x02', 'oura')`,
        ),
      ).rejects.toThrow(/unique|duplicate/i);

      // Cleanup
      await pool.query("DELETE FROM users WHERE id = 'test_hd_unique'");
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

      // Create oura connection
      await pool.query(
        `INSERT INTO oura_connections (user_id, access_token_enc, refresh_token_enc, token_expires_at)
         VALUES ($1, '\\x01', '\\x01', now() + interval '1 hour')`,
        [testUserId],
      );

      // Create health data
      await pool.query(
        `INSERT INTO health_data (user_id, metric_type, date, value_encrypted, source)
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

    it("deleting a user cascades to oura_connections", async () => {
      // Verify child records exist before deletion
      const connBefore = await pool.query(
        "SELECT COUNT(*) AS cnt FROM oura_connections WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(connBefore.rows[0].cnt)).toBe(1);

      // Delete user
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);

      // Verify child records are gone
      const connAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM oura_connections WHERE user_id = $1",
        [testUserId],
      );
      expect(parseInt(connAfter.rows[0].cnt)).toBe(0);
    });

    it("deleting a user cascades to health_data", async () => {
      const hdAfter = await pool.query(
        "SELECT COUNT(*) AS cnt FROM health_data WHERE user_id = $1",
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
  // OURA connections UNIQUE enforcement
  // =========================================================================

  describe("oura_connections unique user_id enforcement", () => {
    const testUserId = "test_oura_unique";

    afterAll(async () => {
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    });

    it("rejects duplicate user_id in oura_connections", async () => {
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ($1, 'Test', 'arn:test') ON CONFLICT DO NOTHING",
        [testUserId],
      );

      await pool.query(
        `INSERT INTO oura_connections (user_id, access_token_enc, refresh_token_enc, token_expires_at)
         VALUES ($1, '\\x01', '\\x01', now() + interval '1 hour')`,
        [testUserId],
      );

      await expect(
        pool.query(
          `INSERT INTO oura_connections (user_id, access_token_enc, refresh_token_enc, token_expires_at)
           VALUES ($1, '\\x02', '\\x02', now() + interval '2 hours')`,
          [testUserId],
        ),
      ).rejects.toThrow(/unique|duplicate/i);
    });
  });
});
