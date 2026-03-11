/**
 * API key detail and revoke endpoint.
 *
 * PATCH /api/keys/:id — Revoke an API key (idempotent).
 *
 * Auth: Owner (session or API key with keys:write scope).
 *
 * See: /docs/cli-mcp-server-lld.md Section 7.5.3
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apiKeys, auditEvents } from "@/db/schema";
import { getResolvedContext } from "@/lib/auth/resolve-api-key";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import { enforceScope } from "@/lib/auth/permissions";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const patchKeySchema = z.object({
  action: z.literal("revoke", {
    error: 'Action must be "revoke"',
  }),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

// ─── PATCH /api/keys/:id ────────────────────────────────────────────────────

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require keys:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "keys:write");
    }

    const { id } = await context.params;

    if (!isValidUuid(id)) {
      throw new ApiError("NOT_FOUND", "API key not found", 404);
    }

    // Validate body
    const body = await request.json();
    validateRequest(patchKeySchema, body);

    // Fetch the key
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, ctx.userId)));

    if (!key) {
      throw new ApiError("NOT_FOUND", "API key not found", 404);
    }

    // Idempotent: if already revoked, return current state
    if (key.revokedAt !== null) {
      return NextResponse.json({
        data: {
          id: key.id,
          status: "revoked" as const,
          revoked_at: key.revokedAt.toISOString(),
        },
      });
    }

    // Revoke the key
    const now = new Date();
    const [updated] = await db
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(eq(apiKeys.id, id))
      .returning();

    // Emit key.revoked audit event (fire-and-forget)
    const actorType = ctx.authMethod === "api_key" ? "api_key" : "owner";
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType,
        actorId: ctx.userId,
        eventType: "key.revoked",
        resourceType: "api_key",
        resourceDetail: {
          api_key_id: key.id,
          api_key_name: key.name,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: updated.id,
        status: "revoked" as const,
        revoked_at: updated.revokedAt!.toISOString(),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
