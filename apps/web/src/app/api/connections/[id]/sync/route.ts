/**
 * POST /api/connections/:id/sync — Manually trigger a data sync.
 *
 * Dispatches an Inngest sync.manual event for background processing.
 * Rejects if already syncing (409) or connection expired (403).
 * Sets sync_status to 'queued' while the event is dispatched.
 *
 * Auth: Owner (session required)
 *
 * See: /docs/integrations-pipeline-lld.md §7, §8.1
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerConnections, auditEvents } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { inngest } from "@/inngest/client";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { id } = await params;

    // Find the connection (only if owned by this user)
    const connections = await db
      .select()
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.id, id),
          eq(providerConnections.userId, ctx.userId),
        ),
      )
      .limit(1);

    if (connections.length === 0) {
      throw new ApiError("NOT_FOUND", "Connection not found", 404);
    }

    const connection = connections[0];

    // Reject if connection is expired — user must re-authenticate
    if (connection.status === "expired") {
      throw new ApiError(
        "FORBIDDEN",
        "Connection has expired. Please re-authenticate with the provider.",
        403,
      );
    }

    // Reject if already syncing (409 SYNC_IN_PROGRESS)
    if (connection.syncStatus === "syncing") {
      throw new ApiError(
        "CONFLICT",
        "A sync is already in progress for this connection",
        409,
      );
    }

    // Set status to queued
    await db
      .update(providerConnections)
      .set({ syncStatus: "queued", syncError: null, updatedAt: new Date() })
      .where(eq(providerConnections.id, id));

    // Dispatch Inngest manual sync event
    await inngest.send({
      name: "integration/sync.manual",
      data: {
        connectionId: id,
        userId: ctx.userId,
        provider: connection.provider,
      },
    });

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: "owner",
        actorId: ctx.userId,
        eventType: "data.synced",
        resourceType: "connection",
        resourceDetail: {
          connection_id: id,
          provider: connection.provider,
          trigger: "manual",
        },
        ipAddress: request.headers.get("x-forwarded-for") || "127.0.0.1",
      })
      .catch((err) => {
        console.error("Failed to emit audit event:", err);
      });

    return NextResponse.json({
      data: {
        sync_id: `sync_${Date.now()}`,
        status: "queued",
        message: `Sync dispatched for ${connection.provider} connection`,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
