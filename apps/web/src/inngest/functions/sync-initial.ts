/**
 * integration/sync.initial
 *
 * Historical backfill after first OAuth connection.
 * Uses the same sync logic as sync.connection but with no existing cursors,
 * which signals adapters to start from historicalWindowDays ago.
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

export const syncInitial = inngest.createFunction(
  {
    id: "integration/sync.initial",
    name: "Integration Initial Sync",
    concurrency: [{ limit: 1, key: "event.data.connectionId" }],
    retries: 5,
    onFailure: async ({ event, error }) => {
      const { connectionId } = event.data.event.data;
      await markSyncError(connectionId, error.message || "Initial sync failed");
    },
  },
  { event: "integration/sync.initial" },
  async ({ event, step }) => {
    const { connectionId, userId, provider } = event.data;

    // Claim the connection
    const claimed = await step.run("mark-syncing", async () => {
      return claimConnection(connectionId);
    });

    if (claimed === 0) return { skipped: true, reason: "already-syncing" };

    // Fetch the connection (cursors should be null for initial sync)
    const connection = await step.run("fetch-connection", async () => {
      const [conn] = await db
        .select()
        .from(providerConnections)
        .where(eq(providerConnections.id, connectionId))
        .limit(1);
      return conn ?? null;
    });

    if (!connection) {
      return { skipped: true, reason: "connection-not-found" };
    }

    // Initial sync: cursors are null, adapters start from historicalWindowDays
    const dailyCursor = await step.run("sync-daily", async () => {
      return syncDailyData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        null, // Start from beginning
      );
    });

    const seriesCursor = await step.run("sync-series", async () => {
      return syncSeriesData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        null,
      );
    });

    const periodsCursor = await step.run("sync-periods", async () => {
      return syncPeriodData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        null,
      );
    });

    // Mark idle with initial cursors
    await step.run("mark-idle", async () => {
      return markSyncIdle(connectionId, {
        dailyCursor,
        seriesCursor,
        periodsCursor,
      });
    });

    return { success: true, connectionId, provider, initialBackfill: true };
  },
);
