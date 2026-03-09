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
 * Tests for the audit log API endpoint:
 * - GET /api/audit
 *
 * Tests verify auth enforcement, pagination, filtering,
 * human-readable descriptions, and cursor-based navigation.
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

let auditGET: typeof import("../route").GET;

const TEST_USER_ID = "audit_test_user_001";
const TEST_USER_ID_2 = "audit_test_user_002";

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

  const auditModule = await import("../route");
  auditGET = auditModule.GET;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Audit Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Audit Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Audit Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
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

  await db
    .delete(users)
    .where(sql`${users.id} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);
});

afterAll(async () => {
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createAuthRequest(url: string, userId: string): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
  });
  return new Request(url, { method: "GET", headers });
}

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

async function createAuditEvents(
  userId: string,
  count: number,
  overrides: Partial<{
    eventType: string;
    actorType: string;
    grantId: string;
    resourceDetail: Record<string, unknown>;
  }> = {},
) {
  const values = [];
  for (let i = 0; i < count; i++) {
    values.push({
      ownerId: userId,
      actorType: overrides.actorType || "owner",
      actorId: userId,
      grantId: overrides.grantId || null,
      eventType: overrides.eventType || `test.event.${i}`,
      resourceType: "test",
      resourceDetail: overrides.resourceDetail || { index: i },
    });
  }

  // Insert one at a time with a small delay to ensure unique createdAt for pagination
  for (const value of values) {
    await db.insert(auditEvents).values(value);
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/audit", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest("http://localhost:3000/api/audit");
    const response = await auditGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns empty list when no events", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/audit",
      TEST_USER_ID,
    );
    const response = await auditGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.has_more).toBe(false);
    expect(body.pagination.next_cursor).toBeNull();
  });

  it("returns audit events for the user", async () => {
    await createAuditEvents(TEST_USER_ID, 3, {
      eventType: "share.created",
      resourceDetail: { label: "My Share" },
    });

    const request = createAuthRequest(
      "http://localhost:3000/api/audit",
      TEST_USER_ID,
    );
    const response = await auditGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.length).toBe(3);
    expect(body.data[0].event_type).toBe("share.created");
    expect(body.data[0].description).toBeDefined();
    expect(body.data[0].id).toBeDefined();
    expect(body.data[0].created_at).toBeDefined();
  });

  it("does not return events from other users", async () => {
    await createAuditEvents(TEST_USER_ID_2, 3, {
      eventType: "share.created",
    });

    const request = createAuthRequest(
      "http://localhost:3000/api/audit",
      TEST_USER_ID,
    );
    const response = await auditGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  it("includes human-readable descriptions", async () => {
    // Create events of different types
    await db.insert(auditEvents).values([
      {
        ownerId: TEST_USER_ID,
        actorType: "owner",
        actorId: TEST_USER_ID,
        eventType: "share.created",
        resourceType: "share_grant",
        resourceDetail: { label: "Weekly Report" },
      },
      {
        ownerId: TEST_USER_ID,
        actorType: "viewer",
        actorId: null,
        eventType: "data.viewed",
        resourceType: "health_data",
        resourceDetail: { metrics: ["sleep_score", "hrv"] },
      },
      {
        ownerId: TEST_USER_ID,
        actorType: "owner",
        actorId: TEST_USER_ID,
        eventType: "account.settings",
        resourceType: "user",
        resourceDetail: { field: "display_name", new_value: "New Name" },
      },
    ]);

    const request = createAuthRequest(
      "http://localhost:3000/api/audit",
      TEST_USER_ID,
    );
    const response = await auditGET(request);
    const body = await response.json();

    const shareCreated = body.data.find(
      (e: Record<string, unknown>) => e.event_type === "share.created",
    );
    expect(shareCreated.description).toContain("Weekly Report");

    const dataViewed = body.data.find(
      (e: Record<string, unknown>) => e.event_type === "data.viewed",
    );
    expect(dataViewed.description).toContain("Viewer");
    expect(dataViewed.description).toContain("2");

    const settings = body.data.find(
      (e: Record<string, unknown>) => e.event_type === "account.settings",
    );
    expect(settings.description).toContain("display name");
  });

  // ─── Filtering Tests ─────────────────────────────────────────────────────

  describe("filtering", () => {
    beforeEach(async () => {
      await db.insert(auditEvents).values([
        {
          ownerId: TEST_USER_ID,
          actorType: "owner",
          actorId: TEST_USER_ID,
          eventType: "share.created",
          resourceType: "share_grant",
          resourceDetail: { label: "Share 1" },
        },
        {
          ownerId: TEST_USER_ID,
          actorType: "viewer",
          eventType: "data.viewed",
          resourceType: "health_data",
          grantId: "11111111-1111-1111-1111-111111111111",
          resourceDetail: { metrics: ["sleep_score"] },
        },
        {
          ownerId: TEST_USER_ID,
          actorType: "owner",
          actorId: TEST_USER_ID,
          eventType: "share.revoked",
          resourceType: "share_grant",
          resourceDetail: { label: "Share 1" },
        },
      ]);
    });

    it("filters by event_type", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?event_type=share.created",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].event_type).toBe("share.created");
    });

    it("filters by actor_type", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?actor_type=viewer",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].actor_type).toBe("viewer");
    });

    it("filters by grant_id", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?grant_id=11111111-1111-1111-1111-111111111111",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].grant_id).toBe(
        "11111111-1111-1111-1111-111111111111",
      );
    });

    it("filters by date range", async () => {
      const request = createAuthRequest(
        `http://localhost:3000/api/audit?start=2026-03-01&end=2026-03-31`,
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      // All events were created today (within this range)
      expect(body.data.length).toBe(3);
    });

    it("filters by date range - past dates return empty", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?start=2020-01-01&end=2020-01-31",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data).toEqual([]);
    });

    it("combines multiple filters", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?event_type=data.viewed&actor_type=viewer",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(1);
      expect(body.data[0].event_type).toBe("data.viewed");
      expect(body.data[0].actor_type).toBe("viewer");
    });

    it("returns 400 for invalid actor_type", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?actor_type=invalid",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid grant_id format", async () => {
      const request = createAuthRequest(
        "http://localhost:3000/api/audit?grant_id=not-a-uuid",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      expect(response.status).toBe(400);
    });
  });

  // ─── Pagination Tests ────────────────────────────────────────────────────

  describe("pagination", () => {
    it("paginates with default limit of 50", async () => {
      // Create 55 events to test pagination
      for (let i = 0; i < 55; i++) {
        await db.insert(auditEvents).values({
          ownerId: TEST_USER_ID,
          actorType: "owner",
          actorId: TEST_USER_ID,
          eventType: `test.event.${i}`,
          resourceType: "test",
        });
      }

      const request = createAuthRequest(
        "http://localhost:3000/api/audit",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(50);
      expect(body.pagination.has_more).toBe(true);
      expect(body.pagination.next_cursor).toBeDefined();
    });

    it("respects limit parameter", async () => {
      await createAuditEvents(TEST_USER_ID, 10, {
        eventType: "test.event",
      });

      const request = createAuthRequest(
        "http://localhost:3000/api/audit?limit=5",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      expect(body.data.length).toBe(5);
      expect(body.pagination.has_more).toBe(true);
    });

    it("cursor navigation returns next page", async () => {
      await createAuditEvents(TEST_USER_ID, 10, {
        eventType: "test.event",
      });

      // First page
      const request1 = createAuthRequest(
        "http://localhost:3000/api/audit?limit=5",
        TEST_USER_ID,
      );
      const response1 = await auditGET(request1);
      const body1 = await response1.json();

      expect(body1.data.length).toBe(5);
      expect(body1.pagination.has_more).toBe(true);

      // Second page using cursor
      const request2 = createAuthRequest(
        `http://localhost:3000/api/audit?limit=5&cursor=${body1.pagination.next_cursor}`,
        TEST_USER_ID,
      );
      const response2 = await auditGET(request2);
      const body2 = await response2.json();

      expect(body2.data.length).toBe(5);
      expect(body2.pagination.has_more).toBe(false);

      // Verify no duplicates across pages
      const allIds = [
        ...body1.data.map((e: Record<string, unknown>) => e.id),
        ...body2.data.map((e: Record<string, unknown>) => e.id),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(10);
    });

    it("caps limit at 100", async () => {
      await createAuditEvents(TEST_USER_ID, 5, {
        eventType: "test.event",
      });

      const request = createAuthRequest(
        "http://localhost:3000/api/audit?limit=200",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      // Should return all 5 events (limit capped at 100, only 5 exist)
      expect(body.data.length).toBe(5);
    });

    it("returns events in descending order (newest first)", async () => {
      for (let i = 0; i < 5; i++) {
        await db.insert(auditEvents).values({
          ownerId: TEST_USER_ID,
          actorType: "owner",
          actorId: TEST_USER_ID,
          eventType: `test.event.${i}`,
          resourceType: "test",
        });
      }

      const request = createAuthRequest(
        "http://localhost:3000/api/audit",
        TEST_USER_ID,
      );
      const response = await auditGET(request);
      const body = await response.json();

      // Verify descending order
      for (let i = 0; i < body.data.length - 1; i++) {
        expect(
          new Date(body.data[i].created_at).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(body.data[i + 1].created_at).getTime(),
        );
      }
    });
  });
});
