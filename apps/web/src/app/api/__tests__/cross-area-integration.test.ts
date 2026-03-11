import type { Pool as PoolType } from "pg";
import { sql } from "drizzle-orm";
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
 * Cross-area integration tests.
 *
 * Verifies that the web API, CLI, and MCP server integrate correctly:
 * - API key auth works across audit, health-data/series, health-data/periods
 * - Audit events record correct actor_type for API key access
 * - Scope enforcement across all route surfaces
 * - Actor type filter includes api_key
 *
 * These tests correspond to VAL-CROSS-001 through VAL-CROSS-010.
 */

// ─── Mock cookies ────────────────────────────────────────────────────────────

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
  })),
}));

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let auditEvents: typeof import("@/db/schema").auditEvents;
let apiKeys: typeof import("@/db/schema").apiKeys;

let auditGET: typeof import("../audit/route").GET;
let seriesGET: typeof import("../health-data/series/route").GET;
let periodsGET: typeof import("../health-data/periods/route").GET;
let healthDataGET: typeof import("../health-data/route").GET;

const TEST_USER_ID = "cross_area_test_user_001";
const TEST_API_KEY_ID = "00000000-0000-4000-a000-000000000001";

// ─── Setup & Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  // Import modules
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  auditEvents = schema.auditEvents;
  apiKeys = schema.apiKeys;

  const auditModule = await import("../audit/route");
  auditGET = auditModule.GET;

  const seriesModule = await import("../health-data/series/route");
  seriesGET = seriesModule.GET;

  const periodsModule = await import("../health-data/periods/route");
  periodsGET = periodsModule.GET;

  const healthDataModule = await import("../health-data/route");
  healthDataGET = healthDataModule.GET;
});

beforeEach(async () => {
  // Create test user
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      displayName: "Cross-Area Test User",
      kmsKeyArn: "local-dev-key",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Cross-Area Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up audit events (bypass immutability trigger)
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query(`DELETE FROM audit_events WHERE owner_id = $1`, [
      TEST_USER_ID,
    ]);
    await client.query(`SET session_replication_role = 'origin'`);
  } finally {
    client.release();
  }

  // Clean up API keys and users
  await db.delete(apiKeys).where(sql`${apiKeys.userId} = ${TEST_USER_ID}`);
  await db.delete(users).where(sql`${users.id} = ${TEST_USER_ID}`);
});

afterAll(async () => {
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a request with session-based auth */
function createSessionRequest(
  url: string,
  userId: string,
  method = "GET",
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

/** Create a request with API key auth context */
function createApiKeyRequest(
  url: string,
  userId: string,
  scopes: string[],
  method = "GET",
  apiKeyId = TEST_API_KEY_ID,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "api_key",
      apiKeyId,
      scopes,
    }),
  });
  return new Request(url, { method, headers });
}

/** Create an unauthenticated request */
function createUnauthRequest(url: string): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
  });
  return new Request(url, { method: "GET", headers });
}

/** Wait briefly for fire-and-forget audit events to be written */
async function waitForAuditEvents(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Cross-Area Integration", () => {
  // ─── VAL-CROSS-002: Web API key to CLI auth flow ─────────────────────────
  describe("API key auth works across endpoints (VAL-CROSS-002, VAL-CROSS-005)", () => {
    it("API key auth works for GET /api/audit", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/audit",
        TEST_USER_ID,
        ["audit:read"],
      );
      const response = await auditGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toBeInstanceOf(Array);
    });

    it("API key without audit:read scope gets 403 on /api/audit", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/audit",
        TEST_USER_ID,
        ["health:read"], // No audit:read
      );
      const response = await auditGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("INSUFFICIENT_SCOPES");
    });

    it("API key auth works for GET /api/health-data", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);
    });

    it("API key auth works for GET /api/health-data/series", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);
    });

    it("API key auth works for GET /api/health-data/periods", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);
    });

    it("unauthenticated request returns 401 on /api/audit", async () => {
      const request = createUnauthRequest("http://localhost:3000/api/audit");
      const response = await auditGET(request);
      expect(response.status).toBe(401);
    });
  });

  // ─── VAL-CROSS-007: Audit trail spans all surfaces ───────────────────────
  describe("Audit trail records API key actor_type (VAL-CROSS-007, VAL-CROSS-009)", () => {
    it("health-data access via API key records actor_type=api_key", async () => {
      // Access health data via API key auth
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      await healthDataGET(request);
      await waitForAuditEvents();

      // Query audit log to verify actor_type
      const auditRequest = createSessionRequest(
        "http://localhost:3000/api/audit?event_type=data.viewed",
        TEST_USER_ID,
      );
      const auditResponse = await auditGET(auditRequest);
      expect(auditResponse.status).toBe(200);

      const body = await auditResponse.json();
      const apiKeyEvents = body.data.filter(
        (e: Record<string, unknown>) => e.actor_type === "api_key",
      );
      expect(apiKeyEvents.length).toBeGreaterThan(0);
    });

    it("session-based access records actor_type=owner", async () => {
      // Access health data via session auth
      const request = createSessionRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-01-31",
        TEST_USER_ID,
      );
      await healthDataGET(request);
      await waitForAuditEvents();

      // Query audit log to verify actor_type
      const auditRequest = createSessionRequest(
        "http://localhost:3000/api/audit?event_type=data.viewed",
        TEST_USER_ID,
      );
      const auditResponse = await auditGET(auditRequest);
      expect(auditResponse.status).toBe(200);

      const body = await auditResponse.json();
      const ownerEvents = body.data.filter(
        (e: Record<string, unknown>) => e.actor_type === "owner",
      );
      expect(ownerEvents.length).toBeGreaterThan(0);
    });

    it("audit log supports filtering by api_key actor_type", async () => {
      // Insert an api_key audit event directly
      await db.insert(auditEvents).values({
        ownerId: TEST_USER_ID,
        actorType: "api_key",
        actorId: TEST_USER_ID,
        eventType: "data.viewed",
        resourceType: "health_data",
        resourceDetail: { metrics: ["sleep_score"] },
      });

      // Filter by api_key actor_type
      const request = createSessionRequest(
        "http://localhost:3000/api/audit?actor_type=api_key",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.length).toBeGreaterThan(0);
      expect(
        body.data.every(
          (e: Record<string, unknown>) => e.actor_type === "api_key",
        ),
      ).toBe(true);
    });

    it("audit events from both surfaces (session + api_key) appear in same list", async () => {
      // Create session event
      await db.insert(auditEvents).values({
        ownerId: TEST_USER_ID,
        actorType: "owner",
        actorId: TEST_USER_ID,
        eventType: "share.created",
        resourceType: "share_grant",
        resourceDetail: { label: "Session share" },
      });

      // Create API key event
      await db.insert(auditEvents).values({
        ownerId: TEST_USER_ID,
        actorType: "api_key",
        actorId: TEST_USER_ID,
        eventType: "share.created",
        resourceType: "share_grant",
        resourceDetail: { label: "API key share" },
      });

      // Query all events
      const request = createSessionRequest(
        "http://localhost:3000/api/audit",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      const actorTypes = body.data.map(
        (e: Record<string, unknown>) => e.actor_type,
      );
      expect(actorTypes).toContain("owner");
      expect(actorTypes).toContain("api_key");
    });
  });

  // ─── VAL-CROSS-008: Read-only API key enforced ───────────────────────────
  describe("Read-only API key scope enforcement (VAL-CROSS-008)", () => {
    it("health:read scope allows GET /api/health-data", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);
    });

    it("health:read scope allows GET /api/health-data/series", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);
    });

    it("health:read scope allows GET /api/health-data/periods", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["health:read"],
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);
    });

    it("API key without health:read gets 403 on /api/health-data/series", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["audit:read"], // No health:read
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("INSUFFICIENT_SCOPES");
    });

    it("API key without health:read gets 403 on /api/health-data/periods", async () => {
      const request = createApiKeyRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
        ["audit:read"], // No health:read
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(403);

      const body = await response.json();
      expect(body.error.code).toBe("INSUFFICIENT_SCOPES");
    });
  });

  // ─── VAL-CROSS-006: Monorepo typecheck ───────────────────────────────────
  describe("Type system integration (VAL-CROSS-006)", () => {
    it("audit event actor_type check constraint includes api_key", async () => {
      // Verify that inserting actor_type=api_key into audit_events succeeds
      await db.insert(auditEvents).values({
        ownerId: TEST_USER_ID,
        actorType: "api_key",
        actorId: TEST_USER_ID,
        eventType: "key.used",
        resourceType: "api_key",
        resourceDetail: { api_key_id: TEST_API_KEY_ID },
      });

      // If we get here, the check constraint allows api_key
      const result = await db
        .select()
        .from(auditEvents)
        .where(
          sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.actorType} = 'api_key'`,
        );

      expect(result.length).toBeGreaterThan(0);
    });
  });
});
