/**
 * Annotation API endpoints.
 *
 * POST /api/annotations — Create a manual annotation.
 * GET /api/annotations — List annotations for a date range (merged with provider events).
 *
 * Auth: Owner for POST; Owner or Viewer for GET.
 *
 * See: /docs/dashboard-backend-lld.md §9.1, §9.2
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { userAnnotations, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import { createEncryptionProvider } from "@/lib/encryption";
import { fetchMergedAnnotations } from "@/lib/dashboard/annotations";
import type { ViewerPermissions } from "@/lib/auth/request-context";

// ─── Constants ──────────────────────────────────────────────────────────────

const ANNOTATION_EVENT_TYPES = [
  "meal",
  "workout",
  "travel",
  "alcohol",
  "medication",
  "supplement",
  "custom",
] as const;

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createAnnotationSchema = z.object({
  event_type: z.enum(ANNOTATION_EVENT_TYPES, {
    message: `event_type must be one of: ${ANNOTATION_EVENT_TYPES.join(", ")}`,
  }),
  label: z
    .string()
    .min(1, "Label is required")
    .max(255, "Label must be 255 characters or less"),
  note: z.string().max(1000, "Note must be 1000 characters or less").optional(),
  occurred_at: z.string().datetime("occurred_at must be a valid ISO datetime"),
  ended_at: z
    .string()
    .datetime("ended_at must be a valid ISO datetime")
    .optional(),
});

const getAnnotationsSchema = z.object({
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD format"),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "end must be YYYY-MM-DD format"),
  event_type: z
    .enum(ANNOTATION_EVENT_TYPES, {
      message: `event_type must be one of: ${ANNOTATION_EVENT_TYPES.join(", ")}`,
    })
    .optional(),
});

// ─── POST /api/annotations ──────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse and validate body
    const body = await request.json();
    const data = validateRequest(createAnnotationSchema, body);

    // Validate ended_at > occurred_at if provided
    if (data.ended_at) {
      const occurredDate = new Date(data.occurred_at);
      const endedDate = new Date(data.ended_at);
      if (endedDate <= occurredDate) {
        throw new ApiError(
          "VALIDATION_ERROR",
          "ended_at must be after occurred_at",
          400,
          [
            {
              field: "ended_at",
              message: "ended_at must be after occurred_at",
            },
          ],
        );
      }
    }

    // Encrypt label and note
    const encryption = createEncryptionProvider();
    const labelEncrypted = await encryption.encrypt(
      Buffer.from(data.label),
      ctx.userId,
    );

    let noteEncrypted: Buffer | null = null;
    if (data.note !== undefined) {
      noteEncrypted = await encryption.encrypt(
        Buffer.from(data.note),
        ctx.userId,
      );
    }

    // Insert into user_annotations
    const [annotation] = await db
      .insert(userAnnotations)
      .values({
        userId: ctx.userId,
        eventType: data.event_type,
        labelEncrypted,
        noteEncrypted,
        occurredAt: new Date(data.occurred_at),
        endedAt: data.ended_at ? new Date(data.ended_at) : null,
      })
      .returning();

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: ctx.authMethod === "api_key" ? "api_key" : "owner",
        actorId: ctx.userId,
        eventType: "annotation.created",
        resourceType: "annotation",
        resourceDetail: {
          annotation_id: annotation.id,
          event_type: data.event_type,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json(
      {
        data: {
          id: annotation.id,
          event_type: annotation.eventType,
          label: data.label,
          note: data.note ?? null,
          occurred_at: annotation.occurredAt.toISOString(),
          ended_at: annotation.endedAt
            ? annotation.endedAt.toISOString()
            : null,
          created_at: annotation.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── GET /api/annotations ───────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    if (ctx.role === "unauthenticated" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse query parameters
    const url = new URL(request.url);
    const queryParams = {
      start: url.searchParams.get("start"),
      end: url.searchParams.get("end"),
      event_type: url.searchParams.get("event_type") || undefined,
    };

    const parsed = getAnnotationsSchema.safeParse(queryParams);
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

    const { start, end, event_type } = parsed.data;

    // Validate end >= start
    if (end < start) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "end must be on or after start",
        400,
        [{ field: "end", message: "end must be on or after start" }],
      );
    }

    // Compute the datetime range for querying
    const startDate = `${start}T00:00:00.000Z`;
    const endDate = `${end}T23:59:59.999Z`;

    // Determine viewer metrics for scoping
    const encryption = createEncryptionProvider();
    let viewerMetrics: string[] | undefined;
    if (ctx.role === "viewer") {
      const permissions = ctx.permissions as ViewerPermissions;
      viewerMetrics = permissions.allowedMetrics;
    }

    // Fetch merged annotations (user + provider)
    let annotations = await fetchMergedAnnotations(
      ctx.userId,
      startDate,
      endDate,
      encryption,
      db as Parameters<typeof fetchMergedAnnotations>[4],
      viewerMetrics,
    );

    // Apply optional event_type filter
    if (event_type) {
      annotations = annotations.filter((a) => a.event_type === event_type);
    }

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType:
          ctx.role === "viewer"
            ? "viewer"
            : ctx.authMethod === "api_key"
              ? "api_key"
              : "owner",
        actorId: ctx.userId,
        grantId: ctx.grantId ?? null,
        eventType: "data.viewed",
        resourceType: "annotation",
        resourceDetail: {
          start,
          end,
          event_type: event_type ?? "all",
          count: annotations.length,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        annotations,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
