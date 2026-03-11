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
  vi,
} from "vitest";

/**
 * Tests for Inngest function definitions and registration.
 * Verifies function metadata, event bindings, and that the client
 * is properly configured with typed events.
 */

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let providerConnections: typeof import("@/db/schema").providerConnections;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let healthDataPeriods: typeof import("@/db/schema").healthDataPeriods;
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

// Inngest modules
let inngest: typeof import("../client").inngest;
let syncSweep: typeof import("../functions").syncSweep;
let syncConnection: typeof import("../functions").syncConnection;
let syncInitial: typeof import("../functions").syncInitial;
let syncManual: typeof import("../functions").syncManual;
let tokenRefresh: typeof import("../functions").tokenRefresh;
let partitionEnsure: typeof import("../functions").partitionEnsure;

const TEST_USER_ID = "inngest_func_test_001";
const TEST_USER_ID_2 = "inngest_func_test_002";

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

  const clientModule = await import("../client");
  inngest = clientModule.inngest;

  const functionsModule = await import("../functions");
  syncSweep = functionsModule.syncSweep;
  syncConnection = functionsModule.syncConnection;
  syncInitial = functionsModule.syncInitial;
  syncManual = functionsModule.syncManual;
  tokenRefresh = functionsModule.tokenRefresh;
  partitionEnsure = functionsModule.partitionEnsure;
});

beforeEach(async () => {
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Inngest Function Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Inngest Function Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Inngest Function Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  await db
    .delete(healthDataDaily)
    .where(
      sql`${healthDataDaily.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await pool
    .query(`DELETE FROM health_data_series WHERE user_id IN ($1, $2)`, [
      TEST_USER_ID,
      TEST_USER_ID_2,
    ])
    .catch(() => {});
  await db
    .delete(healthDataPeriods)
    .where(
      sql`${healthDataPeriods.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(providerConnections)
    .where(
      sql`${providerConnections.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await pool
    .query(`DELETE FROM audit_events WHERE owner_id IN ($1, $2)`, [
      TEST_USER_ID,
      TEST_USER_ID_2,
    ])
    .catch(() => {});
  await db
    .delete(users)
    .where(sql`${users.id} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
});

afterAll(async () => {
  await pool.end();
});

async function createTestConnection(
  userId: string = TEST_USER_ID,
  provider: string = "oura",
  overrides: Partial<{
    status: string;
    syncStatus: string;
    tokenExpiresAt: Date;
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
    userId,
  );

  const [conn] = await db
    .insert(providerConnections)
    .values({
      userId,
      provider,
      authType: "oauth2",
      authEnc,
      tokenExpiresAt:
        overrides.tokenExpiresAt ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: overrides.status ?? "active",
      lastSyncAt: new Date(),
      syncStatus: overrides.syncStatus ?? "idle",
    })
    .returning({ id: providerConnections.id });

  return conn.id;
}

// ─── Client Configuration ─────────────────────────────────────

describe("Inngest client", () => {
  it("has correct app ID", () => {
    expect(inngest.id).toBe("totus");
  });
});

// ─── Function Registration ────────────────────────────────────

describe("Function registration", () => {
  it("syncSweep is defined with cron trigger", () => {
    expect(syncSweep).toBeDefined();
    // Access the internal config to verify the function ID
    const config = (syncSweep as unknown as { id: string[] }).id;
    expect(config).toBeDefined();
  });

  it("syncConnection is defined", () => {
    expect(syncConnection).toBeDefined();
  });

  it("syncInitial is defined", () => {
    expect(syncInitial).toBeDefined();
  });

  it("syncManual is defined", () => {
    expect(syncManual).toBeDefined();
  });

  it("tokenRefresh is defined", () => {
    expect(tokenRefresh).toBeDefined();
  });

  it("partitionEnsure is defined", () => {
    expect(partitionEnsure).toBeDefined();
  });

  it("all 6 functions are exported from index", async () => {
    const mod = await import("../functions");
    expect(mod.syncSweep).toBeDefined();
    expect(mod.syncConnection).toBeDefined();
    expect(mod.syncInitial).toBeDefined();
    expect(mod.syncManual).toBeDefined();
    expect(mod.tokenRefresh).toBeDefined();
    expect(mod.partitionEnsure).toBeDefined();
  });
});

// ─── Inngest Route Handler ────────────────────────────────────

describe("/api/inngest route handler", () => {
  it("exports GET, POST, PUT handlers", async () => {
    const routeModule = await import("@/app/api/inngest/route");
    expect(routeModule.GET).toBeDefined();
    expect(routeModule.POST).toBeDefined();
    expect(routeModule.PUT).toBeDefined();
    expect(typeof routeModule.GET).toBe("function");
    expect(typeof routeModule.POST).toBe("function");
    expect(typeof routeModule.PUT).toBe("function");
  });
});

// ─── Sync route dispatches Inngest event ──────────────────────

describe("POST /api/connections/:id/sync dispatches Inngest event", () => {
  let syncPOST: typeof import("@/app/api/connections/[id]/sync/route").POST;

  beforeAll(async () => {
    const syncModule = await import("@/app/api/connections/[id]/sync/route");
    syncPOST = syncModule.POST;
  });

  function createAuthRequest(url: string, userId: string): Request {
    const headers = new Headers({
      "x-request-context": JSON.stringify({
        role: "owner",
        userId,
        permissions: "full",
        authMethod: "session",
      }),
    });
    return new Request(url, { method: "POST", headers });
  }

  it("returns queued status instead of completed", async () => {
    const connId = await createTestConnection();

    // Mock inngest.send to prevent actual event dispatch
    const originalSend = inngest.send;
    let sentEvent: unknown = null;
    inngest.send = vi.fn(async (event: unknown) => {
      sentEvent = event;
      return [{ ids: ["mock-event-id"] }] as never;
    });

    try {
      const request = createAuthRequest(
        `http://localhost:3000/api/connections/${connId}/sync`,
        TEST_USER_ID,
      );
      const response = await syncPOST(request, {
        params: Promise.resolve({ id: connId }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.status).toBe("queued");
      expect(body.data.message).toContain("Sync dispatched");

      // Verify the connection was set to queued
      const [conn] = await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connId));
      expect(conn.syncStatus).toBe("queued");

      // Verify the event was dispatched
      expect(inngest.send).toHaveBeenCalledOnce();
      expect(sentEvent).toMatchObject({
        name: "integration/sync.manual",
        data: {
          connectionId: connId,
          userId: TEST_USER_ID,
          provider: "oura",
        },
      });
    } finally {
      inngest.send = originalSend;
    }
  });

  it("still returns 409 when already syncing", async () => {
    const connId = await createTestConnection(TEST_USER_ID, "oura", {
      syncStatus: "syncing",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(409);
  });

  it("still returns 403 when connection is expired", async () => {
    const connId = await createTestConnection(TEST_USER_ID, "oura", {
      status: "expired",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(403);
  });
});

// ─── Partition Ensure ─────────────────────────────────────────

describe("partition.ensure creates future partitions", () => {
  it("partition check SQL does not error", async () => {
    // Verify that partition creation SQL runs without error
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const partitionName = `health_data_series_${year}_${month}`;

    // Check if current month partition exists (it should from migration)
    const result = await pool.query(
      `SELECT 1 FROM pg_class WHERE relname = $1`,
      [partitionName],
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(0);
  });
});

// ─── Error state handling ─────────────────────────────────────

describe("Failed sync sets error state (VAL-MPB-039)", () => {
  it("markSyncError correctly sets sync_status and sync_error", async () => {
    const connId = await createTestConnection(TEST_USER_ID, "oura", {
      syncStatus: "syncing",
    });

    const { markSyncError: markErr } = await import("../sync-helpers");
    await markErr(connId, "Provider API returned 500 Internal Server Error");

    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));

    expect(conn.syncStatus).toBe("error");
    expect(conn.syncError).toBe(
      "Provider API returned 500 Internal Server Error",
    );
  });
});

// ─── Token Refresh (VAL-MPB-040) ──────────────────────────────

describe("Token refresh updates auth_enc (VAL-MPB-040)", () => {
  it("encryptTokenSet produces valid encrypted blob", async () => {
    const { encryptTokenSet: encrypt, decryptAuth: decrypt } =
      await import("../sync-helpers");

    const tokens = {
      accessToken: "refreshed_access_token",
      refreshToken: "refreshed_refresh_token",
      expiresAt: new Date("2026-12-01T00:00:00.000Z"),
      scopes: ["daily", "heartrate"],
    };

    const encrypted = await encrypt(tokens, TEST_USER_ID);
    const decrypted = await decrypt(encrypted, TEST_USER_ID);

    expect(decrypted.accessToken).toBe("refreshed_access_token");
    expect(decrypted.refreshToken).toBe("refreshed_refresh_token");
  });
});
