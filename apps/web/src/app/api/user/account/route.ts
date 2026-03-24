/**
 * DELETE /api/user/account — Delete user account with cascade.
 *
 * Requires exact confirmation string: "DELETE MY ACCOUNT".
 * Emits audit event BEFORE deletion so it persists.
 * Cascades: user -> connections, health data, shares.
 * Audit events persist (no FK on owner_id).
 * Clears session cookie.
 *
 * Auth: Owner (session required).
 *
 * See: /docs/api-database-lld.md Section 7.6
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users, auditEvents } from "@/db/schema";
import { getResolvedContext } from "@/lib/auth/resolve-api-key";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import { SESSION_COOKIE_CONFIG } from "@/lib/auth/mock-auth";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIRMATION_STRING = "DELETE MY ACCOUNT";

// ─── Validation Schemas ─────────────────────────────────────────────────────

const deleteAccountSchema = z.object({
  confirmation: z.string(),
});

// ─── DELETE /api/user/account ───────────────────────────────────────────────

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getResolvedContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Parse and validate body
    const body = await request.json();
    const data = validateRequest(deleteAccountSchema, body);

    // Verify exact confirmation string
    if (data.confirmation !== CONFIRMATION_STRING) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Confirmation must be exactly "${CONFIRMATION_STRING}"`,
        400,
        [
          {
            field: "confirmation",
            message: `Must be exactly "${CONFIRMATION_STRING}"`,
          },
        ],
      );
    }

    // Verify user exists
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.userId));

    if (!user) {
      throw new ApiError("NOT_FOUND", "User not found", 404);
    }

    // Emit audit event BEFORE deleting (so it persists)
    await db.insert(auditEvents).values({
      ownerId: ctx.userId,
      actorType: "owner",
      actorId: ctx.userId,
      eventType: "account.deleted",
      resourceType: "user",
      resourceDetail: {
        display_name: user.displayName,
      },
    });

    // Delete the user — FK cascades handle connections, health data, shares
    await db.delete(users).where(eq(users.id, ctx.userId));

    // Clear session cookie
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_CONFIG.name, "", {
      httpOnly: SESSION_COOKIE_CONFIG.httpOnly,
      sameSite: SESSION_COOKIE_CONFIG.sameSite,
      path: SESSION_COOKIE_CONFIG.path,
      secure: SESSION_COOKIE_CONFIG.secure,
      maxAge: 0, // Expire immediately
    });

    return NextResponse.json({
      data: {
        deleted: true,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
