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
 * - GET /api/connections/oura/authorize
 * - GET /api/connections/oura/callback
 * - DELETE /api/connections/:id
 * - POST /api/connections/:id/sync
 *
 * Tests verify auth enforcement, happy paths, and error cases.
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

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let ouraConnections: typeof import("@/db/schema").ouraConnections;
let healthData: typeof import("@/db/schema").healthData;

// Route handlers
let listGET: typeof import("../route").GET;
let authorizeGET: typeof import("../oura/authorize/route").GET;
let callbackGET: typeof import("../oura/callback/route").GET;
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
  ouraConnections = schema.ouraConnections;
  healthData = schema.healthData;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import route handlers
  const listModule = await import("../route");
  listGET = listModule.GET;

  const authorizeModule = await import("../oura/authorize/route");
  authorizeGET = authorizeModule.GET;

  const callbackModule = await import("../oura/callback/route");
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
    .delete(healthData)
    .where(sql`${healthData.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
  await db
    .delete(ouraConnections)
    .where(
      sql`${ouraConnections.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
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

async function createOuraConnection(userId: string): Promise<string> {
  const encryption = createEncryptionProvider();
  const accessToken = await encryption.encrypt(
    Buffer.from("mock_access_token"),
    userId,
  );
  const refreshToken = await encryption.encrypt(
    Buffer.from("mock_refresh_token"),
    userId,
  );

  const [conn] = await db
    .insert(ouraConnections)
    .values({
      userId,
      accessTokenEnc: accessToken,
      refreshTokenEnc: refreshToken,
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      lastSyncAt: new Date(),
      syncStatus: "idle",
    })
    .returning({ id: ouraConnections.id });

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

  it("returns connection list when connected", async () => {
    await createOuraConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].provider).toBe("oura");
    expect(body.data[0].status).toBe("connected");
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].connected_at).toBeDefined();
    expect(body.data[0].last_sync_at).toBeDefined();
  });

  it("does not return other users connections", async () => {
    await createOuraConnection(TEST_USER_ID_2);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });
});

describe("GET /api/connections/oura/authorize", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
    );
    const response = await authorizeGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns authorize URL with state JWT", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.authorize_url).toBeDefined();
    expect(typeof body.data.authorize_url).toBe("string");

    // In mock mode, the authorize_url should point to the mock callback
    const url = new URL(body.data.authorize_url);
    expect(url.searchParams.get("state")).toBeDefined();
    expect(url.searchParams.get("state")!.length).toBeGreaterThan(0);
  });

  it("returns 409 if already connected", async () => {
    await createOuraConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const response = await authorizeGET(request);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe("CONFLICT");
  });
});

describe("GET /api/connections/oura/callback", () => {
  it("redirects to dashboard with error when no state", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?code=test_code",
    );
    const response = await callbackGET(request);
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=");
  });

  it("redirects to dashboard with error when no code", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?state=some_state",
    );
    const response = await callbackGET(request);
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=");
  });

  it("redirects to dashboard with error for invalid state JWT", async () => {
    const request = new Request(
      "http://localhost:3000/api/connections/oura/callback?code=test_code&state=invalid_jwt",
    );
    const response = await callbackGET(request);
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("error=oura_state_invalid");
  });

  it("creates connection and redirects on valid callback", async () => {
    // First get an authorize URL to get a valid state JWT
    const authRequest = createAuthRequest(
      "http://localhost:3000/api/connections/oura/authorize",
      TEST_USER_ID,
    );
    const authResponse = await authorizeGET(authRequest);
    const authBody = await authResponse.json();
    const authorizeUrl = new URL(authBody.data.authorize_url);
    const state = authorizeUrl.searchParams.get("state")!;

    // Now simulate the callback with the valid state
    const callbackRequest = new Request(
      `http://localhost:3000/api/connections/oura/callback?code=mock_auth_code&state=${state}`,
    );
    const response = await callbackGET(callbackRequest);
    expect(response.status).toBe(302);

    const location = response.headers.get("location");
    expect(location).toContain("/dashboard");
    expect(location).toContain("connected=oura");

    // Verify connection was created
    const connections = await db
      .select()
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, TEST_USER_ID));
    expect(connections).toHaveLength(1);
    expect(connections[0].syncStatus).toBe("idle");
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
    const connId = await createOuraConnection(TEST_USER_ID_2);

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

  it("deletes connection but preserves health data", async () => {
    const connId = await createOuraConnection(TEST_USER_ID);

    // Insert some health data for this user
    const encryption = createEncryptionProvider();
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(85)),
      TEST_USER_ID,
    );

    await db.insert(healthData).values({
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

    // Connection should be gone
    const connections = await db
      .select()
      .from(ouraConnections)
      .where(eq(ouraConnections.id, connId));
    expect(connections).toHaveLength(0);

    // Health data should still be there
    const data = await db
      .select()
      .from(healthData)
      .where(eq(healthData.userId, TEST_USER_ID));
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
    const connId = await createOuraConnection(TEST_USER_ID_2);

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

  it("triggers sync and generates mock data", async () => {
    const connId = await createOuraConnection(TEST_USER_ID);

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
    expect(body.data.status).toBeDefined();

    // Check that health data was generated
    const data = await db
      .select()
      .from(healthData)
      .where(eq(healthData.userId, TEST_USER_ID));
    expect(data.length).toBeGreaterThan(0);

    // Check connection sync status is back to idle
    const [conn] = await db
      .select()
      .from(ouraConnections)
      .where(eq(ouraConnections.id, connId));
    expect(conn.syncStatus).toBe("idle");
    expect(conn.lastSyncAt).toBeDefined();
  });

  it("returns 409 when already syncing", async () => {
    const connId = await createOuraConnection(TEST_USER_ID);

    // Set sync status to syncing manually
    await db
      .update(ouraConnections)
      .set({ syncStatus: "syncing" })
      .where(eq(ouraConnections.id, connId));

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
});
