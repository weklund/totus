/**
 * GET /api/connections/:provider/callback — Generic OAuth callback.
 *
 * Validates the state JWT (extracts userId + provider), exchanges the
 * authorization code for tokens via the provider adapter, encrypts tokens
 * into auth_enc, upserts into provider_connections, emits audit event,
 * and redirects to dashboard.
 *
 * Auth: None (callback from provider). The state JWT validates the originating user.
 *
 * See: /docs/integrations-pipeline-lld.md §8.1
 */

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { providerConnections, auditEvents } from "@/db/schema";
import { createEncryptionProvider } from "@/lib/encryption";
import { getProvider, isValidProvider } from "@/config/providers";
import { getAdapter } from "@/lib/integrations/adapters";

/**
 * Get the OAuth state signing secret.
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

/**
 * Build a redirect URL to the dashboard with query parameters.
 */
function dashboardRedirect(params: Record<string, string>): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = new URL("/dashboard", appUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url.toString(), 302);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const { provider: pathProvider } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Validate required parameters
  if (!code || !state) {
    return dashboardRedirect({ error: `${pathProvider}_connect_failed` });
  }

  // Validate and decode state JWT
  let userId: string;
  let provider: string;
  try {
    const { payload } = await jwtVerify(state, getStateSecret());
    userId = payload.userId as string;
    provider = (payload.provider as string) || pathProvider;
    if (!userId) {
      return dashboardRedirect({ error: `${pathProvider}_state_invalid` });
    }
  } catch {
    return dashboardRedirect({ error: `${pathProvider}_state_invalid` });
  }

  // Verify provider from state matches path provider
  if (provider !== pathProvider) {
    return dashboardRedirect({ error: `${pathProvider}_state_invalid` });
  }

  // Validate provider exists
  if (!isValidProvider(provider)) {
    return dashboardRedirect({ error: `${provider}_connect_failed` });
  }

  const providerConfig = getProvider(provider);
  if (!providerConfig) {
    return dashboardRedirect({ error: `${provider}_connect_failed` });
  }

  try {
    // Exchange code for tokens via adapter
    const adapter = getAdapter(provider);
    const tokenSet = await adapter.exchangeCodeForTokens(code);

    // Encrypt tokens as a single auth payload
    const encryption = createEncryptionProvider();
    const authPayload = JSON.stringify({
      access_token: tokenSet.accessToken,
      refresh_token: tokenSet.refreshToken,
      expires_at: tokenSet.expiresAt.toISOString(),
      scopes: tokenSet.scopes,
    });
    const authEnc = await encryption.encrypt(
      Buffer.from(authPayload, "utf-8"),
      userId,
    );

    // Store connection (upsert on unique (user_id, provider))
    await db
      .insert(providerConnections)
      .values({
        userId,
        provider,
        authType:
          providerConfig.authType === "pkce"
            ? "oauth2"
            : providerConfig.authType,
        authEnc,
        tokenExpiresAt: tokenSet.expiresAt,
        status: "active",
        syncStatus: "idle",
      })
      .onConflictDoUpdate({
        target: [providerConnections.userId, providerConnections.provider],
        set: {
          authEnc,
          tokenExpiresAt: tokenSet.expiresAt,
          status: "active",
          syncStatus: "idle",
          syncError: null,
          updatedAt: new Date(),
        },
      });

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: userId,
        actorType: "owner",
        actorId: userId,
        eventType: "account.connected",
        resourceType: "connection",
        resourceDetail: { provider },
        ipAddress: request.headers.get("x-forwarded-for") || "127.0.0.1",
      })
      .catch((err) => {
        console.error("Failed to emit audit event:", err);
      });

    return dashboardRedirect({ connected: provider });
  } catch (error) {
    console.error(`${provider} callback error:`, error);
    return dashboardRedirect({ error: `${provider}_connect_failed` });
  }
}
