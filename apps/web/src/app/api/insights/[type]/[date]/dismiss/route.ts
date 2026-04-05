/**
 * Insight Dismissal API endpoint.
 *
 * POST /api/insights/:type/:date/dismiss — Dismiss an insight for a specific
 * date and type. Idempotent: second call for the same (user, type, date)
 * returns the same result without creating duplicate rows.
 *
 * Auth: Owner only. Viewers → 403. No auth → 401.
 *
 * See: /docs/dashboard-backend-lld.md §6, §10
 *
 * VAL-INSGT-001, VAL-INSGT-002
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { dismissedInsights, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { createErrorResponse, ApiError } from "@/lib/api";
import { getP0Rules } from "@/lib/dashboard/insights";

// ─── Known Insight Types ────────────────────────────────────────────────────

/** Set of valid insight type IDs derived from the P0 rules. */
const KNOWN_INSIGHT_TYPES = new Set(getP0Rules().map((rule) => rule.id));

// ─── Date Validation ────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── POST /api/insights/:type/:date/dismiss ─────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ type: string; date: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    // Auth: no auth → 401
    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Auth: viewer → 403
    if (ctx.role === "viewer") {
      throw new ApiError(
        "FORBIDDEN",
        "Only the data owner can dismiss insights",
        403,
      );
    }

    // Resolve path parameters
    const { type, date } = await params;

    // Validate insight type
    if (!KNOWN_INSIGHT_TYPES.has(type)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Invalid insight type: ${type}. Must be one of: ${[...KNOWN_INSIGHT_TYPES].join(", ")}`,
        400,
        [{ field: "type", message: `Unknown insight type: ${type}` }],
      );
    }

    // Validate date format (YYYY-MM-DD)
    if (!DATE_REGEX.test(date)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Invalid date format: ${date}. Must be YYYY-MM-DD`,
        400,
        [{ field: "date", message: "Date must be in YYYY-MM-DD format" }],
      );
    }

    // Upsert into dismissed_insights — idempotent (ON CONFLICT DO NOTHING)
    await db
      .insert(dismissedInsights)
      .values({
        userId: ctx.userId,
        insightType: type,
        referenceDate: date,
      })
      .onConflictDoNothing({
        target: [
          dismissedInsights.userId,
          dismissedInsights.insightType,
          dismissedInsights.referenceDate,
        ],
      });

    // Emit insight.dismissed audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: ctx.authMethod === "api_key" ? "api_key" : "owner",
        actorId: ctx.userId,
        eventType: "insight.dismissed",
        resourceType: "insight",
        resourceDetail: {
          insight_type: type,
          date,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        insight_type: type,
        date,
        dismissed: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
