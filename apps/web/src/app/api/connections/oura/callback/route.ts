/**
 * GET /api/connections/oura/callback — Oura OAuth2 callback.
 *
 * Validates the state JWT, exchanges the authorization code for tokens
 * (mock: generate fake tokens), encrypts tokens with EncryptionService,
 * stores oura_connection, emits audit event, and redirects to dashboard.
 *
 * Auth: None (callback from Oura). The state JWT validates the originating user.
 *
 * See: /docs/api-database-lld.md Section 7.2.3
 */

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/db";
import { providerConnections, auditEvents } from "@/db/schema";
import { createEncryptionProvider } from "@/lib/encryption";

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

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Validate required parameters
  if (!code || !state) {
    return dashboardRedirect({ error: "oura_connect_failed" });
  }

  // Validate and decode state JWT
  let userId: string;
  try {
    const { payload } = await jwtVerify(state, getStateSecret());
    userId = payload.userId as string;
    if (!userId) {
      return dashboardRedirect({ error: "oura_state_invalid" });
    }
  } catch {
    return dashboardRedirect({ error: "oura_state_invalid" });
  }

  try {
    // Exchange code for tokens (mock: generate fake tokens)
    const accessToken = `mock_access_token_${Date.now()}`;
    const refreshToken = `mock_refresh_token_${Date.now()}`;
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Encrypt tokens as a single auth payload (new format)
    const encryption = createEncryptionProvider();
    const authPayload = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: tokenExpiresAt.toISOString(),
      scopes: [
        "daily",
        "heartrate",
        "workout",
        "tag",
        "session",
        "sleep",
        "spo2",
      ],
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
        provider: "oura",
        authType: "oauth2",
        authEnc,
        tokenExpiresAt,
        status: "active",
        syncStatus: "idle",
      })
      .onConflictDoUpdate({
        target: [providerConnections.userId, providerConnections.provider],
        set: {
          authEnc,
          tokenExpiresAt,
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
        resourceDetail: { provider: "oura" },
        ipAddress: request.headers.get("x-forwarded-for") || "127.0.0.1",
      })
      .catch((err) => {
        console.error("Failed to emit audit event:", err);
      });

    return dashboardRedirect({ connected: "oura" });
  } catch (error) {
    console.error("Oura callback error:", error);
    return dashboardRedirect({ error: "oura_connect_failed" });
  }
}
