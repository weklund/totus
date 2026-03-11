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
 * Tests for the shares API endpoints:
 * - POST /api/shares — create a share grant
 * - GET /api/shares — list share grants with status filter and pagination
 * - GET /api/shares/:id — get share grant details
 * - PATCH /api/shares/:id — revoke a share grant
 * - DELETE /api/shares/:id — hard delete a revoked/expired share grant
 *
 * Tests verify: auth enforcement, validation, happy paths, max share limit,
 * revocation idempotency, delete restrictions, pagination, status filtering.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let shareGrants: typeof import("@/db/schema").shareGrants;
let auditEvents: typeof import("@/db/schema").auditEvents;
let healthData: typeof import("@/db/schema").healthData;

// Route handlers
let listGET: typeof import("../route").GET;
let createPOST: typeof import("../route").POST;
let detailGET: typeof import("../[id]/route").GET;
let revokePATCH: typeof import("../[id]/route").PATCH;
let deleteDELETE: typeof import("../[id]/route").DELETE;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

const TEST_USER_ID = "shares_test_user_001";
const TEST_USER_ID_2 = "shares_test_user_002";

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
  process.env.VIEWER_JWT_SECRET =
    process.env.VIEWER_JWT_SECRET || "test-viewer-jwt-secret-key";
  process.env.VIEWER_JWT_SECRET_PREVIOUS =
    process.env.VIEWER_JWT_SECRET_PREVIOUS || "test-viewer-jwt-secret-prev";

  // Import modules
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  shareGrants = schema.shareGrants;
  auditEvents = schema.auditEvents;
  healthData = schema.healthData;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import route handlers
  const listModule = await import("../route");
  listGET = listModule.GET;
  createPOST = listModule.POST;

  const detailModule = await import("../[id]/route");
  detailGET = detailModule.GET;
  revokePATCH = detailModule.PATCH;
  deleteDELETE = detailModule.DELETE;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Shares Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Shares Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Shares Test User", updatedAt: new Date() },
    });

  // Seed health data so metric validation passes
  const encryption = createEncryptionProvider();
  const encrypted = await encryption.encrypt(
    Buffer.from(JSON.stringify(85)),
    TEST_USER_ID,
  );

  await db
    .insert(healthData)
    .values({
      userId: TEST_USER_ID,
      metricType: "sleep_score",
      date: "2026-01-15",
      valueEncrypted: encrypted,
      source: "oura",
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(shareGrants)
    .where(sql`${shareGrants.ownerId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);

  await db
    .delete(healthData)
    .where(sql`${healthData.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);

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
  if (body) {
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
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function validShareBody(overrides: Record<string, unknown> = {}) {
  return {
    label: "For Dr. Patel - annual checkup",
    allowed_metrics: ["sleep_score"],
    data_start: "2026-01-01",
    data_end: "2026-03-01",
    expires_in_days: 30,
    ...overrides,
  };
}

async function createShareGrant(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const request = createAuthRequest(
    "http://localhost:3000/api/shares",
    userId,
    "POST",
    validShareBody(overrides),
  );
  const response = await createPOST(request);
  const body = await response.json();
  return body.data.id;
}

async function createExpiredGrant(userId: string): Promise<string> {
  // Create a grant with expires_in_days=1, then manually set grant_expires to the past
  const request = createAuthRequest(
    "http://localhost:3000/api/shares",
    userId,
    "POST",
    validShareBody({ expires_in_days: 1 }),
  );
  const response = await createPOST(request);
  const body = await response.json();
  const grantId = body.data.id;

  // Manually set grant_expires to past
  await db
    .update(shareGrants)
    .set({ grantExpires: new Date("2020-01-01T00:00:00Z") })
    .where(eq(shareGrants.id, grantId));

  return grantId;
}

// ─── POST /api/shares ────────────────────────────────────────────────────────

describe("POST /api/shares", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/shares",
      "POST",
      validShareBody(),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("creates share grant and returns raw token (shown once)", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ note: "Please review my sleep trends" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.token).toBeDefined();
    expect(body.data.token.length).toBe(43); // base64url of 32 bytes
    expect(body.data.share_url).toContain("/v/");
    expect(body.data.share_url).toContain(body.data.token);
    expect(body.data.label).toBe("For Dr. Patel - annual checkup");
    expect(body.data.allowed_metrics).toEqual(["sleep_score"]);
    expect(body.data.data_start).toBe("2026-01-01");
    expect(body.data.data_end).toBe("2026-03-01");
    expect(body.data.grant_expires).toBeDefined();
    expect(body.data.note).toBe("Please review my sleep trends");
    expect(body.data.created_at).toBeDefined();

    // Verify token is stored as a hash, not the raw token
    const [grant] = await db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.id, body.data.id));
    expect(grant).toBeDefined();
    expect(grant.token).not.toBe(body.data.token);
    expect(grant.token.length).toBe(64); // SHA-256 hex
  });

  it("returns 400 for missing label", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ label: "" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for label exceeding 255 chars", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ label: "x".repeat(256) }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty allowed_metrics array", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ allowed_metrics: [] }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid metric type", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ allowed_metrics: ["not_a_real_metric"] }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for more than 21 metrics", async () => {
    const metrics = Array.from({ length: 22 }, (_, i) => `metric_${i}`);
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ allowed_metrics: metrics }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date format", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ data_start: "01-01-2026" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when data_end < data_start", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ data_start: "2026-03-01", data_end: "2026-01-01" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for expires_in_days < 1", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ expires_in_days: 0 }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for expires_in_days > 365", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ expires_in_days: 366 }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for note exceeding 1000 chars", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ note: "x".repeat(1001) }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("allows creation without a note", async () => {
    const body = validShareBody();
    delete (body as Record<string, unknown>).note;
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      body,
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const result = await response.json();
    expect(result.data.note).toBeNull();
  });

  it("enforces max 50 active shares per user (409)", async () => {
    // Create 50 active shares
    for (let i = 0; i < 50; i++) {
      await createShareGrant(TEST_USER_ID, {
        label: `Share ${i}`,
      });
    }

    // 51st share should fail
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody({ label: "Share 51 - should fail" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.error.code).toBe("MAX_SHARES_EXCEEDED");
  }, 30000);

  it("emits share.created audit event", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
      "POST",
      validShareBody(),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const result = await response.json();

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check audit event exists
    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'share.created' AND ${auditEvents.grantId} = ${result.data.id}`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].actorType).toBe("owner");
    expect(events[0].resourceType).toBe("share_grant");
  });
});

// ─── GET /api/shares ─────────────────────────────────────────────────────────

describe("GET /api/shares", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest("http://localhost:3000/api/shares");
    const response = await listGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns empty array when no shares", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.has_more).toBe(false);
  });

  it("returns share grants with computed status", async () => {
    await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].label).toBe("For Dr. Patel - annual checkup");
    expect(body.data[0].status).toBe("active");
    expect(body.data[0].view_count).toBe(0);
    expect(body.data[0].created_at).toBeDefined();
  });

  it("does not return another user's shares", async () => {
    await createShareGrant(TEST_USER_ID_2);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  it("filters by status=active", async () => {
    await createShareGrant(TEST_USER_ID);
    await createExpiredGrant(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares?status=active",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("active");
  });

  it("filters by status=expired", async () => {
    await createShareGrant(TEST_USER_ID);
    const expiredId = await createExpiredGrant(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares?status=expired",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("expired");
    expect(body.data[0].id).toBe(expiredId);
  });

  it("filters by status=revoked", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    // Revoke it
    const revokeRequest = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    await revokePATCH(revokeRequest, {
      params: Promise.resolve({ id: grantId }),
    });

    // Also create an active one
    await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares?status=revoked",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].status).toBe("revoked");
    expect(body.data[0].id).toBe(grantId);
  });

  it("supports cursor-based pagination", async () => {
    // Create 3 shares
    for (let i = 0; i < 3; i++) {
      await createShareGrant(TEST_USER_ID, { label: `Share ${i}` });
      // Small delay to ensure different created_at
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Get first page (limit=2)
    const request1 = createAuthRequest(
      "http://localhost:3000/api/shares?limit=2",
      TEST_USER_ID,
    );
    const response1 = await listGET(request1);
    expect(response1.status).toBe(200);

    const body1 = await response1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.pagination.has_more).toBe(true);
    expect(body1.pagination.next_cursor).toBeDefined();

    // Get second page
    const request2 = createAuthRequest(
      `http://localhost:3000/api/shares?limit=2&cursor=${body1.pagination.next_cursor}`,
      TEST_USER_ID,
    );
    const response2 = await listGET(request2);
    expect(response2.status).toBe(200);

    const body2 = await response2.json();
    expect(body2.data.length).toBe(1);
    expect(body2.pagination.has_more).toBe(false);

    // Ensure no overlap between pages
    const allIds = [
      ...body1.data.map((d: { id: string }) => d.id),
      ...body2.data.map((d: { id: string }) => d.id),
    ];
    const uniqueIds = new Set(allIds);
    expect(uniqueIds.size).toBe(3);
  });

  it("does not include the raw token in list responses", async () => {
    await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/shares",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    const body = await response.json();

    expect(body.data[0].token).toBeUndefined();
    expect(body.data[0].share_url).toBeUndefined();
  });
});

// ─── GET /api/shares/:id ────────────────────────────────────────────────────

describe("GET /api/shares/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/shares/some-id",
    );
    const response = await detailGET(request, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-existent share", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${fakeId}`,
      TEST_USER_ID,
    );
    const response = await detailGET(request, {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for another user's share", async () => {
    const grantId = await createShareGrant(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
    );
    const response = await detailGET(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns share details with view_count and last_viewed_at", async () => {
    const grantId = await createShareGrant(TEST_USER_ID, {
      note: "Test note for details",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
    );
    const response = await detailGET(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(grantId);
    expect(body.data.label).toBe("For Dr. Patel - annual checkup");
    expect(body.data.note).toBe("Test note for details");
    expect(body.data.view_count).toBe(0);
    expect(body.data.last_viewed_at).toBeNull();
    expect(body.data.status).toBe("active");
    expect(body.data.recent_views).toBeDefined();
    expect(Array.isArray(body.data.recent_views)).toBe(true);
  });

  it("returns 404 for invalid UUID format", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/shares/not-a-uuid",
      TEST_USER_ID,
    );
    const response = await detailGET(request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
  });
});

// ─── PATCH /api/shares/:id ──────────────────────────────────────────────────

describe("PATCH /api/shares/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/shares/some-id",
      "PATCH",
      { action: "revoke" },
    );
    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-existent share", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${fakeId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 for another user's share", async () => {
    const grantId = await createShareGrant(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(404);
  });

  it("revokes an active share and returns updated status", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(grantId);
    expect(body.data.status).toBe("revoked");
    expect(body.data.revoked_at).toBeDefined();
  });

  it("is idempotent — revoking already-revoked share returns 200", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    // First revoke
    const request1 = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    const response1 = await revokePATCH(request1, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response1.status).toBe(200);

    // Second revoke — should also return 200 (idempotent)
    const request2 = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    const response2 = await revokePATCH(request2, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response2.status).toBe(200);

    const body = await response2.json();
    expect(body.data.status).toBe("revoked");
  });

  it("returns 400 for invalid action", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "something_else" },
    );
    const response = await revokePATCH(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("emits share.revoked audit event", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    await revokePATCH(request, {
      params: Promise.resolve({ id: grantId }),
    });

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'share.revoked' AND ${auditEvents.grantId} = ${grantId}`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── DELETE /api/shares/:id ─────────────────────────────────────────────────

describe("DELETE /api/shares/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/shares/some-id",
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: "some-id" }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 404 for non-existent share", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${fakeId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: fakeId }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 SHARE_STILL_ACTIVE for active share", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.code).toBe("SHARE_STILL_ACTIVE");
  });

  it("deletes a revoked share", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    // Revoke first
    const revokeRequest = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    await revokePATCH(revokeRequest, {
      params: Promise.resolve({ id: grantId }),
    });

    // Then delete
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(grantId);
    expect(body.data.deleted).toBe(true);

    // Verify grant is gone
    const [gone] = await db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.id, grantId));
    expect(gone).toBeUndefined();
  });

  it("deletes an expired share", async () => {
    const grantId = await createExpiredGrant(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(grantId);
    expect(body.data.deleted).toBe(true);
  });

  it("returns 404 for another user's share", async () => {
    const grantId = await createShareGrant(TEST_USER_ID_2);

    // Revoke it as the owner first
    const revokeRequest = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID_2,
      "PATCH",
      { action: "revoke" },
    );
    await revokePATCH(revokeRequest, {
      params: Promise.resolve({ id: grantId }),
    });

    // Try to delete as a different user
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: grantId }),
    });
    expect(response.status).toBe(404);
  });

  it("emits share.deleted audit event", async () => {
    const grantId = await createShareGrant(TEST_USER_ID);

    // Revoke first
    const revokeRequest = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "PATCH",
      { action: "revoke" },
    );
    await revokePATCH(revokeRequest, {
      params: Promise.resolve({ id: grantId }),
    });

    // Delete
    const request = createAuthRequest(
      `http://localhost:3000/api/shares/${grantId}`,
      TEST_USER_ID,
      "DELETE",
    );
    await deleteDELETE(request, {
      params: Promise.resolve({ id: grantId }),
    });

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'share.deleted' AND ${auditEvents.grantId} = ${grantId}`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
