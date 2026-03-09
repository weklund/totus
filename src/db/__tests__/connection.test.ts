import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

/**
 * Check if PostgreSQL is reachable before running tests.
 * This prevents tests from failing in CI or environments without a database.
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

describe.skipIf(!canConnect)("database connection", () => {
  let pool: import("pg").Pool;
  let db: import("drizzle-orm/node-postgres").NodePgDatabase;

  beforeAll(async () => {
    // Dynamically import to ensure DATABASE_URL is available at import time
    const dbModule = await import("@/db");
    pool = dbModule.pool;
    db = dbModule.db;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("connects to PostgreSQL and executes a query", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT 1 AS value");
      expect(result.rows[0].value).toBe(1);
    } finally {
      client.release();
    }
  });

  it("returns the correct database name", async () => {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT current_database() AS db");
      expect(result.rows[0].db).toBe("totus");
    } finally {
      client.release();
    }
  });

  it("exports a drizzle db instance", () => {
    expect(db).toBeDefined();
  });

  it("can execute a query through drizzle", async () => {
    const result = await db.execute("SELECT 1 AS value");
    expect(result.rows).toBeDefined();
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
