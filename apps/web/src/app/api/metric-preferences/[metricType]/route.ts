/**
 * PUT /api/metric-preferences/[metricType] — Set a metric source preference.
 * DELETE /api/metric-preferences/[metricType] — Remove a metric source preference.
 *
 * Auth: Owner (Clerk session required)
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { metricSourcePreferences } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { isValidMetricType } from "@/config/metrics";
import { PROVIDER_IDS } from "@/config/providers";

// ─── Validation Schema ──────────────────────────────────────────────────────

const putPreferenceSchema = z.object({
  provider: z
    .string()
    .refine((s) => PROVIDER_IDS.includes(s as (typeof PROVIDER_IDS)[number]), {
      message: "Invalid provider",
    }),
});

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ metricType: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    // Auth check: must be owner
    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { metricType } = await params;

    // Validate metric type
    if (!isValidMetricType(metricType)) {
      throw new ApiError(
        "INVALID_METRIC_TYPE",
        `Unknown metric type: ${metricType}`,
        400,
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Request body must be valid JSON",
        400,
      );
    }

    const parseResult = putPreferenceSchema.safeParse(body);
    if (!parseResult.success) {
      const details = parseResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid request body",
        400,
        details,
      );
    }

    const { provider } = parseResult.data;

    // Upsert the preference
    await db
      .insert(metricSourcePreferences)
      .values({
        userId: ctx.userId,
        metricType,
        provider,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          metricSourcePreferences.userId,
          metricSourcePreferences.metricType,
        ],
        set: {
          provider,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      data: {
        metric_type: metricType,
        provider,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ metricType: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    // Auth check: must be owner
    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { metricType } = await params;

    // Validate metric type
    if (!isValidMetricType(metricType)) {
      throw new ApiError(
        "INVALID_METRIC_TYPE",
        `Unknown metric type: ${metricType}`,
        400,
      );
    }

    // Delete the preference
    const result = await db
      .delete(metricSourcePreferences)
      .where(
        and(
          eq(metricSourcePreferences.userId, ctx.userId),
          eq(metricSourcePreferences.metricType, metricType),
        ),
      );

    if ((result.rowCount ?? 0) === 0) {
      // Not an error — idempotent delete
    }

    return NextResponse.json({
      data: {
        metric_type: metricType,
        deleted: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
