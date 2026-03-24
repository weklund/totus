/**
 * GET /api/viewer/data — Fetch health data scoped to viewer's grant permissions.
 *
 * Auth: Viewer (requires valid totus_viewer cookie) or Owner (full access, like /api/health-data)
 *
 * Processing:
 * 1. Verify viewer JWT from cookie (via middleware request context)
 * 2. Parse query params (metrics, start, end, resolution)
 * 3. Re-validate grant against database (check not revoked since JWT issued)
 * 4. Enforce grant scope: intersect metrics, clamp dates
 * 5. Query and decrypt health data
 * 6. Emit data.viewed audit event
 *
 * See: /docs/api-database-lld.md Section 7.5.2
 */

import { NextResponse } from "next/server";
import { and, between, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { healthDataDaily, auditEvents, shareGrants } from "@/db/schema";
import { getResolvedContext } from "@/lib/auth/resolve-api-key";
import { enforcePermissions, PermissionError } from "@/lib/auth/permissions";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { createEncryptionProvider } from "@/lib/encryption";
import { METRIC_TYPE_IDS, getMetricType } from "@/config/metrics";

// ─── Validation Schema ──────────────────────────────────────────────────────

const VALID_RESOLUTIONS = ["daily", "weekly", "monthly"] as const;

const viewerDataQuerySchema = z.object({
  metrics: z
    .array(
      z.string().refine((m) => METRIC_TYPE_IDS.includes(m), {
        message: "Invalid metric type",
      }),
    )
    .min(1, "At least one metric is required")
    .max(10, "Maximum 10 metrics allowed"),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  resolution: z.enum(VALID_RESOLUTIONS).default("daily"),
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface DataPoint {
  date: string;
  value: number;
  source: string;
}

// ─── Aggregation Helpers ────────────────────────────────────────────────────

/**
 * Get the ISO week Monday for a given date string (YYYY-MM-DD).
 */
function getIsoWeekMonday(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().split("T")[0]!;
}

/**
 * Get the first day of the month for a given date string (YYYY-MM-DD).
 */
function getFirstOfMonth(dateStr: string): string {
  return dateStr.substring(0, 7) + "-01";
}

/**
 * Aggregate daily data points by period (week or month).
 */
function aggregatePoints(
  points: DataPoint[],
  resolution: "weekly" | "monthly",
): DataPoint[] {
  const groupFn = resolution === "weekly" ? getIsoWeekMonday : getFirstOfMonth;

  const groups = new Map<
    string,
    { sum: number; count: number; source: string }
  >();

  for (const point of points) {
    const key = groupFn(point.date);
    const existing = groups.get(key);
    if (existing) {
      existing.sum += point.value;
      existing.count += 1;
    } else {
      groups.set(key, { sum: point.value, count: 1, source: point.source });
    }
  }

  return Array.from(groups.entries())
    .map(([date, { sum, count, source }]) => ({
      date,
      value: Math.round((sum / count) * 100) / 100,
      source,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Auth check: must be owner or viewer
    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // For viewer role: re-validate grant against database
    if (ctx.role === "viewer" && ctx.grantId) {
      const grantResults = await db
        .select({
          id: shareGrants.id,
          revokedAt: shareGrants.revokedAt,
          grantExpires: shareGrants.grantExpires,
        })
        .from(shareGrants)
        .where(eq(shareGrants.id, ctx.grantId));

      if (grantResults.length === 0) {
        throw new ApiError("FORBIDDEN", "Share grant is no longer valid", 403);
      }

      const grant = grantResults[0];

      if (grant.revokedAt !== null) {
        throw new ApiError("FORBIDDEN", "Share grant has been revoked", 403);
      }

      if (grant.grantExpires <= new Date()) {
        throw new ApiError("FORBIDDEN", "Share grant has expired", 403);
      }
    }

    // Parse and validate query parameters
    const url = new URL(request.url);
    const metricsParam = url.searchParams.get("metrics");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const resolutionParam = url.searchParams.get("resolution") || "daily";

    if (!metricsParam) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "metrics parameter is required",
        400,
        [{ field: "metrics", message: "metrics parameter is required" }],
      );
    }

    if (!startParam) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "start parameter is required",
        400,
        [{ field: "start", message: "start parameter is required" }],
      );
    }

    if (!endParam) {
      throw new ApiError("VALIDATION_ERROR", "end parameter is required", 400, [
        { field: "end", message: "end parameter is required" },
      ]);
    }

    const metrics = metricsParam.split(",").filter(Boolean);

    const parseResult = viewerDataQuerySchema.safeParse({
      metrics,
      start: startParam,
      end: endParam,
      resolution: resolutionParam,
    });

    if (!parseResult.success) {
      const details = parseResult.error.issues.map((issue) => ({
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

    const query = parseResult.data;

    // Validate start <= end
    if (query.start > query.end) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "start date must be before or equal to end date",
        400,
        [
          {
            field: "start",
            message: "start date must be before or equal to end date",
          },
        ],
      );
    }

    // Enforce permissions (narrows scope for viewers)
    let effectiveMetrics: string[];
    let effectiveStart: string;
    let effectiveEnd: string;

    try {
      const scope = enforcePermissions(ctx, {
        userId: ctx.userId,
        metrics: query.metrics,
        startDate: query.start,
        endDate: query.end,
      });
      effectiveMetrics = scope.metrics;
      effectiveStart = scope.startDate;
      effectiveEnd = scope.endDate;
    } catch (error) {
      if (error instanceof PermissionError) {
        throw new ApiError(error.code, error.message, error.statusCode);
      }
      throw error;
    }

    // Build database query conditions
    const conditions = [
      eq(healthDataDaily.userId, ctx.userId),
      inArray(healthDataDaily.metricType, effectiveMetrics),
      between(healthDataDaily.date, effectiveStart, effectiveEnd),
    ];

    // Fetch encrypted data
    const rows = await db
      .select({
        metricType: healthDataDaily.metricType,
        date: healthDataDaily.date,
        valueEncrypted: healthDataDaily.valueEncrypted,
        source: healthDataDaily.source,
      })
      .from(healthDataDaily)
      .where(and(...conditions))
      .orderBy(healthDataDaily.metricType, healthDataDaily.date);

    // Decrypt values
    const encryption = createEncryptionProvider();
    const decryptedByMetric = new Map<string, DataPoint[]>();

    for (const row of rows) {
      const decrypted = await encryption.decrypt(
        row.valueEncrypted,
        ctx.userId,
      );
      const value = JSON.parse(decrypted.toString()) as number;

      const points = decryptedByMetric.get(row.metricType) || [];
      points.push({
        date: row.date,
        value,
        source: row.source,
      });
      decryptedByMetric.set(row.metricType, points);
    }

    // Build response with aggregation if needed
    const metricsResponse: Record<
      string,
      { unit: string; points: DataPoint[] }
    > = {};
    const metricsReturned: string[] = [];

    for (const metricId of effectiveMetrics) {
      const metricConfig = getMetricType(metricId);
      const rawPoints = decryptedByMetric.get(metricId) || [];

      let points: DataPoint[];
      if (query.resolution === "daily") {
        points = rawPoints.sort((a, b) => a.date.localeCompare(b.date));
      } else {
        points = aggregatePoints(rawPoints, query.resolution);
      }

      metricsResponse[metricId] = {
        unit: metricConfig?.unit || "unknown",
        points,
      };

      if (rawPoints.length > 0) {
        metricsReturned.push(metricId);
      }
    }

    // Count total data points returned for audit
    let totalPointsReturned = 0;
    for (const metric of Object.values(metricsResponse)) {
      totalPointsReturned += metric.points.length;
    }

    // Validate grantId is a UUID before inserting (audit column is UUID type)
    const isValidUuid = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const auditGrantId =
      ctx.grantId && isValidUuid(ctx.grantId) ? ctx.grantId : null;

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: ctx.role === "viewer" ? "viewer" : ctx.role,
        actorId: ctx.role === "owner" ? ctx.userId : null,
        grantId: auditGrantId,
        eventType: "data.viewed",
        resourceType: "health_data",
        resourceDetail: {
          metrics: effectiveMetrics,
          date_range: { start: effectiveStart, end: effectiveEnd },
          resolution: query.resolution,
          data_points_returned: totalPointsReturned,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    // Build scope info for viewer response
    const scopeInfo =
      ctx.role === "viewer" && ctx.grantId
        ? {
            scope: {
              grant_id: ctx.grantId,
              allowed_metrics:
                ctx.permissions !== "full"
                  ? ctx.permissions.allowedMetrics
                  : effectiveMetrics,
              data_start:
                ctx.permissions !== "full"
                  ? ctx.permissions.dataStart
                  : effectiveStart,
              data_end:
                ctx.permissions !== "full"
                  ? ctx.permissions.dataEnd
                  : effectiveEnd,
            },
          }
        : {};

    return NextResponse.json({
      data: {
        metrics: metricsResponse,
        query: {
          start: effectiveStart,
          end: effectiveEnd,
          resolution: query.resolution,
          metrics_requested: query.metrics,
          metrics_returned: metricsReturned,
        },
        ...scopeInfo,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
