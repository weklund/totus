/**
 * POST /api/viewer/validate — Validate a share token and issue viewer session.
 *
 * Public endpoint: no auth required. Rate limited at 10 req/min per IP.
 *
 * Processing:
 * 1. Hash incoming token with SHA-256
 * 2. Look up grant by token hash
 * 3. Check grant validity (exists, not revoked, not expired)
 * 4. If valid: increment view_count, issue viewer JWT cookie, emit audit event
 * 5. Return grant details including owner display name
 *
 * Security: Returns generic 404 SHARE_NOT_FOUND for all invalid tokens
 * (not found, expired, or revoked) to prevent information leakage.
 *
 * See: /docs/api-database-lld.md Section 7.5.1
 */

import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shareGrants, auditEvents, users } from "@/db/schema";
import { createErrorResponse, ApiError, validateRequest } from "@/lib/api";
import { validationRateLimiter, createRateLimitResponse } from "@/lib/api";
import { hashToken, issueViewerJwt, VIEWER_COOKIE_CONFIG } from "@/lib/auth";

// ─── Validation Schema ──────────────────────────────────────────────────────

const validateTokenSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Rate limit by IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    const rateLimitResult = validationRateLimiter.check(ip);
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult);
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Invalid JSON in request body",
        400,
      );
    }

    const data = validateRequest(validateTokenSchema, body);

    // Hash the token for lookup
    const tokenHash = hashToken(data.token);

    // Look up the share grant by token hash
    const results = await db
      .select()
      .from(shareGrants)
      .where(eq(shareGrants.token, tokenHash));

    if (results.length === 0) {
      throw new ApiError(
        "SHARE_NOT_FOUND",
        "This share link is not available. It may have expired, been revoked, or never existed.",
        404,
      );
    }

    const grant = results[0];

    // Check if revoked — return generic 404 to prevent info leakage
    if (grant.revokedAt !== null) {
      throw new ApiError(
        "SHARE_NOT_FOUND",
        "The share link was not found or is no longer available",
        404,
      );
    }

    // Check if expired — return generic 404 to prevent info leakage
    if (grant.grantExpires <= new Date()) {
      throw new ApiError(
        "SHARE_NOT_FOUND",
        "The share link was not found or is no longer available",
        404,
      );
    }

    // Grant is valid — increment view_count and update last_viewed_at
    await db
      .update(shareGrants)
      .set({
        viewCount: sql`${shareGrants.viewCount} + 1`,
        lastViewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(shareGrants.id, grant.id));

    // Issue viewer JWT
    const viewerJwt = await issueViewerJwt({
      id: grant.id,
      ownerId: grant.ownerId,
      allowedMetrics: grant.allowedMetrics as string[],
      dataStart: grant.dataStart,
      dataEnd: grant.dataEnd,
      grantExpires: grant.grantExpires,
    });

    // Look up owner display name
    const ownerResults = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, grant.ownerId));

    const ownerDisplayName = ownerResults[0]?.displayName ?? "Unknown";

    // Emit audit event (fire-and-forget)
    const userAgent = request.headers.get("user-agent") || null;
    db.insert(auditEvents)
      .values({
        ownerId: grant.ownerId,
        actorType: "viewer",
        actorId: null,
        grantId: grant.id,
        eventType: "share.viewed",
        resourceType: "share_grant",
        resourceDetail: {
          label: grant.label,
          allowed_metrics: grant.allowedMetrics,
        },
        ipAddress: ip !== "unknown" ? ip : null,
        userAgent,
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    // Build response and set viewer cookie
    const response = NextResponse.json({
      data: {
        valid: true,
        owner_display_name: ownerDisplayName,
        label: grant.label,
        note: grant.note ?? null,
        allowed_metrics: grant.allowedMetrics,
        data_start: grant.dataStart,
        data_end: grant.dataEnd,
        expires_at: grant.grantExpires.toISOString(),
      },
    });

    // Calculate cookie max-age: min(grant_expires, now + 4h) - now
    const now = Math.floor(Date.now() / 1000);
    const fourHoursFromNow = now + 4 * 60 * 60;
    const grantExpiresUnix = Math.floor(grant.grantExpires.getTime() / 1000);
    const cookieMaxAge = Math.min(grantExpiresUnix, fourHoursFromNow) - now;

    response.cookies.set(VIEWER_COOKIE_CONFIG.name, viewerJwt, {
      httpOnly: VIEWER_COOKIE_CONFIG.httpOnly,
      sameSite: VIEWER_COOKIE_CONFIG.sameSite,
      path: VIEWER_COOKIE_CONFIG.path,
      secure: VIEWER_COOKIE_CONFIG.secure,
      maxAge: cookieMaxAge,
    });

    return response;
  } catch (error) {
    return createErrorResponse(error);
  }
}
