/**
 * Multi-Day Recovery View endpoint.
 *
 * GET /api/views/recovery — Returns daily metric values over a 2–14 day range
 * with baselines, sparklines, triggering event, annotations, and insights.
 *
 * Composition flow (LLD §8.2):
 * 1. Parse/validate (start, end required YYYY-MM-DD, metrics optional, event_id optional, grant_token optional)
 * 2. Validate date range 2–14 days
 * 3. Auth + permissions (viewer scoping)
 * 4. Fetch baselines anchored to start date (FR-1.4)
 * 5. For each date in range: fetch daily values, compute summary metrics
 * 6. Build sparklines per metric
 * 7. If event_id provided: fetch and decrypt the triggering annotation (verify ownership, 404 if not found)
 * 8. Fetch merged annotations for range
 * 9. Generate insights (recovery viewType)
 * 10. Assemble RecoveryResponse
 * 11. Emit audit event
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * VAL-RECOV-001 through VAL-RECOV-007
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, between, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  healthDataDaily,
  dismissedInsights,
  userAnnotations,
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
import type {
  Annotation,
  BaselinePayload,
  SummaryMetric,
} from "@/lib/dashboard/types";
import { resolveSourcesForMetrics } from "@/lib/api/source-resolution";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default metrics for the recovery view when none specified (LLD §8.2). */
const DEFAULT_RECOVERY_METRICS = [
  "readiness_score",
  "hrv",
  "rhr",
  "sleep_score",
  "body_temperature_deviation",
];

/** Minimum date range in days (inclusive). */
const MIN_RANGE_DAYS = 2;

/** Maximum date range in days (inclusive). */
const MAX_RANGE_DAYS = 14;

// ─── Validation ─────────────────────────────────────────────────────────────

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const recoveryViewQuerySchema = z.object({
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
    .pipe(z.array(z.string().refine(isValidMetricType, "Invalid metric type")))
    .optional(),
  event_id: z
    .string()
    .transform((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n <= 0) throw new Error("Invalid event_id");
      return n;
    })
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
 * E.g., 2026-03-24 to 2026-03-28 = 5 days.
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

// ─── GET /api/views/recovery ────────────────────────────────────────────────

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
      event_id: url.searchParams.get("event_id") ?? undefined,
      grant_token: url.searchParams.get("grant_token") ?? undefined,
    };

    const parsed = recoveryViewQuerySchema.safeParse(queryParams);
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

    const { start, end, event_id } = parsed.data;
    let requestedMetrics = parsed.data.metrics ?? DEFAULT_RECOVERY_METRICS;

    // Validate date range: 2–14 days (inclusive)
    const rangeDays = daysBetweenInclusive(start, end);
    if (start > end) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "start must be before or equal to end",
        400,
      );
    }
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

    // Step 5: For each date in range — fetch daily values and compute summaries
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

    // Decrypt and group by date
    const valuesByDate = new Map<string, Map<string, number>>();
    for (const date of dateRange) {
      valuesByDate.set(date, new Map());
    }

    for (const row of dailyRows) {
      // Apply source resolution filtering
      const resolution = sourceResolutionMap.get(row.metricType);
      if (resolution && row.source !== resolution.source) {
        continue;
      }

      const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
      const value = JSON.parse(decrypted.toString()) as number;

      const dateMap = valuesByDate.get(row.date);
      if (dateMap) {
        dateMap.set(row.metricType, value);
      }
    }

    // Compute summary metrics for each date
    const daily: Record<string, { metrics: Record<string, SummaryMetric> }> =
      {};
    for (const date of dateRange) {
      const dayValues = valuesByDate.get(date)!;
      const summaryMap = computeSummaryMetrics(dayValues, baselinesMap);

      const metricsObj: Record<string, SummaryMetric> = {};
      for (const [metric, summary] of summaryMap) {
        metricsObj[metric] = summary;
      }
      daily[date] = { metrics: metricsObj };
    }

    // Step 6: Build sparklines per metric
    const sparklines: Record<string, { dates: string[]; values: number[] }> =
      {};
    for (const metric of requestedMetrics) {
      const dates: string[] = [];
      const values: number[] = [];

      for (const date of dateRange) {
        const dayValues = valuesByDate.get(date)!;
        const value = dayValues.get(metric);
        if (value !== undefined) {
          dates.push(date);
          values.push(value);
        }
        // Skip dates with missing data (no zero-fill)
      }

      if (dates.length > 0) {
        sparklines[metric] = { dates, values };
      }
    }

    // Step 7: If event_id provided, fetch and decrypt the triggering annotation
    let triggeringEvent: Annotation | null = null;
    if (event_id !== undefined) {
      const annotationRows = await db
        .select({
          id: userAnnotations.id,
          userId: userAnnotations.userId,
          eventType: userAnnotations.eventType,
          labelEncrypted: userAnnotations.labelEncrypted,
          noteEncrypted: userAnnotations.noteEncrypted,
          occurredAt: userAnnotations.occurredAt,
          endedAt: userAnnotations.endedAt,
        })
        .from(userAnnotations)
        .where(eq(userAnnotations.id, event_id));

      if (annotationRows.length === 0) {
        throw new ApiError(
          "NOT_FOUND",
          "Triggering event annotation not found",
          404,
        );
      }

      const annotation = annotationRows[0]!;

      // Verify ownership
      if (annotation.userId !== userId) {
        throw new ApiError(
          "NOT_FOUND",
          "Triggering event annotation not found",
          404,
        );
      }

      // For viewers: validate that the annotation occurred_at falls within the
      // viewer's grant date window. If outside, return null triggering_event
      // instead of exposing data outside the grant boundaries.
      if (ctx.role === "viewer") {
        const permissions = ctx.permissions as ViewerPermissions;
        const occurredDate = annotation.occurredAt.toISOString().split("T")[0]!;
        if (
          occurredDate < permissions.dataStart ||
          occurredDate > permissions.dataEnd
        ) {
          // Annotation is outside the viewer's grant window — suppress it
          triggeringEvent = null;
        } else {
          // Within grant window — decrypt and return
          const labelDecrypted = await encryption.decrypt(
            annotation.labelEncrypted,
            userId,
          );
          const label = labelDecrypted.toString();

          let note: string | null = null;
          if (annotation.noteEncrypted) {
            const noteDecrypted = await encryption.decrypt(
              annotation.noteEncrypted,
              userId,
            );
            note = noteDecrypted.toString();
          }

          triggeringEvent = {
            id: annotation.id,
            source: "user",
            event_type: annotation.eventType,
            label,
            note,
            occurred_at: annotation.occurredAt.toISOString(),
            ended_at: annotation.endedAt
              ? annotation.endedAt.toISOString()
              : null,
          };
        }
      } else {
        // Owner: full access — decrypt and return
        const labelDecrypted = await encryption.decrypt(
          annotation.labelEncrypted,
          userId,
        );
        const label = labelDecrypted.toString();

        let note: string | null = null;
        if (annotation.noteEncrypted) {
          const noteDecrypted = await encryption.decrypt(
            annotation.noteEncrypted,
            userId,
          );
          note = noteDecrypted.toString();
        }

        triggeringEvent = {
          id: annotation.id,
          source: "user",
          event_type: annotation.eventType,
          label,
          note,
          occurred_at: annotation.occurredAt.toISOString(),
          ended_at: annotation.endedAt
            ? annotation.endedAt.toISOString()
            : null,
        };
      }
    }

    // Step 8: Fetch merged annotations for range
    let viewerMetrics: string[] | undefined;
    if (ctx.role === "viewer") {
      const permissions = ctx.permissions as ViewerPermissions;
      viewerMetrics = permissions.allowedMetrics;
    }

    const annotations = await fetchMergedAnnotations(
      userId,
      `${effectiveStart}T00:00:00.000Z`,
      `${effectiveEnd}T23:59:59.999Z`,
      encryption,
      db as Parameters<typeof fetchMergedAnnotations>[4],
      viewerMetrics,
    );

    // Step 9: Generate insights (recovery viewType)
    // For recovery view, use the last date's summaries for insight generation
    const lastDate = dateRange[dateRange.length - 1]!;
    const lastDayValues = valuesByDate.get(lastDate)!;
    const lastDaySummaries = computeSummaryMetrics(lastDayValues, baselinesMap);

    const dismissedTypes = await getDismissedTypes(userId, lastDate);

    const insights = generateInsights("recovery", {
      viewType: "recovery",
      date: lastDate,
      summaries: lastDaySummaries,
      baselines: baselinesMap,
      annotations,
      dismissedTypes,
    });

    // Step 10: Assemble RecoveryResponse
    const response = {
      date_range: {
        start: effectiveStart,
        end: effectiveEnd,
      },
      triggering_event: triggeringEvent,
      insights,
      daily,
      baselines: baselinesMapToResponse(baselinesMap),
      sparklines,
      annotations,
    };

    // Step 11: Emit view.accessed audit event (fire-and-forget)
    const metricsReturned = [
      ...new Set(Object.values(daily).flatMap((d) => Object.keys(d.metrics))),
    ];
    const dataPointsReturned = Object.values(daily).reduce(
      (sum, d) => sum + Object.keys(d.metrics).length,
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
          view_type: "recovery",
          date_range: { start: effectiveStart, end: effectiveEnd },
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
 * Convert the baselines Map to the response format matching LLD §8.2.
 */
function baselinesMapToResponse(
  baselines: Map<string, BaselinePayload>,
): Record<
  string,
  { avg: number; stddev: number; upper: number; lower: number }
> {
  const result: Record<
    string,
    { avg: number; stddev: number; upper: number; lower: number }
  > = {};
  for (const [metric, payload] of baselines) {
    result[metric] = {
      avg: payload.avg_30d,
      stddev: payload.stddev_30d,
      upper: payload.upper,
      lower: payload.lower,
    };
  }
  return result;
}
