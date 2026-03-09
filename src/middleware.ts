import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import type { RequestContext } from "@/lib/auth/request-context";

/**
 * Unified auth middleware for Totus.
 *
 * Checks auth in this order:
 * 1. __session cookie (owner auth via mock/Clerk) -> role='owner'
 * 2. totus_viewer cookie (viewer JWT) -> role='viewer'
 * 3. No auth -> unauthenticated
 *
 * Produces a RequestContext object stored in the x-request-context header.
 *
 * Route protection:
 * - /dashboard/* routes redirect to /sign-in if unauthenticated
 * - /api/* owner-only routes return 401 if unauthenticated
 * - Public routes are always accessible
 */

const SESSION_COOKIE = "__session";
const VIEWER_COOKIE = "totus_viewer";
const REQUEST_CONTEXT_HEADER = "x-request-context";
const JWT_ISSUER = "totus-mock-auth";

// ─── Public routes (no auth required) ───────────────────────────────────────

const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-up",
  "/api/auth/sign-in",
  "/api/auth/sign-up",
  "/api/auth/sign-out",
  "/api/auth/session",
  "/api/viewer/validate",
  "/api/health",
  "/api/connections/oura/callback",
];

/**
 * Check if a path is public (no auth required).
 */
function isPublicPath(pathname: string): boolean {
  // Exact match or prefix match for public paths
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Check if a path is a dashboard route (requires owner auth, redirect if not).
 */
function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

/**
 * Owner-only API routes (return 401 if unauthenticated).
 * These are API routes that require an owner session specifically.
 */
function isOwnerOnlyApiPath(pathname: string): boolean {
  // All /api/* routes are owner-only by default, unless they are:
  // - Public paths (handled above)
  // - Viewer-accessible paths (/api/viewer/data)
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  // Viewer-accessible API routes
  const viewerAccessiblePaths = ["/api/viewer/data"];
  if (
    viewerAccessiblePaths.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    )
  ) {
    return false;
  }

  return true;
}

// ─── Secret helpers ─────────────────────────────────────────────────────────

function getSessionSecret(): Uint8Array | null {
  const secret = process.env.MOCK_AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function getViewerSecret(): Uint8Array | null {
  const secret = process.env.VIEWER_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

function getViewerSecretPrevious(): Uint8Array | null {
  const secret = process.env.VIEWER_JWT_SECRET_PREVIOUS;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

// ─── Auth verification ──────────────────────────────────────────────────────

/**
 * Verify the owner session cookie and extract userId.
 */
async function verifyOwnerSession(
  sessionToken: string,
): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(sessionToken, secret, {
      issuer: JWT_ISSUER,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

interface ViewerJwtClaims {
  grantId: string;
  ownerId: string;
  allowedMetrics: string[];
  dataStart: string;
  dataEnd: string;
}

/**
 * Verify the viewer JWT cookie, trying current secret first, then previous.
 */
async function verifyViewerToken(
  token: string,
): Promise<ViewerJwtClaims | null> {
  // Try current secret
  const currentSecret = getViewerSecret();
  if (currentSecret) {
    try {
      const { payload } = await jwtVerify(token, currentSecret);
      return extractViewerClaims(payload);
    } catch {
      // fall through
    }
  }

  // Try previous secret (dual-secret rotation)
  const previousSecret = getViewerSecretPrevious();
  if (previousSecret) {
    try {
      const { payload } = await jwtVerify(token, previousSecret);
      return extractViewerClaims(payload);
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Extract viewer claims from a verified JWT payload.
 */
function extractViewerClaims(
  payload: Record<string, unknown>,
): ViewerJwtClaims | null {
  const grantId = payload.grantId as string | undefined;
  const ownerId = payload.ownerId as string | undefined;
  const allowedMetrics = payload.allowedMetrics as string[] | undefined;
  const dataStart = payload.dataStart as string | undefined;
  const dataEnd = payload.dataEnd as string | undefined;

  if (!grantId || !ownerId || !allowedMetrics || !dataStart || !dataEnd) {
    return null;
  }

  return { grantId, ownerId, allowedMetrics, dataStart, dataEnd };
}

// ─── Security headers ───────────────────────────────────────────────────────

/**
 * Add security headers to the response.
 */
function addSecurityHeaders(response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;",
  );
}

// ─── Middleware ──────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Skip static files and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // ── Step 1: Determine auth context ────────────────────────────────────

  let context: RequestContext;

  // 1. Check __session cookie (owner auth)
  const sessionCookie = request.cookies.get(SESSION_COOKIE);
  if (sessionCookie?.value) {
    const userId = await verifyOwnerSession(sessionCookie.value);
    if (userId) {
      context = {
        role: "owner",
        userId,
        permissions: "full",
        authMethod: "session",
      };
    } else {
      // Invalid session cookie — treat as unauthenticated
      context = {
        role: "unauthenticated",
        permissions: "full",
        authMethod: "none",
      };
    }
  }
  // 2. Check totus_viewer cookie (viewer auth)
  else {
    const viewerCookie = request.cookies.get(VIEWER_COOKIE);
    if (viewerCookie?.value) {
      const claims = await verifyViewerToken(viewerCookie.value);
      if (claims) {
        context = {
          role: "viewer",
          userId: claims.ownerId,
          grantId: claims.grantId,
          permissions: {
            allowedMetrics: claims.allowedMetrics,
            dataStart: claims.dataStart,
            dataEnd: claims.dataEnd,
          },
          authMethod: "viewer_jwt",
        };
      } else {
        // Invalid viewer cookie — treat as unauthenticated
        context = {
          role: "unauthenticated",
          permissions: "full",
          authMethod: "none",
        };
      }
    }
    // 3. No auth
    else {
      context = {
        role: "unauthenticated",
        permissions: "full",
        authMethod: "none",
      };
    }
  }

  // ── Step 2: Route protection ──────────────────────────────────────────

  const isUnauthenticated = context.role === "unauthenticated";

  // Auth pages: redirect to /dashboard if already authenticated as owner
  if (
    (pathname.startsWith("/sign-in") || pathname.startsWith("/sign-up")) &&
    context.role === "owner" &&
    context.userId
  ) {
    const dashboardUrl = new URL("/dashboard", request.url);
    const response = NextResponse.redirect(dashboardUrl);
    addSecurityHeaders(response);
    return response;
  }

  // Dashboard routes: redirect to /sign-in if unauthenticated
  if (isDashboardPath(pathname) && isUnauthenticated) {
    const signInUrl = new URL("/sign-in", request.url);
    const response = NextResponse.redirect(signInUrl);
    addSecurityHeaders(response);
    return response;
  }

  // Owner-only API routes: return 401 if unauthenticated
  // (but not for public paths — those are always accessible)
  if (
    isOwnerOnlyApiPath(pathname) &&
    !isPublicPath(pathname) &&
    isUnauthenticated
  ) {
    const response = NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required",
        },
      },
      { status: 401 },
    );
    addSecurityHeaders(response);
    return response;
  }

  // Viewer-only API routes: return 401 if neither owner nor viewer
  if (pathname.startsWith("/api/viewer/data") && isUnauthenticated) {
    const response = NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication is required",
        },
      },
      { status: 401 },
    );
    addSecurityHeaders(response);
    return response;
  }

  // ── Step 3: Attach context to request headers ─────────────────────────

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_CONTEXT_HEADER, JSON.stringify(context));

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // ── Step 4: Add security headers ──────────────────────────────────────

  addSecurityHeaders(response);

  return response;
}

/**
 * Matcher configuration: run middleware on all routes except static assets.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
