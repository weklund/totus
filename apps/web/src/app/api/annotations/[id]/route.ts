/**
 * Single annotation endpoints.
 *
 * PATCH /api/annotations/:id — Update an annotation (owner only).
 * DELETE /api/annotations/:id — Delete an annotation (owner only).
 *
 * Auth: Owner (session required) for both endpoints.
 *
 * See: /docs/dashboard-backend-lld.md §9.3, §9.4
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userAnnotations, auditEvents } from "@/db/schema";
import {
  getResolvedContext,
  checkApiKeyRateLimit,
} from "@/lib/auth/resolve-api-key";
import { enforceScope } from "@/lib/auth/permissions";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import { createEncryptionProvider } from "@/lib/encryption";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ─── Validation Schemas ─────────────────────────────────────────────────────

const updateAnnotationSchema = z.object({
  label: z
    .string()
    .min(1, "Label is required")
    .max(255, "Label must be 255 characters or less")
    .optional(),
  note: z
    .string()
    .max(1000, "Note must be 1000 characters or less")
    .nullable()
    .optional(),
  occurred_at: z
    .string()
    .datetime("occurred_at must be a valid ISO datetime")
    .optional(),
  ended_at: z
    .string()
    .datetime("ended_at must be a valid ISO datetime")
    .nullable()
    .optional(),
});

// ─── PATCH /api/annotations/:id ─────────────────────────────────────────────

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require health:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "health:write");
    }

    const { id: idStr } = await context.params;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      throw new ApiError("NOT_FOUND", "Annotation not found", 404);
    }

    // Validate body
    const body = await request.json();
    const data = validateRequest(updateAnnotationSchema, body);

    // Verify annotation exists and is owned by the user
    const [existing] = await db
      .select()
      .from(userAnnotations)
      .where(
        and(eq(userAnnotations.id, id), eq(userAnnotations.userId, ctx.userId)),
      );

    if (!existing) {
      throw new ApiError("NOT_FOUND", "Annotation not found", 404);
    }

    // Build update set
    const encryption = createEncryptionProvider();
    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Determine the effective occurred_at and ended_at for validation
    const effectiveOccurredAt = data.occurred_at
      ? new Date(data.occurred_at)
      : existing.occurredAt;
    let effectiveEndedAt: Date | null;
    if (data.ended_at === null) {
      effectiveEndedAt = null;
    } else if (data.ended_at !== undefined) {
      effectiveEndedAt = new Date(data.ended_at);
    } else {
      effectiveEndedAt = existing.endedAt;
    }

    // Validate ended_at > occurred_at if ended_at is set
    if (effectiveEndedAt && effectiveEndedAt <= effectiveOccurredAt) {
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

    // Encrypt updated label
    if (data.label !== undefined) {
      updateSet.labelEncrypted = await encryption.encrypt(
        Buffer.from(data.label),
        ctx.userId,
      );
    }

    // Encrypt updated note (nullable)
    if (data.note !== undefined) {
      if (data.note === null) {
        updateSet.noteEncrypted = null;
      } else {
        updateSet.noteEncrypted = await encryption.encrypt(
          Buffer.from(data.note),
          ctx.userId,
        );
      }
    }

    // Update timestamp fields
    if (data.occurred_at !== undefined) {
      updateSet.occurredAt = new Date(data.occurred_at);
    }
    if (data.ended_at !== undefined) {
      updateSet.endedAt = data.ended_at ? new Date(data.ended_at) : null;
    }

    // Perform the update
    const [updated] = await db
      .update(userAnnotations)
      .set(updateSet)
      .where(eq(userAnnotations.id, id))
      .returning();

    // Decrypt for response
    const labelDecrypted = await encryption.decrypt(
      updated.labelEncrypted,
      ctx.userId,
    );
    const label = labelDecrypted.toString();

    let note: string | null = null;
    if (updated.noteEncrypted) {
      const noteDecrypted = await encryption.decrypt(
        updated.noteEncrypted,
        ctx.userId,
      );
      note = noteDecrypted.toString();
    }

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: ctx.authMethod === "api_key" ? "api_key" : "owner",
        actorId: ctx.userId,
        eventType: "annotation.updated",
        resourceType: "annotation",
        resourceDetail: {
          annotation_id: updated.id,
          event_type: updated.eventType,
          fields_updated: Object.keys(data).filter(
            (k) => data[k as keyof typeof data] !== undefined,
          ),
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: updated.id,
        event_type: updated.eventType,
        label,
        note,
        occurred_at: updated.occurredAt.toISOString(),
        ended_at: updated.endedAt ? updated.endedAt.toISOString() : null,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}

// ─── DELETE /api/annotations/:id ────────────────────────────────────────────

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    // Check general API key rate limit
    const generalRateLimitResponse = checkApiKeyRateLimit(ctx);
    if (generalRateLimitResponse) return generalRateLimitResponse;

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // If authenticated via API key, require health:write scope
    if (ctx.authMethod === "api_key") {
      enforceScope(ctx, "health:write");
    }

    const { id: idStr } = await context.params;
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      throw new ApiError("NOT_FOUND", "Annotation not found", 404);
    }

    // Verify annotation exists and is owned by the user
    const [existing] = await db
      .select()
      .from(userAnnotations)
      .where(
        and(eq(userAnnotations.id, id), eq(userAnnotations.userId, ctx.userId)),
      );

    if (!existing) {
      throw new ApiError("NOT_FOUND", "Annotation not found", 404);
    }

    // Delete the annotation
    await db.delete(userAnnotations).where(eq(userAnnotations.id, id));

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: ctx.authMethod === "api_key" ? "api_key" : "owner",
        actorId: ctx.userId,
        eventType: "annotation.deleted",
        resourceType: "annotation",
        resourceDetail: {
          annotation_id: existing.id,
          event_type: existing.eventType,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        id: existing.id,
        deleted: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
