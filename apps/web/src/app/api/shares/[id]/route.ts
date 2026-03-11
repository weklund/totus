/**
 * Share grant detail, revoke, and delete endpoints.
 *
 * GET /api/shares/:id — Get share grant details with view stats.
 * PATCH /api/shares/:id — Revoke a share grant (idempotent).
 * DELETE /api/shares/:id — Hard delete a revoked/expired share grant.
 *
 * Auth: Owner (session required) for all endpoints.
 *
 * See: /docs/api-database-lld.md Section 7.4
 */

import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shareGrants, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { enforceScope } from "@/lib/auth/permissions";
import {
  createErrorResponse,
  ApiError,
  validateRequest,
  apiKeyReadRateLimiter,
  apiKeyWriteRateLimiter,
  createRateLimitResponse,
} from "@/lib/api";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const patchShareSchema = z.object({
  action: z.literal("revoke", {
    error: 'Action must be "revoke"',
  }),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute status from grant fields.
 */
function computeStatus(
  revokedAt: Date | null,
  grantExpires: Date,
): "active" | "expired" | "revoked" {
  if (revokedAt !== null) return "revoked";
  if (grantExpires <= new Date()) return "expired";
  return "active";
}

/**
 * Validate UUID format.
 */
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

// ─── GET /api/shares/:id ────────────────────────────────────────────────────

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require shares:read scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "shares:read");

      const rateLimitResult = apiKeyReadRateLimiter.check(
        ctx.apiKeyId ?? ctx.userId,
      );
      if (!rateLimitResult.allowed) {
        return createRateLimitResponse(rateLimitResult);
      }
    }

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Fetch the share grant
    const [grant] = await db
      .select()
      .from(shareGrants)
      .where(and(eq(shareGrants.id, id), eq(shareGrants.ownerId, ctx.userId)));

    if (!grant) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Fetch recent views from audit events (last 10 share.viewed/data.viewed for this grant)
    const recentViews = await db
      .select({
        viewedAt: auditEvents.createdAt,
        ipAddress: auditEvents.ipAddress,
        userAgent: auditEvents.userAgent,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.grantId, grant.id),
          eq(auditEvents.ownerId, ctx.userId),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(10);

    return NextResponse.json({
      data: {
        id: grant.id,
        label: grant.label,
        allowed_metrics: grant.allowedMetrics,
        data_start: grant.dataStart,
        data_end: grant.dataEnd,
        grant_expires: grant.grantExpires.toISOString(),
        status: computeStatus(grant.revokedAt, grant.grantExpires),
        revoked_at: grant.revokedAt?.toISOString() ?? null,
        note: grant.note,
        view_count: grant.viewCount,
        last_viewed_at: grant.lastViewedAt?.toISOString() ?? null,
        created_at: grant.createdAt.toISOString(),
        recent_views: recentViews.map((v) => ({
          viewed_at: v.viewedAt.toISOString(),
          ip_address: v.ipAddress,
          user_agent_summary: v.userAgent
            ? summarizeUserAgent(v.userAgent)
            : null,
        })),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

/**
 * Produce a brief user agent summary (e.g., "Chrome on macOS").
 */
function summarizeUserAgent(ua: string): string {
  let browser = "Unknown Browser";
  let os = "Unknown OS";

  if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
  else if (ua.includes("Firefox")) browser = "Firefox";
  else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
  else if (ua.includes("Edg")) browser = "Edge";

  if (ua.includes("Macintosh") || ua.includes("Mac OS")) os = "macOS";
  else if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("Android")) os = "Android";

  return `${browser} on ${os}`;
}

// ─── PATCH /api/shares/:id ──────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const patchRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (patchRateLimitResponse) return patchRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require shares:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "shares:write");

      const rateLimitResult = apiKeyWriteRateLimiter.check(
        ctx.apiKeyId ?? ctx.userId,
      );
      if (!rateLimitResult.allowed) {
        return createRateLimitResponse(rateLimitResult);
      }
    }

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Validate body
    const body = await request.json();
    validateRequest(patchShareSchema, body);

    // Fetch the share grant
    const [grant] = await db
      .select()
      .from(shareGrants)
      .where(and(eq(shareGrants.id, id), eq(shareGrants.ownerId, ctx.userId)));

    if (!grant) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Idempotent: if already revoked, return current state
    if (grant.revokedAt !== null) {
      return NextResponse.json({
        data: {
          id: grant.id,
          status: "revoked" as const,
          revoked_at: grant.revokedAt.toISOString(),
        },
      });
    }

    // Revoke the share grant
    const now = new Date();
    const [updated] = await db
      .update(shareGrants)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(shareGrants.id, id))
      .returning();

    // Emit audit event (fire-and-forget)
    const actorType = ctx.authMethod === "api_key" ? "api_key" : "owner";
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType,
        actorId: ctx.userId,
        grantId: grant.id,
        eventType: "share.revoked",
        resourceType: "share_grant",
        resourceDetail: {
          label: grant.label,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: updated.id,
        status: "revoked" as const,
        revoked_at: updated.revokedAt!.toISOString(),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── DELETE /api/shares/:id ─────────────────────────────────────────────────

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const deleteRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (deleteRateLimitResponse) return deleteRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require shares:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "shares:write");

      const rateLimitResult = apiKeyWriteRateLimiter.check(
        ctx.apiKeyId ?? ctx.userId,
      );
      if (!rateLimitResult.allowed) {
        return createRateLimitResponse(rateLimitResult);
      }
    }

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Fetch the share grant
    const [grant] = await db
      .select()
      .from(shareGrants)
      .where(and(eq(shareGrants.id, id), eq(shareGrants.ownerId, ctx.userId)));

    if (!grant) {
      throw new ApiError("NOT_FOUND", "Share grant not found", 404);
    }

    // Check: only revoked or expired shares can be deleted
    const status = computeStatus(grant.revokedAt, grant.grantExpires);
    if (status === "active") {
      throw new ApiError(
        "SHARE_STILL_ACTIVE",
        "Cannot delete an active share. Revoke it first.",
        403,
      );
    }

    // Hard delete the grant
    await db.delete(shareGrants).where(eq(shareGrants.id, id));

    // Emit audit event (fire-and-forget)
    const deleteActorType = ctx.authMethod === "api_key" ? "api_key" : "owner";
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: deleteActorType,
        actorId: ctx.userId,
        grantId: grant.id,
        eventType: "share.deleted",
        resourceType: "share_grant",
        resourceDetail: {
          label: grant.label,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: grant.id,
        deleted: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
