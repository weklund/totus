/**
 * Share management API endpoints.
 *
 * POST /api/shares — Create a new share grant.
 * GET /api/shares — List the owner's share grants with status filter & pagination.
 *
 * Auth: Owner (session required) for both endpoints.
 *
 * See: /docs/api-database-lld.md Section 7.4
 */

import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shareGrants, auditEvents } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import {
  createErrorResponse,
  ApiError,
  validateRequest,
  paginateResults,
  decodeCursor,
} from "@/lib/api";
import { generateShareToken } from "@/lib/auth/viewer";
import { METRIC_TYPE_IDS } from "@/config/metrics";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ACTIVE_SHARES = 50;

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createShareSchema = z.object({
  label: z
    .string()
    .min(1, "Label is required")
    .max(255, "Label must be 255 characters or less"),
  allowed_metrics: z
    .array(
      z.string().refine((m) => METRIC_TYPE_IDS.includes(m), {
        message: "Invalid metric type",
      }),
    )
    .min(1, "At least one metric is required")
    .max(21, "Maximum 21 metrics allowed"),
  data_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  data_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  expires_in_days: z
    .number()
    .int("Must be an integer")
    .min(1, "Minimum 1 day")
    .max(365, "Maximum 365 days"),
  note: z
    .string()
    .max(1000, "Note must be 1000 characters or less")
    .optional()
    .nullable(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute status from grant fields.
 */
function computeStatus(
  revokedAt: Date | null,
  grantExpires: Date,
): "active" | "expired" | "revoked" {
  if (revokedAt !== null) return "revoked";
  if (grantExpires <= new Date()) return "expired";
  return "active";
}

// ─── POST /api/shares ───────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse and validate body
    const body = await request.json();
    const data = validateRequest(createShareSchema, body);

    // Validate data_end >= data_start
    if (data.data_end < data.data_start) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "data_end must be on or after data_start",
        400,
        [
          {
            field: "data_end",
            message: "data_end must be on or after data_start",
          },
        ],
      );
    }

    // Check max active shares limit
    const activeShareCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shareGrants)
      .where(
        and(
          eq(shareGrants.ownerId, ctx.userId),
          isNull(shareGrants.revokedAt),
          sql`${shareGrants.grantExpires} > now()`,
        ),
      );

    const count = activeShareCount[0]?.count ?? 0;
    if (count >= MAX_ACTIVE_SHARES) {
      throw new ApiError(
        "MAX_SHARES_EXCEEDED",
        `Maximum ${MAX_ACTIVE_SHARES} active shares allowed. Revoke or wait for existing shares to expire.`,
        409,
      );
    }

    // Generate share token
    const { rawToken, tokenHash } = generateShareToken();

    // Compute grant_expires
    const grantExpires = new Date();
    grantExpires.setDate(grantExpires.getDate() + data.expires_in_days);

    // Insert the share grant
    const [grant] = await db
      .insert(shareGrants)
      .values({
        token: tokenHash,
        ownerId: ctx.userId,
        label: data.label,
        note: data.note ?? null,
        allowedMetrics: data.allowed_metrics,
        dataStart: data.data_start,
        dataEnd: data.data_end,
        grantExpires,
      })
      .returning();

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: "owner",
        actorId: ctx.userId,
        grantId: grant.id,
        eventType: "share.created",
        resourceType: "share_grant",
        resourceDetail: {
          label: data.label,
          allowed_metrics: data.allowed_metrics,
          data_start: data.data_start,
          data_end: data.data_end,
          expires_in_days: data.expires_in_days,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    return NextResponse.json(
      {
        data: {
          id: grant.id,
          token: rawToken,
          share_url: `${appUrl}/v/${rawToken}`,
          label: grant.label,
          allowed_metrics: grant.allowedMetrics,
          data_start: grant.dataStart,
          data_end: grant.dataEnd,
          grant_expires: grant.grantExpires.toISOString(),
          note: grant.note,
          created_at: grant.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── GET /api/shares ────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse query parameters
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "all";
    const cursor = url.searchParams.get("cursor");
    const limitParam = url.searchParams.get("limit");
    const limit = Math.min(
      Math.max(parseInt(limitParam || "20", 10) || 20, 1),
      50,
    );

    // Validate status parameter
    if (!["active", "expired", "revoked", "all"].includes(status)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid status filter. Must be one of: active, expired, revoked, all",
        400,
      );
    }

    // Build conditions
    const conditions = [eq(shareGrants.ownerId, ctx.userId)];

    // Apply status filter
    const now = new Date();
    if (status === "active") {
      conditions.push(isNull(shareGrants.revokedAt));
      conditions.push(sql`${shareGrants.grantExpires} > ${now.toISOString()}`);
    } else if (status === "expired") {
      conditions.push(isNull(shareGrants.revokedAt));
      conditions.push(sql`${shareGrants.grantExpires} <= ${now.toISOString()}`);
    } else if (status === "revoked") {
      conditions.push(isNotNull(shareGrants.revokedAt));
    }

    // Apply cursor
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        conditions.push(
          sql`(${shareGrants.createdAt}, ${shareGrants.id}) < (${decoded.createdAt}, ${decoded.id})`,
        );
      }
    }

    // Query limit+1 to determine has_more
    const rows = await db
      .select()
      .from(shareGrants)
      .where(and(...conditions))
      .orderBy(desc(shareGrants.createdAt), desc(shareGrants.id))
      .limit(limit + 1);

    // Build paginated response
    const result = paginateResults(
      rows,
      limit,
      (item) => item.createdAt.toISOString(),
      (item) => item.id,
    );

    const data = result.data.map((grant) => ({
      id: grant.id,
      label: grant.label,
      allowed_metrics: grant.allowedMetrics,
      data_start: grant.dataStart,
      data_end: grant.dataEnd,
      grant_expires: grant.grantExpires.toISOString(),
      status: computeStatus(grant.revokedAt, grant.grantExpires),
      revoked_at: grant.revokedAt?.toISOString() ?? null,
      view_count: grant.viewCount,
      last_viewed_at: grant.lastViewedAt?.toISOString() ?? null,
      created_at: grant.createdAt.toISOString(),
    }));

    return NextResponse.json({
      data,
      pagination: result.pagination,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
