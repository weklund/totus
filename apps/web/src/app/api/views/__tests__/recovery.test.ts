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
 * Integration tests for the Multi-Day Recovery view endpoint:
 * - GET /api/views/recovery
 *
 * Tests verify: complete response shape, date range validation, baselines anchored
 * to start date, viewer scoping, triggering event, missing data handling, audit event.
 *
 * VAL-RECOV-001 through VAL-RECOV-007
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let metricBaselines: typeof import("@/db/schema").metricBaselines;
let dismissedInsights: typeof import("@/db/schema").dismissedInsights;
let userAnnotations: typeof import("@/db/schema").userAnnotations;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handler
let recoveryGET: typeof import("@/app/api/views/recovery/route").GET;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

const TEST_USER_ID = "recovery_view_test_user_001";
const TEST_USER_ID_2 = "recovery_view_test_user_002";
const TEST_GRANT_ID = "00000000-0000-0000-0000-000000000088";
const START_DATE = "2026-03-24";
const END_DATE = "2026-03-28";

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
  healthDataDaily = schema.healthDataDaily;
  metricBaselines = schema.metricBaselines;
  dismissedInsights = schema.dismissedInsights;
  userAnnotations = schema.userAnnotations;
  auditEvents = schema.auditEvents;

  // Import encryption
  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import route handler
  const recoveryModule = await import("@/app/api/views/recovery/route");
  recoveryGET = recoveryModule.GET;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Recovery View Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Recovery View Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Recovery View Test User", updatedAt: new Date() },
    });

  // Seed health_data_daily: 40 days of data ending at END_DATE for baseline + daily values
  const encryption = createEncryptionProvider();
  const metrics = [
    { type: "readiness_score", values: generateDailyValues(75, 8, 40) },
    { type: "hrv", values: generateDailyValues(45, 8, 40) },
    { type: "rhr", values: generateDailyValues(62, 5, 40) },
    { type: "sleep_score", values: generateDailyValues(78, 6, 40) },
    {
      type: "body_temperature_deviation",
      values: generateDailyValues(0.1, 0.3, 40),
    },
  ];

  for (const metric of metrics) {
    for (let i = 0; i < metric.values.length; i++) {
      const date = daysBefore(END_DATE, metric.values.length - 1 - i);
      const encrypted = await encryption.encrypt(
        Buffer.from(JSON.stringify(metric.values[i])),
        TEST_USER_ID,
      );
      await db
        .insert(healthDataDaily)
        .values({
          userId: TEST_USER_ID,
          metricType: metric.type,
          date,
          valueEncrypted: encrypted,
          source: "oura",
        })
        .onConflictDoNothing();
    }
  }

  // Seed a user annotation (workout) for triggering event test
  const annotationLabel = await encryption.encrypt(
    Buffer.from("10K morning run 🏃"),
    TEST_USER_ID,
  );
  const annotationNote = await encryption.encrypt(
    Buffer.from("Felt great, PR attempt"),
    TEST_USER_ID,
  );
  await db
    .insert(userAnnotations)
    .values({
      userId: TEST_USER_ID,
      eventType: "workout",
      labelEncrypted: annotationLabel,
      noteEncrypted: annotationNote,
      occurredAt: new Date(`${START_DATE}T08:00:00.000Z`),
      endedAt: new Date(`${START_DATE}T09:30:00.000Z`),
    })
    .onConflictDoNothing();
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(dismissedInsights)
    .where(
      sql`${dismissedInsights.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(userAnnotations)
    .where(
      sql`${userAnnotations.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(metricBaselines)
    .where(
      sql`${metricBaselines.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(healthDataDaily)
    .where(
      sql`${healthDataDaily.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );

  // Delete audit events via raw SQL (immutability trigger blocks normal DELETE)
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysBefore(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0]!;
}

function generateDailyValues(
  mean: number,
  spread: number,
  count: number,
): number[] {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random using sine
    values.push(Math.round((mean + Math.sin(i * 1.7) * spread) * 100) / 100);
  }
  return values;
}

function createOwnerRequest(url: string, userId: string): Request {
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

function createViewerRequest(
  url: string,
  ownerId: string,
  opts: {
    allowedMetrics?: string[];
    dataStart?: string;
    dataEnd?: string;
  } = {},
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "viewer",
      userId: ownerId,
      grantId: TEST_GRANT_ID,
      permissions: {
        allowedMetrics: opts.allowedMetrics ?? ["rhr", "hrv"],
        dataStart: opts.dataStart ?? "2026-01-01",
        dataEnd: opts.dataEnd ?? "2026-12-31",
      },
      authMethod: "viewer_jwt",
    }),
  });
  return new Request(url, { method: "GET", headers });
}

function buildUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `http://localhost:3000/api/views/recovery?${qs}`;
}

async function callRecoveryView(
  params: Record<string, string>,
  userId: string,
): Promise<Response> {
  const url = buildUrl(params);
  const request = createOwnerRequest(url, userId);
  return recoveryGET(request);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/views/recovery", () => {
  // --- VAL-RECOV-001: Single-request response with all required fields ---

  it("returns 200 with all 7 required top-level keys", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data).toHaveProperty("date_range");
    expect(data).toHaveProperty("triggering_event");
    expect(data).toHaveProperty("insights");
    expect(data).toHaveProperty("daily");
    expect(data).toHaveProperty("baselines");
    expect(data).toHaveProperty("sparklines");
    expect(data).toHaveProperty("annotations");
  });

  it("daily has one entry per date in range with correct metric shapes", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();
    const data = body.data;

    // 2026-03-24 to 2026-03-28 = 5 dates
    const dailyDates = Object.keys(data.daily);
    expect(dailyDates.length).toBe(5);

    // Each daily entry has metrics with SummaryMetric shape
    for (const date of dailyDates) {
      const dayEntry = data.daily[date];
      expect(dayEntry).toHaveProperty("metrics");

      for (const [, metric] of Object.entries(dayEntry.metrics)) {
        const m = metric as Record<string, unknown>;
        expect(m).toHaveProperty("value");
        expect(m).toHaveProperty("avg_30d");
        expect(m).toHaveProperty("delta");
        expect(m).toHaveProperty("delta_pct");
        expect(m).toHaveProperty("direction");
        expect(m).toHaveProperty("status");
        expect(["better", "worse", "neutral"]).toContain(m.direction);
        expect(["critical", "warning", "normal", "good"]).toContain(m.status);
      }
    }
  });

  // --- VAL-RECOV-002: Baselines anchored to range start date ---

  it("baselines are present and anchored to start date", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();
    const baselines = body.data.baselines;

    // Should have baseline entries (40 days of data seeded)
    expect(Object.keys(baselines).length).toBeGreaterThan(0);

    // Check shape of baseline entry
    const anyKey = Object.keys(baselines)[0];
    const entry = baselines[anyKey];
    expect(entry).toHaveProperty("avg");
    expect(entry).toHaveProperty("stddev");
    expect(entry).toHaveProperty("upper");
    expect(entry).toHaveProperty("lower");
    expect(typeof entry.avg).toBe("number");
    expect(typeof entry.stddev).toBe("number");
  });

  it("changing end date only does not change baselines", async () => {
    // Request with same start, different end
    const response1 = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body1 = await response1.json();
    const baselines1 = body1.data.baselines;

    const response2 = await callRecoveryView(
      { start: START_DATE, end: "2026-03-30" },
      TEST_USER_ID,
    );
    const body2 = await response2.json();
    const baselines2 = body2.data.baselines;

    // Same start date → same baselines
    for (const key of Object.keys(baselines1)) {
      if (baselines2[key]) {
        expect(baselines1[key].avg).toBeCloseTo(baselines2[key].avg, 2);
        expect(baselines1[key].stddev).toBeCloseTo(baselines2[key].stddev, 2);
      }
    }
  });

  it("changing start date changes baselines", async () => {
    const response1 = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body1 = await response1.json();
    const baselines1 = body1.data.baselines;

    // Use a start date much further back to ensure different 30-day windows
    const response2 = await callRecoveryView(
      { start: daysBefore(END_DATE, 13), end: END_DATE },
      TEST_USER_ID,
    );
    const body2 = await response2.json();
    const baselines2 = body2.data.baselines;

    // Different start date → different baselines (different 30-day windows)
    // At least one metric should differ (windows are 9 days apart)
    let anyDifference = false;
    for (const key of Object.keys(baselines1)) {
      if (
        baselines2[key] &&
        Math.abs(baselines1[key].avg - baselines2[key].avg) > 0.001
      ) {
        anyDifference = true;
        break;
      }
    }
    expect(anyDifference).toBe(true);
  });

  // --- VAL-RECOV-003: Date range validation enforced ---

  it("returns 200 for 2-day range (minimum)", async () => {
    const response = await callRecoveryView(
      { start: "2026-03-27", end: "2026-03-28" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);
  });

  it("returns 200 for 14-day range (maximum)", async () => {
    const response = await callRecoveryView(
      { start: "2026-03-15", end: "2026-03-28" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for 1-day range", async () => {
    const response = await callRecoveryView(
      { start: "2026-03-28", end: "2026-03-28" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for 15-day range", async () => {
    const response = await callRecoveryView(
      { start: "2026-03-14", end: "2026-03-28" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when start is after end", async () => {
    const response = await callRecoveryView(
      { start: "2026-03-28", end: "2026-03-24" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("applies default metrics when metrics param omitted", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    // Default metrics: readiness_score, hrv, rhr, sleep_score, body_temperature_deviation
    const baselineKeys = Object.keys(data.baselines);
    const expectedDefaults = [
      "readiness_score",
      "hrv",
      "rhr",
      "sleep_score",
      "body_temperature_deviation",
    ];

    // All baselines should be from the default set
    for (const key of baselineKeys) {
      expect(expectedDefaults).toContain(key);
    }
  });

  // --- VAL-RECOV-004: Viewer sees only granted metrics and clamped dates ---

  it("viewer response contains only granted metrics", async () => {
    const url = buildUrl({ start: START_DATE, end: END_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    const response = await recoveryGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const baselineKeys = Object.keys(body.data.baselines);
    const sparklineKeys = Object.keys(body.data.sparklines);

    for (const key of baselineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
    for (const key of sparklineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }

    // Daily metrics should also be scoped
    for (const date of Object.keys(body.data.daily)) {
      const metricKeys = Object.keys(body.data.daily[date].metrics);
      for (const key of metricKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
    }
  });

  it("viewer date clamping: date outside grant range returns 403", async () => {
    const url = buildUrl({ start: START_DATE, end: END_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2025-06-30",
    });
    const response = await recoveryGET(request);
    expect(response.status).toBe(403);
  });

  // --- VAL-RECOV-005: Zod validation rejects invalid parameters ---

  it("returns 400 when start parameter is missing", async () => {
    const url = buildUrl({ end: END_DATE });
    const request = createOwnerRequest(url, TEST_USER_ID);
    const response = await recoveryGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when end parameter is missing", async () => {
    const url = buildUrl({ start: START_DATE });
    const request = createOwnerRequest(url, TEST_USER_ID);
    const response = await recoveryGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for malformed date format", async () => {
    const response = await callRecoveryView(
      { start: "03-24-2026", end: END_DATE },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid metric name", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE, metrics: "invalid_metric" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 without auth", async () => {
    const url = buildUrl({ start: START_DATE, end: END_DATE });
    const request = createUnauthRequest(url);
    const response = await recoveryGET(request);
    expect(response.status).toBe(401);
  });

  // --- VAL-RECOV-006: Days with missing data handled gracefully ---

  it("user with no data gets 200 with empty structures", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID_2,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data.date_range.start).toBe(START_DATE);
    expect(data.date_range.end).toBe(END_DATE);
    expect(Object.keys(data.baselines)).toHaveLength(0);
    expect(Object.keys(data.sparklines)).toHaveLength(0);
    expect(data.insights).toEqual([]);
    expect(data.annotations).toEqual([]);
    expect(data.triggering_event).toBeNull();

    // Daily entries should exist for each date but with empty metrics
    const dailyDates = Object.keys(data.daily);
    expect(dailyDates.length).toBe(5);
    for (const date of dailyDates) {
      expect(Object.keys(data.daily[date].metrics)).toHaveLength(0);
    }
  });

  // --- VAL-RECOV-007: Triggering event ---

  it("triggering_event is null when event_id is omitted", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();
    expect(body.data.triggering_event).toBeNull();
  });

  it("triggering_event populated when valid event_id provided", async () => {
    // First, find the annotation we seeded
    const annotationRows = await db
      .select({ id: userAnnotations.id })
      .from(userAnnotations)
      .where(
        sql`${userAnnotations.userId} = ${TEST_USER_ID} AND ${userAnnotations.eventType} = 'workout'`,
      );
    expect(annotationRows.length).toBeGreaterThan(0);

    const eventId = annotationRows[0]!.id;

    const response = await callRecoveryView(
      {
        start: START_DATE,
        end: END_DATE,
        event_id: String(eventId),
      },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const te = body.data.triggering_event;
    expect(te).not.toBeNull();
    expect(te.id).toBe(eventId);
    expect(te.event_type).toBe("workout");
    expect(te.label).toContain("10K morning run");
    expect(te.note).toContain("Felt great");
    expect(te.source).toBe("user");
  });

  it("returns 404 when event_id references non-existent annotation", async () => {
    const response = await callRecoveryView(
      {
        start: START_DATE,
        end: END_DATE,
        event_id: "999999",
      },
      TEST_USER_ID,
    );
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when event_id references another user's annotation", async () => {
    // Create an annotation for user 2
    const encryption = createEncryptionProvider();
    const label = await encryption.encrypt(
      Buffer.from("User 2 workout"),
      TEST_USER_ID_2,
    );
    const [inserted] = await db
      .insert(userAnnotations)
      .values({
        userId: TEST_USER_ID_2,
        eventType: "workout",
        labelEncrypted: label,
        noteEncrypted: null,
        occurredAt: new Date(`${START_DATE}T10:00:00.000Z`),
        endedAt: null,
      })
      .returning({ id: userAnnotations.id });

    // User 1 tries to access user 2's annotation
    const response = await callRecoveryView(
      {
        start: START_DATE,
        end: END_DATE,
        event_id: String(inserted!.id),
      },
      TEST_USER_ID,
    );
    expect(response.status).toBe(404);
  });

  // --- Sparklines ---

  it("sparklines contain dates and values for each metric with data", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();
    const sparklines = body.data.sparklines;

    expect(Object.keys(sparklines).length).toBeGreaterThan(0);

    for (const [, sparkline] of Object.entries(sparklines)) {
      const sl = sparkline as { dates: string[]; values: number[] };
      expect(Array.isArray(sl.dates)).toBe(true);
      expect(Array.isArray(sl.values)).toBe(true);
      expect(sl.dates.length).toBe(sl.values.length);
      expect(sl.dates.length).toBeGreaterThan(0);

      // All values should be actual finite numbers (no zero-fill from missing data)
      for (const v of sl.values) {
        expect(typeof v).toBe("number");
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  // --- Annotations ---

  it("annotations include user-created annotations within the date range", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();
    const annotations = body.data.annotations;

    expect(Array.isArray(annotations)).toBe(true);
    const workoutAnnotation = annotations.find(
      (a: Record<string, unknown>) => a.event_type === "workout",
    );
    expect(workoutAnnotation).toBeDefined();
    expect(workoutAnnotation.label).toContain("10K morning run");
  });

  // --- Insights ---

  it("insights array is present and has max 3 entries", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    const body = await response.json();

    expect(Array.isArray(body.data.insights)).toBe(true);
    expect(body.data.insights.length).toBeLessThanOrEqual(3);
  });

  // --- Audit event ---

  it("emits view.accessed audit event with recovery view metadata", async () => {
    await callRecoveryView({ start: START_DATE, end: END_DATE }, TEST_USER_ID);

    // Wait for fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 300));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID}
            AND ${auditEvents.eventType} = 'view.accessed'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);

    const matchingEvent = events.find((e) => {
      const detail = e.resourceDetail as Record<string, unknown>;
      return detail.view_type === "recovery";
    });
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.resourceType).toBe("view");

    const detail = matchingEvent!.resourceDetail as Record<string, unknown>;
    expect(detail.view_type).toBe("recovery");
    expect(detail.date_range).toEqual({
      start: START_DATE,
      end: END_DATE,
    });
  });

  it("viewer audit event has actor_type viewer with grant_id", async () => {
    const url = buildUrl({ start: START_DATE, end: END_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    await recoveryGET(request);

    // Wait for fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 300));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID}
            AND ${auditEvents.eventType} = 'view.accessed'
            AND ${auditEvents.actorType} = 'viewer'`,
      );

    const viewerEvent = events.find((e) => {
      const detail = e.resourceDetail as Record<string, unknown>;
      return detail.view_type === "recovery";
    });
    expect(viewerEvent).toBeDefined();
    expect(viewerEvent!.grantId).toBe(TEST_GRANT_ID);
  });

  // --- Metrics parameter filtering ---

  it("optional metrics parameter filters daily, baselines, and sparklines", async () => {
    const response = await callRecoveryView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const baselineKeys = Object.keys(body.data.baselines);
    const sparklineKeys = Object.keys(body.data.sparklines);

    for (const key of baselineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
    for (const key of sparklineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }

    for (const date of Object.keys(body.data.daily)) {
      const metricKeys = Object.keys(body.data.daily[date].metrics);
      for (const key of metricKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
    }
  });
});
