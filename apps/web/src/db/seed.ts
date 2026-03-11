/**
 * Database seed script.
 *
 * Populates the local database with synthetic test data:
 * - 1 test user
 * - 1 Oura connection with mock encrypted tokens
 * - 90 days of health data across 8 metric types (~720 rows)
 * - 1 share grant with a known token
 * - Sample audit events
 *
 * Usage: bun run db:seed
 *
 * Idempotent: running twice does not create duplicates (uses upsert semantics).
 */

import { sql } from "drizzle-orm";
import { db, pool } from "./index";
import {
  users,
  providerConnections,
  healthDataDaily,
  shareGrants,
  auditEvents,
} from "./schema";
import { upsertDailyData, type HealthDataRow } from "./upsert";
import { createEncryptionProvider } from "@/lib/encryption";

// ─── Constants ──────────────────────────────────────────────

const TEST_USER_ID = "user_test_001";
const TEST_DISPLAY_NAME = "Test User";
const TEST_KMS_KEY_ARN = "arn:aws:kms:us-east-1:000000000000:key/dev-local-key";

/** Known share token for testing. Raw token (before hashing). */
const KNOWN_SHARE_TOKEN_HASH =
  "a]b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6z7";

const SEED_SOURCE = "oura";

/**
 * Metric definitions with realistic value ranges.
 */
const SEED_METRICS = [
  { id: "sleep_score", min: 60, max: 95, decimals: 0 },
  { id: "hrv", min: 20, max: 80, decimals: 1 },
  { id: "rhr", min: 50, max: 70, decimals: 0 },
  { id: "steps", min: 3000, max: 15000, decimals: 0 },
  { id: "readiness_score", min: 55, max: 98, decimals: 0 },
  { id: "sleep_duration", min: 5.5, max: 9.0, decimals: 2 },
  { id: "deep_sleep", min: 0.5, max: 2.5, decimals: 2 },
  { id: "active_calories", min: 150, max: 800, decimals: 0 },
] as const;

const DAYS_OF_DATA = 90;

// ─── Helpers ────────────────────────────────────────────────

/**
 * Generate a pseudo-random number in [min, max] with given decimal precision.
 * Uses a simple seeded approach for reproducibility per day/metric.
 */
function generateValue(
  min: number,
  max: number,
  decimals: number,
  seed: number,
): number {
  // Simple but deterministic pseudo-random using sine
  const rand = Math.abs(Math.sin(seed * 9301 + 49297) % 1);
  const value = min + rand * (max - min);
  return Number(value.toFixed(decimals));
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

// ─── Seed Functions ─────────────────────────────────────────

async function seedUser() {
  console.log("  Seeding test user...");

  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      displayName: TEST_DISPLAY_NAME,
      kmsKeyArn: TEST_KMS_KEY_ARN,
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        displayName: TEST_DISPLAY_NAME,
        kmsKeyArn: TEST_KMS_KEY_ARN,
        updatedAt: new Date(),
      },
    });

  console.log("  ✓ Test user created (id: %s)", TEST_USER_ID);
}

async function seedProviderConnection() {
  console.log("  Seeding provider connection (Oura)...");

  const encryption = createEncryptionProvider();

  // Create a combined auth payload (new format)
  const authPayload = JSON.stringify({
    access_token: "mock_access_token_for_testing",
    refresh_token: "mock_refresh_token_for_testing",
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
    TEST_USER_ID,
  );

  // Upsert into provider_connections on the unique (user_id, provider) constraint
  await db
    .insert(providerConnections)
    .values({
      userId: TEST_USER_ID,
      provider: "oura",
      authType: "oauth2",
      authEnc,
      tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      status: "active",
      lastSyncAt: new Date(),
      syncStatus: "idle",
    })
    .onConflictDoUpdate({
      target: [providerConnections.userId, providerConnections.provider],
      set: {
        authEnc,
        tokenExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastSyncAt: new Date(),
        syncStatus: "idle",
        syncError: null,
        updatedAt: new Date(),
      },
    });

  console.log("  ✓ Provider connection created for user %s", TEST_USER_ID);
}

async function seedHealthData() {
  console.log("  Seeding 90 days of health data...");

  const encryption = createEncryptionProvider();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalRows = 0;

  for (const metric of SEED_METRICS) {
    const rows: HealthDataRow[] = [];

    for (let dayOffset = 0; dayOffset < DAYS_OF_DATA; dayOffset++) {
      const date = new Date(today);
      date.setDate(date.getDate() - dayOffset);
      const dateStr = formatDate(date);

      // Generate a deterministic but varied value
      const seed = dayOffset * 1000 + metric.id.length * 100 + dayOffset;
      const value = generateValue(
        metric.min,
        metric.max,
        metric.decimals,
        seed,
      );

      // Encrypt the value as JSON
      const encrypted = await encryption.encrypt(
        Buffer.from(JSON.stringify(value)),
        TEST_USER_ID,
      );

      rows.push({
        userId: TEST_USER_ID,
        metricType: metric.id,
        date: dateStr,
        valueEncrypted: encrypted,
        source: SEED_SOURCE,
        sourceId: `oura_${metric.id}_${dateStr}`,
      });
    }

    // Batch upsert (batches of 100)
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await upsertDailyData(db, batch);
    }

    totalRows += rows.length;
    console.log("  ✓ %s: %d data points", metric.id, rows.length);
  }

  console.log("  ✓ Total health data rows: %d", totalRows);
}

async function seedShareGrant() {
  console.log("  Seeding share grant...");

  const now = new Date();
  const dataStart = new Date(now);
  dataStart.setDate(dataStart.getDate() - 90);
  const dataEnd = new Date(now);
  const grantExpires = new Date(now);
  grantExpires.setDate(grantExpires.getDate() + 30);

  // Upsert by token to make it idempotent
  await db
    .insert(shareGrants)
    .values({
      token: KNOWN_SHARE_TOKEN_HASH,
      ownerId: TEST_USER_ID,
      label: "Test Share for Development",
      note: "A sample share grant created by the seed script.",
      allowedMetrics: ["sleep_score", "hrv", "rhr", "steps", "readiness_score"],
      dataStart: formatDate(dataStart),
      dataEnd: formatDate(dataEnd),
      grantExpires,
    })
    .onConflictDoUpdate({
      target: shareGrants.token,
      set: {
        label: "Test Share for Development",
        allowedMetrics: [
          "sleep_score",
          "hrv",
          "rhr",
          "steps",
          "readiness_score",
        ],
        dataStart: formatDate(dataStart),
        dataEnd: formatDate(dataEnd),
        grantExpires,
        updatedAt: new Date(),
      },
    });

  console.log(
    "  ✓ Share grant created (token: %s...)",
    KNOWN_SHARE_TOKEN_HASH.substring(0, 8),
  );
}

async function seedAuditEvents() {
  console.log("  Seeding audit events...");

  const events = [
    {
      ownerId: TEST_USER_ID,
      actorType: "owner" as const,
      actorId: TEST_USER_ID,
      eventType: "user.created",
      resourceType: "user",
      resourceDetail: { user_id: TEST_USER_ID },
      ipAddress: "127.0.0.1",
    },
    {
      ownerId: TEST_USER_ID,
      actorType: "owner" as const,
      actorId: TEST_USER_ID,
      eventType: "account.connected",
      resourceType: "connection",
      resourceDetail: { source: "oura" },
      ipAddress: "127.0.0.1",
    },
    {
      ownerId: TEST_USER_ID,
      actorType: "system" as const,
      actorId: "sync_worker",
      eventType: "data.synced",
      resourceType: "health_data",
      resourceDetail: {
        source: "oura",
        metric_count: SEED_METRICS.length,
        days: DAYS_OF_DATA,
      },
      ipAddress: "127.0.0.1",
    },
    {
      ownerId: TEST_USER_ID,
      actorType: "owner" as const,
      actorId: TEST_USER_ID,
      eventType: "share.created",
      resourceType: "share_grant",
      resourceDetail: {
        allowed_metrics: [
          "sleep_score",
          "hrv",
          "rhr",
          "steps",
          "readiness_score",
        ],
      },
      ipAddress: "127.0.0.1",
    },
    {
      ownerId: TEST_USER_ID,
      actorType: "viewer" as const,
      actorId: null,
      eventType: "share.viewed",
      resourceType: "share_grant",
      resourceDetail: { viewer_ip: "203.0.113.42" },
      ipAddress: "203.0.113.42",
    },
  ];

  // Audit events are append-only (immutable), so we skip if events already exist
  // for this user to maintain idempotency.
  const existingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(sql`${auditEvents.ownerId} = ${TEST_USER_ID}`);

  if (existingCount[0]!.count > 0) {
    console.log(
      "  ⏭ Audit events already exist for user %s (count: %d), skipping",
      TEST_USER_ID,
      existingCount[0]!.count,
    );
    return;
  }

  for (const event of events) {
    await db.insert(auditEvents).values(event);
  }

  console.log("  ✓ %d audit events created", events.length);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log("🌱 Totus Database Seed");
  console.log("=".repeat(50));

  try {
    await seedUser();
    await seedProviderConnection();
    await seedHealthData();
    await seedShareGrant();
    await seedAuditEvents();

    console.log("=".repeat(50));
    console.log("✅ Seed complete!");

    // Print summary
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const [healthCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthDataDaily);
    const [shareCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shareGrants);
    const [auditCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents);

    const metricBreakdown = await db
      .select({
        metricType: healthDataDaily.metricType,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataDaily)
      .groupBy(healthDataDaily.metricType)
      .orderBy(healthDataDaily.metricType);

    console.log("\n📊 Summary:");
    console.log("  Users:        %d", userCount!.count);
    console.log("  Health data:  %d rows", healthCount!.count);
    console.log("  Share grants: %d", shareCount!.count);
    console.log("  Audit events: %d", auditCount!.count);
    console.log("\n  Health data by metric:");
    for (const row of metricBreakdown) {
      console.log("    %s: %d", row.metricType.padEnd(20), row.count);
    }
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
