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
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { enforceScope } from "@/lib/auth/permissions";
import { createErrorResponse, ApiError } from "@/lib/api/errors";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check API key rate limiting
    const rateLimitResponse = checkApiKeyRateLimit(ctx);
    if (rateLimitResponse) return rateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Enforce scope for API key auth
    enforceScope(ctx, "connections:write");

    // The [provider] slug is used as a connection ID for DELETE operations
    const { provider: id } = await params;

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
    const actorType = ctx.authMethod === "api_key" ? "api_key" : "owner";
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType,
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
