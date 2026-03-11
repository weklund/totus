import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";

// Set up env before importing middleware
const MOCK_SECRET = "test-secret-for-mock-auth-at-least-32-chars-long";
process.env.MOCK_AUTH_SECRET = MOCK_SECRET;
process.env.VIEWER_JWT_SECRET = "viewer-secret-for-jwt-test-at-least-32-chars";

import { middleware } from "@/middleware";

async function createSessionToken(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(MOCK_SECRET);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("totus-mock-auth")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

function makeRequest(
  path: string,
  cookies: Record<string, string> = {},
): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const request = new NextRequest(url);
  for (const [name, value] of Object.entries(cookies)) {
    request.cookies.set(name, value);
  }
  return request;
}

describe("Auth redirect middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects authenticated user from /sign-in to /dashboard", async () => {
    const token = await createSessionToken("user_123");
    const request = makeRequest("/sign-in", { __session: token });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard");
  });

  it("redirects authenticated user from /sign-up to /dashboard", async () => {
    const token = await createSessionToken("user_123");
    const request = makeRequest("/sign-up", { __session: token });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard");
  });

  it("allows unauthenticated user to access /sign-in", async () => {
    const request = makeRequest("/sign-in");

    const response = await middleware(request);

    // Should not redirect (status 200 or next)
    expect(response.status).toBe(200);
  });

  it("allows unauthenticated user to access /sign-up", async () => {
    const request = makeRequest("/sign-up");

    const response = await middleware(request);

    expect(response.status).toBe(200);
  });

  it("redirects unauthenticated user from /dashboard to /sign-in", async () => {
    const request = makeRequest("/dashboard");

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("redirects authenticated user from /sign-in/subpath to /dashboard", async () => {
    const token = await createSessionToken("user_123");
    const request = makeRequest("/sign-in/some-path", { __session: token });

    const response = await middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/dashboard");
  });
});
