import { SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { RequestContext } from "@/lib/auth/request-context";

/**
 * Tests for the unified auth middleware.
 *
 * We test the middleware function directly by constructing NextRequest objects
 * and verifying the response (redirects, 401s, context header).
 *
 * Note: We use dynamic imports because the middleware module reads env vars,
 * and we need to set them before import.
 */

const REQUEST_CONTEXT_HEADER = "x-request-context";

let middleware: typeof import("../middleware").middleware;

// Secrets for tests
const MOCK_AUTH_SECRET = "test-middleware-auth-secret";
const VIEWER_JWT_SECRET = "test-middleware-viewer-secret";
const VIEWER_JWT_SECRET_PREVIOUS = "test-middleware-viewer-secret-prev";

beforeAll(async () => {
  process.env.MOCK_AUTH_SECRET = MOCK_AUTH_SECRET;
  process.env.VIEWER_JWT_SECRET = VIEWER_JWT_SECRET;
  process.env.VIEWER_JWT_SECRET_PREVIOUS = VIEWER_JWT_SECRET_PREVIOUS;

  const mod = await import("../middleware");
  middleware = mod.middleware;
});

// ─── Helper: create a signed owner session JWT ──────────────────────────────

async function createOwnerSessionJwt(userId: string): Promise<string> {
  const secret = new TextEncoder().encode(MOCK_AUTH_SECRET);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("totus-mock-auth")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

// ─── Helper: create a signed viewer JWT ─────────────────────────────────────

async function createViewerJwt(
  claims: {
    grantId: string;
    ownerId: string;
    allowedMetrics: string[];
    dataStart: string;
    dataEnd: string;
  },
  secretStr: string = VIEWER_JWT_SECRET,
): Promise<string> {
  const secret = new TextEncoder().encode(secretStr);
  return new SignJWT({
    grantId: claims.grantId,
    ownerId: claims.ownerId,
    allowedMetrics: claims.allowedMetrics,
    dataStart: claims.dataStart,
    dataEnd: claims.dataEnd,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("4h")
    .setJti("test-jti")
    .sign(secret);
}

// ─── Helper: create a NextRequest-like object ───────────────────────────────

function createNextRequest(
  path: string,
  cookies: Record<string, string> = {},
): {
  nextUrl: { pathname: string; searchParams: URLSearchParams };
  url: string;
  headers: Headers;
  cookies: {
    get: (name: string) => { value: string } | undefined;
  };
} {
  const url = new URL(path, "http://localhost:3000");
  return {
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    url: url.toString(),
    headers: new Headers(),
    cookies: {
      get: (name: string) => {
        const val = cookies[name];
        return val ? { value: val } : undefined;
      },
    },
  };
}

// ─── Helper: extract context from response ──────────────────────────────────

function getContextFromResponse(response: Response): RequestContext | null {
  // The context is set on the request headers via NextResponse.next(),
  // but in our testing we can check the response's x-middleware-request headers
  // Next.js middleware stores rewritten request headers as x-middleware-request-* on the response.
  // For simpler testing, we parse context from the middleware's behavior.

  // Actually, the middleware calls NextResponse.next({ request: { headers } }) which
  // sets x-middleware-request-* headers on the response for downstream consumption.
  const headerName = `x-middleware-request-${REQUEST_CONTEXT_HEADER}`;
  const raw = response.headers.get(headerName);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RequestContext;
  } catch {
    return null;
  }
}

// ─── Owner auth ─────────────────────────────────────────────────────────────

describe("middleware — owner auth", () => {
  it("produces role=owner context for valid __session cookie", async () => {
    const token = await createOwnerSessionJwt("user_owner1");
    const req = createNextRequest("/dashboard", { __session: token });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Should not redirect (owner is authenticated)
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);

    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("owner");
    expect(ctx!.userId).toBe("user_owner1");
    expect(ctx!.permissions).toBe("full");
    expect(ctx!.authMethod).toBe("session");
  });

  it("treats invalid __session cookie as unauthenticated", async () => {
    const req = createNextRequest("/api/health-data", {
      __session: "invalid.jwt.token",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Should return 401 for an API route
    expect(response.status).toBe(401);
  });

  it("treats expired __session cookie as unauthenticated", async () => {
    const secret = new TextEncoder().encode(MOCK_AUTH_SECRET);
    const expiredToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_expired")
      .setIssuer("totus-mock-auth")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 86400)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);

    const req = createNextRequest("/dashboard", { __session: expiredToken });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Should redirect to /sign-in
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });
});

// ─── Viewer auth ────────────────────────────────────────────────────────────

describe("middleware — viewer auth", () => {
  it("produces role=viewer context for valid totus_viewer cookie", async () => {
    const viewerJwt = await createViewerJwt({
      grantId: "grant_abc",
      ownerId: "user_owner2",
      allowedMetrics: ["sleep_score", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
    const req = createNextRequest("/api/viewer/data", {
      totus_viewer: viewerJwt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("viewer");
    expect(ctx!.grantId).toBe("grant_abc");
    expect(ctx!.userId).toBe("user_owner2");
    expect(ctx!.authMethod).toBe("viewer_jwt");
    expect(ctx!.permissions).toEqual({
      allowedMetrics: ["sleep_score", "hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
  });

  it("accepts viewer JWT signed with previous secret (rotation)", async () => {
    const viewerJwt = await createViewerJwt(
      {
        grantId: "grant_rotated",
        ownerId: "user_rotated",
        allowedMetrics: ["rhr"],
        dataStart: "2025-03-01",
        dataEnd: "2025-09-01",
      },
      VIEWER_JWT_SECRET_PREVIOUS,
    );
    const req = createNextRequest("/api/viewer/data", {
      totus_viewer: viewerJwt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("viewer");
    expect(ctx!.grantId).toBe("grant_rotated");
  });

  it("treats invalid totus_viewer cookie as unauthenticated", async () => {
    const req = createNextRequest("/api/viewer/data", {
      totus_viewer: "invalid.jwt.here",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // viewer/data requires auth, so should be 401
    expect(response.status).toBe(401);
  });

  it("prefers __session over totus_viewer when both present", async () => {
    const ownerToken = await createOwnerSessionJwt("user_priority");
    const viewerJwt = await createViewerJwt({
      grantId: "grant_secondary",
      ownerId: "user_other",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });

    const req = createNextRequest("/dashboard", {
      __session: ownerToken,
      totus_viewer: viewerJwt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("owner");
    expect(ctx!.userId).toBe("user_priority");
  });
});

// ─── Unauthenticated ────────────────────────────────────────────────────────

describe("middleware — unauthenticated", () => {
  it("produces role=unauthenticated when no cookies present", async () => {
    const req = createNextRequest("/sign-in");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("unauthenticated");
    expect(ctx!.authMethod).toBe("none");
  });
});

// ─── Route protection ───────────────────────────────────────────────────────

describe("middleware — route protection", () => {
  it("/dashboard redirects to /sign-in when unauthenticated", async () => {
    const req = createNextRequest("/dashboard");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("/dashboard/settings redirects to /sign-in when unauthenticated", async () => {
    const req = createNextRequest("/dashboard/settings");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("/dashboard/share redirects to /sign-in when unauthenticated", async () => {
    const req = createNextRequest("/dashboard/share");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("/dashboard/audit redirects to /sign-in when unauthenticated", async () => {
    const req = createNextRequest("/dashboard/audit");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/sign-in");
  });

  it("/api/health-data returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/health-data");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("/api/shares returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/shares");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("/api/connections returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/connections");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("/api/audit returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/audit");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("/api/user/profile returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/user/profile");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("/api/viewer/data returns 401 when unauthenticated", async () => {
    const req = createNextRequest("/api/viewer/data");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });
});

// ─── Public routes ──────────────────────────────────────────────────────────

describe("middleware — public routes", () => {
  it("/sign-in is accessible without auth", async () => {
    const req = createNextRequest("/sign-in");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Should not redirect or return 401
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(302);
    expect(response.status).not.toBe(401);
  });

  it("/sign-up is accessible without auth", async () => {
    const req = createNextRequest("/sign-up");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });

  it("/api/auth/sign-in is accessible without auth", async () => {
    const req = createNextRequest("/api/auth/sign-in");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
  });

  it("/api/auth/sign-up is accessible without auth", async () => {
    const req = createNextRequest("/api/auth/sign-up");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
  });

  it("/api/auth/sign-out is accessible without auth", async () => {
    const req = createNextRequest("/api/auth/sign-out");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
  });

  it("/api/viewer/validate is accessible without auth", async () => {
    const req = createNextRequest("/api/viewer/validate");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
  });

  it("/api/health is accessible without auth", async () => {
    const req = createNextRequest("/api/health");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
  });

  it("/ (home page) is accessible without auth", async () => {
    const req = createNextRequest("/");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });
});

// ─── Security headers ───────────────────────────────────────────────────────

describe("middleware — security headers", () => {
  it("sets X-Content-Type-Options header", async () => {
    const req = createNextRequest("/");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-Frame-Options header", async () => {
    const req = createNextRequest("/");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Strict-Transport-Security header", async () => {
    const req = createNextRequest("/");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age=63072000",
    );
  });

  it("sets Content-Security-Policy header", async () => {
    const req = createNextRequest("/");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'self'",
    );
  });

  it("includes security headers on 401 responses", async () => {
    const req = createNextRequest("/api/health-data");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("includes security headers on redirect responses", async () => {
    const req = createNextRequest("/dashboard");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(307);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

// ─── Auth with dashboard ────────────────────────────────────────────────────

describe("middleware — authenticated dashboard access", () => {
  it("allows owner to access /dashboard", async () => {
    const token = await createOwnerSessionJwt("user_dash");
    const req = createNextRequest("/dashboard", { __session: token });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });

  it("allows owner to access /dashboard/settings", async () => {
    const token = await createOwnerSessionJwt("user_settings");
    const req = createNextRequest("/dashboard/settings", {
      __session: token,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });

  it("allows owner to access /api/health-data", async () => {
    const token = await createOwnerSessionJwt("user_api");
    const req = createNextRequest("/api/health-data", {
      __session: token,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
    const ctx = getContextFromResponse(response);
    expect(ctx!.role).toBe("owner");
  });

  it("allows viewer to access /api/viewer/data", async () => {
    const viewerJwt = await createViewerJwt({
      grantId: "grant_data",
      ownerId: "user_data_owner",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
    const req = createNextRequest("/api/viewer/data", {
      totus_viewer: viewerJwt,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
    const ctx = getContextFromResponse(response);
    expect(ctx!.role).toBe("viewer");
  });
});

// ─── grant_token passthrough for view endpoints ─────────────────────────────

describe("middleware — grant_token passthrough for /api/views/*", () => {
  it("allows unauthenticated request to /api/views/night with grant_token", async () => {
    const req = createNextRequest(
      "/api/views/night?date=2026-03-28&grant_token=some-token",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Should NOT return 401 — the request should pass through to the route handler
    expect(response.status).not.toBe(401);

    // The context should be unauthenticated (route handler will resolve grant_token)
    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("unauthenticated");
  });

  it("allows unauthenticated request to /api/views/recovery with grant_token", async () => {
    const req = createNextRequest(
      "/api/views/recovery?start=2026-03-24&end=2026-03-28&grant_token=some-token",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("unauthenticated");
  });

  it("allows unauthenticated request to /api/views/trend with grant_token", async () => {
    const req = createNextRequest(
      "/api/views/trend?start=2026-02-27&end=2026-03-28&metrics=rhr,hrv&grant_token=some-token",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).not.toBe(401);
    const ctx = getContextFromResponse(response);
    expect(ctx).not.toBeNull();
    expect(ctx!.role).toBe("unauthenticated");
  });

  it("still returns 401 for /api/views/night WITHOUT grant_token", async () => {
    const req = createNextRequest("/api/views/night?date=2026-03-28");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Without grant_token, unauthenticated requests should get 401
    expect(response.status).toBe(401);
  });

  it("still returns 401 for /api/views/recovery WITHOUT grant_token", async () => {
    const req = createNextRequest(
      "/api/views/recovery?start=2026-03-24&end=2026-03-28",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("still returns 401 for /api/views/trend WITHOUT grant_token", async () => {
    const req = createNextRequest(
      "/api/views/trend?start=2026-02-27&end=2026-03-28&metrics=rhr,hrv",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });

  it("does NOT allow grant_token passthrough for non-view routes", async () => {
    const req = createNextRequest("/api/health-data?grant_token=some-token");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    // Non-view routes should still require standard auth
    expect(response.status).toBe(401);
  });

  it("does NOT allow grant_token passthrough for /api/annotations", async () => {
    const req = createNextRequest(
      "/api/annotations?start=2026-03-01&end=2026-03-28&grant_token=some-token",
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await middleware(req as any);

    expect(response.status).toBe(401);
  });
});
