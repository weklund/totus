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
} from "vitest";

/**
 * Tests for the insight dismissal API endpoint:
 * - POST /api/insights/:type/:date/dismiss
 *
 * Tests verify: auth enforcement, validation (type + date format),
 * happy path, idempotent upsert, viewer rejection, and audit events.
 *
 * VAL-INSGT-001, VAL-INSGT-002
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let dismissedInsights: typeof import("@/db/schema").dismissedInsights;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handler
let dismissPOST: typeof import("@/app/api/insights/[type]/[date]/dismiss/route").POST;

const TEST_USER_ID = "dismiss_test_user_001";
const TEST_USER_ID_2 = "dismiss_test_user_002";
const TEST_GRANT_ID = "00000000-0000-0000-0000-000000000088";

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
  dismissedInsights = schema.dismissedInsights;
  auditEvents = schema.auditEvents;

  // Import route handler
  const dismissModule =
    await import("@/app/api/insights/[type]/[date]/dismiss/route");
  dismissPOST = dismissModule.POST;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Dismiss Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Dismiss Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Dismiss Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(dismissedInsights)
    .where(
      sql`${dismissedInsights.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
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

function createAuthRequest(url: string, userId: string): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
    "Content-Type": "application/json",
  });
  return new Request(url, { method: "POST", headers });
}

function createUnauthRequest(url: string): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
    "Content-Type": "application/json",
  });
  return new Request(url, { method: "POST", headers });
}

function createViewerRequest(
  url: string,
  ownerId: string,
  allowedMetrics: string[] = ["rhr", "hrv"],
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "viewer",
      userId: ownerId,
      grantId: TEST_GRANT_ID,
      permissions: {
        allowedMetrics,
        dataStart: "2026-01-01",
        dataEnd: "2026-12-31",
      },
      authMethod: "viewer_jwt",
    }),
    "Content-Type": "application/json",
  });
  return new Request(url, { method: "POST", headers });
}

function buildUrl(type: string, date: string): string {
  return `http://localhost:3000/api/insights/${type}/${date}/dismiss`;
}

function callDismiss(
  type: string,
  date: string,
  userId: string,
): Promise<Response> {
  const request = createAuthRequest(buildUrl(type, date), userId);
  return dismissPOST(request, {
    params: Promise.resolve({ type, date }),
  });
}

// ─── POST /api/insights/:type/:date/dismiss ──────────────────────────────────

describe("POST /api/insights/:type/:date/dismiss", () => {
  // --- Auth enforcement ---

  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(buildUrl("elevated_rhr", "2026-03-28"));
    const response = await dismissPOST(request, {
      params: Promise.resolve({ type: "elevated_rhr", date: "2026-03-28" }),
    });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for viewer with grant_token", async () => {
    const request = createViewerRequest(
      buildUrl("elevated_rhr", "2026-03-28"),
      TEST_USER_ID,
    );
    const response = await dismissPOST(request, {
      params: Promise.resolve({ type: "elevated_rhr", date: "2026-03-28" }),
    });
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  // --- Validation ---

  it("returns 400 for invalid insight type", async () => {
    const response = await callDismiss(
      "not_a_real_insight",
      "2026-03-28",
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date format (MM-DD-YYYY)", async () => {
    const response = await callDismiss(
      "elevated_rhr",
      "03-28-2026",
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date format (non-date string)", async () => {
    const response = await callDismiss(
      "elevated_rhr",
      "not-a-date",
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // --- Happy path ---

  it("dismisses insight and returns 200 with confirmation", async () => {
    const response = await callDismiss(
      "elevated_rhr",
      "2026-03-28",
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toEqual({
      insight_type: "elevated_rhr",
      date: "2026-03-28",
      dismissed: true,
    });
  });

  it("creates a row in dismissed_insights table", async () => {
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    const rows = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(TEST_USER_ID);
    expect(rows[0].insightType).toBe("elevated_rhr");
    expect(rows[0].dismissedAt).toBeInstanceOf(Date);
  });

  // --- Idempotency ---

  it("second dismiss call returns 200 with identical body (idempotent)", async () => {
    const response1 = await callDismiss(
      "elevated_rhr",
      "2026-03-28",
      TEST_USER_ID,
    );
    expect(response1.status).toBe(200);
    const body1 = await response1.json();

    const response2 = await callDismiss(
      "elevated_rhr",
      "2026-03-28",
      TEST_USER_ID,
    );
    expect(response2.status).toBe(200);
    const body2 = await response2.json();

    expect(body2.data).toEqual(body1.data);
  });

  it("idempotent: only one row exists after two calls", async () => {
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    const rows = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );

    expect(rows).toHaveLength(1);
  });

  it("idempotent: dismissed_at unchanged after second call", async () => {
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    const [row1] = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );

    // Wait a moment to ensure timestamp would differ if updated
    await new Promise((resolve) => setTimeout(resolve, 50));

    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    const [row2] = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );

    expect(row1.dismissedAt.getTime()).toBe(row2.dismissedAt.getTime());
  });

  // --- Scoping ---

  it("dismissal is scoped to specific date and type", async () => {
    // Dismiss elevated_rhr for Mar 28
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    // Same type, different date — no row
    const rowsDiffDate = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-29'`,
      );
    expect(rowsDiffDate).toHaveLength(0);

    // Same date, different type — no row
    const rowsDiffType = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID}
            AND ${dismissedInsights.insightType} = 'low_sleep_score'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );
    expect(rowsDiffType).toHaveLength(0);
  });

  it("user A's dismissal does not affect user B", async () => {
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    const rows = await db
      .select()
      .from(dismissedInsights)
      .where(
        sql`${dismissedInsights.userId} = ${TEST_USER_ID_2}
            AND ${dismissedInsights.insightType} = 'elevated_rhr'
            AND ${dismissedInsights.referenceDate} = '2026-03-28'`,
      );
    expect(rows).toHaveLength(0);
  });

  // --- All valid insight types ---

  it("accepts all known P0 insight types", async () => {
    const validTypes = [
      "elevated_rhr",
      "low_sleep_score",
      "suppressed_hrv",
      "multi_metric_deviation",
    ];

    for (const type of validTypes) {
      const response = await callDismiss(type, "2026-03-28", TEST_USER_ID);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.insight_type).toBe(type);
      expect(body.data.dismissed).toBe(true);
    }
  });

  // --- Audit event ---

  it("emits insight.dismissed audit event", async () => {
    await callDismiss("elevated_rhr", "2026-03-28", TEST_USER_ID);

    // Wait for fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID}
            AND ${auditEvents.eventType} = 'insight.dismissed'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);

    // Find the audit event matching our specific dismiss call
    const matchingEvent = events.find((e) => {
      const detail = e.resourceDetail as Record<string, unknown>;
      return (
        detail.insight_type === "elevated_rhr" && detail.date === "2026-03-28"
      );
    });
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.resourceType).toBe("insight");
    expect(matchingEvent!.actorType).toBe("owner");

    const detail = matchingEvent!.resourceDetail as Record<string, unknown>;
    expect(detail.insight_type).toBe("elevated_rhr");
    expect(detail.date).toBe("2026-03-28");
  });
});
