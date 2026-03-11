/**
 * GET /api/health-data/periods — Query duration events (sleep stages, workouts, meals).
 *
 * Returns period events with started_at, ended_at, duration_sec, subtype.
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * See: /docs/integrations-pipeline-lld.md §3.5
 */

import { NextResponse } from "next/server";
import { and, between, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { healthDataPeriods, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import {
  enforceScope,
  enforcePermissions,
  PermissionError,
} from "@/lib/auth/permissions";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { METRIC_TYPE_IDS, getMetricType } from "@/config/metrics";
import { PROVIDER_IDS } from "@/config/providers";

// ─── Validation Schema ──────────────────────────────────────────────────────

const periodsQuerySchema = z.object({
  event_type: z.string().refine((m) => METRIC_TYPE_IDS.includes(m), {
    message: "Invalid event type",
  }),
  subtype: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  source: z
    .string()
    .refine((s) => PROVIDER_IDS.includes(s as (typeof PROVIDER_IDS)[number]), {
      message: "Invalid source provider",
    })
    .optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────────

interface PeriodEvent {
  started_at: string;
  ended_at: string;
  duration_sec: number;
  subtype: string | null;
  source: string;
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check API key rate limiting
    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    // Auth check: must be owner or viewer
    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Enforce scope for API key auth
    enforceScope(ctx, "health:read");

    // Parse and validate query parameters
    const url = new URL(request.url);
    const eventType = url.searchParams.get("event_type");
    const subtype = url.searchParams.get("subtype") || undefined;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const source = url.searchParams.get("source") || undefined;

    if (!eventType) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "event_type parameter is required",
        400,
        [{ field: "event_type", message: "event_type parameter is required" }],
      );
    }

    if (!from) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "from parameter is required",
        400,
        [{ field: "from", message: "from parameter is required" }],
      );
    }

    if (!to) {
      throw new ApiError("VALIDATION_ERROR", "to parameter is required", 400, [
        { field: "to", message: "to parameter is required" },
      ]);
    }

    const parseResult = periodsQuerySchema.safeParse({
      event_type: eventType,
      subtype,
      from,
      to,
      source,
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

    // Validate from <= to
    if (query.from > query.to) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "from date must be before or equal to to date",
        400,
        [
          {
            field: "from",
            message: "from date must be before or equal to to date",
          },
        ],
      );
    }

    // Enforce permissions — period event_types are in allowed_metrics
    try {
      const scope = enforcePermissions(ctx, {
        userId: ctx.userId,
        metrics: [query.event_type],
        startDate: query.from,
        endDate: query.to,
      });
      if (!scope.metrics.includes(query.event_type)) {
        throw new ApiError(
          "FORBIDDEN",
          "No permitted event types in this request",
          403,
        );
      }
    } catch (error) {
      if (error instanceof PermissionError) {
        throw new ApiError(error.code, error.message, error.statusCode);
      }
      throw error;
    }

    // Convert dates to timestamps for the query
    const fromTs = new Date(query.from + "T00:00:00.000Z");
    const toTs = new Date(query.to + "T23:59:59.999Z");

    // Build database query conditions
    const conditions = [
      eq(healthDataPeriods.userId, ctx.userId),
      eq(healthDataPeriods.eventType, query.event_type),
      between(healthDataPeriods.startedAt, fromTs, toTs),
    ];

    if (query.subtype) {
      conditions.push(eq(healthDataPeriods.subtype, query.subtype));
    }

    if (query.source) {
      conditions.push(eq(healthDataPeriods.source, query.source));
    }

    // Fetch data
    const rows = await db
      .select({
        startedAt: healthDataPeriods.startedAt,
        endedAt: healthDataPeriods.endedAt,
        durationSec: healthDataPeriods.durationSec,
        subtype: healthDataPeriods.subtype,
        source: healthDataPeriods.source,
      })
      .from(healthDataPeriods)
      .where(and(...conditions))
      .orderBy(healthDataPeriods.startedAt);

    // Build response
    const periods: PeriodEvent[] = rows.map((row) => ({
      started_at: row.startedAt.toISOString(),
      ended_at: row.endedAt.toISOString(),
      duration_sec: row.durationSec ?? 0,
      subtype: row.subtype,
      source: row.source,
    }));

    const metricConfig = getMetricType(query.event_type);

    // Validate grantId is a UUID before inserting
    const isValidUuid = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const auditGrantId =
      ctx.grantId && isValidUuid(ctx.grantId) ? ctx.grantId : null;

    // Emit audit event (fire-and-forget)
    const actorType = ctx.authMethod === "api_key" ? "api_key" : ctx.role;
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType,
        actorId: ctx.role === "owner" ? ctx.userId : null,
        grantId: auditGrantId,
        eventType: "data.viewed",
        resourceType: "health_data_periods",
        resourceDetail: {
          event_type: query.event_type,
          date_range: { from: query.from, to: query.to },
          source: query.source || "all",
          periods_returned: periods.length,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        event_type: query.event_type,
        label: metricConfig?.label || query.event_type,
        from: query.from,
        to: query.to,
        source: query.source || null,
        periods,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
