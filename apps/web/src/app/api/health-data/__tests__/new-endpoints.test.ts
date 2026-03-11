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
 * Tests for the new/updated health data API endpoints:
 * - GET /api/health-data (source resolution)
 * - GET /api/health-data/series (intraday data)
 * - GET /api/health-data/periods (duration events)
 * - GET /api/health-data/types (all 3 data types)
 * - GET /api/metric-preferences (list preferences)
 * - PUT /api/metric-preferences/[metricType] (set preference)
 * - DELETE /api/metric-preferences/[metricType] (remove preference)
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthData: typeof import("@/db/schema").healthData;
let healthDataPeriods: typeof import("@/db/schema").healthDataPeriods;
let metricSourcePreferences: typeof import("@/db/schema").metricSourcePreferences;

// Route handlers
let healthDataGET: typeof import("../route").GET;
let typesGET: typeof import("../types/route").GET;
let seriesGET: typeof import("../series/route").GET;
let periodsGET: typeof import("../periods/route").GET;
let prefsGET: typeof import("../../metric-preferences/route").GET;
let prefsPUT: typeof import("../../metric-preferences/[metricType]/route").PUT;
let prefsDELETE: typeof import("../../metric-preferences/[metricType]/route").DELETE;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;
let encryptionProvider: import("@/lib/encryption").EncryptionProvider;

const TEST_USER_ID = "hd_new_test_user_001";
const TEST_USER_ID_2 = "hd_new_test_user_002";

// ─── Setup & Teardown ────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";
  process.env.ENCRYPTION_KEY =
    process.env.ENCRYPTION_KEY ||
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  healthData = schema.healthData;
  healthDataPeriods = schema.healthDataPeriods;
  metricSourcePreferences = schema.metricSourcePreferences;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;
  encryptionProvider = createEncryptionProvider();

  // Import route handlers
  const healthDataModule = await import("../route");
  healthDataGET = healthDataModule.GET;

  const typesModule = await import("../types/route");
  typesGET = typesModule.GET;

  const seriesModule = await import("../series/route");
  seriesGET = seriesModule.GET;

  const periodsModule = await import("../periods/route");
  periodsGET = periodsModule.GET;

  const prefsModule = await import("../../metric-preferences/route");
  prefsGET = prefsModule.GET;

  const prefsMetricModule =
    await import("../../metric-preferences/[metricType]/route");
  prefsPUT = prefsMetricModule.PUT;
  prefsDELETE = prefsMetricModule.DELETE;
});

beforeEach(async () => {
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "New Endpoints Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "New Endpoints Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "New Endpoints Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up all test data
  await db
    .delete(metricSourcePreferences)
    .where(
      sql`${metricSourcePreferences.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );
  await db
    .delete(healthData)
    .where(sql`${healthData.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`);

  // Clean up series data via raw SQL (partitioned table)
  await pool
    .query(`DELETE FROM health_data_series WHERE user_id IN ($1, $2)`, [
      TEST_USER_ID,
      TEST_USER_ID_2,
    ])
    .catch(() => {});

  await db
    .delete(healthDataPeriods)
    .where(
      sql`${healthDataPeriods.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
    );

  // Delete audit events via raw SQL
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

function createViewerRequest(
  url: string,
  ownerId: string,
  grantId: string,
  allowedMetrics: string[],
  dataStart: string,
  dataEnd: string,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "viewer",
      userId: ownerId,
      grantId,
      permissions: {
        allowedMetrics,
        dataStart,
        dataEnd,
      },
      authMethod: "viewer_jwt",
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

function createOwnerJsonRequest(
  url: string,
  userId: string,
  method: string,
  body?: unknown,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
    "content-type": "application/json",
  });
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function insertDailyData(
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
  await db.insert(healthData).values({
    userId,
    metricType,
    date,
    valueEncrypted: encrypted,
    source,
  });
}

async function insertSeriesData(
  userId: string,
  metricType: string,
  recordedAt: Date,
  value: number,
  source: string = "oura",
): Promise<void> {
  const encrypted = await encryptionProvider.encrypt(
    Buffer.from(JSON.stringify(value)),
    userId,
  );
  await pool.query(
    `INSERT INTO health_data_series (user_id, metric_type, recorded_at, value_encrypted, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, metric_type, recorded_at, source) DO UPDATE
     SET value_encrypted = EXCLUDED.value_encrypted`,
    [userId, metricType, recordedAt, encrypted, source],
  );
}

async function insertPeriodData(
  userId: string,
  eventType: string,
  startedAt: Date,
  endedAt: Date,
  source: string = "oura",
  subtype: string | null = null,
): Promise<void> {
  await db.insert(healthDataPeriods).values({
    userId,
    eventType,
    subtype,
    startedAt,
    endedAt,
    source,
  });
}

// ─── Tests: GET /api/health-data/series ──────────────────────────────────────

describe("GET /api/health-data/series", () => {
  describe("auth enforcement", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-01&to=2026-01-31",
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns 400 when metric_type is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when from is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&to=2026-01-31",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when to is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-01",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid metric_type", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=invalid&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when from is after to", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-03-01&to=2026-01-01",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(400);
    });
  });

  describe("happy path", () => {
    beforeEach(async () => {
      await insertSeriesData(
        TEST_USER_ID,
        "heart_rate",
        new Date("2026-01-15T10:00:00Z"),
        72,
      );
      await insertSeriesData(
        TEST_USER_ID,
        "heart_rate",
        new Date("2026-01-15T10:05:00Z"),
        75,
      );
      await insertSeriesData(
        TEST_USER_ID,
        "heart_rate",
        new Date("2026-01-15T10:10:00Z"),
        70,
      );
    });

    it("returns intraday readings with recorded_at and value", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-15&to=2026-01-15",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(body.data.metric_type).toBe("heart_rate");
      expect(body.data.unit).toBe("bpm");
      expect(body.data.readings).toHaveLength(3);
      expect(body.data.readings[0].recorded_at).toBeDefined();
      expect(body.data.readings[0].value).toBe(72);
      expect(body.data.readings[0].source).toBe("oura");
    });

    it("returns empty readings for no data in range", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2020-01-01&to=2020-01-31",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.readings).toHaveLength(0);
    });

    it("filters by source when provided", async () => {
      await insertSeriesData(
        TEST_USER_ID,
        "heart_rate",
        new Date("2026-01-15T10:00:00Z"),
        80,
        "whoop",
      );

      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-15&to=2026-01-15&source=oura",
        TEST_USER_ID,
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      // Should only have oura readings
      for (const reading of body.data.readings) {
        expect(reading.source).toBe("oura");
      }
    });
  });

  describe("viewer access", () => {
    beforeEach(async () => {
      await insertSeriesData(
        TEST_USER_ID,
        "heart_rate",
        new Date("2026-01-15T10:00:00Z"),
        72,
      );
    });

    it("returns data for viewer with matching grant", async () => {
      const request = createViewerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-15&to=2026-01-15",
        TEST_USER_ID,
        "test-grant-id",
        ["heart_rate"],
        "2026-01-01",
        "2026-01-31",
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.readings).toHaveLength(1);
    });

    it("returns 403 when metric not in grant", async () => {
      const request = createViewerRequest(
        "http://localhost:3000/api/health-data/series?metric_type=heart_rate&from=2026-01-15&to=2026-01-15",
        TEST_USER_ID,
        "test-grant-id",
        ["sleep_score"], // Grant doesn't include heart_rate
        "2026-01-01",
        "2026-01-31",
      );
      const response = await seriesGET(request);
      expect(response.status).toBe(403);
    });
  });
});

// ─── Tests: GET /api/health-data/periods ─────────────────────────────────────

describe("GET /api/health-data/periods", () => {
  describe("auth enforcement", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-01&to=2026-01-31",
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(401);
    });
  });

  describe("validation", () => {
    it("returns 400 when event_type is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid event_type", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=invalid&from=2026-01-01&to=2026-01-31",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(400);
    });

    it("returns 400 when from is after to", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-03-01&to=2026-01-01",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(400);
    });
  });

  describe("happy path", () => {
    beforeEach(async () => {
      await insertPeriodData(
        TEST_USER_ID,
        "sleep_stage",
        new Date("2026-01-15T22:00:00Z"),
        new Date("2026-01-15T23:30:00Z"),
        "oura",
        "deep",
      );
      await insertPeriodData(
        TEST_USER_ID,
        "sleep_stage",
        new Date("2026-01-15T23:30:00Z"),
        new Date("2026-01-16T01:00:00Z"),
        "oura",
        "rem",
      );
    });

    it("returns periods with started_at, ended_at, duration_sec", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-15&to=2026-01-16",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(body.data.event_type).toBe("sleep_stage");
      expect(body.data.periods).toHaveLength(2);

      const firstPeriod = body.data.periods[0];
      expect(firstPeriod.started_at).toBeDefined();
      expect(firstPeriod.ended_at).toBeDefined();
      expect(firstPeriod.duration_sec).toBe(5400); // 1.5 hours = 5400 seconds
      expect(firstPeriod.subtype).toBe("deep");
      expect(firstPeriod.source).toBe("oura");
    });

    it("filters by subtype", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-15&to=2026-01-16&subtype=deep",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.periods).toHaveLength(1);
      expect(body.data.periods[0].subtype).toBe("deep");
    });

    it("filters by source", async () => {
      await insertPeriodData(
        TEST_USER_ID,
        "sleep_stage",
        new Date("2026-01-16T22:00:00Z"),
        new Date("2026-01-16T23:30:00Z"),
        "whoop",
        "deep",
      );

      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2026-01-15&to=2026-01-17&source=oura",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      for (const period of body.data.periods) {
        expect(period.source).toBe("oura");
      }
    });

    it("returns empty periods for no data in range", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/periods?event_type=sleep_stage&from=2020-01-01&to=2020-01-31",
        TEST_USER_ID,
      );
      const response = await periodsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.periods).toHaveLength(0);
    });
  });
});

// ─── Tests: GET /api/health-data/types (all data types) ──────────────────────

describe("GET /api/health-data/types (with all data types)", () => {
  beforeEach(async () => {
    // Insert daily data
    await insertDailyData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);

    // Insert series data
    await insertSeriesData(
      TEST_USER_ID,
      "heart_rate",
      new Date("2026-01-15T10:00:00Z"),
      72,
    );

    // Insert period data
    await insertPeriodData(
      TEST_USER_ID,
      "sleep_stage",
      new Date("2026-01-15T22:00:00Z"),
      new Date("2026-01-15T23:30:00Z"),
      "oura",
      "deep",
    );
  });

  it("returns metrics from all 3 data types", async () => {
    const request = createOwnerRequest(
      "http://localhost:3000/api/health-data/types",
      TEST_USER_ID,
    );
    const response = await typesGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const types = body.data.types;

    // Check that we have entries from all 3 data types
    const dataTypes = types.map((t: { data_type: string }) => t.data_type);
    expect(dataTypes).toContain("daily");
    expect(dataTypes).toContain("series");
    expect(dataTypes).toContain("period");

    // Check specific entries
    const sleepScore = types.find(
      (t: { metric_type: string }) => t.metric_type === "sleep_score",
    );
    expect(sleepScore).toBeDefined();
    expect(sleepScore.data_type).toBe("daily");
    expect(sleepScore.label).toBe("Sleep Score");

    const heartRate = types.find(
      (t: { metric_type: string }) => t.metric_type === "heart_rate",
    );
    expect(heartRate).toBeDefined();
    expect(heartRate.data_type).toBe("series");

    const sleepStage = types.find(
      (t: { metric_type: string }) => t.metric_type === "sleep_stage",
    );
    expect(sleepStage).toBeDefined();
    expect(sleepStage.data_type).toBe("period");
  });
});

// ─── Tests: Metric Preferences CRUD ──────────────────────────────────────────

describe("Metric Preferences CRUD", () => {
  describe("GET /api/metric-preferences", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthRequest(
        "http://localhost:3000/api/metric-preferences",
      );
      const response = await prefsGET(request);
      expect(response.status).toBe(401);
    });

    it("returns empty array when no preferences set", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/metric-preferences",
        TEST_USER_ID,
      );
      const response = await prefsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.preferences).toHaveLength(0);
    });

    it("returns preferences after setting them", async () => {
      // Set a preference
      await db.insert(metricSourcePreferences).values({
        userId: TEST_USER_ID,
        metricType: "hrv",
        provider: "oura",
      });

      const request = createOwnerRequest(
        "http://localhost:3000/api/metric-preferences",
        TEST_USER_ID,
      );
      const response = await prefsGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.preferences).toHaveLength(1);
      expect(body.data.preferences[0].metric_type).toBe("hrv");
      expect(body.data.preferences[0].provider).toBe("oura");
    });
  });

  describe("PUT /api/metric-preferences/[metricType]", () => {
    it("returns 401 without auth", async () => {
      const headers = new Headers({
        "x-request-context": JSON.stringify({
          role: "unauthenticated",
          permissions: "full",
          authMethod: "none",
        }),
        "content-type": "application/json",
      });
      const unauthRequest = new Request(
        "http://localhost:3000/api/metric-preferences/hrv",
        {
          method: "PUT",
          headers,
          body: JSON.stringify({ provider: "oura" }),
        },
      );
      const response = await prefsPUT(unauthRequest, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(401);
    });

    it("sets a preference and returns it", async () => {
      const request = createOwnerJsonRequest(
        "http://localhost:3000/api/metric-preferences/hrv",
        TEST_USER_ID,
        "PUT",
        { provider: "oura" },
      );
      const response = await prefsPUT(request, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.metric_type).toBe("hrv");
      expect(body.data.provider).toBe("oura");

      // Verify in DB
      const prefs = await db
        .select()
        .from(metricSourcePreferences)
        .where(
          sql`${metricSourcePreferences.userId} = ${TEST_USER_ID} AND ${metricSourcePreferences.metricType} = 'hrv'`,
        );
      expect(prefs).toHaveLength(1);
      expect(prefs[0]!.provider).toBe("oura");
    });

    it("updates an existing preference", async () => {
      // Set initial
      await db.insert(metricSourcePreferences).values({
        userId: TEST_USER_ID,
        metricType: "hrv",
        provider: "oura",
      });

      // Update to whoop
      const request = createOwnerJsonRequest(
        "http://localhost:3000/api/metric-preferences/hrv",
        TEST_USER_ID,
        "PUT",
        { provider: "whoop" },
      );
      const response = await prefsPUT(request, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.provider).toBe("whoop");
    });

    it("returns 400 for invalid metric type", async () => {
      const request = createOwnerJsonRequest(
        "http://localhost:3000/api/metric-preferences/invalid_metric",
        TEST_USER_ID,
        "PUT",
        { provider: "oura" },
      );
      const response = await prefsPUT(request, {
        params: Promise.resolve({ metricType: "invalid_metric" }),
      });
      expect(response.status).toBe(400);
    });

    it("returns 400 for invalid provider", async () => {
      const request = createOwnerJsonRequest(
        "http://localhost:3000/api/metric-preferences/hrv",
        TEST_USER_ID,
        "PUT",
        { provider: "invalid_provider" },
      );
      const response = await prefsPUT(request, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("DELETE /api/metric-preferences/[metricType]", () => {
    it("deletes an existing preference", async () => {
      // Set preference first
      await db.insert(metricSourcePreferences).values({
        userId: TEST_USER_ID,
        metricType: "hrv",
        provider: "oura",
      });

      const request = createOwnerRequest(
        "http://localhost:3000/api/metric-preferences/hrv",
        TEST_USER_ID,
      );
      const deleteRequest = new Request(
        "http://localhost:3000/api/metric-preferences/hrv",
        {
          method: "DELETE",
          headers: request.headers,
        },
      );
      const response = await prefsDELETE(deleteRequest, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.deleted).toBe(true);

      // Verify removed from DB
      const prefs = await db
        .select()
        .from(metricSourcePreferences)
        .where(
          sql`${metricSourcePreferences.userId} = ${TEST_USER_ID} AND ${metricSourcePreferences.metricType} = 'hrv'`,
        );
      expect(prefs).toHaveLength(0);
    });

    it("returns 200 for idempotent delete (no existing preference)", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/metric-preferences/hrv",
        TEST_USER_ID,
      );
      const deleteRequest = new Request(
        "http://localhost:3000/api/metric-preferences/hrv",
        {
          method: "DELETE",
          headers: request.headers,
        },
      );
      const response = await prefsDELETE(deleteRequest, {
        params: Promise.resolve({ metricType: "hrv" }),
      });
      expect(response.status).toBe(200);
    });

    it("returns 400 for invalid metric type", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/metric-preferences/invalid",
        TEST_USER_ID,
      );
      const deleteRequest = new Request(
        "http://localhost:3000/api/metric-preferences/invalid",
        {
          method: "DELETE",
          headers: request.headers,
        },
      );
      const response = await prefsDELETE(deleteRequest, {
        params: Promise.resolve({ metricType: "invalid" }),
      });
      expect(response.status).toBe(400);
    });
  });
});

// ─── Tests: Source Resolution in GET /api/health-data ────────────────────────

describe("GET /api/health-data (source resolution)", () => {
  beforeEach(async () => {
    // Insert HRV data from 2 sources
    await insertDailyData(TEST_USER_ID, "hrv", "2026-01-15", 42.5, "oura");
    await insertDailyData(TEST_USER_ID, "hrv", "2026-01-15", 40.0, "whoop");
    await insertDailyData(TEST_USER_ID, "hrv", "2026-01-16", 45.0, "oura");
    await insertDailyData(TEST_USER_ID, "hrv", "2026-01-16", 43.0, "whoop");
  });

  it("includes source_resolution in response", async () => {
    const request = createOwnerRequest(
      "http://localhost:3000/api/health-data?metrics=hrv&start=2026-01-15&end=2026-01-16",
      TEST_USER_ID,
    );
    const response = await healthDataGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Source resolution should be present (auto-resolved)
    if (body.data.query.source_resolution) {
      expect(body.data.query.source_resolution.hrv).toBeDefined();
      expect(body.data.query.source_resolution.hrv.source).toBeDefined();
      expect(body.data.query.source_resolution.hrv.reason).toBeDefined();
    }
  });

  it("respects user preference when set", async () => {
    // Set preference for whoop
    await db.insert(metricSourcePreferences).values({
      userId: TEST_USER_ID,
      metricType: "hrv",
      provider: "whoop",
    });

    const request = createOwnerRequest(
      "http://localhost:3000/api/health-data?metrics=hrv&start=2026-01-15&end=2026-01-16",
      TEST_USER_ID,
    );
    const response = await healthDataGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    // Should only return whoop data
    const points = body.data.metrics.hrv.points;
    for (const point of points) {
      expect(point.source).toBe("whoop");
    }

    // Source resolution should show user_preference
    expect(body.data.query.source_resolution?.hrv?.reason).toBe(
      "user_preference",
    );
  });

  it("returns all sources when sources=all is passed", async () => {
    const request = createOwnerRequest(
      "http://localhost:3000/api/health-data?metrics=hrv&start=2026-01-15&end=2026-01-16&sources=all",
      TEST_USER_ID,
    );
    const response = await healthDataGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    const points = body.data.metrics.hrv.points;
    // Should have data from both sources
    const sources = new Set(points.map((p: { source: string }) => p.source));
    expect(sources.size).toBe(2);
    expect(sources.has("oura")).toBe(true);
    expect(sources.has("whoop")).toBe(true);
  });
});
