import type { Pool as PoolType } from "pg";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

/**
 * Tests for Inngest sync helper functions:
 * - claimConnection, markSyncIdle, markSyncError
 * - decryptAuth, encryptTokenSet, ensureBuffer
 * - syncDailyData, syncSeriesData, syncPeriodData
 */

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let providerConnections: typeof import("@/db/schema").providerConnections;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let healthDataPeriods: typeof import("@/db/schema").healthDataPeriods;
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

// Sync helpers
let claimConnection: typeof import("../sync-helpers").claimConnection;
let markSyncIdle: typeof import("../sync-helpers").markSyncIdle;
let markSyncError: typeof import("../sync-helpers").markSyncError;
let decryptAuth: typeof import("../sync-helpers").decryptAuth;
let encryptTokenSet: typeof import("../sync-helpers").encryptTokenSet;
let ensureBuffer: typeof import("../sync-helpers").ensureBuffer;
let syncDailyData: typeof import("../sync-helpers").syncDailyData;
let syncSeriesData: typeof import("../sync-helpers").syncSeriesData;
let syncPeriodData: typeof import("../sync-helpers").syncPeriodData;

const TEST_USER_ID = "inngest_sync_test_001";

beforeAll(async () => {
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  process.env.OURA_CLIENT_ID =
    process.env.OURA_CLIENT_ID || "test-oura-client-id";
  process.env.OURA_CLIENT_SECRET =
    process.env.OURA_CLIENT_SECRET || "test-oura-client-secret";

  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  providerConnections = schema.providerConnections;
  healthDataDaily = schema.healthDataDaily;
  healthDataPeriods = schema.healthDataPeriods;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  const helpers = await import("../sync-helpers");
  claimConnection = helpers.claimConnection;
  markSyncIdle = helpers.markSyncIdle;
  markSyncError = helpers.markSyncError;
  decryptAuth = helpers.decryptAuth;
  encryptTokenSet = helpers.encryptTokenSet;
  ensureBuffer = helpers.ensureBuffer;
  syncDailyData = helpers.syncDailyData;
  syncSeriesData = helpers.syncSeriesData;
  syncPeriodData = helpers.syncPeriodData;
});

beforeEach(async () => {
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      displayName: "Inngest Sync Test User",
      kmsKeyArn: "local-dev-key",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Inngest Sync Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up in correct order (FK constraints)
  await db
    .delete(healthDataDaily)
    .where(eq(healthDataDaily.userId, TEST_USER_ID));
  await db.execute(
    sql`DELETE FROM health_data_series WHERE user_id = ${TEST_USER_ID}`,
  );
  await db
    .delete(healthDataPeriods)
    .where(eq(healthDataPeriods.userId, TEST_USER_ID));
  await db
    .delete(providerConnections)
    .where(eq(providerConnections.userId, TEST_USER_ID));
  await pool
    .query(`DELETE FROM audit_events WHERE owner_id = $1`, [TEST_USER_ID])
    .catch(() => {});
  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

afterAll(async () => {
  await pool.end();
});

async function createTestConnection(
  overrides: Partial<{
    status: string;
    syncStatus: string;
    tokenExpiresAt: Date;
    dailyCursor: string | null;
    seriesCursor: string | null;
    periodsCursor: string | null;
  }> = {},
): Promise<string> {
  const encryption = createEncryptionProvider();
  const authPayload = JSON.stringify({
    access_token: "mock_access_token",
    refresh_token: "mock_refresh_token",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    scopes: ["daily", "heartrate", "sleep"],
  });
  const authEnc = await encryption.encrypt(
    Buffer.from(authPayload, "utf-8"),
    TEST_USER_ID,
  );

  const [conn] = await db
    .insert(providerConnections)
    .values({
      userId: TEST_USER_ID,
      provider: "oura",
      authType: "oauth2",
      authEnc,
      tokenExpiresAt:
        overrides.tokenExpiresAt ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: overrides.status ?? "active",
      lastSyncAt: new Date(),
      syncStatus: overrides.syncStatus ?? "idle",
      dailyCursor: overrides.dailyCursor ?? null,
      seriesCursor: overrides.seriesCursor ?? null,
      periodsCursor: overrides.periodsCursor ?? null,
    })
    .returning({ id: providerConnections.id });

  return conn.id;
}

// ─── ensureBuffer ─────────────────────────────────────────────

describe("ensureBuffer", () => {
  it("returns Buffer unchanged", () => {
    const buf = Buffer.from("hello");
    expect(ensureBuffer(buf)).toBe(buf);
  });

  it("reconstructs Buffer from serialized form", () => {
    const original = Buffer.from("test data");
    const serialized = { type: "Buffer", data: Array.from(original) };
    const result = ensureBuffer(serialized);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe("test data");
  });

  it("throws for non-Buffer input", () => {
    expect(() => ensureBuffer("not a buffer")).toThrow(
      "Cannot convert value to Buffer",
    );
  });
});

// ─── claimConnection ──────────────────────────────────────────

describe("claimConnection", () => {
  it("claims idle connection successfully", async () => {
    const connId = await createTestConnection({ syncStatus: "idle" });
    const claimed = await claimConnection(connId);
    expect(claimed).toBe(1);

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(conn.syncStatus).toBe("syncing");
  });

  it("does not claim already-syncing connection", async () => {
    const connId = await createTestConnection({ syncStatus: "syncing" });
    const claimed = await claimConnection(connId);
    expect(claimed).toBe(0);
  });

  it("claims error-state connection", async () => {
    const connId = await createTestConnection({ syncStatus: "error" });
    const claimed = await claimConnection(connId);
    expect(claimed).toBe(1);
  });
});

// ─── markSyncIdle / markSyncError ─────────────────────────────

describe("markSyncIdle", () => {
  it("sets sync status to idle and updates cursors", async () => {
    const connId = await createTestConnection({ syncStatus: "syncing" });

    await markSyncIdle(connId, {
      dailyCursor: "2026-03-01",
      seriesCursor: "2026-03-01T00:00:00Z",
      periodsCursor: "2026-03-01T00:00:00Z",
    });

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(conn.syncStatus).toBe("idle");
    expect(conn.lastSyncAt).toBeDefined();
    expect(conn.syncError).toBeNull();
    expect(conn.dailyCursor).toBe("2026-03-01");
    expect(conn.seriesCursor).toBe("2026-03-01T00:00:00Z");
    expect(conn.periodsCursor).toBe("2026-03-01T00:00:00Z");
  });
});

describe("markSyncError", () => {
  it("sets sync_status to error with message", async () => {
    const connId = await createTestConnection({ syncStatus: "syncing" });

    await markSyncError(connId, "Provider API returned 500");

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(conn.syncStatus).toBe("error");
    expect(conn.syncError).toBe("Provider API returned 500");
  });

  it("truncates error message to 1000 chars", async () => {
    const connId = await createTestConnection({ syncStatus: "syncing" });
    const longError = "x".repeat(2000);

    await markSyncError(connId, longError);

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(conn.syncError!.length).toBe(1000);
  });
});

// ─── decryptAuth / encryptTokenSet ────────────────────────────

describe("decryptAuth", () => {
  it("decrypts auth_enc blob to DecryptedAuth", async () => {
    const encryption = createEncryptionProvider();
    const authPayload = JSON.stringify({
      access_token: "test_access",
      refresh_token: "test_refresh",
      expires_at: "2026-12-01T00:00:00.000Z",
      scopes: ["daily", "sleep"],
    });
    const encrypted = await encryption.encrypt(
      Buffer.from(authPayload, "utf-8"),
      TEST_USER_ID,
    );

    const auth = await decryptAuth(encrypted, TEST_USER_ID);
    expect(auth.accessToken).toBe("test_access");
    expect(auth.refreshToken).toBe("test_refresh");
    expect(auth.scopes).toEqual(["daily", "sleep"]);
    expect(auth.expiresAt).toBeInstanceOf(Date);
  });

  it("handles serialized Buffer from Inngest steps", async () => {
    const encryption = createEncryptionProvider();
    const authPayload = JSON.stringify({
      access_token: "test_access",
      refresh_token: "test_refresh",
      expires_at: "2026-12-01T00:00:00.000Z",
      scopes: ["daily"],
    });
    const encrypted = await encryption.encrypt(
      Buffer.from(authPayload, "utf-8"),
      TEST_USER_ID,
    );

    // Simulate Inngest serialization
    const serialized = {
      type: "Buffer",
      data: Array.from(encrypted),
    };

    const auth = await decryptAuth(serialized, TEST_USER_ID);
    expect(auth.accessToken).toBe("test_access");
  });
});

describe("encryptTokenSet", () => {
  it("encrypts and can be decrypted back", async () => {
    const tokens = {
      accessToken: "new_access",
      refreshToken: "new_refresh",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      scopes: ["daily", "sleep"],
    };

    const encrypted = await encryptTokenSet(tokens, TEST_USER_ID);
    expect(Buffer.isBuffer(encrypted)).toBe(true);

    const auth = await decryptAuth(encrypted, TEST_USER_ID);
    expect(auth.accessToken).toBe("new_access");
    expect(auth.refreshToken).toBe("new_refresh");
  });
});

// ─── syncDailyData ────────────────────────────────────────────

describe("syncDailyData", () => {
  it("fetches and upserts daily data from adapter", async () => {
    const connId = await createTestConnection();

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));

    await syncDailyData(connId, TEST_USER_ID, "oura", conn.authEnc, null);

    // Verify data was inserted
    const data = await db
      .select()
      .from(healthDataDaily)
      .where(eq(healthDataDaily.userId, TEST_USER_ID));

    expect(data.length).toBeGreaterThan(0);
    expect(data[0].source).toBe("oura");
    expect(data[0].userId).toBe(TEST_USER_ID);
  });
});

// ─── syncPeriodData ───────────────────────────────────────────

describe("syncPeriodData", () => {
  it("fetches and upserts period data from adapter", async () => {
    const connId = await createTestConnection();

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));

    await syncPeriodData(connId, TEST_USER_ID, "oura", conn.authEnc, null);

    // Verify periods were inserted
    const data = await db
      .select()
      .from(healthDataPeriods)
      .where(eq(healthDataPeriods.userId, TEST_USER_ID));

    expect(data.length).toBeGreaterThan(0);
    expect(data[0].source).toBe("oura");
    expect(data[0].eventType).toBeDefined();
  });
});

// ─── syncSeriesData ───────────────────────────────────────────

describe("syncSeriesData", () => {
  it("fetches and upserts series data from adapter", async () => {
    const connId = await createTestConnection();

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));

    await syncSeriesData(connId, TEST_USER_ID, "oura", conn.authEnc, null);

    // Verify series data was inserted via raw SQL (partitioned table)
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM health_data_series WHERE user_id = $1`,
      [TEST_USER_ID],
    );
    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  });
});
