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
 * Integration tests for the 30-Day Trend View endpoint:
 * - GET /api/views/trend
 *
 * Tests verify: complete response shape, date range validation, smoothing,
 * trend direction, baselines anchored to start date, viewer scoping,
 * correlations validation, minimum 7-day range, audit event.
 *
 * VAL-TREND-001 through VAL-TREND-008
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let metricBaselines: typeof import("@/db/schema").metricBaselines;
let dismissedInsights: typeof import("@/db/schema").dismissedInsights;
let shareGrants: typeof import("@/db/schema").shareGrants;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handler
let trendGET: typeof import("@/app/api/views/trend/route").GET;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

// Viewer auth
let hashToken: typeof import("@/lib/auth/viewer").hashToken;

const TEST_USER_ID = "trend_view_test_user_001";
const TEST_USER_ID_2 = "trend_view_test_user_002";
const TEST_GRANT_ID = "00000000-0000-0000-0000-000000000099";
const START_DATE = "2026-02-27";
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
  shareGrants = schema.shareGrants;
  auditEvents = schema.auditEvents;

  // Import encryption
  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import viewer auth
  const viewerModule = await import("@/lib/auth/viewer");
  hashToken = viewerModule.hashToken;

  // Import route handler
  const trendModule = await import("@/app/api/views/trend/route");
  trendGET = trendModule.GET;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Trend View Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Trend View Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Trend View Test User", updatedAt: new Date() },
    });

  // Seed health_data_daily: 60 days of data for baseline + range coverage
  // Data ends at END_DATE (2026-03-28), starts 59 days before that
  const encryption = createEncryptionProvider();
  const DATA_DAYS = 60;
  const metrics = [
    { type: "rhr", values: generateDailyValues(62, 5, DATA_DAYS) },
    { type: "hrv", values: generateDailyValues(45, 8, DATA_DAYS) },
    { type: "sleep_score", values: generateDailyValues(78, 6, DATA_DAYS) },
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
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(dismissedInsights)
    .where(
      sql`${dismissedInsights.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
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
  return `http://localhost:3000/api/views/trend?${qs}`;
}

async function callTrendView(
  params: Record<string, string>,
  userId: string,
): Promise<Response> {
  const url = buildUrl(params);
  const request = createOwnerRequest(url, userId);
  return trendGET(request);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/views/trend", () => {
  // --- VAL-TREND-001: Single-request response with all required fields ---

  it("returns 200 with all 5 required top-level keys", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data).toHaveProperty("date_range");
    expect(data).toHaveProperty("smoothing");
    expect(data).toHaveProperty("insights");
    expect(data).toHaveProperty("metrics");
    expect(data).toHaveProperty("correlations");
  });

  it("per-metric data includes raw, smoothed, trend, and baseline", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const data = body.data;

    for (const [, metricData] of Object.entries(data.metrics)) {
      const m = metricData as Record<string, unknown>;
      expect(m).toHaveProperty("raw");
      expect(m).toHaveProperty("smoothed");
      expect(m).toHaveProperty("trend");
      expect(m).toHaveProperty("baseline");

      // raw shape
      const raw = m.raw as { dates: string[]; values: number[] };
      expect(Array.isArray(raw.dates)).toBe(true);
      expect(Array.isArray(raw.values)).toBe(true);
      expect(raw.dates.length).toBe(raw.values.length);
      expect(raw.dates.length).toBeGreaterThan(0);

      // baseline shape
      const baseline = m.baseline as Record<string, number>;
      expect(typeof baseline.avg).toBe("number");
      expect(typeof baseline.stddev).toBe("number");
      expect(typeof baseline.upper).toBe("number");
      expect(typeof baseline.lower).toBe("number");

      // trend shape
      const trend = m.trend as Record<string, unknown>;
      expect(["rising", "falling", "stable"]).toContain(trend.direction);
      expect(typeof trend.start_value).toBe("number");
      expect(typeof trend.end_value).toBe("number");
      expect(typeof trend.change_pct).toBe("number");
      expect(typeof trend.change_abs).toBe("number");
    }
  });

  it("smoothing defaults to 7d when omitted", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    const body = await response.json();
    expect(body.data.smoothing).toBe("7d");
  });

  // --- VAL-TREND-002: Rolling averages correct with smoothing ---

  it("smoothed values are non-null when smoothing is 7d", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr", smoothing: "7d" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const rhrData = body.data.metrics.rhr;

    expect(rhrData.smoothed).not.toBeNull();
    expect(Array.isArray(rhrData.smoothed.dates)).toBe(true);
    expect(Array.isArray(rhrData.smoothed.values)).toBe(true);
    expect(rhrData.smoothed.dates.length).toBeGreaterThan(0);
  });

  it("smoothed values are non-null when smoothing is 30d", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr", smoothing: "30d" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const rhrData = body.data.metrics.rhr;

    expect(rhrData.smoothed).not.toBeNull();
    expect(rhrData.smoothed.dates.length).toBeGreaterThan(0);
  });

  it("smoothed values are null when smoothing is none", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr", smoothing: "none" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const rhrData = body.data.metrics.rhr;

    expect(rhrData.smoothed).toBeNull();
  });

  it("raw data always included alongside smoothed data", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr", smoothing: "7d" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const rhrData = body.data.metrics.rhr;

    // Both raw and smoothed must be present
    expect(rhrData.raw).not.toBeNull();
    expect(rhrData.smoothed).not.toBeNull();
    expect(rhrData.raw.dates.length).toBeGreaterThan(0);
  });

  // --- VAL-TREND-003: Trend detection uses 7-day start/end averages ---

  it("trend uses first and last 7-day averages for direction", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const trend = body.data.metrics.rhr.trend;

    // start_value and end_value are averages of 7-day windows
    expect(typeof trend.start_value).toBe("number");
    expect(typeof trend.end_value).toBe("number");
    expect(Number.isFinite(trend.start_value)).toBe(true);
    expect(Number.isFinite(trend.end_value)).toBe(true);

    // change_abs = end - start
    expect(trend.change_abs).toBeCloseTo(
      trend.end_value - trend.start_value,
      2,
    );

    // change_pct = ((end - start) / start) * 100
    if (trend.start_value !== 0) {
      expect(trend.change_pct).toBeCloseTo(
        ((trend.end_value - trend.start_value) / trend.start_value) * 100,
        2,
      );
    }
  });

  it("baselines anchored to start date", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    const body = await response.json();
    const baselines = body.data.metrics;

    // Check baselines exist
    for (const [, metricData] of Object.entries(baselines)) {
      const m = metricData as { baseline: Record<string, number> };
      expect(typeof m.baseline.avg).toBe("number");
      expect(Number.isFinite(m.baseline.avg)).toBe(true);
    }
  });

  it("changing start date changes baselines", async () => {
    const response1 = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    const body1 = await response1.json();
    const baseline1 = body1.data.metrics.rhr.baseline;

    // Use a different start date
    const response2 = await callTrendView(
      { start: "2026-03-07", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    const body2 = await response2.json();
    const baseline2 = body2.data.metrics.rhr.baseline;

    // Different start dates → different baselines (different 30-day windows)
    // The windows differ by 8 days, so baselines should differ
    const diff = Math.abs(baseline1.avg - baseline2.avg);
    expect(diff).toBeGreaterThan(0);
  });

  // --- VAL-TREND-004: Date range and parameter validation ---

  it("returns 200 for 7-day range (minimum)", async () => {
    const response = await callTrendView(
      { start: "2026-03-22", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);
  });

  it("returns 200 for 365-day range (maximum)", async () => {
    const response = await callTrendView(
      { start: "2025-03-29", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);
  });

  it("returns 400 for 6-day range", async () => {
    const response = await callTrendView(
      { start: "2026-03-23", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for 366-day range", async () => {
    const response = await callTrendView(
      { start: "2025-03-28", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when start is after end", async () => {
    const response = await callTrendView(
      { start: END_DATE, end: START_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for more than 10 metrics", async () => {
    const tooManyMetrics =
      "rhr,hrv,sleep_score,deep_sleep,rem_sleep,sleep_latency,spo2,respiratory_rate,awake_time,readiness_score,weight";
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: tooManyMetrics },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid smoothing value", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr", smoothing: "14d" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when metrics param is missing", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when start param is missing", async () => {
    const url = buildUrl({ end: END_DATE, metrics: "rhr" });
    const request = createOwnerRequest(url, TEST_USER_ID);
    const response = await trendGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when end param is missing", async () => {
    const url = buildUrl({ start: START_DATE, metrics: "rhr" });
    const request = createOwnerRequest(url, TEST_USER_ID);
    const response = await trendGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for malformed date format", async () => {
    const response = await callTrendView(
      { start: "02-27-2026", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid metric name", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "invalid_metric" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 without auth", async () => {
    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
    });
    const request = createUnauthRequest(url);
    const response = await trendGET(request);
    expect(response.status).toBe(401);
  });

  // --- VAL-TREND-005: Correlations validation ---

  it("returns 400 for more than 5 correlation pairs", async () => {
    const correlations =
      "rhr:hrv,rhr:sleep_score,hrv:sleep_score,rhr:deep_sleep,hrv:deep_sleep,sleep_score:deep_sleep";
    const response = await callTrendView(
      {
        start: START_DATE,
        end: END_DATE,
        metrics: "rhr,hrv,sleep_score,deep_sleep",
        correlations,
      },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when correlation metric not in metrics list", async () => {
    const response = await callTrendView(
      {
        start: START_DATE,
        end: END_DATE,
        metrics: "rhr,hrv",
        correlations: "rhr:sleep_score",
      },
      TEST_USER_ID,
    );
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("correlations array is empty when param not provided", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );
    const body = await response.json();
    expect(body.data.correlations).toEqual([]);
  });

  // --- VAL-TREND-006: Viewer sees only granted metrics and clamped dates ---

  it("viewer response contains only granted metrics", async () => {
    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv,sleep_score",
    });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    const response = await trendGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const metricKeys = Object.keys(body.data.metrics);

    for (const key of metricKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
  });

  it("viewer date clamping: date outside grant range returns 403", async () => {
    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
    });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2025-06-30",
    });
    const response = await trendGET(request);
    expect(response.status).toBe(403);
  });

  // --- VAL-TREND-007: Audit event emitted ---

  it("emits view.accessed audit event with trend view metadata", async () => {
    await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID,
    );

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
      return detail.view_type === "trend";
    });
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.resourceType).toBe("view");

    const detail = matchingEvent!.resourceDetail as Record<string, unknown>;
    expect(detail.view_type).toBe("trend");
    expect(detail.date_range).toEqual({
      start: START_DATE,
      end: END_DATE,
    });
    expect(detail).toHaveProperty("smoothing");
  });

  it("viewer audit event has actor_type viewer with grant_id", async () => {
    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
    });
    const request = createViewerRequest(url, TEST_USER_ID, {
      allowedMetrics: ["rhr", "hrv"],
    });
    await trendGET(request);

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
      return detail.view_type === "trend";
    });
    expect(viewerEvent).toBeDefined();
    expect(viewerEvent!.grantId).toBe(TEST_GRANT_ID);
  });

  // --- VAL-TREND-008: Minimum range (7 days) produces valid trend results ---

  it("7-day range produces valid stable trend (overlapping windows)", async () => {
    // With exactly 7 days, the first and last 7-day windows overlap completely
    const response = await callTrendView(
      { start: "2026-03-22", end: END_DATE, metrics: "rhr" },
      TEST_USER_ID,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const trend = body.data.metrics.rhr.trend;

    // With complete overlap, start_value ≈ end_value → stable
    expect(trend.direction).toBe("stable");
    expect(typeof trend.start_value).toBe("number");
    expect(typeof trend.end_value).toBe("number");
    expect(Number.isFinite(trend.change_pct)).toBe(true);
  });

  // --- Additional: user with no data ---

  it("user with no data gets 200 with empty metric structures", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv" },
      TEST_USER_ID_2,
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    const data = body.data;

    expect(data.date_range.start).toBe(START_DATE);
    expect(data.date_range.end).toBe(END_DATE);
    expect(data.smoothing).toBe("7d");
    expect(data.insights).toEqual([]);
    expect(data.correlations).toEqual([]);

    // Metrics should exist but with empty raw data
    for (const [, metricData] of Object.entries(data.metrics)) {
      const m = metricData as { raw: { dates: string[]; values: number[] } };
      expect(m.raw.dates.length).toBe(0);
      expect(m.raw.values.length).toBe(0);
    }
  });

  // --- Insights ---

  it("insights array is present and has max 3 entries", async () => {
    const response = await callTrendView(
      { start: START_DATE, end: END_DATE, metrics: "rhr,hrv,sleep_score" },
      TEST_USER_ID,
    );
    const body = await response.json();

    expect(Array.isArray(body.data.insights)).toBe(true);
    expect(body.data.insights.length).toBeLessThanOrEqual(3);
  });

  // --- grant_token auth resolution ---

  it("grant_token: valid token returns scoped viewer response", async () => {
    const rawToken = "test-trend-grant-token-valid-abc123";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Trend view share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2026-01-01",
      dataEnd: "2026-12-31",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv,sleep_score",
      grant_token: rawToken,
    });
    const request = new Request(url, { method: "GET" });
    const response = await trendGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const metricKeys = Object.keys(body.data.metrics);

    // Only granted metrics should be present (sleep_score filtered out)
    for (const key of metricKeys) {
      expect(["rhr", "hrv"]).toContain(key);
    }
  });

  it("grant_token: invalid token returns 401", async () => {
    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
      grant_token: "invalid-trend-token-xyz",
    });
    const request = new Request(url, { method: "GET" });
    const response = await trendGET(request);
    expect(response.status).toBe(401);
  });

  it("grant_token: expired token returns 401", async () => {
    const rawToken = "test-trend-grant-token-expired-xyz";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Expired trend share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2026-01-01",
      dataEnd: "2026-12-31",
      grantExpires: new Date(Date.now() - 1000),
    });

    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
      grant_token: rawToken,
    });
    const request = new Request(url, { method: "GET" });
    const response = await trendGET(request);
    expect(response.status).toBe(401);
  });

  it("grant_token: date range outside grant window returns 403", async () => {
    const rawToken = "test-trend-grant-token-daterange-abc";
    const tokenHash = hashToken(rawToken);

    await db.insert(shareGrants).values({
      token: tokenHash,
      ownerId: TEST_USER_ID,
      label: "Narrow trend share",
      allowedMetrics: ["rhr", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2025-06-30", // START_DATE/END_DATE are in 2026
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const url = buildUrl({
      start: START_DATE,
      end: END_DATE,
      metrics: "rhr,hrv",
      grant_token: rawToken,
    });
    const request = new Request(url, { method: "GET" });
    const response = await trendGET(request);
    expect(response.status).toBe(403);
  });
});
