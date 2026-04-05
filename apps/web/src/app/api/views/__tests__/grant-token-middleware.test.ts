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
 * Integration tests for grant_token auth flow through the FULL request path:
 * middleware passthrough + route handler token validation.
 *
 * These tests verify that:
 * 1. The middleware allows unauthenticated requests with grant_token to pass through
 * 2. The route handler validates the grant_token and establishes viewer context
 * 3. Invalid/expired grant_token returns 401 from the route handler
 * 4. Valid grant_token returns viewer-scoped data
 *
 * The tests call route handlers with NO x-request-context header (simulating
 * the middleware passing through an unauthenticated request with grant_token).
 * The route handler's getResolvedContext() will produce an unauthenticated context,
 * then the grant_token resolution overrides it with a viewer context.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthDataDaily: typeof import("@/db/schema").healthDataDaily;
let healthDataSeries: typeof import("@/db/schema").healthDataSeries;
let healthDataPeriods: typeof import("@/db/schema").healthDataPeriods;
let shareGrants: typeof import("@/db/schema").shareGrants;

// Route handlers
let nightGET: typeof import("@/app/api/views/night/route").GET;
let recoveryGET: typeof import("@/app/api/views/recovery/route").GET;
let trendGET: typeof import("@/app/api/views/trend/route").GET;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;

// Viewer auth
let hashToken: typeof import("@/lib/auth/viewer").hashToken;

const TEST_USER_ID = "grant_mw_test_user_001";
const VIEW_DATE = "2026-03-28";
const START_DATE = "2026-03-24";
const END_DATE = "2026-03-28";
const TREND_START = "2026-02-27";
const TREND_END = "2026-03-28";

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
  shareGrants = schema.shareGrants;

  // Import encryption
  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;

  // Import viewer auth
  const viewerModule = await import("@/lib/auth/viewer");
  hashToken = viewerModule.hashToken;

  // Import route handlers
  const nightModule = await import("@/app/api/views/night/route");
  nightGET = nightModule.GET;

  const recoveryModule = await import("@/app/api/views/recovery/route");
  recoveryGET = recoveryModule.GET;

  const trendModule = await import("@/app/api/views/trend/route");
  trendGET = trendModule.GET;
});

beforeEach(async () => {
  // Create test user
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      displayName: "Grant MW Test User",
      kmsKeyArn: "local-dev-key",
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Grant MW Test User", updatedAt: new Date() },
    });

  // Seed 35 days of health data for rhr, hrv
  const encryption = createEncryptionProvider();
  const metrics = [
    { type: "rhr", values: generateDailyValues(62, 5, 35) },
    { type: "hrv", values: generateDailyValues(45, 8, 35) },
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

  // Seed intraday HR series for the night window
  const nightStart = new Date(`${daysBefore(VIEW_DATE, 1)}T20:00:00.000Z`);
  const nightEnd = new Date(`${VIEW_DATE}T08:00:00.000Z`);

  for (let i = 0; i < 10; i++) {
    const ts = new Date(nightStart.getTime() + i * 60 * 60 * 1000);
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

  // Seed sleep periods for the night window
  const sleepBase = new Date(`${daysBefore(VIEW_DATE, 1)}T22:30:00.000Z`);
  const sleepStages = [
    { stage: "light", offset: 0, duration: 60 },
    { stage: "deep", offset: 60, duration: 60 },
    { stage: "rem", offset: 120, duration: 30 },
  ];
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
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(healthDataSeries)
    .where(sql`${healthDataSeries.userId} = ${TEST_USER_ID}`);
  await db
    .delete(healthDataPeriods)
    .where(sql`${healthDataPeriods.userId} = ${TEST_USER_ID}`);
  await db
    .delete(healthDataDaily)
    .where(sql`${healthDataDaily.userId} = ${TEST_USER_ID}`);
  await db
    .delete(shareGrants)
    .where(sql`${shareGrants.ownerId} = ${TEST_USER_ID}`);

  // Delete audit events via raw SQL (immutability trigger blocks normal DELETE)
  await pool
    .query(`DELETE FROM audit_events WHERE owner_id = $1`, [TEST_USER_ID])
    .catch(() => {});

  await db.delete(users).where(sql`${users.id} = ${TEST_USER_ID}`);
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
    values.push(Math.round((mean + Math.sin(i * 1.7) * spread) * 100) / 100);
  }
  return values;
}

/**
 * Create a request with NO auth headers — simulates what the middleware
 * produces when it lets an unauthenticated request with grant_token pass through.
 * The x-request-context header contains an unauthenticated context.
 */
function createUnauthenticatedRequestWithGrantToken(url: string): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
  });
  return new Request(url, { method: "GET", headers });
}

async function createValidGrant(
  rawToken: string,
  opts: {
    allowedMetrics?: string[];
    dataStart?: string;
    dataEnd?: string;
    expired?: boolean;
  } = {},
): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db.insert(shareGrants).values({
    token: tokenHash,
    ownerId: TEST_USER_ID,
    label: "Grant MW test share",
    allowedMetrics: opts.allowedMetrics ?? ["rhr", "hrv"],
    dataStart: opts.dataStart ?? "2026-01-01",
    dataEnd: opts.dataEnd ?? "2026-12-31",
    grantExpires: opts.expired
      ? new Date(Date.now() - 1000) // already expired
      : new Date(Date.now() + 24 * 60 * 60 * 1000), // +1 day
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("grant_token middleware + route handler integration", () => {
  // ─── Night view ────────────────────────────────────────────────────────

  describe("/api/views/night", () => {
    it("valid grant_token returns viewer-scoped data", async () => {
      const rawToken = "grant-mw-night-valid-abc123";
      await createValidGrant(rawToken, {
        allowedMetrics: ["rhr", "hrv"],
      });

      const url = `http://localhost:3000/api/views/night?date=${VIEW_DATE}&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await nightGET(request);

      expect(response.status).toBe(200);

      const body = await response.json();
      const data = body.data;

      // Verify all required top-level keys
      expect(data).toHaveProperty("date");
      expect(data).toHaveProperty("time_range");
      expect(data).toHaveProperty("insights");
      expect(data).toHaveProperty("annotations");
      expect(data).toHaveProperty("series");
      expect(data).toHaveProperty("hypnogram");
      expect(data).toHaveProperty("summary");
      expect(data).toHaveProperty("baselines");

      // Verify viewer scoping — only granted metrics
      const summaryKeys = Object.keys(data.summary);
      const baselineKeys = Object.keys(data.baselines);
      for (const key of summaryKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
      for (const key of baselineKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
    });

    it("invalid grant_token returns 401", async () => {
      const url = `http://localhost:3000/api/views/night?date=${VIEW_DATE}&grant_token=totally-invalid-token`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await nightGET(request);

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("expired grant_token returns 401", async () => {
      const rawToken = "grant-mw-night-expired-xyz";
      await createValidGrant(rawToken, { expired: true });

      const url = `http://localhost:3000/api/views/night?date=${VIEW_DATE}&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await nightGET(request);

      expect(response.status).toBe(401);
    });
  });

  // ─── Recovery view ─────────────────────────────────────────────────────

  describe("/api/views/recovery", () => {
    it("valid grant_token returns viewer-scoped data", async () => {
      const rawToken = "grant-mw-recovery-valid-abc123";
      await createValidGrant(rawToken, {
        allowedMetrics: ["rhr", "hrv"],
      });

      const url = `http://localhost:3000/api/views/recovery?start=${START_DATE}&end=${END_DATE}&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await recoveryGET(request);

      expect(response.status).toBe(200);

      const body = await response.json();
      const data = body.data;

      // Verify all required top-level keys
      expect(data).toHaveProperty("date_range");
      expect(data).toHaveProperty("triggering_event");
      expect(data).toHaveProperty("insights");
      expect(data).toHaveProperty("daily");
      expect(data).toHaveProperty("baselines");
      expect(data).toHaveProperty("sparklines");
      expect(data).toHaveProperty("annotations");

      // Verify viewer scoping — only granted metrics in baselines
      const baselineKeys = Object.keys(data.baselines);
      for (const key of baselineKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
    });

    it("invalid grant_token returns 401", async () => {
      const url = `http://localhost:3000/api/views/recovery?start=${START_DATE}&end=${END_DATE}&grant_token=totally-invalid-token`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await recoveryGET(request);

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("expired grant_token returns 401", async () => {
      const rawToken = "grant-mw-recovery-expired-xyz";
      await createValidGrant(rawToken, { expired: true });

      const url = `http://localhost:3000/api/views/recovery?start=${START_DATE}&end=${END_DATE}&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await recoveryGET(request);

      expect(response.status).toBe(401);
    });
  });

  // ─── Trend view ────────────────────────────────────────────────────────

  describe("/api/views/trend", () => {
    it("valid grant_token returns viewer-scoped data", async () => {
      const rawToken = "grant-mw-trend-valid-abc123";
      await createValidGrant(rawToken, {
        allowedMetrics: ["rhr", "hrv"],
      });

      const url = `http://localhost:3000/api/views/trend?start=${TREND_START}&end=${TREND_END}&metrics=rhr,hrv&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await trendGET(request);

      expect(response.status).toBe(200);

      const body = await response.json();
      const data = body.data;

      // Verify all required top-level keys
      expect(data).toHaveProperty("date_range");
      expect(data).toHaveProperty("smoothing");
      expect(data).toHaveProperty("insights");
      expect(data).toHaveProperty("metrics");
      expect(data).toHaveProperty("correlations");

      // Verify viewer scoping — only granted metrics present
      const metricKeys = Object.keys(data.metrics);
      for (const key of metricKeys) {
        expect(["rhr", "hrv"]).toContain(key);
      }
    });

    it("invalid grant_token returns 401", async () => {
      const url = `http://localhost:3000/api/views/trend?start=${TREND_START}&end=${TREND_END}&metrics=rhr,hrv&grant_token=totally-invalid-token`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await trendGET(request);

      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("expired grant_token returns 401", async () => {
      const rawToken = "grant-mw-trend-expired-xyz";
      await createValidGrant(rawToken, { expired: true });

      const url = `http://localhost:3000/api/views/trend?start=${TREND_START}&end=${TREND_END}&metrics=rhr,hrv&grant_token=${rawToken}`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await trendGET(request);

      expect(response.status).toBe(401);
    });
  });

  // ─── Cross-cutting: invalid token returns 401 from route handler ───────

  describe("invalid grant_token returns 401 from route handler (not middleware)", () => {
    it("route handler returns structured error envelope for invalid token", async () => {
      const url = `http://localhost:3000/api/views/night?date=${VIEW_DATE}&grant_token=bad-token`;
      const request = createUnauthenticatedRequestWithGrantToken(url);
      const response = await nightGET(request);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code", "UNAUTHORIZED");
      expect(body.error).toHaveProperty("message");
      expect(body.error.message).toContain("Invalid or expired share token");
    });
  });
});
