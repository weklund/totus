/**
 * GET /api/connections/oura/authorize — Initiate Oura OAuth2 flow.
 *
 * Generates an OAuth state JWT (signed with jose, contains userId, nonce, exp),
 * builds the Oura authorization URL, and returns it. In mock mode, the
 * authorize_url points to the mock callback endpoint.
 *
 * Auth: Owner (session required)
 *
 * See: /docs/api-database-lld.md Section 7.2.2
 */

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ouraConnections } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";

/**
 * Get the OAuth state signing secret.
 * Reuses MOCK_AUTH_SECRET for signing OAuth state JWTs.
 */
function getStateSecret(): Uint8Array {
  const secret = process.env.MOCK_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "MOCK_AUTH_SECRET is required for OAuth state JWT signing.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Check if user already has an Oura connection
    const existing = await db
      .select({ id: ouraConnections.id })
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, ctx.userId))
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError(
        "CONFLICT",
        "Oura is already connected. Disconnect first to re-authorize.",
        409,
      );
    }

    // Generate OAuth state JWT
    const nonce = randomBytes(16).toString("hex");
    const stateJwt = await new SignJWT({
      userId: ctx.userId,
      nonce,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(getStateSecret());

    // Build authorization URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const clientId = process.env.OURA_CLIENT_ID || "";
    const redirectUri = `${appUrl}/api/connections/oura/callback`;

    // In mock mode (no real client ID), point to mock callback directly
    const isMockMode =
      !clientId ||
      clientId === "your-oura-client-id" ||
      process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

    let authorizeUrl: string;

    if (isMockMode) {
      // Mock mode: point directly to callback with a mock code
      const mockUrl = new URL(redirectUri);
      mockUrl.searchParams.set("code", "mock_auth_code");
      mockUrl.searchParams.set("state", stateJwt);
      authorizeUrl = mockUrl.toString();
    } else {
      // Real Oura OAuth
      const oauthUrl = new URL("https://cloud.ouraring.com/oauth/authorize");
      oauthUrl.searchParams.set("client_id", clientId);
      oauthUrl.searchParams.set("redirect_uri", redirectUri);
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("state", stateJwt);
      oauthUrl.searchParams.set(
        "scope",
        "daily heartrate workout tag session sleep spo2",
      );
      authorizeUrl = oauthUrl.toString();
    }

    return NextResponse.json({
      data: { authorize_url: authorizeUrl },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
