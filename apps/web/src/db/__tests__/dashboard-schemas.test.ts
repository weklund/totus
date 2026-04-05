/**
 * Integration tests for dashboard database schemas:
 *
 * 1. VAL-DB-002: Metric baselines encryption at rest — write a baseline row,
 *    read raw value_encrypted, verify it is non-JSON ciphertext, decrypt and
 *    verify BaselinePayload shape.
 *
 * 2. VAL-DB-004: CASCADE deletion — insert rows in metric_baselines,
 *    user_annotations, dismissed_insights for a user, delete the user,
 *    assert zero rows remain in all 3 tables.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

// ─── Postgres connectivity check ─────────────────────────────────────────────

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

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: Pool;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let metricBaselines: typeof import("@/db/schema").metricBaselines;
let userAnnotations: typeof import("@/db/schema").userAnnotations;
let dismissedInsights: typeof import("@/db/schema").dismissedInsights;
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

const TEST_USER_ID = "db_dashboard_test_001";

// ─── Setup & Teardown ────────────────────────────────────────────────────────

describe.skipIf(!canConnect)("dashboard schema integration", () => {
  beforeAll(async () => {
    // Ensure env vars
    process.env.ENCRYPTION_KEY =
      process.env.ENCRYPTION_KEY ||
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // Import modules
    const dbModule = await import("@/db");
    pool = dbModule.pool;
    db = dbModule.db;

    const schema = await import("@/db/schema");
    users = schema.users;
    metricBaselines = schema.metricBaselines;
    userAnnotations = schema.userAnnotations;
    dismissedInsights = schema.dismissedInsights;

    const encModule = await import("@/lib/encryption");
    createEncryptionProvider = encModule.createEncryptionProvider;
  });

  afterEach(async () => {
    // Clean up in correct FK order (children first, then user)
    await pool
      .query(`DELETE FROM metric_baselines WHERE user_id = $1`, [TEST_USER_ID])
      .catch(() => {});
    await pool
      .query(`DELETE FROM user_annotations WHERE user_id = $1`, [TEST_USER_ID])
      .catch(() => {});
    await pool
      .query(`DELETE FROM dismissed_insights WHERE user_id = $1`, [
        TEST_USER_ID,
      ])
      .catch(() => {});
    await pool
      .query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
      .catch(() => {});
  });

  afterAll(async () => {
    await pool.end();
  });

  // Helper: create test user
  async function createTestUser() {
    await db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        displayName: "Dashboard Schema Test User",
        kmsKeyArn: "local-dev-key",
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          displayName: "Dashboard Schema Test User",
          updatedAt: new Date(),
        },
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VAL-DB-002: Baseline values encrypted at rest
  // ═══════════════════════════════════════════════════════════════════════════

  describe("VAL-DB-002: metric_baselines encryption at rest", () => {
    it("value_encrypted contains non-JSON ciphertext that decrypts to BaselinePayload", async () => {
      await createTestUser();

      const encryption = createEncryptionProvider();

      // The payload to encrypt
      const payload = {
        avg_30d: 62.5,
        stddev_30d: 4.8,
        upper: 67.3,
        lower: 57.7,
        sample_count: 28,
      };

      // Encrypt and insert
      const plaintext = Buffer.from(JSON.stringify(payload));
      const encrypted = await encryption.encrypt(plaintext, TEST_USER_ID);

      await db.insert(metricBaselines).values({
        userId: TEST_USER_ID,
        metricType: "rhr",
        referenceDate: "2026-03-28",
        valueEncrypted: encrypted,
        computedAt: new Date(),
      });

      // Read the raw value_encrypted from DB
      const rawResult = await pool.query(
        `SELECT value_encrypted FROM metric_baselines WHERE user_id = $1 AND metric_type = $2`,
        [TEST_USER_ID, "rhr"],
      );

      expect(rawResult.rows.length).toBe(1);
      const rawBytes: Buffer = rawResult.rows[0].value_encrypted;

      // Verify it is NOT valid JSON (it's ciphertext)
      let isJson = false;
      try {
        JSON.parse(rawBytes.toString("utf-8"));
        isJson = true;
      } catch {
        isJson = false;
      }
      expect(isJson).toBe(false);

      // Decrypt and verify BaselinePayload shape
      const decrypted = await encryption.decrypt(rawBytes, TEST_USER_ID);
      const parsed = JSON.parse(decrypted.toString());

      expect(parsed).toHaveProperty("avg_30d");
      expect(parsed).toHaveProperty("stddev_30d");
      expect(parsed).toHaveProperty("upper");
      expect(parsed).toHaveProperty("lower");
      expect(parsed).toHaveProperty("sample_count");

      // All fields are finite numbers
      expect(Number.isFinite(parsed.avg_30d)).toBe(true);
      expect(Number.isFinite(parsed.stddev_30d)).toBe(true);
      expect(Number.isFinite(parsed.upper)).toBe(true);
      expect(Number.isFinite(parsed.lower)).toBe(true);
      expect(Number.isFinite(parsed.sample_count)).toBe(true);

      // Values match what was originally encrypted
      expect(parsed.avg_30d).toBe(62.5);
      expect(parsed.stddev_30d).toBe(4.8);
      expect(parsed.upper).toBe(67.3);
      expect(parsed.lower).toBe(57.7);
      expect(parsed.sample_count).toBe(28);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // VAL-DB-004: CASCADE deletion cleans up derived tables
  // ═══════════════════════════════════════════════════════════════════════════

  describe("VAL-DB-004: CASCADE deletion cleans up derived tables", () => {
    it("deleting user cascades to metric_baselines, user_annotations, dismissed_insights", async () => {
      await createTestUser();

      const encryption = createEncryptionProvider();

      // Insert into metric_baselines
      const encryptedPayload = await encryption.encrypt(
        Buffer.from(
          JSON.stringify({
            avg_30d: 60,
            stddev_30d: 5,
            upper: 65,
            lower: 55,
            sample_count: 20,
          }),
        ),
        TEST_USER_ID,
      );

      await db.insert(metricBaselines).values({
        userId: TEST_USER_ID,
        metricType: "rhr",
        referenceDate: "2026-03-28",
        valueEncrypted: encryptedPayload,
        computedAt: new Date(),
      });

      // Insert into user_annotations
      const encryptedLabel = await encryption.encrypt(
        Buffer.from("Test meal"),
        TEST_USER_ID,
      );

      await db.insert(userAnnotations).values({
        userId: TEST_USER_ID,
        eventType: "meal",
        labelEncrypted: encryptedLabel,
        occurredAt: new Date("2026-03-28T19:30:00Z"),
      });

      // Insert into dismissed_insights
      await db.insert(dismissedInsights).values({
        userId: TEST_USER_ID,
        insightType: "elevated_rhr",
        referenceDate: "2026-03-28",
      });

      // Verify rows exist before deletion
      const beforeBaselines = await pool.query(
        `SELECT COUNT(*)::int as count FROM metric_baselines WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(beforeBaselines.rows[0].count).toBeGreaterThan(0);

      const beforeAnnotations = await pool.query(
        `SELECT COUNT(*)::int as count FROM user_annotations WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(beforeAnnotations.rows[0].count).toBeGreaterThan(0);

      const beforeDismissed = await pool.query(
        `SELECT COUNT(*)::int as count FROM dismissed_insights WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(beforeDismissed.rows[0].count).toBeGreaterThan(0);

      // Delete the user — should cascade to all 3 tables
      await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]);

      // Verify zero rows remain in all 3 tables
      const afterBaselines = await pool.query(
        `SELECT COUNT(*)::int as count FROM metric_baselines WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(afterBaselines.rows[0].count).toBe(0);

      const afterAnnotations = await pool.query(
        `SELECT COUNT(*)::int as count FROM user_annotations WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(afterAnnotations.rows[0].count).toBe(0);

      const afterDismissed = await pool.query(
        `SELECT COUNT(*)::int as count FROM dismissed_insights WHERE user_id = $1`,
        [TEST_USER_ID],
      );
      expect(afterDismissed.rows[0].count).toBe(0);
    });
  });
});
