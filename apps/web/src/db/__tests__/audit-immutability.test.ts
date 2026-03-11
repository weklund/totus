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

describe.skipIf(!canConnect)("audit log immutability", () => {
  let pool: Pool;
  const testUserId = "test_audit_immut";

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });

    // Ensure the trigger exists
    const triggerResult = await pool.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'audit_events'::regclass
         AND tgname = 'trg_audit_events_immutable'`,
    );
    expect(triggerResult.rows).toHaveLength(1);

    // Ensure the trigger function exists
    const funcResult = await pool.query(
      `SELECT proname FROM pg_proc
       WHERE proname = 'prevent_audit_mutation'`,
    );
    expect(funcResult.rows).toHaveLength(1);

    // Create a test user for cascade tests
    await pool.query(
      "INSERT INTO users (id, display_name, kms_key_arn) VALUES ($1, 'Audit Immutability Test', 'arn:test') ON CONFLICT DO NOTHING",
      [testUserId],
    );
  });

  afterAll(async () => {
    // Clean up: disable trigger temporarily to remove test audit events
    await pool.query(
      "ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable",
    );
    await pool.query("DELETE FROM audit_events WHERE owner_id = $1", [
      testUserId,
    ]);
    await pool.query(
      "ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable",
    );

    // Clean up test user (if still exists)
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);

    await pool.end();
  });

  // =========================================================================
  // Trigger and function existence
  // =========================================================================

  describe("trigger setup", () => {
    it("prevent_audit_mutation function exists", async () => {
      const result = await pool.query(
        `SELECT proname, prolang, prosrc FROM pg_proc
         WHERE proname = 'prevent_audit_mutation'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].proname).toBe("prevent_audit_mutation");
    });

    it("trg_audit_events_immutable trigger exists on audit_events", async () => {
      const result = await pool.query(
        `SELECT tgname, tgtype FROM pg_trigger
         WHERE tgrelid = 'audit_events'::regclass
           AND tgname = 'trg_audit_events_immutable'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].tgname).toBe("trg_audit_events_immutable");
    });

    it("trigger fires BEFORE UPDATE OR DELETE", async () => {
      const result = await pool.query(
        `SELECT tgenabled, tgtype FROM pg_trigger
         WHERE tgrelid = 'audit_events'::regclass
           AND tgname = 'trg_audit_events_immutable'`,
      );
      expect(result.rows).toHaveLength(1);
      // tgtype is a bitmask: bit 0 = ROW, bit 1 = BEFORE, bit 2 = INSERT,
      // bit 3 = DELETE, bit 4 = UPDATE, bit 5 = TRUNCATE
      // BEFORE (2) + ROW (1) + DELETE (8) + UPDATE (16) = 27
      const tgtype = result.rows[0].tgtype;
      expect(tgtype & 1).toBe(1); // FOR EACH ROW
      expect(tgtype & 2).toBe(2); // BEFORE
      expect(tgtype & 8).toBe(8); // DELETE
      expect(tgtype & 16).toBe(16); // UPDATE
    });
  });

  // =========================================================================
  // INSERT succeeds
  // =========================================================================

  describe("INSERT operations", () => {
    it("INSERT into audit_events succeeds", async () => {
      const result = await pool.query(
        `INSERT INTO audit_events (owner_id, actor_type, actor_id, event_type, resource_type)
         VALUES ($1, 'owner', $1, 'test.insert', 'test')
         RETURNING id, owner_id, event_type`,
        [testUserId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].owner_id).toBe(testUserId);
      expect(result.rows[0].event_type).toBe("test.insert");
    });

    it("INSERT with all fields succeeds", async () => {
      const result = await pool.query(
        `INSERT INTO audit_events (
           owner_id, actor_type, actor_id, grant_id, event_type,
           resource_type, resource_detail, ip_address, user_agent, session_id
         ) VALUES (
           $1, 'viewer', 'viewer_001', gen_random_uuid(), 'share.viewed',
           'health_data', '{"metrics": ["sleep_score"]}'::jsonb, '192.168.1.1', 'TestAgent/1.0', 'sess_123'
         ) RETURNING id`,
        [testUserId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBeDefined();
    });
  });

  // =========================================================================
  // UPDATE fails
  // =========================================================================

  describe("UPDATE operations", () => {
    it("UPDATE on audit_events raises an error", async () => {
      // First insert a row to attempt to update
      const insertResult = await pool.query(
        `INSERT INTO audit_events (owner_id, actor_type, event_type)
         VALUES ($1, 'owner', 'test.update_target')
         RETURNING id`,
        [testUserId],
      );
      const id = insertResult.rows[0].id;

      // Attempt to update — should fail
      await expect(
        pool.query(
          "UPDATE audit_events SET event_type = 'hacked' WHERE id = $1",
          [id],
        ),
      ).rejects.toThrow(/immutable.*UPDATE.*not permitted/i);
    });

    it("UPDATE with SET on any column fails", async () => {
      await expect(
        pool.query(
          "UPDATE audit_events SET owner_id = 'hacked' WHERE owner_id = $1",
          [testUserId],
        ),
      ).rejects.toThrow(/immutable/i);
    });

    it("UPDATE with WHERE matching no rows still succeeds (trigger not fired)", async () => {
      // When no rows match, the trigger doesn't fire, so this should succeed
      const result = await pool.query(
        "UPDATE audit_events SET event_type = 'hacked' WHERE owner_id = 'nonexistent_user_xyz'",
      );
      expect(result.rowCount).toBe(0);
    });
  });

  // =========================================================================
  // DELETE fails
  // =========================================================================

  describe("DELETE operations", () => {
    it("DELETE on audit_events raises an error", async () => {
      // First insert a row to attempt to delete
      const insertResult = await pool.query(
        `INSERT INTO audit_events (owner_id, actor_type, event_type)
         VALUES ($1, 'owner', 'test.delete_target')
         RETURNING id`,
        [testUserId],
      );
      const id = insertResult.rows[0].id;

      // Attempt to delete — should fail
      await expect(
        pool.query("DELETE FROM audit_events WHERE id = $1", [id]),
      ).rejects.toThrow(/immutable.*DELETE.*not permitted/i);
    });

    it("DELETE with broader WHERE clause also fails", async () => {
      await expect(
        pool.query("DELETE FROM audit_events WHERE owner_id = $1", [
          testUserId,
        ]),
      ).rejects.toThrow(/immutable/i);
    });

    it("DELETE with WHERE matching no rows still succeeds (trigger not fired)", async () => {
      // When no rows match, the trigger doesn't fire, so this should succeed
      const result = await pool.query(
        "DELETE FROM audit_events WHERE owner_id = 'nonexistent_user_xyz'",
      );
      expect(result.rowCount).toBe(0);
    });
  });

  // =========================================================================
  // Audit events persist after user deletion
  // =========================================================================

  describe("audit events persist after user deletion", () => {
    const cascadeUserId = "test_audit_cascade";

    beforeAll(async () => {
      // Create a user
      await pool.query(
        "INSERT INTO users (id, display_name, kms_key_arn) VALUES ($1, 'Cascade Test', 'arn:test') ON CONFLICT DO NOTHING",
        [cascadeUserId],
      );

      // Create audit events for this user
      await pool.query(
        `INSERT INTO audit_events (owner_id, actor_type, actor_id, event_type)
         VALUES ($1, 'owner', $1, 'data.viewed'),
                ($1, 'owner', $1, 'share.created'),
                ($1, 'system', 'system', 'connection.synced')`,
        [cascadeUserId],
      );
    });

    afterAll(async () => {
      // Clean up audit events (requires disabling trigger)
      await pool.query(
        "ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable",
      );
      await pool.query("DELETE FROM audit_events WHERE owner_id = $1", [
        cascadeUserId,
      ]);
      await pool.query(
        "ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable",
      );
    });

    it("audit events exist before user deletion", async () => {
      const result = await pool.query(
        "SELECT COUNT(*) AS cnt FROM audit_events WHERE owner_id = $1",
        [cascadeUserId],
      );
      expect(parseInt(result.rows[0].cnt)).toBe(3);
    });

    it("user can be deleted successfully", async () => {
      const result = await pool.query("DELETE FROM users WHERE id = $1", [
        cascadeUserId,
      ]);
      expect(result.rowCount).toBe(1);
    });

    it("audit events persist after user deletion", async () => {
      // User is gone
      const userResult = await pool.query(
        "SELECT COUNT(*) AS cnt FROM users WHERE id = $1",
        [cascadeUserId],
      );
      expect(parseInt(userResult.rows[0].cnt)).toBe(0);

      // But audit events remain
      const auditResult = await pool.query(
        "SELECT COUNT(*) AS cnt FROM audit_events WHERE owner_id = $1",
        [cascadeUserId],
      );
      expect(parseInt(auditResult.rows[0].cnt)).toBe(3);
    });

    it("persisted audit events retain all their data", async () => {
      const result = await pool.query(
        "SELECT owner_id, actor_type, event_type FROM audit_events WHERE owner_id = $1 ORDER BY event_type",
        [cascadeUserId],
      );
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].event_type).toBe("connection.synced");
      expect(result.rows[1].event_type).toBe("data.viewed");
      expect(result.rows[2].event_type).toBe("share.created");
    });
  });

  // =========================================================================
  // SELECT still works (read-only operations)
  // =========================================================================

  describe("SELECT operations", () => {
    it("SELECT from audit_events works normally", async () => {
      const result = await pool.query(
        "SELECT COUNT(*) AS cnt FROM audit_events WHERE owner_id = $1",
        [testUserId],
      );
      expect(parseInt(result.rows[0].cnt)).toBeGreaterThan(0);
    });

    it("SELECT with complex queries works normally", async () => {
      const result = await pool.query(
        `SELECT owner_id, event_type, created_at
         FROM audit_events
         WHERE owner_id = $1
         ORDER BY created_at DESC
         LIMIT 5`,
        [testUserId],
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });
});
