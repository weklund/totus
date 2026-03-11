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
 * Tests for the API keys endpoints:
 * - POST /api/keys — create an API key
 * - GET /api/keys — list API keys (without secrets)
 * - PATCH /api/keys/:id — revoke an API key
 *
 * Tests verify: auth enforcement, validation, happy paths, max key limit,
 * revocation idempotency, scope enforcement, scope escalation prevention,
 * audit events, and Bearer token authentication.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let apiKeysTable: typeof import("@/db/schema").apiKeys;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handlers
let listGET: typeof import("../route").GET;
let createPOST: typeof import("../route").POST;
let revokePATCH: typeof import("../[id]/route").PATCH;

// Auth utilities
let generateApiKey: typeof import("@/lib/auth/api-keys").generateApiKey;
let hashLongToken: typeof import("@/lib/auth/api-keys").hashLongToken;

const TEST_USER_ID = "api_keys_test_user_001";
const TEST_USER_ID_2 = "api_keys_test_user_002";
const REQUEST_CONTEXT_HEADER = "x-request-context";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createOwnerRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    userId?: string;
    authMethod?: "session" | "api_key";
    apiKeyId?: string;
    scopes?: string[];
  } = {},
): Request {
  const {
    method = "GET",
    body,
    userId = TEST_USER_ID,
    authMethod = "session",
    apiKeyId,
    scopes,
  } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const ctx: Record<string, unknown> = {
    role: "owner",
    userId,
    permissions: "full",
    authMethod,
  };

  if (authMethod === "api_key" && apiKeyId) {
    ctx.apiKeyId = apiKeyId;
    ctx.scopes = scopes || [];
  }

  headers[REQUEST_CONTEXT_HEADER] = JSON.stringify(ctx);

  return new Request(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function createUnauthenticatedRequest(
  url: string,
  method: string = "GET",
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [REQUEST_CONTEXT_HEADER]: JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
  };
  return new Request(url, { method, headers });
}

// ─── Setup & Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  process.env.VIEWER_JWT_SECRET =
    process.env.VIEWER_JWT_SECRET || "test-viewer-jwt-secret-key";
  process.env.VIEWER_JWT_SECRET_PREVIOUS =
    process.env.VIEWER_JWT_SECRET_PREVIOUS || "test-viewer-jwt-secret-prev";

  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  apiKeysTable = schema.apiKeys;
  auditEvents = schema.auditEvents;

  const listModule = await import("../route");
  listGET = listModule.GET;
  createPOST = listModule.POST;

  const detailModule = await import("../[id]/route");
  revokePATCH = detailModule.PATCH;

  const authModule = await import("@/lib/auth/api-keys");
  generateApiKey = authModule.generateApiKey;
  hashLongToken = authModule.hashLongToken;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "API Keys Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "API Keys Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoNothing();
});

afterEach(async () => {
  // Clean up test data — audit_events is immutable (can't delete), just clean api_keys
  await db
    .delete(apiKeysTable)
    .where(sql`${apiKeysTable.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
});

afterAll(async () => {
  // Clean api_keys before users (FK constraint)
  await db
    .delete(apiKeysTable)
    .where(sql`${apiKeysTable.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
  await db
    .delete(users)
    .where(sql`${users.id} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
  await pool.end();
});

// ─── POST /api/keys ─────────────────────────────────────────────────────────

describe("POST /api/keys", () => {
  it("creates a key with correct format (tot_live_{8}_{32})", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Test Key",
        scopes: ["health:read", "shares:read"],
      },
    });

    const response = await createPOST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.data.key).toMatch(/^tot_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    expect(json.data.name).toBe("Test Key");
    expect(json.data.short_token).toHaveLength(8);
    expect(json.data.scopes).toEqual(["health:read", "shares:read"]);
    expect(json.data.expires_at).toBeTruthy();
    expect(json.data.created_at).toBeTruthy();
    expect(json.data.id).toBeTruthy();
  });

  it("stores short_token and SHA-256 hash in DB (not full key)", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Hash Verify Key",
        scopes: ["health:read"],
      },
    });

    const response = await createPOST(request);
    const json = await response.json();

    // Verify the key is stored correctly in DB
    const [dbKey] = await db
      .select()
      .from(apiKeysTable)
      .where(eq(apiKeysTable.id, json.data.id));

    expect(dbKey).toBeTruthy();
    expect(dbKey.shortToken).toBe(json.data.short_token);
    // The full key should not be stored anywhere
    expect(dbKey.longTokenHash).toHaveLength(64); // SHA-256 hex
    // Verify the hash matches
    const parts = json.data.key.split("_");
    const longToken = parts[3];
    expect(dbKey.longTokenHash).toBe(hashLongToken(longToken));
  });

  it("returns 401 without authentication", async () => {
    const request = createUnauthenticatedRequest(
      "http://localhost:3000/api/keys",
      "POST",
    );
    // Need to add body
    const requestWithBody = new Request("http://localhost:3000/api/keys", {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({
        name: "Test",
        scopes: ["health:read"],
      }),
    });

    const response = await createPOST(requestWithBody);
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid scopes", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Bad Scopes Key",
        scopes: ["invalid:scope"],
      },
    });

    const response = await createPOST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty scopes", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Empty Scopes Key",
        scopes: [],
      },
    });

    const response = await createPOST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing name", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        scopes: ["health:read"],
      },
    });

    const response = await createPOST(request);
    expect(response.status).toBe(400);
  });

  it("uses default expiration of 90 days when not specified", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Default Expiry Key",
        scopes: ["health:read"],
      },
    });

    const response = await createPOST(request);
    const json = await response.json();

    const expiresAt = new Date(json.data.expires_at);
    const now = new Date();
    const diffDays = Math.round(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBeGreaterThanOrEqual(89);
    expect(diffDays).toBeLessThanOrEqual(91);
  });

  it("uses custom expiration when specified", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Custom Expiry Key",
        scopes: ["health:read"],
        expires_in_days: 30,
      },
    });

    const response = await createPOST(request);
    const json = await response.json();

    const expiresAt = new Date(json.data.expires_at);
    const now = new Date();
    const diffDays = Math.round(
      (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBeGreaterThanOrEqual(29);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("enforces max 10 active keys per user (400 KEY_LIMIT_REACHED)", async () => {
    // Create 10 keys first
    for (let i = 0; i < 10; i++) {
      const { shortToken, longTokenHash } = generateApiKey();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 90);
      await db.insert(apiKeysTable).values({
        userId: TEST_USER_ID,
        name: `Key ${i}`,
        shortToken,
        longTokenHash,
        scopes: ["health:read"],
        expiresAt,
      });
    }

    // Try to create 11th key
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "11th Key",
        scopes: ["health:read"],
      },
    });

    const response = await createPOST(request);
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error.code).toBe("KEY_LIMIT_REACHED");
  });

  it("emits key.created audit event", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Audit Test Key",
        scopes: ["health:read"],
      },
    });

    const response = await createPOST(request);
    expect(response.status).toBe(201);

    // Wait for fire-and-forget audit write
    await new Promise((r) => setTimeout(r, 100));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'key.created'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].actorType).toBe("owner");
    expect(events[0].resourceType).toBe("api_key");
  });

  it("prevents scope escalation when creating via API key", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Escalated Key",
        scopes: ["health:read", "shares:write"], // shares:write not in parent
      },
      authMethod: "api_key",
      apiKeyId: "parent-key-id",
      scopes: ["health:read", "keys:write"], // parent only has health:read + keys:write
    });

    const response = await createPOST(request);
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error.code).toBe("INSUFFICIENT_SCOPES");
  });

  it("allows creating key with subset of parent key scopes", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "Subset Key",
        scopes: ["health:read"],
      },
      authMethod: "api_key",
      apiKeyId: "parent-key-id",
      scopes: ["health:read", "shares:read", "keys:write"],
    });

    const response = await createPOST(request);
    expect(response.status).toBe(201);
  });

  it("returns 403 when API key lacks keys:write scope", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: {
        name: "No Keys Write",
        scopes: ["health:read"],
      },
      authMethod: "api_key",
      apiKeyId: "read-only-key-id",
      scopes: ["health:read", "keys:read"], // No keys:write
    });

    const response = await createPOST(request);
    const json = await response.json();
    expect(response.status).toBe(403);
    expect(json.error.code).toBe("INSUFFICIENT_SCOPES");
  });
});

// ─── GET /api/keys ──────────────────────────────────────────────────────────

describe("GET /api/keys", () => {
  it("lists keys without secrets", async () => {
    // Create a key first
    const createReq = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: { name: "List Test Key", scopes: ["health:read"] },
    });
    await createPOST(createReq);

    // List keys
    const listReq = createOwnerRequest("http://localhost:3000/api/keys");
    const response = await listGET(listReq);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.length).toBeGreaterThanOrEqual(1);

    // Verify no full key in response
    for (const key of json.data) {
      expect(key.key).toBeUndefined();
      expect(key.long_token_hash).toBeUndefined();
      expect(key.short_token).toBeTruthy();
      expect(key.name).toBeTruthy();
      expect(key.scopes).toBeTruthy();
      expect(key.status).toBeTruthy();
    }
  });

  it("returns empty array when no keys exist", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      userId: TEST_USER_ID_2,
    });
    const response = await listGET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toHaveLength(0);
  });

  it("returns 401 without authentication", async () => {
    const request = createUnauthenticatedRequest(
      "http://localhost:3000/api/keys",
    );
    const response = await listGET(request);
    expect(response.status).toBe(401);
  });

  it("computes correct status for active, expired, and revoked keys", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const past = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    // Active key
    const activeKey = generateApiKey();
    await db.insert(apiKeysTable).values({
      userId: TEST_USER_ID,
      name: "Active Key",
      shortToken: activeKey.shortToken,
      longTokenHash: activeKey.longTokenHash,
      scopes: ["health:read"],
      expiresAt: future,
    });

    // Expired key
    const expiredKey = generateApiKey();
    await db.insert(apiKeysTable).values({
      userId: TEST_USER_ID,
      name: "Expired Key",
      shortToken: expiredKey.shortToken,
      longTokenHash: expiredKey.longTokenHash,
      scopes: ["health:read"],
      expiresAt: past,
    });

    // Revoked key
    const revokedKey = generateApiKey();
    await db.insert(apiKeysTable).values({
      userId: TEST_USER_ID,
      name: "Revoked Key",
      shortToken: revokedKey.shortToken,
      longTokenHash: revokedKey.longTokenHash,
      scopes: ["health:read"],
      expiresAt: future,
      revokedAt: now,
    });

    const request = createOwnerRequest("http://localhost:3000/api/keys");
    const response = await listGET(request);
    const json = await response.json();

    const statuses = json.data.map((k: { name: string; status: string }) => ({
      name: k.name,
      status: k.status,
    }));

    expect(statuses).toContainEqual({ name: "Active Key", status: "active" });
    expect(statuses).toContainEqual({
      name: "Expired Key",
      status: "expired",
    });
    expect(statuses).toContainEqual({
      name: "Revoked Key",
      status: "revoked",
    });
  });

  it("only shows keys for the authenticated user", async () => {
    // Create key for user 1
    const createReq1 = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: { name: "User 1 Key", scopes: ["health:read"] },
      userId: TEST_USER_ID,
    });
    await createPOST(createReq1);

    // Create key for user 2
    const createReq2 = createOwnerRequest("http://localhost:3000/api/keys", {
      method: "POST",
      body: { name: "User 2 Key", scopes: ["health:read"] },
      userId: TEST_USER_ID_2,
    });
    await createPOST(createReq2);

    // List as user 1
    const listReq = createOwnerRequest("http://localhost:3000/api/keys", {
      userId: TEST_USER_ID,
    });
    const response = await listGET(listReq);
    const json = await response.json();

    // Should only see user 1's key
    const names = json.data.map((k: { name: string }) => k.name);
    expect(names).toContain("User 1 Key");
    expect(names).not.toContain("User 2 Key");
  });

  it("requires keys:read scope when using API key auth", async () => {
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      authMethod: "api_key",
      apiKeyId: "read-key",
      scopes: ["health:read"], // No keys:read
    });

    const response = await listGET(request);
    expect(response.status).toBe(403);
  });
});

// ─── PATCH /api/keys/:id ────────────────────────────────────────────────────

describe("PATCH /api/keys/:id", () => {
  it("revokes an active key", async () => {
    // Create a key
    const { shortToken, longTokenHash } = generateApiKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const [key] = await db
      .insert(apiKeysTable)
      .values({
        userId: TEST_USER_ID,
        name: "To Revoke",
        shortToken,
        longTokenHash,
        scopes: ["health:read"],
        expiresAt,
      })
      .returning();

    const request = createOwnerRequest(
      `http://localhost:3000/api/keys/${key.id}`,
      {
        method: "PATCH",
        body: { action: "revoke" },
      },
    );

    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: key.id }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.status).toBe("revoked");
    expect(json.data.revoked_at).toBeTruthy();
  });

  it("is idempotent — revoking already-revoked key returns 200", async () => {
    const { shortToken, longTokenHash } = generateApiKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const [key] = await db
      .insert(apiKeysTable)
      .values({
        userId: TEST_USER_ID,
        name: "Already Revoked",
        shortToken,
        longTokenHash,
        scopes: ["health:read"],
        expiresAt,
        revokedAt: new Date(),
      })
      .returning();

    const request = createOwnerRequest(
      `http://localhost:3000/api/keys/${key.id}`,
      {
        method: "PATCH",
        body: { action: "revoke" },
      },
    );

    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: key.id }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.status).toBe("revoked");
  });

  it("returns 404 for non-existent key", async () => {
    const request = createOwnerRequest(
      "http://localhost:3000/api/keys/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        body: { action: "revoke" },
      },
    );

    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for key owned by another user", async () => {
    const { shortToken, longTokenHash } = generateApiKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const [key] = await db
      .insert(apiKeysTable)
      .values({
        userId: TEST_USER_ID_2,
        name: "Other User Key",
        shortToken,
        longTokenHash,
        scopes: ["health:read"],
        expiresAt,
      })
      .returning();

    const request = createOwnerRequest(
      `http://localhost:3000/api/keys/${key.id}`,
      {
        method: "PATCH",
        body: { action: "revoke" },
        userId: TEST_USER_ID,
      },
    );

    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: key.id }),
    });
    expect(response.status).toBe(404);
  });

  it("emits key.revoked audit event", async () => {
    const { shortToken, longTokenHash } = generateApiKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const [key] = await db
      .insert(apiKeysTable)
      .values({
        userId: TEST_USER_ID,
        name: "Audit Revoke Key",
        shortToken,
        longTokenHash,
        scopes: ["health:read"],
        expiresAt,
      })
      .returning();

    const request = createOwnerRequest(
      `http://localhost:3000/api/keys/${key.id}`,
      {
        method: "PATCH",
        body: { action: "revoke" },
      },
    );

    await revokePATCH(request, {
      params: Promise.resolve({ id: key.id }),
    });

    // Wait for fire-and-forget audit write
    await new Promise((r) => setTimeout(r, 100));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'key.revoked'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("api_key");
  });

  it("returns 401 without authentication", async () => {
    const request = createUnauthenticatedRequest(
      "http://localhost:3000/api/keys/some-id",
      "PATCH",
    );
    // Add body
    const requestWithBody = new Request(
      "http://localhost:3000/api/keys/some-id",
      {
        method: "PATCH",
        headers: request.headers,
        body: JSON.stringify({ action: "revoke" }),
      },
    );

    const response = await revokePATCH(requestWithBody, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });
});

// ─── API Key Authentication (Bearer header) ──────────────────────────────────

describe("API key authentication via middleware context", () => {
  it("API key auth context is propagated correctly in requests", async () => {
    // Create a real key in DB
    const { shortToken, longTokenHash } = generateApiKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const [key] = await db
      .insert(apiKeysTable)
      .values({
        userId: TEST_USER_ID,
        name: "Auth Test Key",
        shortToken,
        longTokenHash,
        scopes: ["health:read", "keys:read"],
        expiresAt,
      })
      .returning();

    // Make a request with API key context (simulating middleware output)
    const request = createOwnerRequest("http://localhost:3000/api/keys", {
      authMethod: "api_key",
      apiKeyId: key.id,
      scopes: ["health:read", "keys:read"],
    });

    const response = await listGET(request);
    expect(response.status).toBe(200);
  });
});

// ─── API Key generation utility tests ────────────────────────────────────────

describe("API key utilities", () => {
  it("generateApiKey produces correct format", () => {
    const key = generateApiKey();
    expect(key.fullKey).toMatch(/^tot_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/);
    expect(key.shortToken).toHaveLength(8);
    expect(key.longToken).toHaveLength(32);
    expect(key.longTokenHash).toHaveLength(64); // SHA-256 hex
  });

  it("generateApiKey produces unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const key = generateApiKey();
      expect(keys.has(key.fullKey)).toBe(false);
      keys.add(key.fullKey);
    }
  });

  it("hashLongToken is deterministic", () => {
    const token = "placeholder".repeat(3).slice(0, 32);
    const hash1 = hashLongToken(token);
    const hash2 = hashLongToken(token);
    expect(hash1).toBe(hash2);
  });
});

// ─── parseApiKey tests ──────────────────────────────────────────────────────

describe("parseApiKey", () => {
  let parseApiKey: typeof import("@/lib/auth/api-keys").parseApiKey;

  beforeAll(async () => {
    const mod = await import("@/lib/auth/api-keys");
    parseApiKey = mod.parseApiKey;
  });

  it("parses valid key correctly", () => {
    // Construct a test key with known short and long tokens
    const shortTok = "Aa1Bb2Cc";
    const longTok = "Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn";
    const result = parseApiKey(`tot_live_${shortTok}_${longTok}`);
    expect(result).not.toBeNull();
    expect(result!.shortToken).toBe(shortTok);
    expect(result!.longToken).toBe(longTok);
  });

  it("rejects key with wrong prefix", () => {
    const result = parseApiKey(
      "xxx_live_Aa1Bb2Cc_Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn",
    );
    expect(result).toBeNull();
  });

  it("rejects key with wrong number of parts", () => {
    const result = parseApiKey("tot_live_extra_Aa1Bb2Cc_Dd3E");
    expect(result).toBeNull();
  });

  it("rejects key with wrong short token length", () => {
    const result = parseApiKey(
      "tot_live_BRTR_Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn",
    );
    expect(result).toBeNull();
  });

  it("rejects key with wrong long token length", () => {
    const result = parseApiKey("tot_live_Aa1Bb2Cc_short");
    expect(result).toBeNull();
  });

  it("rejects key with invalid characters", () => {
    const result = parseApiKey(
      "tot_live_A-1Bb2Cc_Dd3Ee4Ff5Gg6Hh7Ii8Jj9Kk0Ll1Mm2Nn",
    );
    expect(result).toBeNull();
  });
});

// ─── verifyLongToken tests ──────────────────────────────────────────────────

describe("verifyLongToken", () => {
  let verifyLongToken: typeof import("@/lib/auth/api-keys").verifyLongToken;

  beforeAll(async () => {
    const mod = await import("@/lib/auth/api-keys");
    verifyLongToken = mod.verifyLongToken;
  });

  it("verifies correct token", () => {
    const token = "placeholder".repeat(3).slice(0, 32);
    const hash = hashLongToken(token);
    expect(verifyLongToken(token, hash)).toBe(true);
  });

  it("rejects incorrect token", () => {
    const token = "placeholder".repeat(3).slice(0, 32);
    const hash = hashLongToken(token);
    const wrongToken = "changeme".repeat(4).slice(0, 32);
    expect(verifyLongToken(wrongToken, hash)).toBe(false);
  });
});

// ─── Scope validation tests ──────────────────────────────────────────────────

describe("scope validation", () => {
  let validateScopes: typeof import("@/lib/auth/api-keys").validateScopes;
  let isScopeSubset: typeof import("@/lib/auth/api-keys").isScopeSubset;

  beforeAll(async () => {
    const mod = await import("@/lib/auth/api-keys");
    validateScopes = mod.validateScopes;
    isScopeSubset = mod.isScopeSubset;
  });

  it("validates correct scopes", () => {
    expect(validateScopes(["health:read", "shares:write"])).toBe(true);
  });

  it("rejects invalid scopes", () => {
    expect(validateScopes(["health:read", "invalid:scope"])).toBe(false);
  });

  it("isScopeSubset returns true for subset", () => {
    expect(
      isScopeSubset(["health:read"], ["health:read", "shares:write"]),
    ).toBe(true);
  });

  it("isScopeSubset returns false for non-subset", () => {
    expect(
      isScopeSubset(["health:read", "shares:write"], ["health:read"]),
    ).toBe(false);
  });
});
