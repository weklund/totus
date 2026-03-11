/**
 * DELETE /api/connections/:id — Disconnect a data source.
 *
 * Deletes the connection record and encrypted tokens.
 * Does NOT delete imported health data.
 * Emits account.disconnected audit event.
 *
 * Auth: Owner (session required)
 *
 * See: /docs/api-database-lld.md Section 7.2.4
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerConnections, auditEvents } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { id } = await params;

    // Find and delete the connection (only if owned by this user)
    const deleted = await db
      .delete(providerConnections)
      .where(
        and(
          eq(providerConnections.id, id),
          eq(providerConnections.userId, ctx.userId),
        ),
      )
      .returning({
        id: providerConnections.id,
        provider: providerConnections.provider,
        userId: providerConnections.userId,
      });

    if (deleted.length === 0) {
      throw new ApiError("NOT_FOUND", "Connection not found", 404);
    }

    const now = new Date().toISOString();

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: "owner",
        actorId: ctx.userId,
        eventType: "account.disconnected",
        resourceType: "connection",
        resourceDetail: { connection_id: id, provider: deleted[0].provider },
        ipAddress: request.headers.get("x-forwarded-for") || "127.0.0.1",
      })
      .catch((err) => {
        console.error("Failed to emit audit event:", err);
      });

    return NextResponse.json({
      data: {
        id: deleted[0].id,
        provider: deleted[0].provider,
        disconnected_at: now,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
