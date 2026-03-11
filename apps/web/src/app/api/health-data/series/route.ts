/**
 * GET /api/health-data/series — Query intraday series health data.
 *
 * Returns decrypted time-series readings (e.g., heart rate, glucose, SpO2)
 * with recorded_at timestamps and values.
 *
 * Auth: Owner (full access) or Viewer (scoped to grant)
 *
 * See: /docs/integrations-pipeline-lld.md §3.4
 */

import { NextResponse } from "next/server";
import { and, between, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { healthDataSeries, auditEvents } from "@/db/schema";
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
import { createEncryptionProvider } from "@/lib/encryption";
import { METRIC_TYPE_IDS, getMetricType } from "@/config/metrics";
import { PROVIDER_IDS } from "@/config/providers";

// ─── Validation Schema ──────────────────────────────────────────────────────

const seriesQuerySchema = z.object({
  metric_type: z.string().refine((m) => METRIC_TYPE_IDS.includes(m), {
    message: "Invalid metric type",
  }),
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

interface SeriesReading {
  recorded_at: string;
  value: number;
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
    const metricType = url.searchParams.get("metric_type");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const source = url.searchParams.get("source") || undefined;

    if (!metricType) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "metric_type parameter is required",
        400,
        [
          {
            field: "metric_type",
            message: "metric_type parameter is required",
          },
        ],
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

    const parseResult = seriesQuerySchema.safeParse({
      metric_type: metricType,
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

    // Enforce permissions (narrows scope for viewers)
    try {
      const scope = enforcePermissions(ctx, {
        userId: ctx.userId,
        metrics: [query.metric_type],
        startDate: query.from,
        endDate: query.to,
      });
      // Use the narrowed scope
      if (!scope.metrics.includes(query.metric_type)) {
        throw new ApiError(
          "FORBIDDEN",
          "No permitted metrics in this request",
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
      eq(healthDataSeries.userId, ctx.userId),
      eq(healthDataSeries.metricType, query.metric_type),
      between(healthDataSeries.recordedAt, fromTs, toTs),
    ];

    if (query.source) {
      conditions.push(eq(healthDataSeries.source, query.source));
    }

    // Fetch encrypted data
    const rows = await db
      .select({
        recordedAt: healthDataSeries.recordedAt,
        valueEncrypted: healthDataSeries.valueEncrypted,
        source: healthDataSeries.source,
      })
      .from(healthDataSeries)
      .where(and(...conditions))
      .orderBy(healthDataSeries.recordedAt);

    // Decrypt values
    const encryption = createEncryptionProvider();
    const readings: SeriesReading[] = [];

    for (const row of rows) {
      const decrypted = await encryption.decrypt(
        row.valueEncrypted,
        ctx.userId,
      );
      const value = JSON.parse(decrypted.toString()) as number;

      readings.push({
        recorded_at: row.recordedAt.toISOString(),
        value,
        source: row.source,
      });
    }

    const metricConfig = getMetricType(query.metric_type);

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
        resourceType: "health_data_series",
        resourceDetail: {
          metric_type: query.metric_type,
          date_range: { from: query.from, to: query.to },
          source: query.source || "all",
          readings_returned: readings.length,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        metric_type: query.metric_type,
        unit: metricConfig?.unit || "unknown",
        from: query.from,
        to: query.to,
        source: query.source || null,
        readings,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
