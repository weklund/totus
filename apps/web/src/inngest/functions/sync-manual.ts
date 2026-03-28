/**
 * integration/sync.manual
 *
 * User-triggered sync from the dashboard.
 * Same logic as sync.connection but with fewer retries
 * since the user is waiting.
 *
 * See: /docs/integrations-pipeline-lld.md §7.1
 */

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";
import {
  claimConnection,
  markSyncIdle,
  markSyncError,
  syncDailyData,
  syncSeriesData,
  syncPeriodData,
} from "../sync-helpers";

export const syncManual = inngest.createFunction(
  {
    id: "integration/sync.manual",
    name: "Integration Manual Sync",
    concurrency: [
      { limit: 1, key: "event.data.connectionId" },
      { limit: 3, key: "event.data.provider" },
    ],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { connectionId } = event.data.event.data;
      await markSyncError(connectionId, error.message || "Manual sync failed");
    },
  },
  { event: "integration/sync.manual" },
  async ({ event, step }) => {
    const { connectionId, userId, provider } = event.data;

    // Claim the connection
    const claimed = await step.run("mark-syncing", async () => {
      return claimConnection(connectionId);
    });

    if (claimed === 0) return { skipped: true, reason: "already-syncing" };

    // Verify connection exists and get cursors (no authEnc — avoid large step output)
    const connMeta = await step.run("fetch-connection", async () => {
      const [conn] = await db
        .select({
          id: providerConnections.id,
          dailyCursor: providerConnections.dailyCursor,
          seriesCursor: providerConnections.seriesCursor,
          periodsCursor: providerConnections.periodsCursor,
        })
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId))
        .limit(1);
      return conn ?? null;
    });

    if (!connMeta) {
      return { skipped: true, reason: "connection-not-found" };
    }

    // Each sync step fetches authEnc from DB internally to avoid
    // serializing large encrypted blobs through Inngest step boundaries.
    const dailyCursor = await step.run("sync-daily", async () => {
      const [conn] = await db
        .select({ authEnc: providerConnections.authEnc })
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId));
      if (!conn) return connMeta.dailyCursor;
      return syncDailyData(
        connectionId,
        userId,
        provider,
        conn.authEnc,
        connMeta.dailyCursor,
      );
    });

    const seriesCursor = await step.run("sync-series", async () => {
      const [conn] = await db
        .select({ authEnc: providerConnections.authEnc })
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId));
      if (!conn) return connMeta.seriesCursor;
      return syncSeriesData(
        connectionId,
        userId,
        provider,
        conn.authEnc,
        connMeta.seriesCursor,
      );
    });

    const periodsCursor = await step.run("sync-periods", async () => {
      const [conn] = await db
        .select({ authEnc: providerConnections.authEnc })
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId));
      if (!conn) return connMeta.periodsCursor;
      return syncPeriodData(
        connectionId,
        userId,
        provider,
        conn.authEnc,
        connMeta.periodsCursor,
      );
    });

    // Mark idle with updated cursors
    await step.run("mark-idle", async () => {
      return markSyncIdle(connectionId, {
        dailyCursor,
        seriesCursor,
        periodsCursor,
      });
    });

    return { success: true, connectionId, provider };
  },
);
