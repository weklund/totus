/**
 * Night Detail View endpoint.
 *
 * GET /api/views/night — Returns all data for a single night: intraday series,
 * sleep hypnogram, daily summary with deltas, baselines, annotations, and insights.
 *
 * Composition flow (LLD §8.1):
 * 1. Parse/validate with Zod (date required YYYY-MM-DD, metrics optional, grant_token optional)
 * 2. Auth via getResolvedContext — support owner + viewer (grant_token)
 * 3. enforcePermissions — for viewers, intersect metrics with allowedMetrics, clamp date
 * 4. Fetch baselines anchored to the view date (FR-1.4)
 * 5. Fetch daily values from health_data_daily
 * 6. Fetch intraday series from health_data_series for night window
 * 7. Fetch sleep periods from health_data_periods
 * 8. Compute summary metrics
 * 9. Fetch merged annotations
 * 10. Generate insights (night viewType)
 * 11. Assemble NightDetailResponse
 * 12. Emit view.accessed audit event
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * VAL-NIGHT-001 through VAL-NIGHT-008, VAL-JOBS-006
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  healthDataDaily,
  healthDataSeries,
  healthDataPeriods,
  dismissedInsights,
  auditEvents,
} from "@/db/schema";
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
import { fetchMergedAnnotations } from "@/lib/dashboard/annotations";
import { generateInsights } from "@/lib/dashboard/insights";
import type { ViewerPermissions } from "@/lib/auth/request-context";
import { resolveGrantToken } from "@/lib/auth/resolve-grant-token";
import type { BaselinePayload, SummaryMetric } from "@/lib/dashboard/types";
import { resolveSourcesForMetrics } from "@/lib/api/source-resolution";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sleep stage event types used for the hypnogram. */
const SLEEP_STAGE_TYPES = ["awake", "light", "deep", "rem"];

/** Default metrics for the night view when none specified. */
const DEFAULT_NIGHT_METRICS = [
  "rhr",
  "hrv",
  "sleep_score",
  "sleep_latency",
  "deep_sleep",
  "rem_sleep",
  "sleep_efficiency",
  "spo2",
  "respiratory_rate",
  "awake_time",
];

/** Intraday series metric types (fetched from health_data_series). */
const INTRADAY_SERIES_METRICS = ["heart_rate", "glucose", "spo2"];

// ─── Validation ─────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const nightViewQuerySchema = z.object({
  date: z
    .string()
    .regex(DATE_REGEX, "date must be YYYY-MM-DD format")
    .refine(isValidDate, "date must be a valid calendar date"),
  metrics: z
    .string()
    .transform((s) => s.split(",").map((m) => m.trim()))
    .pipe(z.array(z.string().refine(isValidMetricType, "Invalid metric type")))
    .optional(),
  grant_token: z.string().optional(),
  timezone: z
    .string()
    .refine(isValidTimezone, "Invalid IANA timezone identifier")
    .optional(),
});

/**
 * Validate that a string is a valid IANA timezone identifier.
 * Uses Intl.DateTimeFormat to check validity.
 */
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidDate(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month! - 1 &&
    d.getUTCDate() === day
  );
}

// ─── GET /api/views/night ───────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Step 1: Auth
    let ctx = await getResolvedContext(request);

    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    // Step 2: Parse and validate query parameters
    const url = new URL(request.url);
    const queryParams = {
      date: url.searchParams.get("date") ?? undefined,
      metrics: url.searchParams.get("metrics") ?? undefined,
      grant_token: url.searchParams.get("grant_token") ?? undefined,
      timezone: url.searchParams.get("timezone") ?? undefined,
    };

    const parsed = nightViewQuerySchema.safeParse(queryParams);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
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

    const { date, timezone } = parsed.data;
    let requestedMetrics = parsed.data.metrics ?? DEFAULT_NIGHT_METRICS;

    // Step 3: Enforce permissions (viewer scoping)
    // For viewers, clamp the requested date to the grant window BEFORE
    // calling enforcePermissions. Per VAL-NIGHT-004 and LLD §7.4, dates
    // outside the grant range are clamped to the nearest boundary, not rejected.
    let effectiveDate = date;
    if (ctx.role === "viewer") {
      const permissions = ctx.permissions as ViewerPermissions;
      if (date < permissions.dataStart) {
        effectiveDate = permissions.dataStart;
      } else if (date > permissions.dataEnd) {
        effectiveDate = permissions.dataEnd;
      }
    }

    try {
      const scope = enforcePermissions(ctx, {
        userId: ctx.userId,
        metrics: requestedMetrics,
        startDate: effectiveDate,
        endDate: effectiveDate,
      });
      requestedMetrics = scope.metrics;
      effectiveDate = scope.startDate; // use clamped date
    } catch (error) {
      if (error instanceof PermissionError) {
        throw new ApiError(error.code, error.message, error.statusCode);
      }
      throw error;
    }

    // Compute night window: effectiveDate-1 day 20:00 to effectiveDate 08:00
    // in the user's timezone (default UTC). The local 8 PM–8 AM is converted
    // to UTC timestamps for database queries.
    const { start: nightWindowStart, end: nightWindowEnd } = computeNightWindow(
      effectiveDate,
      timezone,
    );

    const encryption = createEncryptionProvider();
    const userId = ctx.userId;

    // Step 4: Fetch baselines anchored to the effective date (FR-1.4)
    // Include intraday series metrics (glucose, heart_rate, spo2) alongside
    // the daily requestedMetrics so baseline bands render on intraday charts.
    const intradayForBaselines =
      ctx.role === "owner"
        ? INTRADAY_SERIES_METRICS
        : INTRADAY_SERIES_METRICS.filter((m) => requestedMetrics.includes(m));
    const baselineMetrics = [
      ...new Set([...requestedMetrics, ...intradayForBaselines]),
    ];
    const baselinesMap = await fetchBaselines(
      userId,
      baselineMetrics,
      effectiveDate, // referenceDate = effective (clamped) view date
      2, // tolerance
      encryption,
      db as Parameters<typeof fetchBaselines>[5],
    );

    // Step 5: Fetch daily values from health_data_daily for the effective date
    const dailyValues = await fetchDailyValues(
      userId,
      requestedMetrics,
      effectiveDate,
      encryption,
    );

    // Step 6: Fetch intraday series for the night window
    const seriesMetrics = INTRADAY_SERIES_METRICS.filter(
      (m) =>
        // If specific metrics requested, filter to requested + always include series metrics for owner
        ctx.role === "owner" || requestedMetrics.includes(m),
    );
    const seriesData = await fetchIntradaySeries(
      userId,
      ctx.role === "owner" ? INTRADAY_SERIES_METRICS : seriesMetrics,
      nightWindowStart,
      nightWindowEnd,
      encryption,
    );

    // Step 7: Fetch sleep periods (hypnogram)
    const hypnogram = await fetchSleepPeriods(
      userId,
      nightWindowStart,
      nightWindowEnd,
    );

    // Step 8: Compute summary metrics
    const summaryMap = computeSummaryMetrics(dailyValues, baselinesMap);

    // Step 9: Fetch merged annotations
    let viewerMetrics: string[] | undefined;
    if (ctx.role === "viewer") {
      const permissions = ctx.permissions as ViewerPermissions;
      viewerMetrics = permissions.allowedMetrics;
    }

    const annotations = await fetchMergedAnnotations(
      userId,
      nightWindowStart,
      nightWindowEnd,
      encryption,
      db as Parameters<typeof fetchMergedAnnotations>[4],
      viewerMetrics,
    );

    // Step 10: Generate insights
    const dismissedTypes = await getDismissedTypes(userId, effectiveDate);

    const insights = generateInsights("night", {
      viewType: "night",
      date: effectiveDate,
      summaries: summaryMap,
      baselines: baselinesMap,
      annotations,
      dismissedTypes,
    });

    // Step 11: Assemble response
    const response = {
      date: effectiveDate,
      time_range: {
        start: nightWindowStart,
        end: nightWindowEnd,
      },
      insights,
      annotations,
      series: seriesMapToResponse(seriesData),
      hypnogram,
      summary: summaryMapToResponse(summaryMap),
      baselines: baselinesMapToResponse(baselinesMap),
    };

    // Step 12: Emit view.accessed audit event (fire-and-forget)
    const metricsReturned = Object.keys(response.summary);
    const seriesMetricsReturned = Object.keys(response.series);
    const dataPointsReturned = Object.values(response.series).reduce(
      (sum, s) => sum + (s as { timestamps: string[] }).timestamps.length,
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
          view_type: "night",
          date: effectiveDate,
          metrics_requested: requestedMetrics,
          metrics_returned: [...metricsReturned, ...seriesMetricsReturned],
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
 * Compute the day before a YYYY-MM-DD date string.
 */
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0]!;
}

/**
 * Compute the night window (8 PM previous day to 8 AM current day) in the
 * specified timezone, returning UTC ISO strings.
 *
 * For UTC (default): date=2026-03-28 → 2026-03-27T20:00:00.000Z to 2026-03-28T08:00:00.000Z
 * For PST (UTC-8):   date=2026-03-28 → 2026-03-28T04:00:00.000Z to 2026-03-28T16:00:00.000Z
 *   (8 PM PST = 4 AM UTC next day; 8 AM PST = 4 PM UTC)
 *
 * @param dateStr - YYYY-MM-DD date for the night (morning date)
 * @param tz - IANA timezone identifier (e.g., "America/Los_Angeles"). Default: UTC
 * @returns Object with `start` and `end` as UTC ISO strings
 */
function computeNightWindow(
  dateStr: string,
  tz?: string,
): { start: string; end: string } {
  if (!tz || tz === "UTC") {
    // Fast path: no timezone conversion needed
    const prevDay = dayBefore(dateStr);
    return {
      start: `${prevDay}T20:00:00.000Z`,
      end: `${dateStr}T08:00:00.000Z`,
    };
  }

  // Compute the UTC offset for the timezone at the relevant local time.
  // Night window is local 8 PM (previous day) to local 8 AM (dateStr).
  //
  // Strategy: create dates in the target timezone and extract UTC equivalents.
  // We use the Intl.DateTimeFormat to determine the UTC offset for the timezone.
  const prevDay = dayBefore(dateStr);

  // Get UTC time for "prevDay 20:00" in the given timezone
  const startUtc = localTimeToUtc(prevDay, 20, 0, tz);
  // Get UTC time for "dateStr 08:00" in the given timezone
  const endUtc = localTimeToUtc(dateStr, 8, 0, tz);

  return {
    start: startUtc.toISOString(),
    end: endUtc.toISOString(),
  };
}

/**
 * Convert a local date+time in a timezone to a UTC Date.
 *
 * @param dateStr - YYYY-MM-DD date
 * @param hour - Hour (0-23) in local time
 * @param minute - Minute (0-59) in local time
 * @param tz - IANA timezone identifier
 * @returns UTC Date object
 */
function localTimeToUtc(
  dateStr: string,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Parse the local date components
  const [year, month, day] = dateStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];

  // Create a formatter that gives us the UTC offset for this timezone at the local time.
  // We use a two-pass approach:
  // 1. Start with a UTC guess and use Intl to find what local time it maps to
  // 2. Compute the offset and adjust

  // Initial UTC guess: treat local time as UTC
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Format the guess in the target timezone to see what local time it becomes
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guessUtc);

  const getPart = (type: string) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0");

  const localYear = getPart("year");
  const localMonth = getPart("month");
  const localDay = getPart("day");
  const localHour = getPart("hour") === 24 ? 0 : getPart("hour");
  const localMinute = getPart("minute");

  // Compute difference in milliseconds between the target local time and what guessUtc maps to
  const targetLocal = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0, 0),
  );
  const actualLocal = new Date(
    Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, 0, 0),
  );

  // If guessUtc maps to localHour in the timezone, but we want targetHour,
  // we need to shift guessUtc by (targetLocal - actualLocal) to compensate.
  const offsetMs = targetLocal.getTime() - actualLocal.getTime();
  return new Date(guessUtc.getTime() + offsetMs);
}

/**
 * Fetch daily values from health_data_daily for a specific date.
 * Decrypts each row and returns a Map<metricType, value>.
 */
async function fetchDailyValues(
  userId: string,
  metrics: string[],
  date: string,
  encryption: ReturnType<typeof createEncryptionProvider>,
): Promise<Map<string, number>> {
  if (metrics.length === 0) return new Map();

  // Resolve preferred sources per metric
  const sourceResolutionMap = await resolveSourcesForMetrics(userId, metrics);

  const rows = await db
    .select({
      metricType: healthDataDaily.metricType,
      valueEncrypted: healthDataDaily.valueEncrypted,
      source: healthDataDaily.source,
    })
    .from(healthDataDaily)
    .where(
      and(
        eq(healthDataDaily.userId, userId),
        inArray(healthDataDaily.metricType, metrics),
        eq(healthDataDaily.date, date),
      ),
    );

  const values = new Map<string, number>();
  for (const row of rows) {
    // Apply source resolution filtering
    const resolution = sourceResolutionMap.get(row.metricType);
    if (resolution && row.source !== resolution.source) {
      continue;
    }

    const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
    const value = JSON.parse(decrypted.toString()) as number;
    values.set(row.metricType, value);
  }

  return values;
}

/**
 * Fetch intraday time-series data from health_data_series for the night window.
 * Returns a Map<metricType, {timestamps: string[], values: number[]}>.
 */
async function fetchIntradaySeries(
  userId: string,
  metrics: string[],
  windowStart: string,
  windowEnd: string,
  encryption: ReturnType<typeof createEncryptionProvider>,
): Promise<Map<string, { timestamps: string[]; values: number[] }>> {
  if (metrics.length === 0) return new Map();

  const rows = await db
    .select({
      metricType: healthDataSeries.metricType,
      recordedAt: healthDataSeries.recordedAt,
      valueEncrypted: healthDataSeries.valueEncrypted,
    })
    .from(healthDataSeries)
    .where(
      and(
        eq(healthDataSeries.userId, userId),
        inArray(healthDataSeries.metricType, metrics),
        between(
          healthDataSeries.recordedAt,
          new Date(windowStart),
          new Date(windowEnd),
        ),
      ),
    )
    .orderBy(healthDataSeries.recordedAt);

  const result = new Map<string, { timestamps: string[]; values: number[] }>();

  for (const row of rows) {
    const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
    const value = JSON.parse(decrypted.toString()) as number;

    if (!result.has(row.metricType)) {
      result.set(row.metricType, { timestamps: [], values: [] });
    }
    const entry = result.get(row.metricType)!;
    entry.timestamps.push(row.recordedAt.toISOString());
    entry.values.push(value);
  }

  return result;
}

/**
 * Fetch sleep periods from health_data_periods for the night window
 * and assemble the hypnogram structure.
 */
async function fetchSleepPeriods(
  userId: string,
  windowStart: string,
  windowEnd: string,
): Promise<{
  stages: { stage: string; start: string; end: string }[];
  total_duration_hr: number;
} | null> {
  const rows = await db
    .select({
      eventType: healthDataPeriods.eventType,
      startedAt: healthDataPeriods.startedAt,
      endedAt: healthDataPeriods.endedAt,
    })
    .from(healthDataPeriods)
    .where(
      and(
        eq(healthDataPeriods.userId, userId),
        inArray(healthDataPeriods.eventType, SLEEP_STAGE_TYPES),
        between(
          healthDataPeriods.startedAt,
          new Date(windowStart),
          new Date(windowEnd),
        ),
      ),
    )
    .orderBy(healthDataPeriods.startedAt);

  if (rows.length === 0) return null;

  const stages = rows.map((row) => ({
    stage: row.eventType,
    start: row.startedAt.toISOString(),
    end: row.endedAt.toISOString(),
  }));

  // Calculate total duration in hours
  const totalMs = rows.reduce((sum, row) => {
    return sum + (row.endedAt.getTime() - row.startedAt.getTime());
  }, 0);
  const totalDurationHr = Math.round((totalMs / (1000 * 60 * 60)) * 100) / 100;

  return {
    stages,
    total_duration_hr: totalDurationHr,
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

/**
 * Convert the series Map to the response format.
 */
function seriesMapToResponse(
  series: Map<string, { timestamps: string[]; values: number[] }>,
): Record<string, { timestamps: string[]; values: number[] }> {
  const result: Record<string, { timestamps: string[]; values: number[] }> = {};
  for (const [metric, data] of series) {
    result[metric] = data;
  }
  return result;
}

/**
 * Convert the summary Map to the response format.
 */
function summaryMapToResponse(
  summary: Map<string, SummaryMetric>,
): Record<string, SummaryMetric> {
  const result: Record<string, SummaryMetric> = {};
  for (const [metric, data] of summary) {
    result[metric] = data;
  }
  return result;
}

/** Minimum sample_count for baselines to be included in the response (VAL-CROSS-018). */
const MIN_BASELINE_HISTORY = 14;

/**
 * Convert the baselines Map to the response format matching LLD §8.1.
 * Baselines with sample_count < 14 are omitted entirely to avoid rendering
 * misleading normal ranges from insufficient history (VAL-CROSS-018).
 */
function baselinesMapToResponse(
  baselines: Map<string, BaselinePayload>,
): Record<
  string,
  {
    avg: number;
    stddev: number;
    upper: number;
    lower: number;
    sample_count: number;
  }
> {
  const result: Record<
    string,
    {
      avg: number;
      stddev: number;
      upper: number;
      lower: number;
      sample_count: number;
    }
  > = {};
  for (const [metric, payload] of baselines) {
    // Suppress baselines with insufficient history (VAL-CROSS-018)
    if (payload.sample_count < MIN_BASELINE_HISTORY) {
      continue;
    }
    result[metric] = {
      avg: payload.avg_30d,
      stddev: payload.stddev_30d,
      upper: payload.upper,
      lower: payload.lower,
      sample_count: payload.sample_count,
    };
  }
  return result;
}
