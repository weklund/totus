/**
 * GET /api/health-data/types — List available metric types for the current user.
 *
 * Returns metric types that have at least one data point across all 3 data tables
 * (health_data_daily, health_data_series, health_data_periods), with date ranges
 * and point counts. Label, unit, category, and dataType come from the metric registry.
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * See: /docs/api-database-lld.md Section 7.3.2
 */

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  healthDataDaily,
  healthDataSeries,
  healthDataPeriods,
} from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import type { ViewerPermissions } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { getMetricType } from "@/config/metrics";

interface MetricTypeSummary {
  metric_type: string;
  label: string;
  unit: string;
  category: string;
  data_type: string;
  source: string;
  date_range: {
    start: string;
    end: string;
  };
  count: number;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);
    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    // Auth check: must be owner or viewer
    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Determine allowed metrics for viewers
    let allowedMetrics: string[] | null = null;
    if (ctx.role === "viewer" && ctx.permissions !== "full") {
      const viewerPerms = ctx.permissions as ViewerPermissions;
      allowedMetrics = viewerPerms.allowedMetrics;
    }

    // Query daily data summaries
    const dailyConditions = [eq(healthDataDaily.userId, ctx.userId)];
    if (allowedMetrics && allowedMetrics.length > 0) {
      dailyConditions.push(inArray(healthDataDaily.metricType, allowedMetrics));
    }

    const dailySummaries = await db
      .select({
        metricType: healthDataDaily.metricType,
        source: healthDataDaily.source,
        earliestDate: sql<string>`min(${healthDataDaily.date})`,
        latestDate: sql<string>`max(${healthDataDaily.date})`,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataDaily)
      .where(and(...dailyConditions))
      .groupBy(healthDataDaily.metricType, healthDataDaily.source)
      .orderBy(healthDataDaily.metricType);

    // Query series data summaries
    const seriesConditions = [eq(healthDataSeries.userId, ctx.userId)];
    if (allowedMetrics && allowedMetrics.length > 0) {
      seriesConditions.push(
        inArray(healthDataSeries.metricType, allowedMetrics),
      );
    }

    const seriesSummaries = await db
      .select({
        metricType: healthDataSeries.metricType,
        source: healthDataSeries.source,
        earliestDate: sql<string>`min(${healthDataSeries.recordedAt})::date::text`,
        latestDate: sql<string>`max(${healthDataSeries.recordedAt})::date::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataSeries)
      .where(and(...seriesConditions))
      .groupBy(healthDataSeries.metricType, healthDataSeries.source)
      .orderBy(healthDataSeries.metricType);

    // Query periods data summaries
    const periodsConditions = [eq(healthDataPeriods.userId, ctx.userId)];
    if (allowedMetrics && allowedMetrics.length > 0) {
      periodsConditions.push(
        inArray(healthDataPeriods.eventType, allowedMetrics),
      );
    }

    const periodsSummaries = await db
      .select({
        metricType: healthDataPeriods.eventType,
        source: healthDataPeriods.source,
        earliestDate: sql<string>`min(${healthDataPeriods.startedAt})::date::text`,
        latestDate: sql<string>`max(${healthDataPeriods.startedAt})::date::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataPeriods)
      .where(and(...periodsConditions))
      .groupBy(healthDataPeriods.eventType, healthDataPeriods.source)
      .orderBy(healthDataPeriods.eventType);

    // Build unified response
    const types: MetricTypeSummary[] = [];

    // Add daily summaries
    for (const row of dailySummaries) {
      const config = getMetricType(row.metricType);
      types.push({
        metric_type: row.metricType,
        label: config?.label || row.metricType,
        unit: config?.unit || "unknown",
        category: config?.category || "Unknown",
        data_type: "daily",
        source: row.source,
        date_range: {
          start: row.earliestDate,
          end: row.latestDate,
        },
        count: row.count,
      });
    }

    // Add series summaries
    for (const row of seriesSummaries) {
      const config = getMetricType(row.metricType);
      types.push({
        metric_type: row.metricType,
        label: config?.label || row.metricType,
        unit: config?.unit || "unknown",
        category: config?.category || "Unknown",
        data_type: "series",
        source: row.source,
        date_range: {
          start: row.earliestDate,
          end: row.latestDate,
        },
        count: row.count,
      });
    }

    // Add periods summaries
    for (const row of periodsSummaries) {
      const config = getMetricType(row.metricType);
      types.push({
        metric_type: row.metricType,
        label: config?.label || row.metricType,
        unit: config?.unit || "—",
        category: config?.category || "Unknown",
        data_type: "period",
        source: row.source,
        date_range: {
          start: row.earliestDate,
          end: row.latestDate,
        },
        count: row.count,
      });
    }

    return NextResponse.json({
      data: {
        types,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
