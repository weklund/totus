/**
 * Database seed script.
 *
 * Populates the local database with synthetic test data:
 * - 1 test user
 * - 1 Oura provider connection (provider_connections)
 * - 90 days of daily health data across 8 metric types (~720 rows in health_data_daily)
 * - 7 days of intraday series data (heart rate every 5 min) in health_data_series
 * - 7 days of period events (sleep stages, workouts) in health_data_periods
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
  healthDataSeries,
  healthDataPeriods,
  shareGrants,
  auditEvents,
} from "./schema";
import {
  upsertDailyData,
  upsertSeriesData,
  upsertPeriodData,
  type HealthDataRow,
  type SeriesDataRow,
  type PeriodDataRow,
} from "./upsert";
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
const DAYS_OF_SERIES_DATA = 7;
const SERIES_INTERVAL_MINUTES = 5;

/**
 * Intraday series metric definitions.
 * These generate data points every 5 minutes for 7 days.
 */
const SEED_SERIES_METRICS = [
  { id: "heart_rate", min: 55, max: 140, decimals: 0 },
  { id: "spo2_interval", min: 94, max: 100, decimals: 1 },
] as const;

/**
 * Period event definitions for sleep stages and workouts.
 */
const WORKOUT_SUBTYPES = [
  "running",
  "cycling",
  "strength",
  "yoga",
  "walking",
] as const;

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

  console.log("  ✓ Total daily health data rows: %d", totalRows);
}

async function seedSeriesData() {
  console.log(
    "  Seeding %d days of intraday series data...",
    DAYS_OF_SERIES_DATA,
  );

  const encryption = createEncryptionProvider();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalRows = 0;

  for (const metric of SEED_SERIES_METRICS) {
    let metricTotal = 0;

    for (let dayOffset = 0; dayOffset < DAYS_OF_SERIES_DATA; dayOffset++) {
      // Use UTC to avoid DST issues that cause duplicate timestamps
      const dayStartMs = Date.UTC(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - dayOffset,
      );

      const dayRows: SeriesDataRow[] = [];
      const dateStr = new Date(dayStartMs).toISOString().split("T")[0]!;

      // Generate readings every 5 minutes for 24 hours (288 readings/day)
      const readingsPerDay = (24 * 60) / SERIES_INTERVAL_MINUTES;
      for (let i = 0; i < readingsPerDay; i++) {
        const recordedAt = new Date(
          dayStartMs + i * SERIES_INTERVAL_MINUTES * 60 * 1000,
        );

        // Generate a deterministic value with some time-of-day variation
        const hourOfDay = recordedAt.getUTCHours();
        // Heart rate is lower at night (sleeping) and higher during day
        let adjustedMin: number = metric.min;
        let adjustedMax: number = metric.max;
        if (metric.id === "heart_rate") {
          if (hourOfDay >= 0 && hourOfDay < 6) {
            adjustedMin = 50;
            adjustedMax = 65;
          } else if (hourOfDay >= 6 && hourOfDay < 9) {
            adjustedMin = 60;
            adjustedMax = 90;
          } else if (hourOfDay >= 17 && hourOfDay < 20) {
            adjustedMin = 70;
            adjustedMax = 130;
          }
        }

        const seed = dayOffset * 10000 + i * 100 + metric.id.length * 37;
        const value = generateValue(
          adjustedMin,
          adjustedMax,
          metric.decimals,
          seed,
        );

        const encrypted = await encryption.encrypt(
          Buffer.from(JSON.stringify(value)),
          TEST_USER_ID,
        );

        dayRows.push({
          userId: TEST_USER_ID,
          metricType: metric.id,
          recordedAt,
          valueEncrypted: encrypted,
          source: SEED_SOURCE,
          sourceId: `oura_${metric.id}_${dateStr}_${i}`,
        });
      }

      // Upsert one day at a time to avoid cross-day conflicts in a single INSERT
      await upsertSeriesData(db, dayRows);
      metricTotal += dayRows.length;
    }

    totalRows += metricTotal;
    console.log("  ✓ %s: %d data points", metric.id, metricTotal);
  }

  console.log("  ✓ Total series data rows: %d", totalRows);
}

async function seedPeriodData() {
  console.log(
    "  Seeding %d days of period events (sleep stages, workouts)...",
    DAYS_OF_SERIES_DATA,
  );

  const encryption = createEncryptionProvider();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalRows = 0;
  const rows: PeriodDataRow[] = [];

  for (let dayOffset = 0; dayOffset < DAYS_OF_SERIES_DATA; dayOffset++) {
    // Use UTC to avoid DST issues
    const dayStartMs = Date.UTC(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - dayOffset,
    );
    const dayDateStr = new Date(dayStartMs).toISOString().split("T")[0]!;

    // ─── Sleep stages: a full night of sleep (10:30 PM to 6:30 AM) ────
    // Previous evening at 22:30 UTC
    const sleepStartMs =
      dayStartMs - 24 * 60 * 60 * 1000 + 22 * 60 * 60 * 1000 + 30 * 60 * 1000;

    // Typical sleep architecture: light → deep → light → REM → repeat
    const stagePatterns = [
      { subtype: "light", durationMin: 15 },
      { subtype: "deep", durationMin: 45 },
      { subtype: "light", durationMin: 20 },
      { subtype: "rem", durationMin: 10 },
      { subtype: "light", durationMin: 25 },
      { subtype: "deep", durationMin: 40 },
      { subtype: "light", durationMin: 15 },
      { subtype: "rem", durationMin: 25 },
      { subtype: "awake", durationMin: 5 },
      { subtype: "light", durationMin: 20 },
      { subtype: "deep", durationMin: 30 },
      { subtype: "rem", durationMin: 35 },
      { subtype: "light", durationMin: 15 },
      { subtype: "rem", durationMin: 40 },
      { subtype: "light", durationMin: 10 },
      { subtype: "awake", durationMin: 5 },
      { subtype: "light", durationMin: 20 },
      { subtype: "rem", durationMin: 25 },
    ];

    // Add deterministic variation per day
    const seed = dayOffset * 777;
    const variationMin = Math.floor(
      Math.abs(Math.sin(seed * 9301 + 49297) % 1) * 10,
    );

    let currentTimeMs = sleepStartMs + variationMin * 60 * 1000;

    for (const stage of stagePatterns) {
      const stageStart = new Date(currentTimeMs);
      const stageEndMs = currentTimeMs + stage.durationMin * 60 * 1000;
      const stageEnd = new Date(stageEndMs);

      const metadata = {
        stage: stage.subtype,
        night_date: dayDateStr,
      };
      const metadataEnc = await encryption.encrypt(
        Buffer.from(JSON.stringify(metadata)),
        TEST_USER_ID,
      );

      rows.push({
        userId: TEST_USER_ID,
        eventType: "sleep_stage",
        subtype: stage.subtype,
        startedAt: stageStart,
        endedAt: stageEnd,
        metadataEnc,
        source: SEED_SOURCE,
        sourceId: `oura_sleep_stage_${dayDateStr}_${stage.subtype}_${currentTimeMs}`,
      });

      currentTimeMs = stageEndMs;
      totalRows++;
    }

    // ─── Workouts: 1 workout per day (alternating types) ────
    const workoutSubtype =
      WORKOUT_SUBTYPES[dayOffset % WORKOUT_SUBTYPES.length]!;
    const workoutSeed = dayOffset * 4321;
    const workoutHour =
      7 + Math.floor(Math.abs(Math.sin(workoutSeed) % 1) * 12); // 7am-7pm
    const workoutDurationMin =
      30 + Math.floor(Math.abs(Math.sin(workoutSeed * 2) % 1) * 60); // 30-90 min

    const workoutStartMs = dayStartMs + workoutHour * 60 * 60 * 1000;
    const workoutEndMs = workoutStartMs + workoutDurationMin * 60 * 1000;

    const workoutMetadata = {
      type: workoutSubtype,
      calories: Math.floor(200 + Math.abs(Math.sin(workoutSeed * 3) % 1) * 400),
      intensity: ["low", "moderate", "high"][dayOffset % 3],
    };
    const workoutMetadataEnc = await encryption.encrypt(
      Buffer.from(JSON.stringify(workoutMetadata)),
      TEST_USER_ID,
    );

    rows.push({
      userId: TEST_USER_ID,
      eventType: "workout",
      subtype: workoutSubtype,
      startedAt: new Date(workoutStartMs),
      endedAt: new Date(workoutEndMs),
      metadataEnc: workoutMetadataEnc,
      source: SEED_SOURCE,
      sourceId: `oura_workout_${dayDateStr}_${workoutSubtype}`,
    });
    totalRows++;
  }

  // Batch upsert
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await upsertPeriodData(db, batch);
  }

  console.log("  ✓ Total period events: %d", totalRows);
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
    await seedSeriesData();
    await seedPeriodData();
    await seedShareGrant();
    await seedAuditEvents();

    console.log("=".repeat(50));
    console.log("✅ Seed complete!");

    // Print summary
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const [connectionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(providerConnections);
    const [dailyCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthDataDaily);
    const [seriesCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthDataSeries);
    const [periodsCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(healthDataPeriods);
    const [shareCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(shareGrants);
    const [auditCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents);

    const dailyBreakdown = await db
      .select({
        metricType: healthDataDaily.metricType,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataDaily)
      .groupBy(healthDataDaily.metricType)
      .orderBy(healthDataDaily.metricType);

    const seriesBreakdown = await db
      .select({
        metricType: healthDataSeries.metricType,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataSeries)
      .groupBy(healthDataSeries.metricType)
      .orderBy(healthDataSeries.metricType);

    const periodsBreakdown = await db
      .select({
        eventType: healthDataPeriods.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(healthDataPeriods)
      .groupBy(healthDataPeriods.eventType)
      .orderBy(healthDataPeriods.eventType);

    console.log("\n📊 Summary:");
    console.log("  Users:              %d", userCount!.count);
    console.log("  Connections:        %d", connectionCount!.count);
    console.log("  Health data daily:  %d rows", dailyCount!.count);
    console.log("  Health data series: %d rows", seriesCount!.count);
    console.log("  Health data periods:%d rows", periodsCount!.count);
    console.log("  Share grants:       %d", shareCount!.count);
    console.log("  Audit events:       %d", auditCount!.count);
    console.log("\n  Daily data by metric:");
    for (const row of dailyBreakdown) {
      console.log("    %s: %d", row.metricType.padEnd(20), row.count);
    }
    console.log("\n  Series data by metric:");
    for (const row of seriesBreakdown) {
      console.log("    %s: %d", row.metricType.padEnd(20), row.count);
    }
    console.log("\n  Period events by type:");
    for (const row of periodsBreakdown) {
      console.log("    %s: %d", row.eventType.padEnd(20), row.count);
    }
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
