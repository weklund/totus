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
 * Tests for the health data API endpoints:
 * - GET /api/health-data (query with metrics, dates, resolution)
 * - GET /api/health-data/types (available metric types)
 *
 * Tests cover: happy path, resolution aggregation, empty results,
 * auth enforcement, viewer metric filtering and date clamping.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let healthData: typeof import("@/db/schema").healthData;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handlers
let healthDataGET: typeof import("../route").GET;
let typesGET: typeof import("../types/route").GET;

// Encryption
let createEncryptionProvider: typeof import("@/lib/encryption").createEncryptionProvider;
let encryptionProvider: import("@/lib/encryption").EncryptionProvider;

const TEST_USER_ID = "health_data_test_user_001";
const TEST_USER_ID_2 = "health_data_test_user_002";

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

  // Import modules
  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;
  healthData = schema.healthData;
  auditEvents = schema.auditEvents;

  const encModule = await import("@/lib/encryption");
  createEncryptionProvider = encModule.createEncryptionProvider;
  encryptionProvider = createEncryptionProvider();

  // Import route handlers
  const healthDataModule = await import("../route");
  healthDataGET = healthDataModule.GET;

  const typesModule = await import("../types/route");
  typesGET = typesModule.GET;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Health Data Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Health Data Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Health Data Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up test data
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
  await db.insert(healthData).values({
    userId,
    metricType,
    date,
    valueEncrypted: encrypted,
    source,
  });
}

// ─── Tests: GET /api/health-data ─────────────────────────────────────────────

describe("GET /api/health-data", () => {
  describe("auth enforcement", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-03-01",
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("validation", () => {
    it("returns 400 when metrics param is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?start=2026-01-01&end=2026-03-01",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when start param is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&end=2026-03-01",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when end param is missing", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid metric type", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=invalid_metric&start=2026-01-01&end=2026-03-01",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for more than 10 metrics", async () => {
      const metrics = Array.from({ length: 11 }, (_, i) => `metric_${i}`).join(
        ",",
      );
      const request = createOwnerRequest(
        `http://localhost:3000/api/health-data?metrics=${metrics}&start=2026-01-01&end=2026-03-01`,
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when start is after end", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-03-01&end=2026-01-01",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid resolution", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-01&end=2026-03-01&resolution=yearly",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("happy path - daily resolution", () => {
    beforeEach(async () => {
      // Insert test data: sleep_score and hrv for 3 days
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-16", 78);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-17", 91);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-15", 42.5);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-16", 38.1);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-17", 45.7);
    });

    it("returns decrypted health data points for requested metrics", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score,hrv&start=2026-01-15&end=2026-01-17",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(body.data.metrics).toBeDefined();

      // Check sleep_score
      const sleepScore = body.data.metrics.sleep_score;
      expect(sleepScore).toBeDefined();
      expect(sleepScore.unit).toBe("score");
      expect(sleepScore.points).toHaveLength(3);
      expect(sleepScore.points[0].date).toBe("2026-01-15");
      expect(sleepScore.points[0].value).toBe(85);
      expect(sleepScore.points[0].source).toBe("oura");

      // Check hrv
      const hrv = body.data.metrics.hrv;
      expect(hrv).toBeDefined();
      expect(hrv.unit).toBe("ms");
      expect(hrv.points).toHaveLength(3);
      expect(hrv.points[0].value).toBe(42.5);

      // Check query metadata
      expect(body.data.query.start).toBe("2026-01-15");
      expect(body.data.query.end).toBe("2026-01-17");
      expect(body.data.query.resolution).toBe("daily");
      expect(body.data.query.metrics_requested).toContain("sleep_score");
      expect(body.data.query.metrics_requested).toContain("hrv");
      expect(body.data.query.metrics_returned).toContain("sleep_score");
      expect(body.data.query.metrics_returned).toContain("hrv");
    });

    it("returns points sorted by date ascending", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-15&end=2026-01-17",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const points = body.data.metrics.sleep_score.points;
      expect(points[0].date).toBe("2026-01-15");
      expect(points[1].date).toBe("2026-01-16");
      expect(points[2].date).toBe("2026-01-17");
    });

    it("returns only requested metrics", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-15&end=2026-01-17",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.metrics.sleep_score).toBeDefined();
      expect(body.data.metrics.hrv).toBeUndefined();
    });

    it("does not return other user's data", async () => {
      await insertHealthData(TEST_USER_ID_2, "sleep_score", "2026-01-15", 99);

      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-15&end=2026-01-17",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const points = body.data.metrics.sleep_score.points;
      // Should only have our user's data (3 points), not user2's
      expect(points).toHaveLength(3);
      expect(points.every((p: { value: number }) => p.value !== 99)).toBe(true);
    });
  });

  describe("empty results", () => {
    it("returns 200 with empty points when no data in range", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2020-01-01&end=2020-01-31",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.metrics.sleep_score).toBeDefined();
      expect(body.data.metrics.sleep_score.points).toHaveLength(0);
    });
  });

  describe("source filtering", () => {
    beforeEach(async () => {
      await insertHealthData(
        TEST_USER_ID,
        "sleep_score",
        "2026-01-15",
        85,
        "oura",
      );
      await insertHealthData(
        TEST_USER_ID,
        "sleep_score",
        "2026-01-16",
        78,
        "apple_health",
      );
    });

    it("filters by source when provided", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-15&end=2026-01-16&sources=oura",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const points = body.data.metrics.sleep_score.points;
      expect(points).toHaveLength(1);
      expect(points[0].source).toBe("oura");
    });
  });

  describe("weekly resolution", () => {
    beforeEach(async () => {
      // Insert data across two weeks
      // Week of 2026-01-12 (Mon) to 2026-01-18 (Sun)
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-12", 80); // Mon
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-13", 82); // Tue
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-14", 84); // Wed

      // Week of 2026-01-19 (Mon) to 2026-01-25 (Sun)
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-19", 90); // Mon
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-20", 92); // Tue
    });

    it("returns weekly averages with Monday dates", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-12&end=2026-01-25&resolution=weekly",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const points = body.data.metrics.sleep_score.points;
      expect(points).toHaveLength(2);

      // First week: avg(80, 82, 84) = 82
      expect(points[0].date).toBe("2026-01-12"); // Monday
      expect(points[0].value).toBeCloseTo(82, 1);

      // Second week: avg(90, 92) = 91
      expect(points[1].date).toBe("2026-01-19"); // Monday
      expect(points[1].value).toBeCloseTo(91, 1);
    });
  });

  describe("monthly resolution", () => {
    beforeEach(async () => {
      // January data
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-10", 40);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-20", 50);

      // February data
      await insertHealthData(TEST_USER_ID, "hrv", "2026-02-05", 60);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-02-15", 70);
    });

    it("returns monthly averages with 1st-of-month dates", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=hrv&start=2026-01-01&end=2026-02-28&resolution=monthly",
        TEST_USER_ID,
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const points = body.data.metrics.hrv.points;
      expect(points).toHaveLength(2);

      // January: avg(40, 50) = 45
      expect(points[0].date).toBe("2026-01-01");
      expect(points[0].value).toBeCloseTo(45, 1);

      // February: avg(60, 70) = 65
      expect(points[1].date).toBe("2026-02-01");
      expect(points[1].value).toBeCloseTo(65, 1);
    });
  });

  describe("viewer access (scoped)", () => {
    beforeEach(async () => {
      // Insert data for owner
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-16", 78);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-02-15", 91);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-15", 42.5);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-16", 38.1);
    });

    it("returns only granted metrics with dates clamped", async () => {
      // Viewer has grant for sleep_score only, from 2026-01-15 to 2026-01-31
      const request = createViewerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score,hrv&start=2026-01-01&end=2026-03-01",
        TEST_USER_ID,
        "test-grant-id",
        ["sleep_score"],
        "2026-01-15",
        "2026-01-31",
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      // sleep_score should be present, hrv should not (not in grant)
      expect(body.data.metrics.sleep_score).toBeDefined();
      expect(body.data.metrics.hrv).toBeUndefined();

      // Dates should be clamped: only Jan 15 and 16 (within grant window)
      const points = body.data.metrics.sleep_score.points;
      expect(points).toHaveLength(2);
      expect(points[0].date).toBe("2026-01-15");
      expect(points[1].date).toBe("2026-01-16");
    });

    it("returns 403 when no metric intersection", async () => {
      const request = createViewerRequest(
        "http://localhost:3000/api/health-data?metrics=hrv&start=2026-01-15&end=2026-01-31",
        TEST_USER_ID,
        "test-grant-id",
        ["sleep_score"], // Grant only allows sleep_score, viewer asks for hrv
        "2026-01-15",
        "2026-01-31",
      );
      const response = await healthDataGET(request);
      expect(response.status).toBe(403);
    });
  });

  describe("audit events", () => {
    beforeEach(async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
    });

    it("emits data.viewed audit event", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data?metrics=sleep_score&start=2026-01-15&end=2026-01-15",
        TEST_USER_ID,
      );
      await healthDataGET(request);

      // Check audit event was created
      const events = await db
        .select()
        .from(auditEvents)
        .where(
          sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'data.viewed'`,
        );
      expect(events.length).toBeGreaterThanOrEqual(1);

      const event = events[events.length - 1];
      expect(event.actorType).toBe("owner");
      expect(event.eventType).toBe("data.viewed");
      expect(event.resourceType).toBe("health_data");
    });
  });
});

// ─── Tests: GET /api/health-data/types ───────────────────────────────────────

describe("GET /api/health-data/types", () => {
  describe("auth enforcement", () => {
    it("returns 401 without auth", async () => {
      const request = createUnauthRequest(
        "http://localhost:3000/api/health-data/types",
      );
      const response = await typesGET(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("happy path", () => {
    beforeEach(async () => {
      // Insert data for multiple metrics
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-10", 80);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-20", 90);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-12", 42.5);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-18", 45.7);
    });

    it("returns metric types with date ranges and counts", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/types",
        TEST_USER_ID,
      );
      const response = await typesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data).toBeDefined();
      expect(body.data.types).toBeDefined();
      expect(body.data.types).toHaveLength(2);

      // Find sleep_score entry
      const sleepScore = body.data.types.find(
        (t: { metric_type: string }) => t.metric_type === "sleep_score",
      );
      expect(sleepScore).toBeDefined();
      expect(sleepScore.label).toBe("Sleep Score");
      expect(sleepScore.unit).toBe("score");
      expect(sleepScore.category).toBe("sleep");
      expect(sleepScore.date_range.start).toBe("2026-01-10");
      expect(sleepScore.date_range.end).toBe("2026-01-20");
      expect(sleepScore.count).toBe(3);

      // Find hrv entry
      const hrv = body.data.types.find(
        (t: { metric_type: string }) => t.metric_type === "hrv",
      );
      expect(hrv).toBeDefined();
      expect(hrv.label).toBe("Heart Rate Variability");
      expect(hrv.unit).toBe("ms");
      expect(hrv.count).toBe(2);
    });

    it("does not return metrics from other users", async () => {
      await insertHealthData(TEST_USER_ID_2, "steps", "2026-01-15", 10000);

      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/types",
        TEST_USER_ID,
      );
      const response = await typesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const metricTypes = body.data.types.map(
        (t: { metric_type: string }) => t.metric_type,
      );
      expect(metricTypes).not.toContain("steps");
    });
  });

  describe("empty state", () => {
    it("returns empty types array when no data exists", async () => {
      const request = createOwnerRequest(
        "http://localhost:3000/api/health-data/types",
        TEST_USER_ID,
      );
      const response = await typesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.data.types).toHaveLength(0);
    });
  });

  describe("viewer access", () => {
    beforeEach(async () => {
      await insertHealthData(TEST_USER_ID, "sleep_score", "2026-01-15", 85);
      await insertHealthData(TEST_USER_ID, "hrv", "2026-01-15", 42.5);
      await insertHealthData(TEST_USER_ID, "steps", "2026-01-15", 10000);
    });

    it("returns only granted metric types for viewer", async () => {
      const request = createViewerRequest(
        "http://localhost:3000/api/health-data/types",
        TEST_USER_ID,
        "test-grant-id",
        ["sleep_score", "hrv"],
        "2026-01-01",
        "2026-01-31",
      );
      const response = await typesGET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      const metricTypes = body.data.types.map(
        (t: { metric_type: string }) => t.metric_type,
      );
      expect(metricTypes).toContain("sleep_score");
      expect(metricTypes).toContain("hrv");
      expect(metricTypes).not.toContain("steps");
    });
  });
});
