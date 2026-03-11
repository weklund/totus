/**
 * GET /api/metric-preferences — List all metric source preferences for the current user.
 *
 * Returns an array of preferences, each with metric_type and provider.
 * Returns empty array if no preferences are set.
 *
 * Auth: Owner (Clerk session required)
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { metricSourcePreferences } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    // Auth check: must be owner
    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const preferences = await db
      .select({
        metricType: metricSourcePreferences.metricType,
        provider: metricSourcePreferences.provider,
        updatedAt: metricSourcePreferences.updatedAt,
      })
      .from(metricSourcePreferences)
      .where(eq(metricSourcePreferences.userId, ctx.userId))
      .orderBy(metricSourcePreferences.metricType);

    return NextResponse.json({
      data: {
        preferences: preferences.map((p) => ({
          metric_type: p.metricType,
          provider: p.provider,
          updated_at: p.updatedAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
