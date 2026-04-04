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
 * Tests for the viewer API endpoints:
 * - POST /api/viewer/validate — validate share token, issue viewer JWT
 * - GET /api/viewer/data — fetch health data scoped to grant
 *
 * Tests cover: valid token flow, invalid/expired/revoked tokens,
 * viewer data with scope enforcement, empty metric intersection,
 * grant re-validation after revocation, audit events, rate limiting.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let shareGrants: typeof import("@/db/schema").shareGrants;
let auditEvents: typeof import("@/db/schema").auditEvents;
let healthData: typeof import("@/db/schema").healthData;

// Route handlers
let validatePOST: typeof import("../validate/route").POST;
let viewerDataGET: typeof import("../data/route").GET;

// Auth helpers
let hashToken: typeof import("@/lib/auth/viewer").hashToken;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;
let encryptionProvider: import("@/lib/encryption").EncryptionProvider;

// Rate limiter
let validationRateLimiter: typeof import("@/lib/api").validationRateLimiter;

const TEST_USER_ID = "viewer_test_user_001";
const TEST_USER_DISPLAY_NAME = "Viewer Test User";

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

  const authModule = await import("@/lib/auth/viewer");
  hashToken = authModule.hashToken;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;
  encryptionProvider = createEncryptionProvider();

  const apiModule = await import("@/lib/api");
  validationRateLimiter = apiModule.validationRateLimiter;

  // Import route handlers
  const validateModule = await import("../validate/route");
  validatePOST = validateModule.POST;

  const dataModule = await import("../data/route");
  viewerDataGET = dataModule.GET;
});

beforeEach(async () => {
  // Reset rate limiter between tests
  validationRateLimiter.reset();

  // Create test user
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      displayName: TEST_USER_DISPLAY_NAME,
      kmsKeyArn: "local-dev-key",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: TEST_USER_DISPLAY_NAME,
        updatedAt: new Date(),
      },
    });
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db.delete(shareGrants).where(eq(shareGrants.ownerId, TEST_USER_ID));

  await db.delete(healthData).where(eq(healthData.userId, TEST_USER_ID));

  // Delete audit events via raw SQL (immutability trigger blocks normal DELETE)
  await pool
    .query(`DELETE FROM audit_events WHERE owner_id = $1`, [TEST_USER_ID])
    .catch(() => {
      // Trigger may prevent deletion — OK for test cleanup
    });

  await db.delete(users).where(eq(users.id, TEST_USER_ID));
});

afterAll(async () => {
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a share grant directly in the DB and return { rawToken, grantId }.
 */
async function createTestGrant(
  overrides: {
    ownerId?: string;
    allowedMetrics?: string[];
    dataStart?: string;
    dataEnd?: string;
    expiresInDays?: number;
    label?: string;
    note?: string;
  } = {},
): Promise<{ rawToken: string; grantId: string }> {
  const { randomBytes } = await import("crypto");
  const rawToken = randomBytes(32).toString("base64url").replace(/=+$/, "");
  const tokenHash = hashToken(rawToken);

  const grantExpires = new Date();
  grantExpires.setDate(
    grantExpires.getDate() + (overrides.expiresInDays ?? 30),
  );

  const [grant] = await db
    .insert(shareGrants)
    .values({
      token: tokenHash,
      ownerId: overrides.ownerId ?? TEST_USER_ID,
      label: overrides.label ?? "Test Share Grant",
      note: overrides.note ?? "Test note",
      allowedMetrics: overrides.allowedMetrics ?? ["sleep_score", "hrv", "rhr"],
      dataStart: overrides.dataStart ?? "2026-01-01",
      dataEnd: overrides.dataEnd ?? "2026-03-01",
      grantExpires,
    })
    .returning();

  return { rawToken, grantId: grant.id };
}

/**
 * Create an expired share grant.
 */
async function createExpiredGrant(): Promise<{
  rawToken: string;
  grantId: string;
}> {
  const result = await createTestGrant();
  await db
    .update(shareGrants)
    .set({ grantExpires: new Date("2020-01-01T00:00:00Z") })
    .where(eq(shareGrants.id, result.grantId));
  return result;
}

/**
 * Create a revoked share grant.
 */
async function createRevokedGrant(): Promise<{
  rawToken: string;
  grantId: string;
}> {
  const result = await createTestGrant();
  await db
    .update(shareGrants)
    .set({ revokedAt: new Date() })
    .where(eq(shareGrants.id, result.grantId));
  return result;
}

/**
 * Create a validate POST request.
 */
function createValidateRequest(
  token: string,
  ip: string = "192.168.1.1",
): Request {
  return new Request("http://localhost:3000/api/viewer/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ token }),
  });
}

/**
 * Create a viewer data GET request with viewer context.
 */
function createViewerDataRequest(
  params: {
    metrics: string;
    start: string;
    end: string;
    resolution?: string;
  },
  viewerCtx: {
    ownerId: string;
    grantId: string;
    allowedMetrics: string[];
    dataStart: string;
    dataEnd: string;
  },
): Request {
  const url = new URL("http://localhost:3000/api/viewer/data");
  url.searchParams.set("metrics", params.metrics);
  url.searchParams.set("start", params.start);
  url.searchParams.set("end", params.end);
  if (params.resolution) {
    url.searchParams.set("resolution", params.resolution);
  }

  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "viewer",
      userId: viewerCtx.ownerId,
      grantId: viewerCtx.grantId,
      permissions: {
        allowedMetrics: viewerCtx.allowedMetrics,
        dataStart: viewerCtx.dataStart,
        dataEnd: viewerCtx.dataEnd,
      },
      authMethod: "viewer_jwt",
    }),
  });

  return new Request(url.toString(), { method: "GET", headers });
}

/**
 * Create an unauthenticated GET request.
 */
function createUnauthDataRequest(metrics: string): Request {
  const url = `http://localhost:3000/api/viewer/data?metrics=${metrics}&start=2026-01-01&end=2026-03-01`;
  return new Request(url, {
    method: "GET",
    headers: {
      "x-request-context": JSON.stringify({
        role: "unauthenticated",
        permissions: "full",
        authMethod: "none",
      }),
    },
  });
}

/**
 * Insert encrypted health data for testing.
 */
async function insertHealthData(
  userId: string,
  metricType: string,
  date: string,
  value: number,
  source: string = "oura",
): Promise<void> {
  const encrypted = await encryptionProvider.encrypt(
    Buffer.from(JSON.stringify(value)),
    userId,
  );
  await db
    .insert(healthData)
    .values({
      userId,
      metricType,
      date,
      valueEncrypted: encrypted,
      source,
    })
    .onConflictDoNothing();
}

// ─── POST /api/viewer/validate ──────────────────────────────────────────────

describe("POST /api/viewer/validate", () => {
  describe("valid token flow", () => {
    it("returns 200 with grant details and sets viewer cookie", async () => {
      const { rawToken } = await createTestGrant({
        label: "For Dr. Patel",
        note: "Check my sleep data",
        allowedMetrics: ["sleep_score", "hrv"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      const request = createValidateRequest(rawToken);
      const response = await validatePOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.valid).toBe(true);
      expect(body.data.owner_display_name).toBe(TEST_USER_DISPLAY_NAME);
      expect(body.data.label).toBe("For Dr. Patel");
      expect(body.data.note).toBe("Check my sleep data");
      expect(body.data.allowed_metrics).toEqual(["sleep_score", "hrv"]);
      expect(body.data.data_start).toBe("2026-01-01");
      expect(body.data.data_end).toBe("2026-03-01");
      expect(body.data.expires_at).toBeDefined();

      // Check viewer cookie is set
      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain("totus_viewer=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Path=/");
    });

    it("increments view_count on each validation", async () => {
      const { rawToken, grantId } = await createTestGrant();

      // Validate twice
      await validatePOST(createValidateRequest(rawToken));
      await validatePOST(createValidateRequest(rawToken));

      // Check view_count
      const [grant] = await db
        .select()
        .from(shareGrants)
        .where(eq(shareGrants.id, grantId));
      expect(grant.viewCount).toBe(2);
      expect(grant.lastViewedAt).not.toBeNull();
    });

    it("emits share.viewed audit event", async () => {
      const { rawToken, grantId } = await createTestGrant();

      await validatePOST(createValidateRequest(rawToken));

      // Wait for fire-and-forget audit event
      await new Promise((resolve) => setTimeout(resolve, 200));

      const events = await db
        .select()
        .from(auditEvents)
        .where(
          sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'share.viewed' AND ${auditEvents.grantId} = ${grantId}`,
        );

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].actorType).toBe("viewer");
      expect(events[0].resourceType).toBe("share_grant");
    });

    it("returns null note when grant has no note", async () => {
      const { rawToken } = await createTestGrant({
        label: "No note share",
      });

      // Manually set note to null in the DB
      const tokenHash = hashToken(rawToken);
      await db
        .update(shareGrants)
        .set({ note: null })
        .where(eq(shareGrants.token, tokenHash));

      const request = createValidateRequest(rawToken);
      const response = await validatePOST(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.note).toBeNull();
    });
  });

  describe("invalid token", () => {
    it("returns 404 SHARE_NOT_FOUND for non-existent token", async () => {
      const request = createValidateRequest(
        "nonexistent-token-that-doesnt-exist",
      );
      const response = await validatePOST(request);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error.code).toBe("SHARE_NOT_FOUND");
    });

    it("returns 400 for empty token", async () => {
      const request = new Request("http://localhost:3000/api/viewer/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "" }),
      });
      const response = await validatePOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for missing token field", async () => {
      const request = new Request("http://localhost:3000/api/viewer/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const response = await validatePOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid JSON body", async () => {
      const request = new Request("http://localhost:3000/api/viewer/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      const response = await validatePOST(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("expired token", () => {
    it("returns 404 SHARE_NOT_FOUND for expired grant", async () => {
      const { rawToken } = await createExpiredGrant();

      const request = createValidateRequest(rawToken);
      const response = await validatePOST(request);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error.code).toBe("SHARE_NOT_FOUND");
    });
  });

  describe("revoked token", () => {
    it("returns 404 SHARE_NOT_FOUND for revoked grant", async () => {
      const { rawToken } = await createRevokedGrant();

      const request = createValidateRequest(rawToken);
      const response = await validatePOST(request);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error.code).toBe("SHARE_NOT_FOUND");
    });
  });

  describe("rate limiting", () => {
    it("returns 429 after exceeding 10 requests per minute from same IP", async () => {
      const ip = "10.0.0.99";

      // Make 10 requests (all should work, even with 404)
      for (let i = 0; i < 10; i++) {
        const request = createValidateRequest(`token-${i}`, ip);
        const response = await validatePOST(request);
        expect(response.status).not.toBe(429);
      }

      // 11th request should be rate limited
      const request = createValidateRequest("token-11", ip);
      const response = await validatePOST(request);
      expect(response.status).toBe(429);

      const body = await response.json();
      expect(body.error.code).toBe("RATE_LIMITED");
    });
  });
});

// ─── GET /api/viewer/data ───────────────────────────────────────────────────

describe("GET /api/viewer/data", () => {
  describe("auth enforcement", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthDataRequest("sleep_score");
      const response = await viewerDataGET(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("viewer data with scope enforcement", () => {
    beforeEach(async () => {
      // Insert health data for the test user across multiple metrics and dates
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-16", 78);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-17", 91);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-02-15", 88);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-15", 42.5);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-16", 38.1);
      await insertHealthData(TEST_USER_ID, "rhr", "2026-01-15", 62);
      await insertHealthData(TEST_USER_ID, "steps", "2026-01-15", 10000);
    });

    it("returns only granted metrics and clamped dates", async () => {
      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score", "hrv"],
        dataStart: "2026-01-15",
        dataEnd: "2026-01-31",
      });

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score,hrv,steps",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score", "hrv"],
          dataStart: "2026-01-15",
          dataEnd: "2026-01-31",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();

      // sleep_score and hrv should be present
      expect(body.data.metrics.sleep_score).toBeDefined();
      expect(body.data.metrics.hrv).toBeDefined();

      // steps should NOT be present (not in grant)
      expect(body.data.metrics.steps).toBeUndefined();

      // Dates should be clamped: only Jan 15-17 within grant window
      const sleepPoints = body.data.metrics.sleep_score.points;
      expect(sleepPoints.length).toBe(3); // Jan 15, 16, 17 are all within 01-15 to 01-31
      expect(sleepPoints[0].date).toBe("2026-01-15");

      // Feb 15 should NOT be included (outside clamped end of 01-31)
      const dates = sleepPoints.map((p: { date: string }) => p.date);
      expect(dates).not.toContain("2026-02-15");

      // Check query metadata
      expect(body.data.query.start).toBe("2026-01-15"); // clamped
      expect(body.data.query.end).toBe("2026-01-31"); // clamped
      expect(body.data.query.metrics_requested).toContain("sleep_score");
      expect(body.data.query.metrics_requested).toContain("hrv");
      // steps is filtered out by enforcePermissions before it gets to metrics_requested
      // Actually, metrics_requested reflects the original request
      expect(body.data.query.metrics_returned).toContain("sleep_score");
      expect(body.data.query.metrics_returned).toContain("hrv");

      // Check scope info
      expect(body.data.scope).toBeDefined();
      expect(body.data.scope.grant_id).toBe(grantId);
      expect(body.data.scope.allowed_metrics).toEqual(["sleep_score", "hrv"]);
    });

    it("returns data with weekly resolution", async () => {
      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-12",
          end: "2026-01-25",
          resolution: "weekly",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.query.resolution).toBe("weekly");
    });
  });

  describe("empty metric intersection", () => {
    it("returns 403 when no granted metrics match request", async () => {
      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
      });

      // Request only metrics that are NOT in the grant
      const request = createViewerDataRequest(
        {
          metrics: "steps",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when date range is outside grant window", async () => {
      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-15",
        dataEnd: "2026-01-31",
      });

      // Request dates entirely outside the grant window
      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-02-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-15",
          dataEnd: "2026-01-31",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("grant re-validation after revocation", () => {
    it("returns 403 when grant has been revoked since JWT was issued", async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);

      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      // Revoke the grant (simulating revocation after JWT was issued)
      await db
        .update(shareGrants)
        .set({ revokedAt: new Date() })
        .where(eq(shareGrants.id, grantId));

      // Try to fetch data with a viewer context referencing the revoked grant
      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when grant has expired since JWT was issued", async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);

      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      // Expire the grant
      await db
        .update(shareGrants)
        .set({ grantExpires: new Date("2020-01-01T00:00:00Z") })
        .where(eq(shareGrants.id, grantId));

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });

    it("returns 403 when grant has been deleted since JWT was issued", async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);

      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      // Delete the grant
      await db.delete(shareGrants).where(eq(shareGrants.id, grantId));

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("validation", () => {
    it("returns 400 when metrics param is missing", async () => {
      const { grantId } = await createTestGrant();
      const request = new Request(
        "http://localhost:3000/api/viewer/data?start=2026-01-01&end=2026-03-01",
        {
          method: "GET",
          headers: {
            "x-request-context": JSON.stringify({
              role: "viewer",
              userId: TEST_USER_ID,
              grantId,
              permissions: {
                allowedMetrics: ["sleep_score"],
                dataStart: "2026-01-01",
                dataEnd: "2026-03-01",
              },
              authMethod: "viewer_jwt",
            }),
          },
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when start param is missing", async () => {
      const { grantId } = await createTestGrant();
      const request = new Request(
        "http://localhost:3000/api/viewer/data?metrics=sleep_score&end=2026-03-01",
        {
          method: "GET",
          headers: {
            "x-request-context": JSON.stringify({
              role: "viewer",
              userId: TEST_USER_ID,
              grantId,
              permissions: {
                allowedMetrics: ["sleep_score"],
                dataStart: "2026-01-01",
                dataEnd: "2026-03-01",
              },
              authMethod: "viewer_jwt",
            }),
          },
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(400);
    });
  });

  describe("audit events", () => {
    it("emits data.viewed audit event with viewer actor type", async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);

      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      await viewerDataGET(request);

      // Wait for fire-and-forget audit event
      await new Promise((resolve) => setTimeout(resolve, 200));

      const events = await db
        .select()
        .from(auditEvents)
        .where(
          sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'data.viewed' AND ${auditEvents.grantId} = ${grantId}`,
        );

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].actorType).toBe("viewer");
      expect(events[0].resourceType).toBe("health_data");
    });
  });

  describe("empty results", () => {
    it("returns 200 with empty points when no data in scoped range", async () => {
      // No health data inserted for this test

      const { grantId } = await createTestGrant({
        allowedMetrics: ["sleep_score"],
        dataStart: "2026-01-01",
        dataEnd: "2026-03-01",
      });

      const request = createViewerDataRequest(
        {
          metrics: "sleep_score",
          start: "2026-01-01",
          end: "2026-03-01",
        },
        {
          ownerId: TEST_USER_ID,
          grantId,
          allowedMetrics: ["sleep_score"],
          dataStart: "2026-01-01",
          dataEnd: "2026-03-01",
        },
      );

      const response = await viewerDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.metrics.sleep_score).toBeDefined();
      expect(body.data.metrics.sleep_score.points).toHaveLength(0);
    });
  });
});
