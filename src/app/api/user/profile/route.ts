/**
 * User profile API endpoints.
 *
 * GET /api/user/profile — Return user profile with stats.
 * PATCH /api/user/profile — Update display_name (1-100 chars, HTML stripped).
 *
 * Auth: Owner (session required) for both endpoints.
 *
 * See: /docs/api-database-lld.md Section 7.6
 */

import { NextResponse } from "next/server";
import { eq, sql, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  users,
  healthData,
  shareGrants,
  ouraConnections,
  auditEvents,
} from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const updateProfileSchema = z.object({
  display_name: z
    .string()
    .min(1, "Display name is required")
    .max(100, "Display name must be 100 characters or less"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip HTML tags from a string.
 * Removes all HTML elements while preserving text content.
 */
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

// ─── GET /api/user/profile ──────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Fetch user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.userId));

    if (!user) {
      throw new ApiError("NOT_FOUND", "User not found", 404);
    }

    // Count total data points
    const [dataPointsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthData)
      .where(eq(healthData.userId, ctx.userId));

    // Count active shares
    const [activeSharesResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shareGrants)
      .where(
        and(
          eq(shareGrants.ownerId, ctx.userId),
          isNull(shareGrants.revokedAt),
          sql`${shareGrants.grantExpires} > now()`,
        ),
      );

    // Count connections
    const [connectionsResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, ctx.userId));

    return NextResponse.json({
      data: {
        id: user.id,
        display_name: user.displayName,
        created_at: user.createdAt.toISOString(),
        stats: {
          total_data_points: dataPointsResult?.count ?? 0,
          active_shares: activeSharesResult?.count ?? 0,
          connections: connectionsResult?.count ?? 0,
        },
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── PATCH /api/user/profile ────────────────────────────────────────────────

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse and validate body
    const body = await request.json();
    const data = validateRequest(updateProfileSchema, body);

    // Strip HTML from display_name
    const sanitizedName = stripHtml(data.display_name);

    // Validate sanitized name is not empty
    if (sanitizedName.length === 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Display name must contain visible text (HTML-only names are not allowed)",
        400,
        [
          {
            field: "display_name",
            message:
              "Display name must contain visible text after HTML sanitization",
          },
        ],
      );
    }

    // Validate sanitized name length
    if (sanitizedName.length > 100) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Display name must be 100 characters or less after sanitization",
        400,
        [
          {
            field: "display_name",
            message: "Display name exceeds 100 characters after sanitization",
          },
        ],
      );
    }

    // Update user
    const now = new Date();
    const [updated] = await db
      .update(users)
      .set({
        displayName: sanitizedName,
        updatedAt: now,
      })
      .where(eq(users.id, ctx.userId))
      .returning();

    if (!updated) {
      throw new ApiError("NOT_FOUND", "User not found", 404);
    }

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: "owner",
        actorId: ctx.userId,
        eventType: "account.settings",
        resourceType: "user",
        resourceDetail: {
          field: "display_name",
          new_value: sanitizedName,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: updated.id,
        display_name: updated.displayName,
        updated_at: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
