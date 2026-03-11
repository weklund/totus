/**
 * API key management endpoints.
 *
 * POST /api/keys — Create a new API key.
 * GET /api/keys — List the user's API keys (without secrets).
 *
 * Auth: Owner (session or API key with keys:write/keys:read scope).
 *
 * See: /docs/cli-mcp-server-lld.md Section 7.5
 */

import { NextResponse } from "next/server";
import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import {
  generateApiKey,
  validateScopes,
  isScopeSubset,
  VALID_SCOPES,
  DEFAULT_EXPIRES_IN_DAYS,
  MAX_EXPIRES_IN_DAYS,
  MIN_EXPIRES_IN_DAYS,
  MAX_ACTIVE_KEYS_PER_USER,
} from "@/lib/auth/api-keys";
import { enforceScope } from "@/lib/auth/permissions";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  scopes: z
    .array(z.string())
    .min(1, "At least one scope is required")
    .refine((scopes) => validateScopes(scopes), {
      message: `Invalid scope(s). Valid scopes: ${VALID_SCOPES.join(", ")}`,
    }),
  expires_in_days: z
    .number()
    .int("Must be an integer")
    .min(MIN_EXPIRES_IN_DAYS, `Minimum ${MIN_EXPIRES_IN_DAYS} day`)
    .max(MAX_EXPIRES_IN_DAYS, `Maximum ${MAX_EXPIRES_IN_DAYS} days`)
    .optional()
    .default(DEFAULT_EXPIRES_IN_DAYS),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute key status from fields.
 */
function computeStatus(
  revokedAt: Date | null,
  expiresAt: Date,
): "active" | "expired" | "revoked" {
  if (revokedAt !== null) return "revoked";
  if (expiresAt <= new Date()) return "expired";
  return "active";
}

// ─── POST /api/keys ─────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require keys:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "keys:write");
    }

    // Parse and validate body
    const body = await request.json();
    const data = validateRequest(createKeySchema, body);

    // Scope escalation prevention: if creating via API key, new key's scopes
    // must be a subset of the creating key's scopes
    if (ctx.authMethod === "api_key" && ctx.scopes) {
      if (!isScopeSubset(data.scopes, ctx.scopes)) {
        throw new ApiError(
          "INSUFFICIENT_SCOPES",
          "Cannot create an API key with broader scopes than the creating key. " +
            `Requested: [${data.scopes.join(", ")}], ` +
            `Available: [${ctx.scopes.join(", ")}]`,
          403,
        );
      }
    }

    // Check max active keys limit
    const activeKeyCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.userId, ctx.userId),
          isNull(apiKeys.revokedAt),
          sql`${apiKeys.expiresAt} > now()`,
        ),
      );

    const count = activeKeyCount[0]?.count ?? 0;
    if (count >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new ApiError(
        "KEY_LIMIT_REACHED",
        `Maximum ${MAX_ACTIVE_KEYS_PER_USER} active API keys allowed. Revoke existing keys to create new ones.`,
        400,
      );
    }

    // Generate the key
    const { fullKey, shortToken, longTokenHash } = generateApiKey();

    // Compute expiration
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + data.expires_in_days);

    // Insert into database
    const [key] = await db
      .insert(apiKeys)
      .values({
        userId: ctx.userId,
        name: data.name,
        shortToken,
        longTokenHash,
        scopes: data.scopes,
        expiresAt,
      })
      .returning();

    // Emit key.created audit event (fire-and-forget)
    const actorType = ctx.authMethod === "api_key" ? "api_key" : "owner";
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType,
        actorId: ctx.userId,
        eventType: "key.created",
        resourceType: "api_key",
        resourceDetail: {
          api_key_id: key.id,
          api_key_name: data.name,
          scopes: data.scopes,
          expires_in_days: data.expires_in_days,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json(
      {
        data: {
          id: key.id,
          name: key.name,
          key: fullKey, // Only returned at creation time
          short_token: shortToken,
          scopes: key.scopes,
          expires_at: key.expiresAt.toISOString(),
          created_at: key.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── GET /api/keys ──────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require keys:read scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "keys:read");
    }

    // Fetch all keys for this user, ordered by creation date
    const keys = await db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.userId))
      .orderBy(desc(apiKeys.createdAt));

    const data = keys.map((key) => ({
      id: key.id,
      name: key.name,
      short_token: key.shortToken,
      scopes: key.scopes,
      status: computeStatus(key.revokedAt, key.expiresAt),
      expires_at: key.expiresAt.toISOString(),
      last_used_at: key.lastUsedAt?.toISOString() ?? null,
      created_at: key.createdAt.toISOString(),
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return createErrorResponse(error);
  }
}
