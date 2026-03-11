/**
 * integration/token.refresh
 *
 * Cron job that runs every hour. Finds connections with tokens
 * expiring within 24 hours and proactively refreshes them.
 * Each connection is processed in its own step for fault isolation.
 *
 * See: /docs/integrations-pipeline-lld.md §7.1
 */

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";
import { getAdapter } from "@/lib/integrations/adapters";
import { decryptAuth, encryptTokenSet } from "../sync-helpers";

export const tokenRefresh = inngest.createFunction(
  {
    id: "integration/token.refresh",
    name: "Integration Token Refresh",
    retries: 2,
  },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const expiryThreshold = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const expiringSoon = await step.run("fetch-expiring-tokens", async () =>
      db
        .select({
          id: providerConnections.id,
          userId: providerConnections.userId,
          provider: providerConnections.provider,
          authEnc: providerConnections.authEnc,
        })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.status, "active"),
            isNotNull(providerConnections.tokenExpiresAt),
            lte(providerConnections.tokenExpiresAt, expiryThreshold),
          ),
        ),
    );

    if (expiringSoon.length === 0) {
      return { refreshed: 0 };
    }

    let refreshed = 0;
    let failed = 0;

    for (const conn of expiringSoon) {
      await step.run(`refresh-${conn.id}`, async () => {
        try {
          const adapter = getAdapter(conn.provider);
          const auth = await decryptAuth(conn.authEnc, conn.userId);
          const newTokens = await adapter.refreshTokens(auth);
          const reencryptedAuth = await encryptTokenSet(newTokens, conn.userId);

          await db
            .update(providerConnections)
            .set({
              authEnc: reencryptedAuth,
              tokenExpiresAt: newTokens.expiresAt,
              updatedAt: new Date(),
            })
            .where(eq(providerConnections.id, conn.id));

          refreshed++;
        } catch (err) {
          // Check if this is an auth error (refresh token expired/revoked)
          const isAuthError =
            err instanceof Error &&
            (err.message.includes("refresh token") ||
              err.message.includes("401") ||
              err.message.includes("unauthorized") ||
              err.message.includes("revoked"));

          if (isAuthError) {
            // Mark connection as expired — user must re-authenticate
            await db
              .update(providerConnections)
              .set({ status: "expired", updatedAt: new Date() })
              .where(eq(providerConnections.id, conn.id));
          }

          failed++;
          // Do NOT re-throw: failure on one connection must not block others
          console.error(`Token refresh failed for connection ${conn.id}`, err);
        }
      });
    }

    return { refreshed, failed, total: expiringSoon.length };
  },
);
