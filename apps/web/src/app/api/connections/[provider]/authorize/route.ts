/**
 * GET /api/connections/:provider/authorize — Initiate OAuth flow for any provider.
 *
 * Reads provider config from the registry, builds the OAuth authorization URL
 * with a state JWT containing provider + userId. In mock/dev mode, the URL
 * points directly to the callback with a mock code.
 *
 * Auth: Owner (session required)
 *
 * See: /docs/integrations-pipeline-lld.md §8.1
 */

import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { getProvider, isValidProvider } from "@/config/providers";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { provider } = await params;

    // Validate provider
    if (!isValidProvider(provider)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Unknown provider: ${provider}`,
        400,
      );
    }

    const providerConfig = getProvider(provider);
    if (!providerConfig) {
      throw new ApiError(
        "VALIDATION_ERROR",
        `Provider not configured: ${provider}`,
        400,
      );
    }

    // Check if user already has a connection for this provider
    const existing = await db
      .select({ id: providerConnections.id })
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.userId, ctx.userId),
          eq(providerConnections.provider, provider),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ApiError(
        "CONFLICT",
        `${providerConfig.displayName} is already connected. Disconnect first to re-authorize.`,
        409,
      );
    }

    // Generate OAuth state JWT with provider info
    const nonce = randomBytes(16).toString("hex");
    const stateJwt = await new SignJWT({
      userId: ctx.userId,
      provider,
      nonce,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(getStateSecret());

    // Build authorization URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectUri = `${appUrl}/api/connections/${provider}/callback`;

    // Determine if we're in mock mode
    const providerClientId =
      process.env[`${provider.toUpperCase()}_CLIENT_ID`] || "";
    const isMockMode =
      !providerClientId ||
      providerClientId.startsWith("your-") ||
      providerClientId.startsWith("test-") ||
      process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

    let authorizeUrl: string;

    if (isMockMode) {
      // Mock mode: point directly to callback with a mock code
      const mockUrl = new URL(redirectUri);
      mockUrl.searchParams.set("code", "mock_auth_code");
      mockUrl.searchParams.set("state", stateJwt);
      authorizeUrl = mockUrl.toString();
    } else if (providerConfig.auth.authorizeUrl) {
      // Real OAuth
      const oauthUrl = new URL(providerConfig.auth.authorizeUrl);
      oauthUrl.searchParams.set("client_id", providerClientId);
      oauthUrl.searchParams.set("redirect_uri", redirectUri);
      oauthUrl.searchParams.set("response_type", "code");
      oauthUrl.searchParams.set("state", stateJwt);
      if (providerConfig.auth.scopes.length > 0) {
        oauthUrl.searchParams.set(
          "scope",
          providerConfig.auth.scopes.join(" "),
        );
      }
      authorizeUrl = oauthUrl.toString();
    } else {
      throw new ApiError(
        "INTERNAL_ERROR",
        `Provider ${provider} does not support OAuth authorization`,
        500,
      );
    }

    return NextResponse.json({
      data: { authorize_url: authorizeUrl },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
