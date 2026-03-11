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
 * Tests for user management API endpoints:
 * - GET /api/user/profile
 * - PATCH /api/user/profile
 * - POST /api/user/export
 * - DELETE /api/user/account
 *
 * Tests verify auth enforcement, happy paths, validation,
 * HTML stripping, cascade behavior, and audit event emission.
 */

// ─── Mock cookies ────────────────────────────────────────────────────────────

const mockCookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string, _options?: Record<string, unknown>) => {
      if (_options?.maxAge === 0) {
        mockCookieStore.delete(name);
      } else {
        mockCookieStore.set(name, value);
      }
    },
  })),
}));

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthData: typeof import("@/db/schema").healthData;
let shareGrants: typeof import("@/db/schema").shareGrants;
let ouraConnections: typeof import("@/db/schema").ouraConnections;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handlers
let profileGET: typeof import("../profile/route").GET;
let profilePATCH: typeof import("../profile/route").PATCH;
let exportPOST: typeof import("../export/route").POST;
let accountDELETE: typeof import("../account/route").DELETE;

let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

const TEST_USER_ID = "user_mgmt_test_001";
const TEST_USER_ID_2 = "user_mgmt_test_002";

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

  // Import modules
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  healthData = schema.healthData;
  shareGrants = schema.shareGrants;
  ouraConnections = schema.ouraConnections;
  auditEvents = schema.auditEvents;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import route handlers
  const profileModule = await import("../profile/route");
  profileGET = profileModule.GET;
  profilePATCH = profileModule.PATCH;

  const exportModule = await import("../export/route");
  exportPOST = exportModule.POST;

  const accountModule = await import("../account/route");
  accountDELETE = accountModule.DELETE;
});

beforeEach(async () => {
  mockCookieStore.clear();

  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  mockCookieStore.clear();

  // Clean up test data in correct order (FK constraints)
  await db
    .delete(healthData)
    .where(sql`${healthData.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
  await db
    .delete(shareGrants)
    .where(sql`${shareGrants.ownerId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
  await db
    .delete(ouraConnections)
    .where(
      sql`${ouraConnections.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );

  // Use session_replication_role to bypass triggers for cleanup
  // This is session-scoped and doesn't take table-level locks
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query(`DELETE FROM audit_events WHERE owner_id IN ($1, $2)`, [
      TEST_USER_ID,
      TEST_USER_ID_2,
    ]);
    await client.query(`SET session_replication_role = 'origin'`);
  } finally {
    client.release();
  }

  // Re-create users that were deleted by tests
  // First attempt delete, then re-create handled by beforeEach
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
  body?: unknown,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
    "Content-Type": "application/json",
  });

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

function createUnauthRequest(
  url: string,
  method: string = "GET",
  body?: unknown,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
    "Content-Type": "application/json",
  });

  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  return new Request(url, init);
}

async function createTestHealthData(userId: string, count: number = 5) {
  const encryption = createEncryptionProvider();
  const values = [];
  for (let i = 0; i < count; i++) {
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(70 + i)),
      userId,
    );
    values.push({
      userId,
      metricType: "sleep_score",
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      valueEncrypted: encrypted,
      source: "oura",
    });
  }
  await db.insert(healthData).values(values);
}

async function createTestShare(userId: string) {
  const [share] = await db
    .insert(shareGrants)
    .values({
      token: `test_token_hash_${Date.now()}_${Math.random()}`,
      ownerId: userId,
      label: "Test Share",
      allowedMetrics: ["sleep_score"],
      dataStart: "2026-01-01",
      dataEnd: "2026-03-01",
      grantExpires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return share;
}

async function createTestConnection(userId: string) {
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
    .returning();
  return conn;
}

// ─── GET /api/user/profile Tests ─────────────────────────────────────────────

describe("GET /api/user/profile", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/user/profile",
    );
    const response = await profileGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns user profile with zero stats", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
    );
    const response = await profileGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(TEST_USER_ID);
    expect(body.data.display_name).toBe("Test User");
    expect(body.data.created_at).toBeDefined();
    expect(body.data.stats.total_data_points).toBe(0);
    expect(body.data.stats.active_shares).toBe(0);
    expect(body.data.stats.connections).toBe(0);
  });

  it("returns correct stats with data", async () => {
    // Create health data, shares, and connections
    await createTestHealthData(TEST_USER_ID, 10);
    await createTestShare(TEST_USER_ID);
    await createTestConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
    );
    const response = await profileGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.stats.total_data_points).toBe(10);
    expect(body.data.stats.active_shares).toBe(1);
    expect(body.data.stats.connections).toBe(1);
  });

  it("does not count revoked shares as active", async () => {
    const share = await createTestShare(TEST_USER_ID);
    // Revoke the share
    await db
      .update(shareGrants)
      .set({ revokedAt: new Date() })
      .where(eq(shareGrants.id, share.id));

    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
    );
    const response = await profileGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.stats.active_shares).toBe(0);
  });

  it("does not count expired shares as active", async () => {
    await db.insert(shareGrants).values({
      token: `test_expired_${Date.now()}`,
      ownerId: TEST_USER_ID,
      label: "Expired Share",
      allowedMetrics: ["sleep_score"],
      dataStart: "2026-01-01",
      dataEnd: "2026-03-01",
      grantExpires: new Date(Date.now() - 1000), // Already expired
    });

    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
    );
    const response = await profileGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.stats.active_shares).toBe(0);
  });
});

// ─── PATCH /api/user/profile Tests ───────────────────────────────────────────

describe("PATCH /api/user/profile", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/user/profile",
      "PATCH",
      { display_name: "New Name" },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(401);
  });

  it("updates display_name successfully", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "Updated Name" },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.display_name).toBe("Updated Name");
    expect(body.data.updated_at).toBeDefined();

    // Verify in database
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, TEST_USER_ID));
    expect(user.displayName).toBe("Updated Name");
  });

  it("strips HTML from display_name", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "Hello <script>alert('xss')</script>World" },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.display_name).toBe("Hello alert('xss')World");
  });

  it("rejects empty display_name", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "" },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects HTML-only display_name", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "<b></b>" },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects display_name over 100 chars", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "a".repeat(101) },
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing display_name field", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      {},
    );
    const response = await profilePATCH(request);
    expect(response.status).toBe(400);
  });

  it("emits account.settings audit event", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/profile",
      TEST_USER_ID,
      "PATCH",
      { display_name: "Audit Test Name" },
    );
    await profilePATCH(request);

    // Allow fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'account.settings'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    const event = events[events.length - 1];
    expect(event.actorType).toBe("owner");
  });
});

// ─── POST /api/user/export Tests ─────────────────────────────────────────────

describe("POST /api/user/export", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/user/export",
      "POST",
    );
    const response = await exportPOST(request);
    expect(response.status).toBe(401);
  });

  it("exports all user data", async () => {
    // Create some test data
    await createTestHealthData(TEST_USER_ID, 3);
    await createTestShare(TEST_USER_ID);
    await createTestConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/user/export",
      TEST_USER_ID,
      "POST",
    );
    const response = await exportPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const exportData = body.data.export;

    // Verify profile
    expect(exportData.profile.id).toBe(TEST_USER_ID);
    expect(exportData.profile.display_name).toBe("Test User");
    expect(exportData.exported_at).toBeDefined();

    // Verify health data is decrypted
    expect(exportData.health_data.length).toBe(3);
    expect(typeof exportData.health_data[0].value).toBe("number");
    expect(exportData.health_data[0].metric_type).toBe("sleep_score");

    // Verify shares
    expect(exportData.shares.length).toBe(1);
    expect(exportData.shares[0].label).toBe("Test Share");

    // Verify connections
    expect(exportData.connections.length).toBe(1);
    expect(exportData.connections[0].provider).toBe("oura");
  });

  it("exports empty data for user with no data", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/export",
      TEST_USER_ID,
      "POST",
    );
    const response = await exportPOST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const exportData = body.data.export;

    expect(exportData.health_data).toEqual([]);
    expect(exportData.shares).toEqual([]);
    expect(exportData.connections).toEqual([]);
  });

  it("emits data.exported audit event", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/export",
      TEST_USER_ID,
      "POST",
    );
    await exportPOST(request);

    // Allow fire-and-forget to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'data.exported'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── DELETE /api/user/account Tests ──────────────────────────────────────────

describe("DELETE /api/user/account", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/user/account",
      "DELETE",
      { confirmation: "DELETE MY ACCOUNT" },
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 with wrong confirmation string", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "delete my account" },
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with empty confirmation", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "" },
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 with missing confirmation field", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      {},
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(400);
  });

  it("deletes user and cascades", async () => {
    // Create associated data
    await createTestHealthData(TEST_USER_ID, 5);
    await createTestShare(TEST_USER_ID);
    await createTestConnection(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "DELETE MY ACCOUNT" },
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.deleted).toBe(true);

    // Verify user is gone
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, TEST_USER_ID));
    expect(userRows).toHaveLength(0);

    // Verify cascaded health data is gone
    const dataRows = await db
      .select()
      .from(healthData)
      .where(eq(healthData.userId, TEST_USER_ID));
    expect(dataRows).toHaveLength(0);

    // Verify cascaded shares are gone
    const shareRows = await db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.ownerId, TEST_USER_ID));
    expect(shareRows).toHaveLength(0);

    // Verify cascaded connections are gone
    const connRows = await db
      .select()
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, TEST_USER_ID));
    expect(connRows).toHaveLength(0);
  });

  it("audit events persist after user deletion", async () => {
    // Insert an audit event first
    await db.insert(auditEvents).values({
      ownerId: TEST_USER_ID,
      actorType: "owner",
      actorId: TEST_USER_ID,
      eventType: "share.created",
      resourceType: "share_grant",
    });

    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "DELETE MY ACCOUNT" },
    );
    await accountDELETE(request);

    // Audit events should still exist (owner_id is NOT a FK)
    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.ownerId, TEST_USER_ID));

    // Should have at least 2: the pre-existing one + account.deleted
    expect(auditRows.length).toBeGreaterThanOrEqual(2);

    // Should include account.deleted
    const deletedEvent = auditRows.find(
      (e) => e.eventType === "account.deleted",
    );
    expect(deletedEvent).toBeDefined();
  });

  it("emits account.deleted audit event BEFORE deletion", async () => {
    // Count existing account.deleted events before the test
    const beforeEvents = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'account.deleted'`,
      );
    const beforeCount = beforeEvents.length;

    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "DELETE MY ACCOUNT" },
    );
    await accountDELETE(request);

    // Audit event should persist even though user is deleted
    const afterEvents = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'account.deleted'`,
      );

    // Exactly one new account.deleted event was added
    expect(afterEvents.length).toBe(beforeCount + 1);
    const newEvent = afterEvents[afterEvents.length - 1];
    expect(newEvent.actorType).toBe("owner");
    expect(newEvent.actorId).toBe(TEST_USER_ID);
  });

  it("rejects confirmation 'Delete My Account' (case sensitive)", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/user/account",
      TEST_USER_ID,
      "DELETE",
      { confirmation: "Delete My Account" },
    );
    const response = await accountDELETE(request);
    expect(response.status).toBe(400);
  });
});
