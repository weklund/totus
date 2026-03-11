/**
 * GET /api/health-data/types — List available metric types for the current user.
 *
 * Returns metric types that have at least one data point, with date ranges
 * and point counts. Label, unit, and category come from the metric registry.
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * See: /docs/api-database-lld.md Section 7.3.2
 */

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { healthDataDaily } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import type { ViewerPermissions } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { getMetricType } from "@/config/metrics";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    // Auth check: must be owner or viewer
    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Build query conditions
    const conditions = [eq(healthDataDaily.userId, ctx.userId)];

    // For viewers, filter to only allowed metrics
    if (ctx.role === "viewer" && ctx.permissions !== "full") {
      const viewerPerms = ctx.permissions as ViewerPermissions;
      if (viewerPerms.allowedMetrics.length > 0) {
        conditions.push(
          inArray(healthDataDaily.metricType, viewerPerms.allowedMetrics),
        );
      }
    }

    // Query for metric type summaries
    const summaries = await db
      .select({
        metricType: healthDataDaily.metricType,
        source: healthDataDaily.source,
        earliestDate: sql<string>`min(${healthDataDaily.date})`,
        latestDate: sql<string>`max(${healthDataDaily.date})`,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataDaily)
      .where(and(...conditions))
      .groupBy(healthDataDaily.metricType, healthDataDaily.source)
      .orderBy(healthDataDaily.metricType);

    // Build response with metric config enrichment
    const types = summaries.map((row) => {
      const config = getMetricType(row.metricType);

      return {
        metric_type: row.metricType,
        label: config?.label || row.metricType,
        unit: config?.unit || "unknown",
        category: config?.category || "Unknown",
        source: row.source,
        date_range: {
          start: row.earliestDate,
          end: row.latestDate,
        },
        count: row.count,
      };
    });

    return NextResponse.json({
      data: {
        types,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
