/**
 * Inngest Background Jobs for Baseline Materialization
 *
 * Two functions:
 * 1. baselinesRefresh — Cron job (every 6h at :30) that refreshes baselines
 *    for all users with health data, processing in batches of 50.
 * 2. baselinesRefreshUser — Event-triggered per-user refresh, fired after
 *    successful sync completion.
 *
 * Both functions compute 30-day rolling baselines, encrypt with the user's DEK,
 * and upsert into metric_baselines.
 *
 * See: /docs/dashboard-backend-lld.md §4.2
 */

import { eq } from "drizzle-orm";
import { inngest } from "../client";
import { db } from "@/db";
import { healthDataDaily, metricBaselines } from "@/db/schema";
import { createEncryptionProvider } from "@/lib/encryption";
import { computeBaselinesOnDemand } from "@/lib/dashboard/baselines";

/** Batch size for processing users in the cron job. */
const USER_BATCH_SIZE = 50;

/**
 * Get today's date in YYYY-MM-DD format (UTC).
 */
function getTodayUTC(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Refresh baselines for a single user.
 *
 * 1. Query distinct metric types for the user from health_data_daily
 * 2. Compute baselines via computeBaselinesOnDemand (referenceDate = today)
 * 3. Encrypt each BaselinePayload with the user's DEK
 * 4. Upsert into metric_baselines
 *
 * Skips metrics with < 7 data points (handled by computeBaselinesOnDemand).
 *
 * @param userId - The user to refresh baselines for
 * @returns Number of baselines upserted
 */
export async function refreshBaselinesForUser(userId: string): Promise<number> {
  const encryption = createEncryptionProvider();
  const referenceDate = getTodayUTC();

  // Step 1: Query distinct metric types for this user
  const metricRows = await db
    .selectDistinct({ metricType: healthDataDaily.metricType })
    .from(healthDataDaily)
    .where(eq(healthDataDaily.userId, userId));

  const metricTypes = metricRows.map((r) => r.metricType);

  if (metricTypes.length === 0) {
    return 0;
  }

  // Step 2: Compute baselines (handles < 7 data points by omitting those metrics)
  const baselines = await computeBaselinesOnDemand(
    userId,
    metricTypes,
    referenceDate,
    encryption,
    db,
  );

  // Step 3 & 4: Encrypt and upsert each baseline
  let upsertCount = 0;

  for (const [metricType, payload] of baselines) {
    // Encrypt the BaselinePayload JSON with the user's DEK
    const plaintext = Buffer.from(JSON.stringify(payload));
    const encrypted = await encryption.encrypt(plaintext, userId);

    // Upsert into metric_baselines
    await db
      .insert(metricBaselines)
      .values({
        userId,
        metricType,
        referenceDate,
        valueEncrypted: encrypted,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          metricBaselines.userId,
          metricBaselines.metricType,
          metricBaselines.referenceDate,
        ],
        set: {
          valueEncrypted: encrypted,
          computedAt: new Date(),
        },
      });

    upsertCount++;
  }

  return upsertCount;
}

/**
 * Process all users with health data in batches.
 *
 * Queries all distinct user IDs from health_data_daily, then processes them
 * in batches of 50 using Inngest step.run for durability.
 *
 * @param step - Inngest step context for durable execution
 * @returns Summary of processing
 */
export async function processAllUsers(step: {
  run: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
}): Promise<{
  usersProcessed: number;
  batchCount: number;
  baselinesCreated: number;
}> {
  // Query all distinct users with health data
  const usersWithData = (await step.run("fetch-users-with-data", async () => {
    const rows = await db
      .select({ userId: healthDataDaily.userId })
      .from(healthDataDaily)
      .groupBy(healthDataDaily.userId);
    return rows;
  })) as { userId: string }[];

  if (usersWithData.length === 0) {
    return { usersProcessed: 0, batchCount: 0, baselinesCreated: 0 };
  }

  // Process in batches of 50
  const batchCount = Math.ceil(usersWithData.length / USER_BATCH_SIZE);
  let totalBaselinesCreated = 0;

  for (let i = 0; i < batchCount; i++) {
    const batchStart = i * USER_BATCH_SIZE;
    const batchEnd = Math.min(
      batchStart + USER_BATCH_SIZE,
      usersWithData.length,
    );
    const batch = usersWithData.slice(batchStart, batchEnd);

    const batchResult = (await step.run(`process-batch-${i}`, async () => {
      let batchBaselines = 0;

      for (const { userId } of batch) {
        try {
          const count = await refreshBaselinesForUser(userId);
          batchBaselines += count;
        } catch (error) {
          // Log error but continue processing other users
          console.error(
            `Failed to refresh baselines for user ${userId}:`,
            error,
          );
        }
      }

      return batchBaselines;
    })) as number;

    totalBaselinesCreated += batchResult;
  }

  return {
    usersProcessed: usersWithData.length,
    batchCount,
    baselinesCreated: totalBaselinesCreated,
  };
}

/**
 * Cron job: Refresh baselines for all users with health data.
 *
 * Schedule: Every 6 hours at :30 (offset from sync sweep at :00).
 * Concurrency: Max 5 concurrent executions.
 * Retries: Up to 3 times on failure.
 *
 * See: /docs/dashboard-backend-lld.md §4.2
 */
export const baselinesRefresh = inngest.createFunction(
  {
    id: "dashboard/baselines.refresh",
    name: "Dashboard Baselines Refresh",
    concurrency: [{ limit: 5 }],
    retries: 3,
  },
  { cron: "30 */6 * * *" },
  async ({ step }) => {
    const result = await processAllUsers(step);

    return {
      success: true,
      ...result,
    };
  },
);

/**
 * Event-triggered: Refresh baselines for a single user.
 *
 * Triggered by 'dashboard/baselines.refresh.user' event, typically sent
 * after a successful integration sync. Scoped to the userId in event data.
 *
 * See: /docs/dashboard-backend-lld.md §4.2
 */
export const baselinesRefreshUser = inngest.createFunction(
  {
    id: "dashboard/baselines.refresh.user",
    name: "Dashboard Baselines Refresh (Per-User)",
    retries: 3,
  },
  { event: "dashboard/baselines.refresh.user" },
  async ({ event, step }) => {
    const { userId } = event.data;

    const count = await step.run("refresh-user-baselines", async () => {
      return refreshBaselinesForUser(userId);
    });

    return {
      success: true,
      userId,
      baselinesCreated: count,
    };
  },
);
