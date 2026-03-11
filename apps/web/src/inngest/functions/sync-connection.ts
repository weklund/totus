/**
 * integration/sync.connection
 *
 * Per-connection sync: fetches data via provider adapter (daily → series → periods),
 * encrypts and upserts into the correct tables, updates cursors.
 * Includes concurrency limits and failure handling.
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

export const syncConnection = inngest.createFunction(
  {
    id: "integration/sync.connection",
    name: "Integration Sync Connection",
    concurrency: [
      { limit: 1, key: "event.data.connectionId" },
      { limit: 3, key: "event.data.provider" },
    ],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const { connectionId } = event.data.event.data;
      await markSyncError(connectionId, error.message || "Unknown sync error");
    },
  },
  { event: "integration/sync.connection" },
  async ({ event, step }) => {
    const { connectionId, userId, provider } = event.data;

    // Atomic compare-and-swap: only proceed if not already syncing
    const claimed = await step.run("mark-syncing", async () => {
      return claimConnection(connectionId);
    });

    if (claimed === 0) return { skipped: true, reason: "already-syncing" };

    // Fetch connection details
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

    // Sync daily data
    const dailyCursor = await step.run("sync-daily", async () => {
      return syncDailyData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        connection.dailyCursor,
      );
    });

    // Sync series data
    const seriesCursor = await step.run("sync-series", async () => {
      return syncSeriesData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        connection.seriesCursor,
      );
    });

    // Sync period data
    const periodsCursor = await step.run("sync-periods", async () => {
      return syncPeriodData(
        connectionId,
        userId,
        provider,
        connection.authEnc,
        connection.periodsCursor,
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
