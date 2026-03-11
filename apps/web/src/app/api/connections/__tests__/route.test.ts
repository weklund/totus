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
 * Tests for the connections API endpoints:
 * - GET /api/connections
 * - GET /api/connections/:provider/authorize (generic)
 * - GET /api/connections/:provider/callback (generic)
 * - DELETE /api/connections/:id
 * - POST /api/connections/:id/sync
 *
 * Tests verify auth enforcement, happy paths, error cases,
 * sync-in-progress guard, and expired connection guard.
 */

// ─── Mock cookies ────────────────────────────────────────────────────────────

const mockCookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookieStore.set(name, value);
    },
  })),
}));

// ─── Mock Inngest client ─────────────────────────────────────────────────────

vi.mock("@/inngest/client", () => ({
  inngest: {
    id: "totus",
    send: vi.fn(async () => [{ ids: ["mock-event-id"] }]),
  },
}));

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let providerConnections: typeof import("@/db/schema").providerConnections;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;

// Route handlers
let listGET: typeof import("../route").GET;
let authorizeGET: typeof import("../[provider]/authorize/route").GET;
let callbackGET: typeof import("../[provider]/callback/route").GET;
let disconnectDELETE: typeof import("../[id]/route").DELETE;
let syncPOST: typeof import("../[id]/sync/route").POST;

// Auth helpers
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

const TEST_USER_ID = "conn_test_user_001";
const TEST_USER_ID_2 = "conn_test_user_002";

// ─── Setup & Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure env vars
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  process.env.OURA_CLIENT_ID =
    process.env.OURA_CLIENT_ID || "test-oura-client-id";
  process.env.OURA_CLIENT_SECRET =
    process.env.OURA_CLIENT_SECRET || "test-oura-client-secret";

  // Import modules
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  providerConnections = schema.providerConnections;
  healthDataDaily = schema.healthDataDaily;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import route handlers
  const listModule = await import("../route");
  listGET = listModule.GET;

  const authorizeModule = await import("../[provider]/authorize/route");
  authorizeGET = authorizeModule.GET;

  const callbackModule = await import("../[provider]/callback/route");
  callbackGET = callbackModule.GET;

  const disconnectModule = await import("../[id]/route");
  disconnectDELETE = disconnectModule.DELETE;

  const syncModule = await import("../[id]/sync/route");
  syncPOST = syncModule.POST;
});

beforeEach(async () => {
  mockCookieStore.clear();

  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Connection Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Connection Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Connection Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  mockCookieStore.clear();

  // Clean up test data in correct order (FK constraints)
  await db
    .delete(healthDataDaily)
    .where(
      sql`${healthDataDaily.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(providerConnections)
    .where(
      sql`${providerConnections.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );

  // Delete audit events via raw SQL (immutability trigger blocks normal DELETE)
  await pool
    .query(`DELETE FROM audit_events WHERE owner_id IN ($1, $2)`, [
      TEST_USER_ID,
      TEST_USER_ID_2,
    ])
    .catch(() => {
      // Trigger may prevent deletion — this is OK for test cleanup
    });

  await db
    .delete(users)
    .where(sql`${users.id} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
});

afterAll(async () => {
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createAuthRequest(
  url: string,
  userId: string,
  method: string = "GET",
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
  });
  return new Request(url, { method, headers });
}

function createUnauthRequest(url: string, method: string = "GET"): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
  });
  return new Request(url, { method, headers });
}

async function createProviderConnection(
  userId: string,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/connections", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/connections",
    );
    const response = await listGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns empty array when no connections", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  it("returns connection list with provider field", async () => {
    await createProviderConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].provider).toBe("oura");
    expect(body.data[0].status).toBe("active");
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].connected_at).toBeDefined();
    expect(body.data[0].last_sync_at).toBeDefined();
  });

  it("does not return other users connections", async () => {
    await createProviderConnection(TEST_USER_ID_2);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  it("returns multiple connections for multi-provider user", async () => {
    await createProviderConnection(TEST_USER_ID, "oura");
    await createProviderConnection(TEST_USER_ID, "garmin");

    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(2);
    const providers = body.data.map((c: { provider: string }) => c.provider);
    expect(providers).toContain("oura");
    expect(providers).toContain("garmin");
  });
});

describe("GET /api/connections/:provider/authorize", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
    );
    const response = await authorizeGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns authorize URL with state JWT for oura", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.authorize_url).toBeDefined();
    expect(typeof body.data.authorize_url).toBe("string");

    // In mock mode, the authorize_url should point to the callback
    const url = new URL(body.data.authorize_url);
    expect(url.searchParams.get("state")).toBeDefined();
    expect(url.searchParams.get("state")!.length).toBeGreaterThan(0);
    expect(url.pathname).toContain("/api/connections/oura/callback");
  });

  it("returns authorize URL for dexcom provider", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/connections/dexcom/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request, {
      params: Promise.resolve({ provider: "dexcom" }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.authorize_url).toBeDefined();
    const url = new URL(body.data.authorize_url);
    expect(url.pathname).toContain("/api/connections/dexcom/callback");
  });

  it("returns 409 if already connected", async () => {
    await createProviderConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 400 for unknown provider", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/connections/unknown/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request, {
      params: Promise.resolve({ provider: "unknown" }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/connections/:provider/callback", () => {
  it("redirects to dashboard with error when no state", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?code=test_code",
    );
    const response = await callbackGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=");
  });

  it("redirects to dashboard with error when no code", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?state=some_state",
    );
    const response = await callbackGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=");
  });

  it("redirects to dashboard with error for invalid state JWT", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?code=test_code&state=invalid_jwt",
    );
    const response = await callbackGET(request, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=oura_state_invalid");
  });

  it("creates connection and redirects on valid callback for oura", async () => {
    // First get an authorize URL to get a valid state JWT
    const authRequest = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const authResponse = await authorizeGET(authRequest, {
      params: Promise.resolve({ provider: "oura" }),
    });
    const authBody = await authResponse.json();
    const authorizeUrl = new URL(authBody.data.authorize_url);
    const state = authorizeUrl.searchParams.get("state")!;

    // Now simulate the callback with the valid state
    const callbackRequest = new Request(
      `http://localhost:3000/api/connections/oura/callback?code=mock_auth_code&state=${state}`,
    );
    const response = await callbackGET(callbackRequest, {
      params: Promise.resolve({ provider: "oura" }),
    });
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("connected=oura");

    // Verify connection was created in provider_connections
    const connections = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.userId, TEST_USER_ID));
    expect(connections).toHaveLength(1);
    expect(connections[0].provider).toBe("oura");
    expect(connections[0].status).toBe("active");
    expect(connections[0].syncStatus).toBe("idle");
  });

  it("rejects callback when provider in state JWT does not match path", async () => {
    // Get a state JWT for oura
    const authRequest = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const authResponse = await authorizeGET(authRequest, {
      params: Promise.resolve({ provider: "oura" }),
    });
    const authBody = await authResponse.json();
    const authorizeUrl = new URL(authBody.data.authorize_url);
    const state = authorizeUrl.searchParams.get("state")!;

    // Try to use the oura state JWT on the dexcom callback
    const callbackRequest = new Request(
      `http://localhost:3000/api/connections/dexcom/callback?code=mock_auth_code&state=${state}`,
    );
    const response = await callbackGET(callbackRequest, {
      params: Promise.resolve({ provider: "dexcom" }),
    });
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("error=dexcom_state_invalid");
  });
});

describe("DELETE /api/connections/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/connections/some-id",
      "DELETE",
    );
    const response = await disconnectDELETE(request, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-existent connection", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${fakeId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await disconnectDELETE(request, {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when trying to delete another users connection", async () => {
    const connId = await createProviderConnection(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await disconnectDELETE(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(404);
  });

  it("deletes connection from provider_connections but preserves health data", async () => {
    const connId = await createProviderConnection(TEST_USER_ID);

    // Insert some health data for this user
    const encryption = createEncryptionProvider();
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(85)),
      TEST_USER_ID,
    );

    await db.insert(healthDataDaily).values({
      userId: TEST_USER_ID,
      metricType: "sleep_score",
      date: "2026-01-15",
      valueEncrypted: encrypted,
      source: "oura",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await disconnectDELETE(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(connId);
    expect(body.data.provider).toBe("oura");
    expect(body.data.disconnected_at).toBeDefined();

    // Connection should be gone from provider_connections
    const connections = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(connections).toHaveLength(0);

    // Health data should still be there
    const data = await db
      .select()
      .from(healthDataDaily)
      .where(eq(healthDataDaily.userId, TEST_USER_ID));
    expect(data.length).toBeGreaterThan(0);
  });
});

describe("POST /api/connections/:id/sync", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/connections/some-id/sync",
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-existent connection", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${fakeId}/sync`,
      TEST_USER_ID,
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when trying to sync another users connection", async () => {
    const connId = await createProviderConnection(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(404);
  });

  it("dispatches Inngest sync event and returns queued status", async () => {
    const connId = await createProviderConnection(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.status).toBe("queued");
    expect(body.data.message).toContain("Sync dispatched");

    // Check connection sync status is set to queued
    const [conn] = await db
      .select()
      .from(providerConnections)
      .where(eq(providerConnections.id, connId));
    expect(conn.syncStatus).toBe("queued");
  });

  it("returns 409 when already syncing (SYNC_IN_PROGRESS guard)", async () => {
    const connId = await createProviderConnection(TEST_USER_ID, "oura", {
      syncStatus: "syncing",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 403 when connection is expired", async () => {
    const connId = await createProviderConnection(TEST_USER_ID, "oura", {
      status: "expired",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/connections/${connId}/sync`,
      TEST_USER_ID,
      "POST",
    );
    const response = await syncPOST(request, {
      params: Promise.resolve({ id: connId }),
    });
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toContain("expired");
  });
});
