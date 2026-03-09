import { eq } from "drizzle-orm";
import type { Pool as PoolType } from "pg";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Tests for POST /api/auth/sign-in route handler.
 *
 * Mocks next/headers cookies() since we're testing outside Next.js runtime.
 */

// Mock cookies store
const mockCookieStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieStore.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      mockCookieStore.set(name, value);
    },
  })),
}));

let pool: PoolType;
let POST: typeof import("../sign-in/route").POST;
let db: ReturnType<typeof import("drizzle-orm/node-postgres").drizzle>;
let users: typeof import("@/db/schema").users;
let verifySessionToken: typeof import("@/lib/auth/mock-auth").verifySessionToken;

beforeAll(async () => {
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";

  const dbModule = await import("@/db");
  pool = dbModule.pool;
  db = dbModule.db;

  const schema = await import("@/db/schema");
  users = schema.users;

  const authModule = await import("@/lib/auth/mock-auth");
  verifySessionToken = authModule.verifySessionToken;

  const routeModule = await import("../sign-in/route");
  POST = routeModule.POST;
});

afterEach(async () => {
  mockCookieStore.clear();
  // Clean up test users
  await db.delete(users).where(eq(users.id, "mock_test_example_com"));
  await db.delete(users).where(eq(users.id, "mock_existing_example_com"));
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/auth/sign-in", () => {
  it("returns 400 for missing email", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid email format", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "test123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing password", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates user and returns 200 for valid credentials (mock auto-create)", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "test123",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.data.userId).toBe("mock_test_example_com");
    expect(data.data.email).toBe("test@example.com");
  });

  it("returns 200 for existing user without creating duplicate", async () => {
    // Create existing user first
    await db.insert(users).values({
      id: "mock_existing_example_com",
      displayName: "Existing User",
      kmsKeyArn: "local-dev-key",
    });

    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "existing@example.com",
        password: "test123",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.data.userId).toBe("mock_existing_example_com");
  });

  it("sets a valid __session cookie on successful sign-in", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "test123",
      }),
    });

    await POST(request);

    // The mock cookie store should have __session
    const sessionCookie = mockCookieStore.get("__session");
    expect(sessionCookie).toBeDefined();
    expect(typeof sessionCookie).toBe("string");

    // Verify the JWT contains the correct userId
    const userId = await verifySessionToken(sessionCookie!);
    expect(userId).toBe("mock_test_example_com");
  });
});
