import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { clerkMiddleware } from "@clerk/nextjs/server";
import type { RequestContext } from "@/lib/auth/request-context";

/**
 * Unified auth middleware for Totus.
 *
 * When NEXT_PUBLIC_USE_MOCK_AUTH=true, uses mock JWT verification.
 * When false, uses Clerk's clerkMiddleware() for session verification.
 *
 * Checks auth in this order:
 * 1. Authorization: Bearer tot_live_... header (API key auth) -> role='owner'
 * 2. __session cookie (owner auth via mock/Clerk) -> role='owner'
 * 3. totus_viewer cookie (viewer JWT) -> role='viewer'
 * 4. No auth -> unauthenticated
 *
 * Produces a RequestContext object stored in the x-request-context header.
 *
 * Route protection:
 * - /dashboard/* routes redirect to /sign-in if unauthenticated
 * - /api/* owner-only routes return 401 if unauthenticated
 * - Public routes are always accessible
 */

const useMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

const SESSION_COOKIE = "__session";
const VIEWER_COOKIE = "totus_viewer";
const REQUEST_CONTEXT_HEADER = "x-request-context";
const API_KEY_HEADER = "x-api-key-token";
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
  "/api/inngest",
];

/**
 * Pattern for generic provider OAuth callback paths.
 * Matches /api/connections/{provider}/callback
 */
const PROVIDER_CALLBACK_PATTERN = /^\/api\/connections\/[a-z]+\/callback$/;

/**
 * Check if a path is public (no auth required).
 */
function isPublicPath(pathname: string): boolean {
  // Exact match or prefix match for public paths
  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return true;
  }

  // Generic provider OAuth callbacks are public (no auth required)
  if (PROVIDER_CALLBACK_PATTERN.test(pathname)) {
    return true;
  }

  return false;
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

/**
 * Check if a request is a view endpoint with a grant_token query parameter.
 * These requests skip middleware auth enforcement because the route handler
 * validates the grant_token and establishes viewer context directly.
 */
function isViewEndpointWithGrantToken(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;
  return pathname.startsWith("/api/views/") && searchParams.has("grant_token");
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
 * Verify the mock owner session cookie and extract userId.
 */
async function verifyMockOwnerSession(
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
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  // T-11: CSP — tightened from the original unsafe-eval but permissive enough
  // for Next.js and Clerk to function. Next.js requires 'unsafe-inline' for
  // inline scripts without nonce propagation. 'unsafe-eval' is NOT included.
  // connect-src whitelists Clerk (*.clerk.com, *.clerk.accounts.dev, *.clerk.dev)
  // and Inngest for background job communication.
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.dev https://*.clerk.com https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.dev https://*.clerk.com https://*.inngest.com",
      "worker-src 'self' blob:",
      "frame-src 'self' https://*.clerk.accounts.dev https://*.clerk.dev https://*.clerk.com https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://*.clerk.accounts.dev https://*.clerk.dev https://*.clerk.com",
    ].join("; "),
  );
}

// ─── Shared middleware logic ─────────────────────────────────────────────────

/**
 * Core middleware logic shared between mock and Clerk modes.
 *
 * @param request - The incoming request
 * @param ownerUserId - The authenticated owner userId (from mock JWT or Clerk), or null
 * @returns The middleware response
 */
async function coreMiddleware(
  request: NextRequest,
  ownerUserId: string | null,
): Promise<NextResponse> {
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
  let apiKeyToken: string | null = null;

  // 1. Check Authorization: Bearer header (API key auth)
  // The Bearer token is passed through to route handlers for DB validation.
  // Middleware can't do DB lookups (Edge Runtime doesn't support node-postgres).
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (bearerToken && bearerToken.startsWith("tot_live_")) {
    // Mark as "pending API key" — route handlers will validate via DB
    apiKeyToken = bearerToken;
    context = {
      role: "owner",
      userId: "__api_key_pending__",
      permissions: "full",
      authMethod: "api_key",
    };
  }
  // 2. Check owner session (userId already resolved by caller)
  else if (ownerUserId) {
    context = {
      role: "owner",
      userId: ownerUserId,
      permissions: "full",
      authMethod: "session",
    };
  }
  // 3. Check totus_viewer cookie (viewer auth)
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
    // 4. No auth
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
  // View endpoints with grant_token pass through — the route handler validates the token
  if (
    isOwnerOnlyApiPath(pathname) &&
    !isPublicPath(pathname) &&
    !isViewEndpointWithGrantToken(request) &&
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
  // Defense-in-depth: strip any externally-supplied context headers before setting
  // our middleware-verified values. Prevents header injection attacks (T-01).
  requestHeaders.delete(REQUEST_CONTEXT_HEADER);
  requestHeaders.delete(API_KEY_HEADER);
  requestHeaders.set(REQUEST_CONTEXT_HEADER, JSON.stringify(context));

  // Pass raw API key token through for route-level DB validation
  if (apiKeyToken) {
    requestHeaders.set(API_KEY_HEADER, apiKeyToken);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // ── Step 4: Add security headers ──────────────────────────────────────

  addSecurityHeaders(response);

  return response;
}

// ─── Mock auth middleware ────────────────────────────────────────────────────

/**
 * Mock auth middleware: verifies the __session cookie with jose and
 * delegates to the core middleware logic.
 */
async function mockMiddleware(request: NextRequest): Promise<NextResponse> {
  let ownerUserId: string | null = null;

  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (sessionCookie) {
    ownerUserId = await verifyMockOwnerSession(sessionCookie);
  }

  return coreMiddleware(request, ownerUserId);
}

// ─── Clerk auth middleware ──────────────────────────────────────────────────

/**
 * Clerk auth middleware: uses Clerk's clerkMiddleware() to verify
 * the session, then delegates to the core middleware logic.
 *
 * Clerk handles token verification internally. We extract the userId
 * from the auth object and pass it to coreMiddleware, which handles
 * API key auth, viewer JWT auth, route protection, and security headers.
 */
const clerkMw = clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  return coreMiddleware(request, userId);
});

// ─── Export ─────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (useMockAuth) {
    return mockMiddleware(request);
  }
  // clerkMiddleware returns NextMiddleware; invoke it and coerce the result.
  // Our coreMiddleware always returns a NextResponse, so the result is always
  // a NextResponse, but clerkMiddleware's type signature is wider.
  const result = await clerkMw(request, {} as never);
  return (result as NextResponse) ?? NextResponse.next();
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
