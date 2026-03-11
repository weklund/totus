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
 * Tests for POST /api/auth/sign-up route handler.
 *
 * Tests: user creation, validation errors, conflict on duplicate,
 * custom displayName, session cookie issuance.
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
let POST: typeof import("../sign-up/route").POST;
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

  const routeModule = await import("../sign-up/route");
  POST = routeModule.POST;
});

afterEach(async () => {
  mockCookieStore.clear();
  // Clean up test users
  await db.delete(users).where(eq(users.id, "mock_signup_example_com"));
  await db.delete(users).where(eq(users.id, "mock_custom_example_com"));
});

afterAll(async () => {
  await pool.end();
});

describe("POST /api/auth/sign-up", () => {
  it("returns 400 for missing email", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
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
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bad-email", password: "test123" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing password", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "signup@example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("creates user and returns 201 with user data", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "signup@example.com",
        password: "test123",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.data.userId).toBe("mock_signup_example_com");
    expect(data.data.email).toBe("signup@example.com");
    expect(data.data.displayName).toBe("signup");
  });

  it("uses custom displayName when provided", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "custom@example.com",
        password: "test123",
        displayName: "Custom Name",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.data.displayName).toBe("Custom Name");

    // Verify in database
    const dbUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, "mock_custom_example_com"));
    expect(dbUsers[0].displayName).toBe("Custom Name");
  });

  it("returns 409 for duplicate email", async () => {
    // Create user first
    await db.insert(users).values({
      id: "mock_signup_example_com",
      displayName: "Existing",
      kmsKeyArn: "local-dev-key",
    });

    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "signup@example.com",
        password: "test123",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(409);

    const data = await response.json();
    expect(data.error.code).toBe("CONFLICT");
  });

  it("sets a valid __session cookie on successful sign-up", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "signup@example.com",
        password: "test123",
      }),
    });

    await POST(request);

    const sessionCookie = mockCookieStore.get("__session");
    expect(sessionCookie).toBeDefined();

    // Verify the JWT
    const userId = await verifySessionToken(sessionCookie!);
    expect(userId).toBe("mock_signup_example_com");
  });

  it("creates user record in database", async () => {
    const request = new Request("http://localhost:3000/api/auth/sign-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "signup@example.com",
        password: "test123",
      }),
    });

    await POST(request);

    const dbUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, "mock_signup_example_com"));
    expect(dbUsers).toHaveLength(1);
    expect(dbUsers[0].id).toBe("mock_signup_example_com");
    expect(dbUsers[0].displayName).toBe("signup");
    expect(dbUsers[0].kmsKeyArn).toBe("local-dev-key");
  });
});
