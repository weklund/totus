import { describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/auth/sign-out route handler.
 *
 * Tests: cookie clearing, successful response.
 */

// Mock cookies store
const mockCookieStore = new Map<string, { value: string; maxAge?: number }>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const entry = mockCookieStore.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      mockCookieStore.set(name, { value, maxAge: options?.maxAge });
    },
  })),
}));

describe("POST /api/auth/sign-out", () => {
  it("clears the __session cookie by setting maxAge=0", async () => {
    // Pre-set a session cookie
    mockCookieStore.set("__session", { value: "some-jwt-token" });

    const { POST } = await import("../sign-out/route");

    const response = await POST();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.data.success).toBe(true);

    // The cookie should be set with empty value
    const cookie = mockCookieStore.get("__session");
    expect(cookie).toBeDefined();
    expect(cookie!.value).toBe("");
    expect(cookie!.maxAge).toBe(0);
  });

  it("returns 200 even when no session exists", async () => {
    mockCookieStore.clear();

    const { POST } = await import("../sign-out/route");

    const response = await POST();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.data.success).toBe(true);
  });
});
