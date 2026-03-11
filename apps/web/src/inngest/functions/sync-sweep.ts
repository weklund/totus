/**
 * integration/sync.sweep
 *
 * Cron job that runs every 6 hours. Queries all active connections
 * not currently syncing and fans out per-connection sync events.
 *
 * See: /docs/integrations-pipeline-lld.md §7.1
 */

import { and, eq, ne } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";

/**
 * Chunk an array into batches of a given size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const syncSweep = inngest.createFunction(
  {
    id: "integration/sync.sweep",
    name: "Integration Sync Sweep",
  },
  { cron: "0 */6 * * *" },
  async ({ step }) => {
    const connections = await step.run("fetch-eligible-connections", async () =>
      db
        .select({
          id: providerConnections.id,
          userId: providerConnections.userId,
          provider: providerConnections.provider,
        })
        .from(providerConnections)
        .where(
          and(
            eq(providerConnections.status, "active"),
            ne(providerConnections.syncStatus, "syncing"),
          ),
        ),
    );

    if (connections.length === 0) {
      return { dispatched: 0 };
    }

    // Batch into groups of 100 (Inngest sendEvent limit per call)
    const batches = chunk(connections, 100);
    let dispatched = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]!;
      await step.sendEvent(
        `dispatch-sync-batch-${i}`,
        batch.map((conn) => ({
          name: "integration/sync.connection" as const,
          data: {
            connectionId: conn.id,
            userId: conn.userId,
            provider: conn.provider,
          },
        })),
      );
      dispatched += batch.length;
    }

    return { dispatched };
  },
);
