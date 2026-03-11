/**
 * GET /api/audit — Paginated, filterable audit event log.
 *
 * Query params:
 *   event_type - Filter by event type (e.g., share.created, data.viewed)
 *   actor_type - Filter by actor type (owner, viewer, system)
 *   grant_id   - Filter by grant ID
 *   start      - Filter by start date (ISO or YYYY-MM-DD)
 *   end        - Filter by end date (ISO or YYYY-MM-DD)
 *   cursor     - Cursor for pagination
 *   limit      - Page size (default 50, max 100)
 *
 * Returns paginated audit events with human-readable descriptions.
 *
 * Auth: Owner (session required).
 *
 * See: /docs/api-database-lld.md Section 7.6
 */

import { NextResponse } from "next/server";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import {
  createErrorResponse,
  ApiError,
  paginateResults,
  decodeCursor,
} from "@/lib/api";

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_ACTOR_TYPES = ["owner", "viewer", "system"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a human-readable description for an audit event.
 */
function describeEvent(
  eventType: string,
  actorType: string,
  resourceDetail: unknown,
): string {
  const detail = resourceDetail as Record<string, unknown> | null;

  switch (eventType) {
    case "account.settings":
      if (detail?.field === "display_name") {
        return `Updated display name to "${detail.new_value}"`;
      }
      return "Updated account settings";

    case "account.connected":
      return "Connected Oura Ring";

    case "account.disconnected":
      return "Disconnected Oura Ring";

    case "account.deleted":
      return "Account deleted";

    case "data.exported":
      return `Exported all account data (${detail?.health_data_points ?? 0} data points)`;

    case "data.viewed": {
      const metrics = detail?.metrics as string[] | undefined;
      if (actorType === "viewer") {
        return `Viewer accessed ${metrics?.length ?? 0} metric(s) via shared link`;
      }
      return `Viewed ${metrics?.length ?? 0} metric(s)`;
    }

    case "data.synced":
      return "Synced health data from Oura";

    case "share.created": {
      const label = detail?.label;
      return label
        ? `Created share link "${label}"`
        : "Created a new share link";
    }

    case "share.viewed":
      return "Share link was viewed";

    case "share.revoked": {
      const label = detail?.label;
      return label ? `Revoked share link "${label}"` : "Revoked a share link";
    }

    case "share.deleted": {
      const label = detail?.label;
      return label ? `Deleted share link "${label}"` : "Deleted a share link";
    }

    default:
      return eventType.replace(/\./g, " ");
  }
}

/**
 * Validate UUID format.
 */
function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

// ─── GET /api/audit ─────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse query parameters
    const url = new URL(request.url);
    const eventType = url.searchParams.get("event_type");
    const actorType = url.searchParams.get("actor_type");
    const grantId = url.searchParams.get("grant_id");
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const cursor = url.searchParams.get("cursor");
    const limitParam = url.searchParams.get("limit");

    const limit = Math.min(
      Math.max(
        parseInt(limitParam || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
        1,
      ),
      MAX_LIMIT,
    );

    // Validate actor_type filter
    if (actorType && !VALID_ACTOR_TYPES.includes(actorType)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid actor_type filter. Must be one of: owner, viewer, system",
        400,
      );
    }

    // Validate grant_id format
    if (grantId && !isValidUuid(grantId)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid grant_id format. Must be a valid UUID",
        400,
      );
    }

    // Validate date formats
    const dateRegex = /^\d{4}-\d{2}-\d{2}(T.*)?$/;
    if (startParam && !dateRegex.test(startParam)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid start date format. Use YYYY-MM-DD or ISO 8601",
        400,
      );
    }
    if (endParam && !dateRegex.test(endParam)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid end date format. Use YYYY-MM-DD or ISO 8601",
        400,
      );
    }

    // Build conditions
    const conditions = [eq(auditEvents.ownerId, ctx.userId)];

    if (eventType) {
      conditions.push(eq(auditEvents.eventType, eventType));
    }

    if (actorType) {
      conditions.push(eq(auditEvents.actorType, actorType));
    }

    if (grantId) {
      conditions.push(eq(auditEvents.grantId, grantId));
    }

    if (startParam) {
      const startDate = startParam.includes("T")
        ? startParam
        : `${startParam}T00:00:00.000Z`;
      conditions.push(
        sql`${auditEvents.createdAt} >= ${startDate}::timestamptz`,
      );
    }

    if (endParam) {
      const endDate = endParam.includes("T")
        ? endParam
        : `${endParam}T23:59:59.999Z`;
      conditions.push(sql`${auditEvents.createdAt} <= ${endDate}::timestamptz`);
    }

    // Apply cursor
    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) {
        conditions.push(
          sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${decoded.createdAt}::timestamptz, ${decoded.id}::bigint)`,
        );
      }
    }

    // Query limit+1 to determine has_more
    const rows = await db
      .select()
      .from(auditEvents)
      .where(and(...conditions))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(limit + 1);

    // Build paginated response
    const result = paginateResults(
      rows,
      limit,
      (item) => item.createdAt.toISOString(),
      (item) => item.id.toString(),
    );

    const data = result.data.map((event) => ({
      id: event.id.toString(),
      event_type: event.eventType,
      actor_type: event.actorType,
      actor_id: event.actorId,
      grant_id: event.grantId,
      resource_type: event.resourceType,
      resource_detail: event.resourceDetail,
      description: describeEvent(
        event.eventType,
        event.actorType,
        event.resourceDetail,
      ),
      ip_address: event.ipAddress,
      user_agent: event.userAgent,
      created_at: event.createdAt.toISOString(),
    }));

    return NextResponse.json({
      data,
      pagination: result.pagination,
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
