import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { upsertHealthData, type HealthDataRow } from "../upsert";
import { healthData, users } from "../schema";
import { LocalEncryptionProvider } from "@/lib/encryption";

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

const TEST_USER_ID = "user_upsert_test";
const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe.skipIf(!canConnect)("health data upsert", () => {
  let pool: Pool;
  let database: NodePgDatabase;
  let encryption: LocalEncryptionProvider;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
    });
    database = drizzle(pool);
    encryption = new LocalEncryptionProvider(TEST_ENCRYPTION_KEY);

    // Ensure test user exists
    await database
      .insert(users)
      .values({
        id: TEST_USER_ID,
        displayName: "Upsert Test User",
        kmsKeyArn: "arn:aws:kms:us-east-1:000000000000:key/test",
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { displayName: "Upsert Test User" },
      });
  });

  beforeEach(async () => {
    // Clean up health data for the test user before each test
    await database
      .delete(healthData)
      .where(sql`${healthData.userId} = ${TEST_USER_ID}`);
  });

  afterAll(async () => {
    // Clean up test user and associated data
    await database.delete(users).where(sql`${users.id} = ${TEST_USER_ID}`);
    await pool.end();
  });

  it("inserts a new health data row", async () => {
    const value = await encryption.encrypt(
      Buffer.from(JSON.stringify(75)),
      TEST_USER_ID,
    );

    const rows: HealthDataRow[] = [
      {
        userId: TEST_USER_ID,
        metricType: "sleep_score",
        date: "2026-01-15",
        valueEncrypted: value,
        source: "oura",
        sourceId: "oura_sleep_score_2026-01-15",
      },
    ];

    const affected = await upsertHealthData(database, rows);
    expect(affected).toBe(1);

    // Verify the row was inserted
    const result = await database
      .select()
      .from(healthData)
      .where(sql`${healthData.userId} = ${TEST_USER_ID}`);

    expect(result).toHaveLength(1);
    expect(result[0]!.metricType).toBe("sleep_score");
    expect(result[0]!.date).toBe("2026-01-15");
    expect(result[0]!.source).toBe("oura");
    expect(result[0]!.sourceId).toBe("oura_sleep_score_2026-01-15");

    // Verify the value is encrypted (BYTEA, not plaintext)
    expect(Buffer.isBuffer(result[0]!.valueEncrypted)).toBe(true);
    expect(result[0]!.valueEncrypted.length).toBeGreaterThan(50); // encrypted is much longer than "75"

    // Verify it can be decrypted back
    const decrypted = await encryption.decrypt(
      result[0]!.valueEncrypted,
      TEST_USER_ID,
    );
    expect(JSON.parse(decrypted.toString())).toBe(75);
  });

  it("updates existing row on conflict (same user_id, metric_type, date, source)", async () => {
    const originalValue = await encryption.encrypt(
      Buffer.from(JSON.stringify(70)),
      TEST_USER_ID,
    );

    // Insert initial row
    await upsertHealthData(database, [
      {
        userId: TEST_USER_ID,
        metricType: "hrv",
        date: "2026-02-01",
        valueEncrypted: originalValue,
        source: "oura",
        sourceId: "oura_hrv_v1",
      },
    ]);

    // Verify initial insert
    const initial = await database
      .select()
      .from(healthData)
      .where(
        sql`${healthData.userId} = ${TEST_USER_ID} AND ${healthData.metricType} = 'hrv'`,
      );
    expect(initial).toHaveLength(1);
    const initialId = initial[0]!.id;
    const initialImportedAt = initial[0]!.importedAt;

    // Wait a small amount to ensure timestamp differs
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Upsert with updated value (same user_id, metric_type, date, source)
    const updatedValue = await encryption.encrypt(
      Buffer.from(JSON.stringify(85)),
      TEST_USER_ID,
    );

    await upsertHealthData(database, [
      {
        userId: TEST_USER_ID,
        metricType: "hrv",
        date: "2026-02-01",
        valueEncrypted: updatedValue,
        source: "oura",
        sourceId: "oura_hrv_v2",
      },
    ]);

    // Verify: still only one row (no duplicate)
    const afterUpsert = await database
      .select()
      .from(healthData)
      .where(
        sql`${healthData.userId} = ${TEST_USER_ID} AND ${healthData.metricType} = 'hrv'`,
      );
    expect(afterUpsert).toHaveLength(1);

    // The row should have the same id (updated, not new)
    expect(afterUpsert[0]!.id).toBe(initialId);

    // Value should be updated
    const decrypted = await encryption.decrypt(
      afterUpsert[0]!.valueEncrypted,
      TEST_USER_ID,
    );
    expect(JSON.parse(decrypted.toString())).toBe(85);

    // source_id should be updated
    expect(afterUpsert[0]!.sourceId).toBe("oura_hrv_v2");

    // imported_at should be updated
    expect(afterUpsert[0]!.importedAt!.getTime()).toBeGreaterThanOrEqual(
      initialImportedAt!.getTime(),
    );
  });

  it("allows different sources for the same metric and date (no conflict)", async () => {
    const value1 = await encryption.encrypt(
      Buffer.from(JSON.stringify(8000)),
      TEST_USER_ID,
    );
    const value2 = await encryption.encrypt(
      Buffer.from(JSON.stringify(9500)),
      TEST_USER_ID,
    );

    // Insert from oura
    await upsertHealthData(database, [
      {
        userId: TEST_USER_ID,
        metricType: "steps",
        date: "2026-01-20",
        valueEncrypted: value1,
        source: "oura",
      },
    ]);

    // Insert from apple_health (different source = no conflict)
    await upsertHealthData(database, [
      {
        userId: TEST_USER_ID,
        metricType: "steps",
        date: "2026-01-20",
        valueEncrypted: value2,
        source: "apple_health",
      },
    ]);

    // Both rows should exist
    const result = await database
      .select()
      .from(healthData)
      .where(
        sql`${healthData.userId} = ${TEST_USER_ID} AND ${healthData.metricType} = 'steps' AND ${healthData.date} = '2026-01-20'`,
      );
    expect(result).toHaveLength(2);

    const sources = result.map((r) => r.source).sort();
    expect(sources).toEqual(["apple_health", "oura"]);
  });

  it("batch upserts multiple rows", async () => {
    const rows: HealthDataRow[] = [];

    for (let i = 0; i < 10; i++) {
      const value = await encryption.encrypt(
        Buffer.from(JSON.stringify(60 + i)),
        TEST_USER_ID,
      );
      rows.push({
        userId: TEST_USER_ID,
        metricType: "rhr",
        date: `2026-01-${String(i + 1).padStart(2, "0")}`,
        valueEncrypted: value,
        source: "oura",
      });
    }

    const affected = await upsertHealthData(database, rows);
    expect(affected).toBe(10);

    // Verify all 10 rows exist
    const result = await database
      .select()
      .from(healthData)
      .where(
        sql`${healthData.userId} = ${TEST_USER_ID} AND ${healthData.metricType} = 'rhr'`,
      );
    expect(result).toHaveLength(10);
  });

  it("handles empty rows array gracefully", async () => {
    const affected = await upsertHealthData(database, []);
    expect(affected).toBe(0);
  });

  it("running seed twice does not create duplicates (idempotency)", async () => {
    const value = await encryption.encrypt(
      Buffer.from(JSON.stringify(42)),
      TEST_USER_ID,
    );

    const row: HealthDataRow = {
      userId: TEST_USER_ID,
      metricType: "readiness_score",
      date: "2026-03-01",
      valueEncrypted: value,
      source: "oura",
    };

    // Insert twice
    await upsertHealthData(database, [row]);
    await upsertHealthData(database, [row]);

    // Should still be exactly 1 row
    const result = await database
      .select()
      .from(healthData)
      .where(
        sql`${healthData.userId} = ${TEST_USER_ID} AND ${healthData.metricType} = 'readiness_score'`,
      );
    expect(result).toHaveLength(1);
  });
});
