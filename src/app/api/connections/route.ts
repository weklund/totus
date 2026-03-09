/**
 * GET /api/connections — List user's data source connections.
 *
 * Returns the authenticated user's connected data sources with status,
 * last sync time, and connection date. Returns an empty array if no
 * connections exist.
 *
 * Auth: Owner (session required)
 *
 * See: /docs/api-database-lld.md Section 7.2.1
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ouraConnections } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";

/**
 * Derive connection status from token expiry and sync error state.
 *
 * - connected: token_expires_at is in the future
 * - expired: token_expires_at is in the past
 * - error: last sync had an error
 */
function deriveStatus(
  tokenExpiresAt: Date,
  syncError: string | null,
): "connected" | "expired" | "error" {
  if (syncError) return "error";
  if (tokenExpiresAt < new Date()) return "expired";
  return "connected";
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const connections = await db
      .select()
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, ctx.userId));

    const data = connections.map((conn) => ({
      id: conn.id,
      provider: "oura" as const,
      status: deriveStatus(conn.tokenExpiresAt, conn.syncError),
      last_sync_at: conn.lastSyncAt?.toISOString() ?? null,
      sync_status: conn.syncStatus,
      connected_at: conn.createdAt.toISOString(),
    }));

    return NextResponse.json({ data });
  } catch (error) {
    return createErrorResponse(error);
  }
}
