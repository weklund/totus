/**
 * 30-Day Trend View endpoint.
 *
 * GET /api/views/trend — Returns daily values with rolling averages, trend
 * analysis, and baselines over a 7–365 day range.
 *
 * Composition flow (LLD §8.3):
 * 1. Parse/validate (start, end, metrics required, smoothing optional default '7d',
 *    correlations optional, grant_token optional)
 * 2. Validate date range 7–365 days, 1–10 metrics, max 5 correlation pairs
 * 3. Auth + permissions (viewer scoping)
 * 4. Fetch baselines anchored to start date (FR-1.4)
 * 5. Fetch daily values for full range
 * 6. Compute rolling averages per metric using requested smoothing (none/7d/30d)
 * 7. Compute trend direction per metric (compare 7-day averages of first and last weeks)
 * 8. Assemble TrendResponse with raw values, smoothed values, trend results, baselines
 * 9. Emit audit event
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * VAL-TREND-001 through VAL-TREND-008
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { healthDataDaily, dismissedInsights, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { enforcePermissions, PermissionError } from "@/lib/auth/permissions";
import { createErrorResponse, ApiError } from "@/lib/api";
import { createEncryptionProvider } from "@/lib/encryption";
import { isValidMetricType } from "@/config/metrics";
import { fetchBaselines } from "@/lib/dashboard/baselines";
import { computeSummaryMetrics } from "@/lib/dashboard/summaries";
import { computeRollingAverages } from "@/lib/dashboard/rolling-averages";
import { generateInsights } from "@/lib/dashboard/insights";
import type { TrendResult, CorrelationResult } from "@/lib/dashboard/types";
import { resolveGrantToken } from "@/lib/auth/resolve-grant-token";
import { resolveSourcesForMetrics } from "@/lib/api/source-resolution";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum date range in days (inclusive). */
const MIN_RANGE_DAYS = 7;

/** Maximum date range in days (inclusive). */
const MAX_RANGE_DAYS = 365;

/** Maximum number of metrics allowed. */
const MAX_METRICS = 10;

/** Maximum number of correlation pairs allowed. */
const MAX_CORRELATION_PAIRS = 5;

/** Number of days used for trend start/end average windows. */
const TREND_WINDOW_DAYS = 7;

/** Trend direction threshold: |change_pct| > 5% → rising/falling, else stable. */
const TREND_THRESHOLD_PCT = 5;

// ─── Validation ─────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const trendViewQuerySchema = z.object({
  start: z
    .string()
    .regex(DATE_REGEX, "start must be YYYY-MM-DD format")
    .refine(isValidDate, "start must be a valid calendar date"),
  end: z
    .string()
    .regex(DATE_REGEX, "end must be YYYY-MM-DD format")
    .refine(isValidDate, "end must be a valid calendar date"),
  metrics: z
    .string()
    .transform((s) => s.split(",").map((m) => m.trim()))
    .pipe(
      z
        .array(z.string().refine(isValidMetricType, "Invalid metric type"))
        .min(1, "At least one metric is required")
        .max(MAX_METRICS, `Maximum ${MAX_METRICS} metrics allowed`),
    ),
  smoothing: z.enum(["none", "7d", "30d"]).optional().default("7d"),
  correlations: z
    .string()
    .transform((s) =>
      s.split(",").map((pair) => {
        const [a, b] = pair.trim().split(":");
        return [a!, b!] as [string, string];
      }),
    )
    .optional(),
  grant_token: z.string().optional(),
});

function isValidDate(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month! - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Compute the number of days between two YYYY-MM-DD dates (inclusive).
 */
function daysBetweenInclusive(startStr: string, endStr: string): number {
  const start = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");
  return (
    Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
}

/**
 * Generate an array of YYYY-MM-DD date strings from start to end (inclusive).
 */
function getDateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const current = new Date(startStr + "T00:00:00Z");
  const end = new Date(endStr + "T00:00:00Z");

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]!);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

// ─── GET /api/views/trend ───────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Step 1: Auth
    let ctx = await getResolvedContext(request);

    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    // Step 2: Parse and validate query parameters
    const url = new URL(request.url);
    const queryParams = {
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      metrics: url.searchParams.get("metrics") ?? undefined,
      smoothing: url.searchParams.get("smoothing") ?? undefined,
      correlations: url.searchParams.get("correlations") ?? undefined,
      grant_token: url.searchParams.get("grant_token") ?? undefined,
    };

    const parsed = trendViewQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || issue.message,
        message: issue.message,
      }));
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid query parameters",
        400,
        details,
      );
    }

    // Step 2b: Resolve grant_token if present — overrides auth context
    if (parsed.data.grant_token) {
      const viewerCtx = await resolveGrantToken(parsed.data.grant_token);
      if (!viewerCtx) {
        throw new ApiError(
          "UNAUTHORIZED",
          "Invalid or expired share token",
          401,
        );
      }
      ctx = viewerCtx;
    }

    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const {
      start,
      end,
      smoothing,
      correlations: correlationPairs,
    } = parsed.data;
    let requestedMetrics = parsed.data.metrics;

    // Validate date range: 7–365 days (inclusive)
    if (start > end) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "start must be before or equal to end",
        400,
      );
    }

    const rangeDays = daysBetweenInclusive(start, end);
    if (rangeDays < MIN_RANGE_DAYS) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Date range must be at least ${MIN_RANGE_DAYS} days, got ${rangeDays}`,
        400,
      );
    }
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Date range must be at most ${MAX_RANGE_DAYS} days, got ${rangeDays}`,
        400,
      );
    }

    // Validate correlation pairs
    if (correlationPairs) {
      if (correlationPairs.length > MAX_CORRELATION_PAIRS) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `Maximum ${MAX_CORRELATION_PAIRS} correlation pairs allowed, got ${correlationPairs.length}`,
          400,
        );
      }
      // Each metric in a correlation pair must be in the metrics list
      for (const [a, b] of correlationPairs) {
        if (!requestedMetrics.includes(a)) {
          throw new ApiError(
            "VALIDATION_ERROR",
            `Correlation metric '${a}' is not in the metrics list`,
            400,
          );
        }
        if (!requestedMetrics.includes(b)) {
          throw new ApiError(
            "VALIDATION_ERROR",
            `Correlation metric '${b}' is not in the metrics list`,
            400,
          );
        }
      }
    }

    // Step 3: Enforce permissions (viewer scoping)
    let effectiveStart = start;
    let effectiveEnd = end;

    try {
      const scope = enforcePermissions(ctx, {
        userId: ctx.userId,
        metrics: requestedMetrics,
        startDate: start,
        endDate: end,
      });
      requestedMetrics = scope.metrics;
      effectiveStart = scope.startDate;
      effectiveEnd = scope.endDate;
    } catch (error) {
      if (error instanceof PermissionError) {
        throw new ApiError(error.code, error.message, error.statusCode);
      }
      throw error;
    }

    const encryption = createEncryptionProvider();
    const userId = ctx.userId;

    // Step 4: Fetch baselines anchored to start date (FR-1.4)
    const baselinesMap = await fetchBaselines(
      userId,
      requestedMetrics,
      effectiveStart, // referenceDate = start of range
      2, // tolerance
      encryption,
      db as Parameters<typeof fetchBaselines>[5],
    );

    // Step 5: Fetch daily values for full range
    const dateRange = getDateRange(effectiveStart, effectiveEnd);

    // Resolve preferred sources per metric
    const sourceResolutionMap = await resolveSourcesForMetrics(
      userId,
      requestedMetrics,
    );

    // Batch-fetch all daily values for the entire range
    const dailyRows = await db
      .select({
        metricType: healthDataDaily.metricType,
        date: healthDataDaily.date,
        valueEncrypted: healthDataDaily.valueEncrypted,
        source: healthDataDaily.source,
      })
      .from(healthDataDaily)
      .where(
        and(
          eq(healthDataDaily.userId, userId),
          inArray(healthDataDaily.metricType, requestedMetrics),
          between(healthDataDaily.date, effectiveStart, effectiveEnd),
        ),
      );

    // Decrypt and group by metric → array of {date, value} sorted by date
    const rawDataByMetric = new Map<
      string,
      { date: string; value: number }[]
    >();
    for (const metric of requestedMetrics) {
      rawDataByMetric.set(metric, []);
    }

    for (const row of dailyRows) {
      // Apply source resolution filtering
      const resolution = sourceResolutionMap.get(row.metricType);
      if (resolution && row.source !== resolution.source) {
        continue;
      }

      const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
      const value = JSON.parse(decrypted.toString()) as number;

      const arr = rawDataByMetric.get(row.metricType);
      if (arr) {
        arr.push({ date: row.date, value });
      }
    }

    // Sort each metric's data by date ascending
    for (const [, data] of rawDataByMetric) {
      data.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Step 6: Compute rolling averages per metric (if smoothing != "none")
    // Step 7: Compute trend direction per metric
    // Step 8: Assemble TrendResponse
    const metricsResponse: Record<
      string,
      {
        raw: { dates: string[]; values: number[] };
        smoothed: { dates: string[]; values: number[] } | null;
        trend: TrendResult;
        baseline: { avg: number; stddev: number; upper: number; lower: number };
      }
    > = {};

    // Build a values map for summary computation (use last date's values)
    const lastDate = dateRange[dateRange.length - 1]!;
    const lastDateValues = new Map<string, number>();

    for (const metric of requestedMetrics) {
      const rawData = rawDataByMetric.get(metric) ?? [];

      // Raw data arrays
      const rawDates = rawData.map((d) => d.date);
      const rawValues = rawData.map((d) => d.value);

      // Populate last date values for insight generation
      const lastDayEntry = rawData.find((d) => d.date === lastDate);
      if (lastDayEntry) {
        lastDateValues.set(metric, lastDayEntry.value);
      }

      // Smoothed data
      let smoothedResult: { dates: string[]; values: number[] } | null = null;
      if (smoothing !== "none" && rawData.length > 0) {
        const windowDays = smoothing === "30d" ? 30 : 7;
        const smoothed = computeRollingAverages(rawData, windowDays as 7 | 30);
        smoothedResult = {
          dates: smoothed.map((d) => d.date),
          values: smoothed.map((d) => d.value),
        };
      }

      // Trend direction: compare first 7 days avg vs last 7 days avg
      const trend = computeTrendDirection(rawData);

      // Baseline (from fetched baselines)
      const baseline = baselinesMap.get(metric);
      const baselineResponse = baseline
        ? {
            avg: baseline.avg_30d,
            stddev: baseline.stddev_30d,
            upper: baseline.upper,
            lower: baseline.lower,
          }
        : { avg: 0, stddev: 0, upper: 0, lower: 0 };

      metricsResponse[metric] = {
        raw: { dates: rawDates, values: rawValues },
        smoothed: smoothedResult,
        trend,
        baseline: baselineResponse,
      };
    }

    // Generate insights (trend viewType)
    const summaries = computeSummaryMetrics(lastDateValues, baselinesMap);

    // Build trends map for insight context
    const trendsMap = new Map<string, TrendResult>();
    for (const [metric, data] of Object.entries(metricsResponse)) {
      trendsMap.set(metric, data.trend);
    }

    const dismissedTypes = await getDismissedTypes(userId, lastDate);

    const insights = generateInsights("trend", {
      viewType: "trend",
      date: lastDate,
      summaries,
      baselines: baselinesMap,
      trends: trendsMap,
      dismissedTypes,
    });

    // Correlations: empty for P0 (P1 feature)
    const correlations: CorrelationResult[] = [];

    const response = {
      date_range: {
        start: effectiveStart,
        end: effectiveEnd,
      },
      smoothing,
      insights,
      metrics: metricsResponse,
      correlations,
    };

    // Step 9: Emit view.accessed audit event (fire-and-forget)
    const metricsReturned = Object.keys(metricsResponse);
    const dataPointsReturned = Object.values(metricsResponse).reduce(
      (sum, m) => sum + m.raw.values.length,
      0,
    );

    const isValidUuid = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const auditGrantId =
      ctx.grantId && isValidUuid(ctx.grantId) ? ctx.grantId : null;

    db.insert(auditEvents)
      .values({
        ownerId: userId,
        actorType:
          ctx.role === "viewer"
            ? "viewer"
            : ctx.authMethod === "api_key"
              ? "api_key"
              : "owner",
        actorId: ctx.role === "owner" ? userId : null,
        grantId: auditGrantId,
        eventType: "view.accessed",
        resourceType: "view",
        resourceDetail: {
          view_type: "trend",
          date_range: { start: effectiveStart, end: effectiveEnd },
          smoothing,
          metrics_requested: requestedMetrics,
          metrics_returned: metricsReturned,
          data_points_returned: dataPointsReturned,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({ data: response });
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Compute trend direction by comparing the 7-day average of the first week
 * and the 7-day average of the last week.
 *
 * For ranges where the start and end windows overlap (e.g., 7-day range),
 * the trend will naturally be "stable" since start_value ≈ end_value.
 */
function computeTrendDirection(
  data: { date: string; value: number }[],
): TrendResult {
  if (data.length === 0) {
    return {
      direction: "stable",
      start_value: 0,
      end_value: 0,
      change_pct: 0,
      change_abs: 0,
    };
  }

  // First 7 days' values
  const firstWeekValues = data.slice(0, TREND_WINDOW_DAYS).map((d) => d.value);
  // Last 7 days' values
  const lastWeekValues = data.slice(-TREND_WINDOW_DAYS).map((d) => d.value);

  const startValue =
    firstWeekValues.reduce((sum, v) => sum + v, 0) / firstWeekValues.length;
  const endValue =
    lastWeekValues.reduce((sum, v) => sum + v, 0) / lastWeekValues.length;

  const changeAbs = endValue - startValue;
  const changePct =
    startValue !== 0 ? ((endValue - startValue) / startValue) * 100 : 0;

  let direction: "rising" | "falling" | "stable";
  if (Math.abs(changePct) > TREND_THRESHOLD_PCT) {
    direction = changePct > 0 ? "rising" : "falling";
  } else {
    direction = "stable";
  }

  return {
    direction,
    start_value: Math.round(startValue * 100) / 100,
    end_value: Math.round(endValue * 100) / 100,
    change_pct: Math.round(changePct * 100) / 100,
    change_abs: Math.round(changeAbs * 100) / 100,
  };
}

/**
 * Get dismissed insight types for a specific user and date.
 */
async function getDismissedTypes(
  userId: string,
  date: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ insightType: dismissedInsights.insightType })
    .from(dismissedInsights)
    .where(
      and(
        eq(dismissedInsights.userId, userId),
        eq(dismissedInsights.referenceDate, date),
      ),
    );

  return new Set(rows.map((r) => r.insightType));
}
