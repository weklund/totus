/**
 * API key resolution for route handlers.
 *
 * The middleware passes the raw Bearer token through in the x-api-key-token header
 * (since middleware runs in Edge Runtime and can't do DB lookups). Route handlers
 * call resolveApiKeyAuth() to validate the token against the database.
 *
 * This function:
 * 1. Parses the API key format
 * 2. Looks up by short_token in the api_keys table
 * 3. Verifies the long_token hash
 * 4. Checks expiration and revocation
 * 5. Updates last_used_at (async, non-blocking)
 * 6. Returns a fully-resolved RequestContext
 */

import { db } from "@/db";
import { apiKeys, auditEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseApiKey, verifyLongToken } from "./api-keys";
import type { RequestContext } from "./request-context";
import {
  apiKeyGeneralRateLimiter,
  createRateLimitResponse,
} from "@/lib/api/rate-limit";

const API_KEY_HEADER = "x-api-key-token";

/**
 * Resolve API key authentication from request headers.
 *
 * If the request has a pending API key auth (authMethod='api_key' with
 * userId='__api_key_pending__'), validates the token from x-api-key-token header.
 *
 * Returns the resolved context (with real userId, scopes, etc.) or null if invalid.
 */
export async function resolveApiKeyAuth(
  request: Request,
  ctx: RequestContext,
): Promise<RequestContext | null> {
  // Only resolve if this is a pending API key auth
  if (ctx.authMethod !== "api_key" || ctx.userId !== "__api_key_pending__") {
    return ctx;
  }

  const rawToken = request.headers.get(API_KEY_HEADER);
  if (!rawToken) return null;

  const parsed = parseApiKey(rawToken);
  if (!parsed) return null;

  try {
    // Look up by short_token, only non-revoked keys
    const [key] = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        longTokenHash: apiKeys.longTokenHash,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.shortToken, parsed.shortToken))
      .limit(1);

    if (!key) return null;

    // Check if revoked
    if (key.revokedAt !== null) return null;

    // Check expiration
    if (key.expiresAt <= new Date()) return null;

    // Verify the long token hash (constant-time comparison)
    if (!verifyLongToken(parsed.longToken, key.longTokenHash)) return null;

    // Update last_used_at (async, non-blocking)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, key.id))
      .catch(() => {
        // Non-blocking
      });

    // Emit key.used audit event (at most once per key per day)
    // For now, we emit on every use — daily dedup can be added later
    // This is fire-and-forget
    db.insert(auditEvents)
      .values({
        ownerId: key.userId,
        actorType: "api_key",
        actorId: key.userId,
        eventType: "key.used",
        resourceType: "api_key",
        resourceDetail: {
          api_key_id: key.id,
        },
      })
      .catch(() => {
        // Non-blocking
      });

    return {
      role: "owner",
      userId: key.userId,
      permissions: "full",
      authMethod: "api_key",
      apiKeyId: key.id,
      scopes: key.scopes,
    };
  } catch {
    return null;
  }
}

/**
 * Get the resolved request context, handling API key auth if needed.
 *
 * This is a convenience wrapper that combines getRequestContext() with
 * resolveApiKeyAuth(). Use this instead of getRequestContext() in route
 * handlers that should support API key auth.
 *
 * When the resolved auth method is 'api_key', the general API key rate limiter
 * is checked. If the rate limit is exceeded, the `_rateLimited` field is set
 * on the context so that callers can return a 429 response.
 */
export async function getResolvedContext(
  request: Request,
): Promise<RequestContext> {
  const { getRequestContext } = await import("./request-context");
  const ctx = getRequestContext(request);

  if (ctx.authMethod === "api_key" && ctx.userId === "__api_key_pending__") {
    const resolved = await resolveApiKeyAuth(request, ctx);
    if (!resolved) {
      // Invalid API key — return unauthenticated
      return {
        role: "unauthenticated",
        permissions: "full",
        authMethod: "none",
      };
    }

    // Apply the general API key rate limiter
    const rateLimitKey = resolved.apiKeyId ?? resolved.userId ?? "unknown";
    const rateLimitResult = apiKeyGeneralRateLimiter.check(rateLimitKey);
    if (!rateLimitResult.allowed) {
      resolved._rateLimited = rateLimitResult;
    }

    return resolved;
  }

  return ctx;
}

/**
 * Check if the resolved context was rate-limited.
 * If rate-limited, returns a NextResponse with 429 status and rate limit headers.
 * Otherwise returns null.
 *
 * Usage in route handlers:
 * ```ts
 * const ctx = await getResolvedContext(request);
 * const rateLimitResponse = checkApiKeyRateLimit(ctx);
 * if (rateLimitResponse) return rateLimitResponse;
 * ```
 */
export function checkApiKeyRateLimit(
  ctx: RequestContext,
): ReturnType<typeof createRateLimitResponse> | null {
  if (ctx._rateLimited) {
    return createRateLimitResponse(ctx._rateLimited);
  }
  return null;
}
