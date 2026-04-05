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
 * Integration tests for the Night Detail view endpoint:
 * - GET /api/views/night
 *
 * Tests verify: complete response shape, viewer scoping, invalid date,
 * night window correctness, baselines present, insights included, audit event.
 *
 * VAL-NIGHT-001 through VAL-NIGHT-008, VAL-JOBS-006
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let healthDataSeries: typeof import("@/db/schema").healthDataSeries;
let healthDataPeriods: typeof import("@/db/schema").healthDataPeriods;
let metricBaselines: typeof import("@/db/schema").metricBaselines;
let dismissedInsights: typeof import("@/db/schema").dismissedInsights;
let userAnnotations: typeof import("@/db/schema").userAnnotations;
let shareGrants: typeof import("@/db/schema").shareGrants;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handler
let nightGET: typeof import("@/app/api/views/night/route").GET;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

// Viewer auth
let hashToken: typeof import("@/lib/auth/viewer").hashToken;

const TEST_USER_ID = "night_view_test_user_001";
const TEST_USER_ID_2 = "night_view_test_user_002";
const TEST_GRANT_ID = "00000000-0000-0000-0000-000000000099";
const VIEW_DATE = "2026-03-28";

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
  healthDataSeries = schema.healthDataSeries;
  healthDataPeriods = schema.healthDataPeriods;
  metricBaselines = schema.metricBaselines;
  dismissedInsights = schema.dismissedInsights;
  userAnnotations = schema.userAnnotations;
  shareGrants = schema.shareGrants;
  auditEvents = schema.auditEvents;

  // Import encryption
  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import viewer auth
  const viewerModule = await import("@/lib/auth/viewer");
  hashToken = viewerModule.hashToken;

  // Import route handler
  const nightModule = await import("@/app/api/views/night/route");
  nightGET = nightModule.GET;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Night View Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Night View Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Night View Test User", updatedAt: new Date() },
    });

  // Seed health_data_daily: 30 days of data for rhr, hrv, sleep_score
  const encryption = createEncryptionProvider();
  const metrics = [
    { type: "rhr", values: generateDailyValues(62, 5, 35) },
    { type: "hrv", values: generateDailyValues(45, 8, 35) },
    { type: "sleep_score", values: generateDailyValues(78, 6, 35) },
    { type: "sleep_latency", values: generateDailyValues(12, 3, 35) },
    { type: "deep_sleep", values: generateDailyValues(1.5, 0.3, 35) },
  ];

  for (const metric of metrics) {
    for (let i = 0; i < metric.values.length; i++) {
      const date = daysBefore(VIEW_DATE, metric.values.length - 1 - i);
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

  // Seed health_data_series: intraday HR and glucose for the night window
  const nightStart = new Date(`${daysBefore(VIEW_DATE, 1)}T20:00:00.000Z`);
  const nightEnd = new Date(`${VIEW_DATE}T08:00:00.000Z`);

  // HR series: every 30 min from 8pm to 8am (25 points)
  for (let i = 0; i < 25; i++) {
    const ts = new Date(nightStart.getTime() + i * 30 * 60 * 1000);
    if (ts > nightEnd) break;
    const value = 58 + Math.sin(i / 4) * 5;
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(value)),
      TEST_USER_ID,
    );
    await db
      .insert(healthDataSeries)
      .values({
        userId: TEST_USER_ID,
        metricType: "heart_rate",
        recordedAt: ts,
        valueEncrypted: encrypted,
        source: "oura",
      })
      .onConflictDoNothing();
  }

  // Glucose series: every 15 min from 8pm to 8am (49 points)
  for (let i = 0; i < 49; i++) {
    const ts = new Date(nightStart.getTime() + i * 15 * 60 * 1000);
    if (ts > nightEnd) break;
    const value = 95 + Math.sin(i / 6) * 15;
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(value)),
      TEST_USER_ID,
    );
    await db
      .insert(healthDataSeries)
      .values({
        userId: TEST_USER_ID,
        metricType: "glucose",
        recordedAt: ts,
        valueEncrypted: encrypted,
        source: "cronometer",
      })
      .onConflictDoNothing();
  }

  // Seed sleep periods (hypnogram)
  const sleepStages = [
    { stage: "awake", offset: 0, duration: 15 },
    { stage: "light", offset: 15, duration: 45 },
    { stage: "deep", offset: 60, duration: 60 },
    { stage: "rem", offset: 120, duration: 30 },
    { stage: "light", offset: 150, duration: 45 },
    { stage: "deep", offset: 195, duration: 45 },
    { stage: "rem", offset: 240, duration: 30 },
    { stage: "light", offset: 270, duration: 60 },
  ];

  // Sleep starts at 10:30 PM previous day
  const sleepBase = new Date(`${daysBefore(VIEW_DATE, 1)}T22:30:00.000Z`);
  for (const stg of sleepStages) {
    const startedAt = new Date(sleepBase.getTime() + stg.offset * 60 * 1000);
    const endedAt = new Date(
      sleepBase.getTime() + (stg.offset + stg.duration) * 60 * 1000,
    );
    await db
      .insert(healthDataPeriods)
      .values({
        userId: TEST_USER_ID,
        eventType: stg.stage,
        startedAt,
        endedAt,
        source: "oura",
      })
      .onConflictDoNothing();
  }

  // Seed a user annotation within the night window
  const annotationLabel = await encryption.encrypt(
    Buffer.from("Late dinner 🍕"),
    TEST_USER_ID,
  );
  await db
    .insert(userAnnotations)
    .values({
      userId: TEST_USER_ID,
      eventType: "meal",
      labelEncrypted: annotationLabel,
      noteEncrypted: null,
      occurredAt: new Date(`${daysBefore(VIEW_DATE, 1)}T21:30:00.000Z`),
      endedAt: null,
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
    .delete(healthDataSeries)
    .where(
      sql`${healthDataSeries.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(healthDataPeriods)
    .where(
      sql`${healthDataPeriods.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(healthDataDaily)
    .where(
      sql`${healthDataDaily.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(shareGrants)
    .where(sql`${shareGrants.ownerId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);

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
  return `http://localhost:3000/api/views/night?${qs}`;
}

async function callNightView(
  params: Record<string, string>,
  userId: string,
): Promise<Response> {
  const url = buildUrl(params);
  const request = createOwnerRequest(url, userId);
  return nightGET(request);
}

async function callNightViewWithTimezone(
  params: Record<string, string>,
  userId: string,
): Promise<Response> {
  const url = buildUrl(params);
  const request = createOwnerRequest(url, userId);
  return nightGET(request);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/views/night", () => {
  // --- VAL-NIGHT-001: Complete response shape ---

  it("returns 200 with all 8 required top-level keys", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data).toHaveProperty("date");
    expect(data).toHaveProperty("time_range");
    expect(data).toHaveProperty("insights");
    expect(data).toHaveProperty("annotations");
    expect(data).toHaveProperty("series");
    expect(data).toHaveProperty("hypnogram");
    expect(data).toHaveProperty("summary");
    expect(data).toHaveProperty("baselines");
  });

  it("time_range spans 8 PM previous evening to 8 AM morning", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const tr = body.data.time_range;

    // date = 2026-03-28, window = Mar 27 8PM to Mar 28 8AM
    expect(tr.start).toContain("2026-03-27");
    expect(tr.start).toContain("20:00");
    expect(tr.end).toContain("2026-03-28");
    expect(tr.end).toContain("08:00");
  });

  // --- VAL-NIGHT-002: Baselines anchored to requested date ---

  it("baselines are present and have correct shape", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const baselines = body.data.baselines;

    // We seeded 35 days of data, so baselines should be computed
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

  // --- VAL-NIGHT-003: Summary metrics polarity-aware ---

  it("summary metrics have direction and status fields", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const summary = body.data.summary;

    // Should have metrics we seeded
    expect(Object.keys(summary).length).toBeGreaterThan(0);

    for (const [, metric] of Object.entries(summary)) {
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
  });

  // --- VAL-NIGHT-004: Viewer sees only granted metrics ---

  it("viewer response contains only granted metrics in summary and baselines", async () => {
    const url = buildUrl({ date: VIEW_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const summaryKeys = Object.keys(body.data.summary);
    const baselineKeys = Object.keys(body.data.baselines);

    // Only rhr and hrv should be in results
    for (const key of summaryKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
    for (const key of baselineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
  });

  it("viewer date clamping: date after grant end is clamped to grant end date", async () => {
    // VIEW_DATE = 2026-03-28, grant ends 2026-03-25 → should clamp to 2026-03-25
    const grantEnd = "2026-03-25";
    const url = buildUrl({ date: VIEW_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2026-01-01",
      dataEnd: grantEnd,
    });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // The effective date should be clamped to grant end
    expect(body.data.date).toBe(grantEnd);
    // Time range should reflect the clamped date
    expect(body.data.time_range.end).toContain(grantEnd);
  });

  it("viewer date clamping: date before grant start is clamped to grant start date", async () => {
    // Request date 2026-01-15, grant starts 2026-03-01 → should clamp to 2026-03-01
    const grantStart = "2026-03-01";
    const url = buildUrl({ date: "2026-01-15" });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
      dataStart: grantStart,
      dataEnd: "2026-12-31",
    });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // The effective date should be clamped to grant start
    expect(body.data.date).toBe(grantStart);
    // Time range should reflect the clamped date
    expect(body.data.time_range.end).toContain(grantStart);
  });

  it("viewer date clamping: clamped date used for all downstream queries", async () => {
    // Grant window: 2026-03-25 to 2026-03-28, request 2026-03-30 → clamped to 2026-03-28
    const grantEnd = VIEW_DATE; // 2026-03-28
    const url = buildUrl({ date: "2026-03-30" });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv", "sleep_score"],
      dataStart: "2026-03-25",
      dataEnd: grantEnd,
    });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // The response date should be the clamped date
    expect(body.data.date).toBe(grantEnd);
    // Baselines should be present (data exists for clamped date)
    expect(Object.keys(body.data.baselines).length).toBeGreaterThan(0);
    // Summary should have data for clamped date
    expect(Object.keys(body.data.summary).length).toBeGreaterThan(0);
  });

  // --- VAL-NIGHT-005: Zod validation rejects invalid parameters ---

  it("returns 400 when date parameter is missing", async () => {
    const url = `http://localhost:3000/api/views/night`;
    const request = createOwnerRequest(url, TEST_USER_ID);
    const response = await nightGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for malformed date format", async () => {
    const response = await callNightView({ date: "03-28-2026" }, TEST_USER_ID);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date value (Feb 30)", async () => {
    const response = await callNightView({ date: "2026-02-30" }, TEST_USER_ID);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 without auth", async () => {
    const url = buildUrl({ date: VIEW_DATE });
    const request = createUnauthRequest(url);
    const response = await nightGET(request);
    expect(response.status).toBe(401);
  });

  // --- VAL-NIGHT-006: Dismissed insights excluded, max 3 ---

  it("insights array is present and has max 3 entries", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();

    expect(Array.isArray(body.data.insights)).toBe(true);
    expect(body.data.insights.length).toBeLessThanOrEqual(3);
  });

  it("dismissed insights are excluded from response", async () => {
    // First, get insights from an initial call
    const response1 = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body1 = await response1.json();
    const insightsBefore = body1.data.insights as Array<{
      type: string;
    }>;

    if (insightsBefore.length > 0) {
      // Dismiss the first insight
      const typeToDismiss = insightsBefore[0].type;
      await db.insert(dismissedInsights).values({
        userId: TEST_USER_ID,
        insightType: typeToDismiss,
        referenceDate: VIEW_DATE,
      });

      // Call again
      const response2 = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
      const body2 = await response2.json();
      const insightsAfter = body2.data.insights as Array<{
        type: string;
      }>;

      // The dismissed type should not be present
      const dismissedPresent = insightsAfter.some(
        (i) => i.type === typeToDismiss,
      );
      expect(dismissedPresent).toBe(false);
    }
  });

  // --- Night window correctness ---

  it("series data falls within the night window (8PM-8AM)", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const series = body.data.series;

    const windowStart = new Date(`2026-03-27T20:00:00.000Z`).getTime();
    const windowEnd = new Date(`2026-03-28T08:00:00.000Z`).getTime();

    for (const [, metricData] of Object.entries(series)) {
      const md = metricData as { timestamps: string[]; values: number[] };
      for (const ts of md.timestamps) {
        const t = new Date(ts).getTime();
        expect(t).toBeGreaterThanOrEqual(windowStart);
        expect(t).toBeLessThanOrEqual(windowEnd);
      }
    }
  });

  // --- Hypnogram ---

  it("hypnogram contains sleep stages with correct shape", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const hypnogram = body.data.hypnogram;

    expect(hypnogram).not.toBeNull();
    expect(Array.isArray(hypnogram.stages)).toBe(true);
    expect(hypnogram.stages.length).toBeGreaterThan(0);

    for (const stage of hypnogram.stages) {
      expect(["awake", "light", "deep", "rem"]).toContain(stage.stage);
      expect(typeof stage.start).toBe("string");
      expect(typeof stage.end).toBe("string");
    }

    expect(typeof hypnogram.total_duration_hr).toBe("number");
    expect(hypnogram.total_duration_hr).toBeGreaterThan(0);
  });

  // --- Annotations ---

  it("annotations include user-created annotations within the night window", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    const body = await response.json();
    const annotations = body.data.annotations;

    expect(Array.isArray(annotations)).toBe(true);
    // We seeded a meal annotation at 9:30 PM in the night window
    const mealAnnotation = annotations.find(
      (a: Record<string, unknown>) => a.event_type === "meal",
    );
    expect(mealAnnotation).toBeDefined();
    expect(mealAnnotation.label).toContain("Late dinner");
  });

  // --- VAL-NIGHT-007: Edge cases handled gracefully ---

  it("user with no data gets 200 with empty structures", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID_2);
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data.date).toBe(VIEW_DATE);
    expect(data.series).toEqual({});
    expect(data.hypnogram).toBeNull();
    expect(Object.keys(data.summary)).toHaveLength(0);
    expect(Object.keys(data.baselines)).toHaveLength(0);
    expect(data.insights).toEqual([]);
    expect(data.annotations).toEqual([]);
  });

  // --- VAL-NIGHT-008: Audit event emitted ---

  it("emits view.accessed audit event with view metadata", async () => {
    await callNightView({ date: VIEW_DATE }, TEST_USER_ID);

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
      return detail.view_type === "night" && detail.date === VIEW_DATE;
    });
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.resourceType).toBe("view");

    const detail = matchingEvent!.resourceDetail as Record<string, unknown>;
    expect(detail.view_type).toBe("night");
    expect(detail.date).toBe(VIEW_DATE);
  });

  it("viewer audit event has actor_type viewer with grant_id", async () => {
    const url = buildUrl({ date: VIEW_DATE });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    await nightGET(request);

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
      return detail.view_type === "night";
    });
    expect(viewerEvent).toBeDefined();
    expect(viewerEvent!.grantId).toBe(TEST_GRANT_ID);
  });

  // --- Metrics parameter filtering ---

  it("optional metrics parameter filters summary and series", async () => {
    const response = await callNightView(
      { date: VIEW_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const summaryKeys = Object.keys(body.data.summary);
    const baselineKeys = Object.keys(body.data.baselines);

    for (const key of summaryKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
    for (const key of baselineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
  });

  // --- VAL-JOBS-006: On-demand baseline fallback ---

  it("on-demand baseline fallback works for historical dates", async () => {
    // Use a date with no cached baselines — the 30-day window should still work
    // because we seeded 35 days of data ending at VIEW_DATE
    // Request a date several days back that has data in the window
    const historicalDate = daysBefore(VIEW_DATE, 3); // 2026-03-25
    const response = await callNightView(
      { date: historicalDate },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    // Baselines should be computed on-demand
    expect(Object.keys(body.data.baselines).length).toBeGreaterThan(0);
  });

  // --- grant_token auth resolution ---

  it("grant_token: valid token returns scoped viewer response", async () => {
    // Create a share grant for the test user
    const rawToken = "test-night-grant-token-valid-abc123";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Night view share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2026-01-01",
      dataEnd: "2026-12-31",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // +1 day
    });

    // Request with grant_token — no x-request-context header needed
    const url = buildUrl({ date: VIEW_DATE, grant_token: rawToken });
    const request = new Request(url, { method: "GET" });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const summaryKeys = Object.keys(body.data.summary);
    const baselineKeys = Object.keys(body.data.baselines);

    // Only granted metrics should be present
    for (const key of summaryKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
    for (const key of baselineKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
  });

  it("grant_token: invalid token returns 401", async () => {
    const url = buildUrl({
      date: VIEW_DATE,
      grant_token: "totally-invalid-token-xyz",
    });
    const request = new Request(url, { method: "GET" });
    const response = await nightGET(request);
    expect(response.status).toBe(401);
  });

  it("grant_token: expired token returns 401", async () => {
    const rawToken = "test-night-grant-token-expired-xyz";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Expired share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2026-01-01",
      dataEnd: "2026-12-31",
      grantExpires: new Date(Date.now() - 1000), // already expired
    });

    const url = buildUrl({ date: VIEW_DATE, grant_token: rawToken });
    const request = new Request(url, { method: "GET" });
    const response = await nightGET(request);
    expect(response.status).toBe(401);
  });

  it("grant_token: date outside grant window is clamped to grant end", async () => {
    const rawToken = "test-night-grant-token-daterange-abc";
    const tokenHash = hashToken(rawToken);

    const grantEnd = "2025-06-30";
    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Narrow range share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: grantEnd, // VIEW_DATE=2026-03-28 is outside → clamped to 2025-06-30
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const url = buildUrl({ date: VIEW_DATE, grant_token: rawToken });
    const request = new Request(url, { method: "GET" });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Date should be clamped to grant end
    expect(body.data.date).toBe(grantEnd);
  });

  it("grant_token: effective clamped date used for response data", async () => {
    // Grant with narrow date window that includes VIEW_DATE
    const rawToken = "test-night-grant-token-clamp-abc";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Clamped share",
      allowedMetrics: ["rhr", "hrv", "sleep_score"],
      dataStart: "2026-03-01",
      dataEnd: "2026-03-28",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const url = buildUrl({ date: VIEW_DATE, grant_token: rawToken });
    const request = new Request(url, { method: "GET" });
    const response = await nightGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // The response date should be the effective (possibly clamped) date
    expect(body.data.date).toBe(VIEW_DATE);
  });

  // --- VAL-CROSS-024: Annotation overlap — duration annotations spanning night boundary ---

  it("includes annotation whose ended_at overlaps with the night window start", async () => {
    // Create an annotation that starts BEFORE the night window but ends AFTER the start.
    // Night window for 2026-03-28: Mar 27 8PM to Mar 28 8AM.
    // Annotation: 7PM to 8:30PM on Mar 27 — straddles the 8PM boundary.
    const encryption = createEncryptionProvider();
    const labelEnc = await encryption.encrypt(
      Buffer.from("Evening workout 🏋️"),
      TEST_USER_ID,
    );
    await db.insert(userAnnotations).values({
      userId: TEST_USER_ID,
      eventType: "workout",
      labelEncrypted: labelEnc,
      noteEncrypted: null,
      occurredAt: new Date("2026-03-27T19:00:00.000Z"), // 7 PM — before window
      endedAt: new Date("2026-03-27T20:30:00.000Z"), // 8:30 PM — after window start
    });

    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    expect(response.status).toBe(200);

    const body = await response.json();
    const annotations = body.data.annotations as Array<{
      event_type: string;
      label: string;
      ended_at: string;
    }>;

    // The workout annotation should be present because its duration spans into the window
    const workoutAnnotation = annotations.find(
      (a) => a.event_type === "workout" && a.label.includes("Evening workout"),
    );
    expect(workoutAnnotation).toBeDefined();
    expect(workoutAnnotation!.ended_at).toContain("20:30");
  });

  it("excludes annotation that ended before the night window start", async () => {
    // Annotation: 6PM to 7PM on Mar 27 — ends BEFORE the 8PM window start.
    const encryption = createEncryptionProvider();
    const labelEnc = await encryption.encrypt(
      Buffer.from("Afternoon meeting"),
      TEST_USER_ID,
    );
    await db.insert(userAnnotations).values({
      userId: TEST_USER_ID,
      eventType: "custom",
      labelEncrypted: labelEnc,
      noteEncrypted: null,
      occurredAt: new Date("2026-03-27T18:00:00.000Z"), // 6 PM
      endedAt: new Date("2026-03-27T19:00:00.000Z"), // 7 PM — before window start
    });

    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    expect(response.status).toBe(200);

    const body = await response.json();
    const annotations = body.data.annotations as Array<{
      event_type: string;
      label: string;
    }>;

    // Should NOT include the afternoon meeting (ended before window)
    const meeting = annotations.find((a) =>
      a.label.includes("Afternoon meeting"),
    );
    expect(meeting).toBeUndefined();
  });

  // --- VAL-CROSS-021: Night window timezone awareness ---

  it("timezone parameter shifts the night window (America/Los_Angeles)", async () => {
    // For America/Los_Angeles on 2026-03-28 (PDT, UTC-7, DST in effect since Mar 8):
    // Local 8PM Mar 27 PDT = UTC 3AM Mar 28 (20:00 + 7:00)
    // Local 8AM Mar 28 PDT = UTC 3PM Mar 28 (08:00 + 7:00)
    // Window shifts from [Mar 27 20:00Z, Mar 28 08:00Z] to [Mar 28 03:00Z, Mar 28 15:00Z]
    const response = await callNightViewWithTimezone(
      { date: VIEW_DATE, timezone: "America/Los_Angeles" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const tr = body.data.time_range;

    // PDT night window: Mar 28 03:00Z to Mar 28 15:00Z
    expect(tr.start).toContain("2026-03-28");
    expect(tr.start).toContain("03:00");
    expect(tr.end).toContain("2026-03-28");
    expect(tr.end).toContain("15:00");
  });

  it("timezone parameter defaults to UTC when not provided", async () => {
    const response = await callNightView({ date: VIEW_DATE }, TEST_USER_ID);
    expect(response.status).toBe(200);

    const body = await response.json();
    const tr = body.data.time_range;

    // Default UTC window: Mar 27 20:00Z to Mar 28 08:00Z
    expect(tr.start).toContain("2026-03-27");
    expect(tr.start).toContain("20:00");
    expect(tr.end).toContain("2026-03-28");
    expect(tr.end).toContain("08:00");
  });

  it("invalid timezone returns 400 validation error", async () => {
    const response = await callNightViewWithTimezone(
      { date: VIEW_DATE, timezone: "Invalid/Timezone_Name" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("timezone=UTC produces same window as no timezone", async () => {
    const responseUtc = await callNightViewWithTimezone(
      { date: VIEW_DATE, timezone: "UTC" },
      TEST_USER_ID,
    );
    const responseDefault = await callNightView(
      { date: VIEW_DATE },
      TEST_USER_ID,
    );

    const bodyUtc = await responseUtc.json();
    const bodyDefault = await responseDefault.json();

    expect(bodyUtc.data.time_range).toEqual(bodyDefault.data.time_range);
  });

  // --- VAL-CROSS-018: Minimum history threshold — delta suppressed ---

  it("summary metrics suppress delta/direction with insufficient baseline history", async () => {
    // Create a new user with only 10 days of data (< 14 threshold)
    const shortHistoryUser = "night_view_short_hist_001";
    const SHORT_DATE = "2026-03-28";

    await db
      .insert(users)
      .values({
        id: shortHistoryUser,
        displayName: "Short History User",
        kmsKeyArn: "local-dev-key",
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { displayName: "Short History User", updatedAt: new Date() },
      });

    // Seed only 10 days of RHR data (< 14 threshold)
    const encryption = createEncryptionProvider();
    for (let i = 1; i <= 10; i++) {
      const date = daysBefore(SHORT_DATE, i);
      const value = 60 + Math.sin(i) * 3;
      const encrypted = await encryption.encrypt(
        Buffer.from(JSON.stringify(value)),
        shortHistoryUser,
      );
      await db
        .insert(healthDataDaily)
        .values({
          userId: shortHistoryUser,
          metricType: "rhr",
          date,
          valueEncrypted: encrypted,
          source: "oura",
        })
        .onConflictDoNothing();
    }

    // Also seed a daily value for the view date itself
    const todayValue = 65;
    const todayEncrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(todayValue)),
      shortHistoryUser,
    );
    await db
      .insert(healthDataDaily)
      .values({
        userId: shortHistoryUser,
        metricType: "rhr",
        date: SHORT_DATE,
        valueEncrypted: todayEncrypted,
        source: "oura",
      })
      .onConflictDoNothing();

    try {
      const response = await callNightView(
        { date: SHORT_DATE },
        shortHistoryUser,
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const summary = body.data.summary;

      if (summary.rhr) {
        // If a baseline was computed (sample_count >= 7 but < 14),
        // delta and delta_pct should be null, direction should be neutral
        expect(summary.rhr.delta).toBeNull();
        expect(summary.rhr.delta_pct).toBeNull();
        expect(summary.rhr.direction).toBe("neutral");
        expect(summary.rhr.status).toBe("normal");
        // value and avg should still be present
        expect(summary.rhr.value).toBe(todayValue);
        expect(typeof summary.rhr.avg_30d).toBe("number");
      }
    } finally {
      // Clean up
      await db
        .delete(healthDataDaily)
        .where(eq(healthDataDaily.userId, shortHistoryUser));
      await db
        .delete(metricBaselines)
        .where(eq(metricBaselines.userId, shortHistoryUser));
      await pool
        .query(`DELETE FROM audit_events WHERE owner_id = $1`, [
          shortHistoryUser,
        ])
        .catch(() => {});
      await db.delete(users).where(eq(users.id, shortHistoryUser));
    }
  });
});
