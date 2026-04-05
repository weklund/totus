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
 * Tests for the annotations API endpoints:
 * - POST /api/annotations — create an annotation
 * - GET /api/annotations — list annotations with date range
 * - PATCH /api/annotations/:id — update an annotation
 * - DELETE /api/annotations/:id — delete an annotation
 *
 * Tests verify: auth enforcement, Zod validation, happy paths, encryption
 * round-trip, viewer scoping, owner-only enforcement, audit events, and
 * Unicode preservation.
 */

// ─── Module-level variables ──────────────────────────────────────────────────

let pool: PoolType;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let userAnnotations: typeof import("@/db/schema").userAnnotations;
let auditEvents: typeof import("@/db/schema").auditEvents;

// Route handlers
let createPOST: typeof import("../route").POST;
let listGET: typeof import("../route").GET;
let updatePATCH: typeof import("../[id]/route").PATCH;
let deleteDELETE: typeof import("../[id]/route").DELETE;

const TEST_USER_ID = "annot_test_user_001";
const TEST_USER_ID_2 = "annot_test_user_002";
const TEST_GRANT_ID = "00000000-0000-0000-0000-000000000099";

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
  userAnnotations = schema.userAnnotations;
  auditEvents = schema.auditEvents;

  // Import route handlers
  const listModule = await import("../route");
  createPOST = listModule.POST;
  listGET = listModule.GET;

  const detailModule = await import("../[id]/route");
  updatePATCH = detailModule.PATCH;
  deleteDELETE = detailModule.DELETE;
});

beforeEach(async () => {
  // Create test users
  await db
    .insert(users)
    .values([
      {
        id: TEST_USER_ID,
        displayName: "Annotation Test User",
        kmsKeyArn: "local-dev-key",
      },
      {
        id: TEST_USER_ID_2,
        displayName: "Annotation Test User 2",
        kmsKeyArn: "local-dev-key",
      },
    ])
    .onConflictDoUpdate({
      target: users.id,
      set: { displayName: "Annotation Test User", updatedAt: new Date() },
    });
});

afterEach(async () => {
  // Clean up test data in correct order (FK constraints)
  await db
    .delete(userAnnotations)
    .where(
      sql`${userAnnotations.userId} IN (${TEST_USER_ID}, ${TEST_USER_ID_2})`,
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

function createAuthRequest(
  url: string,
  userId: string,
  method: string = "GET",
  body?: unknown,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "owner",
      userId,
      permissions: "full",
      authMethod: "session",
    }),
    "Content-Type": "application/json",
  });
  const init: RequestInit = { method, headers };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function createUnauthRequest(
  url: string,
  method: string = "GET",
  body?: unknown,
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "unauthenticated",
      permissions: "full",
      authMethod: "none",
    }),
    "Content-Type": "application/json",
  });
  const init: RequestInit = { method, headers };
  if (body) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

function createViewerRequest(
  url: string,
  ownerId: string,
  allowedMetrics: string[],
  dataStart: string = "2026-01-01",
  dataEnd: string = "2026-12-31",
): Request {
  const headers = new Headers({
    "x-request-context": JSON.stringify({
      role: "viewer",
      userId: ownerId,
      grantId: TEST_GRANT_ID,
      permissions: {
        allowedMetrics,
        dataStart,
        dataEnd,
      },
      authMethod: "viewer_jwt",
    }),
    "Content-Type": "application/json",
  });
  return new Request(url, { method: "GET", headers });
}

function validAnnotationBody(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "meal",
    label: "Late dinner",
    note: "Heavy pasta, red wine",
    occurred_at: "2026-03-28T21:30:00.000Z",
    ...overrides,
  };
}

async function createAnnotation(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; [key: string]: unknown }> {
  const request = createAuthRequest(
    "http://localhost:3000/api/annotations",
    userId,
    "POST",
    validAnnotationBody(overrides),
  );
  const response = await createPOST(request);
  const body = await response.json();
  return body.data;
}

// ─── POST /api/annotations ───────────────────────────────────────────────────

describe("POST /api/annotations", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/annotations",
      "POST",
      validAnnotationBody(),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("creates annotation and returns 201 with decrypted fields", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody(),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.event_type).toBe("meal");
    expect(body.data.label).toBe("Late dinner");
    expect(body.data.note).toBe("Heavy pasta, red wine");
    expect(body.data.occurred_at).toBe("2026-03-28T21:30:00.000Z");
    expect(body.data.ended_at).toBeNull();
    expect(body.data.created_at).toBeDefined();
  });

  it("stores label and note as encrypted BYTEA (not plaintext)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    // Read the raw row from the database
    const [row] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, annotation.id));

    expect(row).toBeDefined();
    // The encrypted buffer should NOT match the plaintext
    expect(row.labelEncrypted).toBeInstanceOf(Buffer);
    expect(row.labelEncrypted.toString()).not.toBe("Late dinner");
    expect(row.noteEncrypted).toBeInstanceOf(Buffer);
    expect(row.noteEncrypted!.toString()).not.toBe("Heavy pasta, red wine");
  });

  it("creates annotation without note", async () => {
    const body = validAnnotationBody();
    delete (body as Record<string, unknown>).note;
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      body,
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const result = await response.json();
    expect(result.data.note).toBeNull();

    // Verify null note in DB
    const [row] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, result.data.id));
    expect(row.noteEncrypted).toBeNull();
  });

  it("creates annotation with ended_at", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({
        ended_at: "2026-03-28T22:30:00.000Z",
      }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.ended_at).toBe("2026-03-28T22:30:00.000Z");
  });

  it("returns 400 for invalid event_type", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ event_type: "invalid_type" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("validates all 7 event types", async () => {
    const validTypes = [
      "meal",
      "workout",
      "travel",
      "alcohol",
      "medication",
      "supplement",
      "custom",
    ];
    for (const eventType of validTypes) {
      const request = createAuthRequest(
        "http://localhost:3000/api/annotations",
        TEST_USER_ID,
        "POST",
        validAnnotationBody({ event_type: eventType }),
      );
      const response = await createPOST(request);
      expect(response.status).toBe(201);
    }
  });

  it("returns 400 for empty label", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ label: "" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for label exceeding 255 chars", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ label: "x".repeat(256) }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for note exceeding 1000 chars", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ note: "x".repeat(1001) }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid occurred_at datetime", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ occurred_at: "not-a-date" }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when ended_at <= occurred_at", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({
        occurred_at: "2026-03-28T22:00:00.000Z",
        ended_at: "2026-03-28T21:00:00.000Z",
      }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when ended_at equals occurred_at", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({
        occurred_at: "2026-03-28T22:00:00.000Z",
        ended_at: "2026-03-28T22:00:00.000Z",
      }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("preserves Unicode through encryption round-trip", async () => {
    const unicodeLabel = "Dîner tardif 🍷";
    const unicodeNote = "Pâtes à la crème 🧀 — très bon!";
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations",
      TEST_USER_ID,
      "POST",
      validAnnotationBody({ label: unicodeLabel, note: unicodeNote }),
    );
    const response = await createPOST(request);
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.data.label).toBe(unicodeLabel);
    expect(body.data.note).toBe(unicodeNote);
  });

  it("emits annotation.created audit event", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'annotation.created'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    // Find the audit event matching our annotation
    const matchingEvent = events.find((e) => {
      const detail = e.resourceDetail as Record<string, unknown>;
      return detail.annotation_id === annotation.id;
    });
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.actorType).toBe("owner");
    expect(matchingEvent!.resourceType).toBe("annotation");
    const detail = matchingEvent!.resourceDetail as Record<string, unknown>;
    expect(detail.event_type).toBe("meal");
  });
});

// ─── GET /api/annotations ────────────────────────────────────────────────────

describe("GET /api/annotations", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-01&end=2026-03-31",
    );
    const response = await listGET(request);
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 for missing start parameter", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?end=2026-03-31",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing end parameter", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-01",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid date format", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=03-01-2026&end=2026-03-31",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when end < start", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-31&end=2026-03-01",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid event_type filter", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-01&end=2026-03-31&event_type=invalid",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns empty array when no annotations", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-01&end=2026-03-31",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toEqual([]);
  });

  it("returns annotations with decrypted fields sorted by occurred_at", async () => {
    // Create annotations in reverse order
    await createAnnotation(TEST_USER_ID, {
      label: "Second event",
      occurred_at: "2026-03-28T22:00:00.000Z",
    });
    await createAnnotation(TEST_USER_ID, {
      label: "First event",
      occurred_at: "2026-03-28T20:00:00.000Z",
    });

    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(2);
    // Sorted by occurred_at ascending
    expect(body.data.annotations[0].label).toBe("First event");
    expect(body.data.annotations[1].label).toBe("Second event");
    // User annotations have source="user"
    expect(body.data.annotations[0].source).toBe("user");
  });

  it("filters by event_type", async () => {
    await createAnnotation(TEST_USER_ID, { event_type: "meal" });
    await createAnnotation(TEST_USER_ID, { event_type: "workout" });

    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28&event_type=meal",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(1);
    expect(body.data.annotations[0].event_type).toBe("meal");
  });

  it("does not return another user's annotations", async () => {
    await createAnnotation(TEST_USER_ID_2);

    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toEqual([]);
  });

  it("viewer with glucose grant sees meal annotations", async () => {
    await createAnnotation(TEST_USER_ID, { event_type: "meal" });

    const request = createViewerRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
      ["glucose"],
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(1);
    expect(body.data.annotations[0].event_type).toBe("meal");
  });

  it("viewer with only rhr grant does NOT see meal annotations", async () => {
    await createAnnotation(TEST_USER_ID, { event_type: "meal" });

    const request = createViewerRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
      ["rhr"],
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(0);
  });

  it("viewer with active_calories grant sees workout annotations", async () => {
    await createAnnotation(TEST_USER_ID, {
      event_type: "workout",
      label: "Morning run",
    });

    const request = createViewerRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
      ["active_calories"],
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(1);
    expect(body.data.annotations[0].event_type).toBe("workout");
  });

  it("viewer with sleep_score grant does NOT see workout annotations", async () => {
    await createAnnotation(TEST_USER_ID, {
      event_type: "workout",
      label: "Morning run",
    });

    const request = createViewerRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
      ["sleep_score"],
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(0);
  });

  it("viewer sees medication/supplement/custom with any grant", async () => {
    await createAnnotation(TEST_USER_ID, {
      event_type: "medication",
      label: "Vitamin D",
    });
    await createAnnotation(TEST_USER_ID, {
      event_type: "supplement",
      label: "Fish oil",
      occurred_at: "2026-03-28T21:31:00.000Z",
    });
    await createAnnotation(TEST_USER_ID, {
      event_type: "custom",
      label: "Felt dizzy",
      occurred_at: "2026-03-28T21:32:00.000Z",
    });

    const request = createViewerRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
      ["rhr"], // any metric should work
    );
    const response = await listGET(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.annotations).toHaveLength(3);
  });

  it("emits data.viewed audit event", async () => {
    await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    await listGET(request);

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'data.viewed'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("annotation");
    const detail = events[0].resourceDetail as Record<string, unknown>;
    expect(detail.start).toBe("2026-03-28");
    expect(detail.end).toBe("2026-03-28");
  });
});

// ─── PATCH /api/annotations/:id ─────────────────────────────────────────────

describe("PATCH /api/annotations/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/annotations/1",
      "PATCH",
      { label: "Updated" },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 for non-existent annotation", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations/999999",
      TEST_USER_ID,
      "PATCH",
      { label: "Updated" },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for another user's annotation (owner-only)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "Stolen update" },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(404);
  });

  it("updates label only (partial update)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "Updated dinner" },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.label).toBe("Updated dinner");
    // Note should remain unchanged
    expect(body.data.note).toBe("Heavy pasta, red wine");
    expect(body.data.updated_at).toBeDefined();
    // updated_at should be newer than created_at
    expect(new Date(body.data.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(body.data.created_at).getTime(),
    );
  });

  it("sets note to null (nullable)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { note: null },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.note).toBeNull();

    // Verify null in database
    const [row] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, annotation.id));
    expect(row.noteEncrypted).toBeNull();
  });

  it("updates occurred_at", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const newTime = "2026-03-28T23:00:00.000Z";
    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { occurred_at: newTime },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.occurred_at).toBe(newTime);
  });

  it("sets ended_at to null (removes duration)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID, {
      ended_at: "2026-03-28T22:30:00.000Z",
    });

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { ended_at: null },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.ended_at).toBeNull();
  });

  it("returns 400 when updated ended_at <= occurred_at", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { ended_at: "2026-03-28T20:00:00.000Z" }, // before occurred_at
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for label exceeding 255 chars", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "x".repeat(256) },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for note exceeding 1000 chars", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { note: "x".repeat(1001) },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("re-encrypts changed fields", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    // Read original encrypted value
    const [originalRow] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, annotation.id));
    const originalEncrypted = originalRow.labelEncrypted;

    // Update label
    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "Different label" },
    );
    await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });

    // Read updated encrypted value
    const [updatedRow] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, annotation.id));

    // Encrypted value should be different (different plaintext + random IV)
    expect(
      Buffer.compare(originalEncrypted, updatedRow.labelEncrypted),
    ).not.toBe(0);
  });

  it("returns 404 for non-numeric id", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations/abc",
      TEST_USER_ID,
      "PATCH",
      { label: "Updated" },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).toBe(404);
  });

  it("emits annotation.updated audit event", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "Updated" },
    );
    await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'annotation.updated'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("annotation");
    const detail = events[0].resourceDetail as Record<string, unknown>;
    expect(detail.annotation_id).toBe(annotation.id);
  });
});

// ─── DELETE /api/annotations/:id ─────────────────────────────────────────────

describe("DELETE /api/annotations/:id", () => {
  it("returns 401 without auth", async () => {
    const request = createUnauthRequest(
      "http://localhost:3000/api/annotations/1",
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(401);

    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 404 for non-existent annotation", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations/999999",
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(response.status).toBe(404);

    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for another user's annotation (owner-only)", async () => {
    const annotation = await createAnnotation(TEST_USER_ID_2);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(404);
  });

  it("deletes annotation and returns confirmation", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.id).toBe(annotation.id);
    expect(body.data.deleted).toBe(true);

    // Verify annotation is gone
    const [gone] = await db
      .select()
      .from(userAnnotations)
      .where(eq(userAnnotations.id, annotation.id));
    expect(gone).toBeUndefined();
  });

  it("double-delete returns 404 on second call", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    // First delete
    const request1 = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response1 = await deleteDELETE(request1, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response1.status).toBe(200);

    // Second delete
    const request2 = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    const response2 = await deleteDELETE(request2, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response2.status).toBe(404);
  });

  it("subsequent GET returns empty after delete", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    // Delete the annotation
    const deleteReq = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    await deleteDELETE(deleteReq, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });

    // GET should show empty
    const getReq = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    const response = await listGET(getReq);
    const body = await response.json();
    expect(body.data.annotations).toEqual([]);
  });

  it("returns 404 for non-numeric id", async () => {
    const request = createAuthRequest(
      "http://localhost:3000/api/annotations/abc",
      TEST_USER_ID,
      "DELETE",
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(response.status).toBe(404);
  });

  it("emits annotation.deleted audit event", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const request = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    await deleteDELETE(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });

    // Wait for the fire-and-forget audit event
    await new Promise((resolve) => setTimeout(resolve, 200));

    const events = await db
      .select()
      .from(auditEvents)
      .where(
        sql`${auditEvents.ownerId} = ${TEST_USER_ID} AND ${auditEvents.eventType} = 'annotation.deleted'`,
      );

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].resourceType).toBe("annotation");
    const detail = events[0].resourceDetail as Record<string, unknown>;
    expect(detail.annotation_id).toBe(annotation.id);
  });
});

// ─── Full CRUD Lifecycle ─────────────────────────────────────────────────────

describe("Full CRUD lifecycle", () => {
  it("create → update → delete lifecycle", async () => {
    // 1. Create
    const annotation = await createAnnotation(TEST_USER_ID);
    expect(annotation.id).toBeDefined();
    expect(annotation.label).toBe("Late dinner");

    // 2. Update
    const updateReq = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "PATCH",
      { label: "Early dinner", note: "Light salad" },
    );
    const updateRes = await updatePATCH(updateReq, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.data.label).toBe("Early dinner");
    expect(updateBody.data.note).toBe("Light salad");

    // 3. Verify updated in GET
    const getReq = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    const getRes = await listGET(getReq);
    const getBody = await getRes.json();
    expect(getBody.data.annotations).toHaveLength(1);
    expect(getBody.data.annotations[0].label).toBe("Early dinner");

    // 4. Delete
    const deleteReq = createAuthRequest(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      TEST_USER_ID,
      "DELETE",
    );
    const deleteRes = await deleteDELETE(deleteReq, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(deleteRes.status).toBe(200);

    // 5. Verify deleted
    const getReq2 = createAuthRequest(
      "http://localhost:3000/api/annotations?start=2026-03-28&end=2026-03-28",
      TEST_USER_ID,
    );
    const getRes2 = await listGET(getReq2);
    const getBody2 = await getRes2.json();
    expect(getBody2.data.annotations).toEqual([]);
  });
});

// ─── Viewer write access denied ──────────────────────────────────────────────

describe("Viewer access control", () => {
  it("viewer cannot POST annotations", async () => {
    const headers = new Headers({
      "x-request-context": JSON.stringify({
        role: "viewer",
        userId: TEST_USER_ID,
        grantId: TEST_GRANT_ID,
        permissions: {
          allowedMetrics: ["glucose"],
          dataStart: "2026-01-01",
          dataEnd: "2026-12-31",
        },
        authMethod: "viewer_jwt",
      }),
      "Content-Type": "application/json",
    });
    const request = new Request("http://localhost:3000/api/annotations", {
      method: "POST",
      headers,
      body: JSON.stringify(validAnnotationBody()),
    });
    const response = await createPOST(request);
    expect(response.status).toBe(401);
  });

  it("viewer cannot PATCH annotations", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const headers = new Headers({
      "x-request-context": JSON.stringify({
        role: "viewer",
        userId: TEST_USER_ID,
        grantId: TEST_GRANT_ID,
        permissions: {
          allowedMetrics: ["glucose"],
          dataStart: "2026-01-01",
          dataEnd: "2026-12-31",
        },
        authMethod: "viewer_jwt",
      }),
      "Content-Type": "application/json",
    });
    const request = new Request(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ label: "Hacked" }),
      },
    );
    const response = await updatePATCH(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(401);
  });

  it("viewer cannot DELETE annotations", async () => {
    const annotation = await createAnnotation(TEST_USER_ID);

    const headers = new Headers({
      "x-request-context": JSON.stringify({
        role: "viewer",
        userId: TEST_USER_ID,
        grantId: TEST_GRANT_ID,
        permissions: {
          allowedMetrics: ["glucose"],
          dataStart: "2026-01-01",
          dataEnd: "2026-12-31",
        },
        authMethod: "viewer_jwt",
      }),
      "Content-Type": "application/json",
    });
    const request = new Request(
      `http://localhost:3000/api/annotations/${annotation.id}`,
      {
        method: "DELETE",
        headers,
      },
    );
    const response = await deleteDELETE(request, {
      params: Promise.resolve({ id: String(annotation.id) }),
    });
    expect(response.status).toBe(401);
  });
});
