/**
 * Dashboard-specific seed/fixture script.
 *
 * Populates all data types needed for the dashboard views to render fully:
 * - Glucose intraday series (CGM) with S1 spike scenario
 * - Sleep stage hypnogram periods for 14+ nights
 * - Daily metrics: sleep_latency, deep_sleep, rem_sleep, body_temperature_deviation, readiness_score
 * - S1 scenario: Late Meal Disrupts Sleep (annotation, glucose spike, elevated HR, bad sleep metrics)
 * - S3 scenario: Hard Workout Recovery (annotation, readiness/HRV/RHR progression, temp deviation)
 *
 * Idempotent: uses upsert semantics throughout.
 *
 * Usage:
 *   npm run db:seed-dashboard
 *   # or: dotenv -e .env.local -- tsx src/db/seed-dashboard.ts
 */

import { db, pool } from "./index";
import { userAnnotations } from "./schema";
import {
  upsertDailyData,
  upsertSeriesData,
  upsertPeriodData,
  type HealthDataRow,
  type SeriesDataRow,
  type PeriodDataRow,
} from "./upsert";
import { createEncryptionProvider } from "@/lib/encryption";
import { and, eq, between } from "drizzle-orm";

// ─── Constants ──────────────────────────────────────────────

const TEST_USER_ID = "user_test_001";
const OURA_SOURCE = "oura";
const DEXCOM_SOURCE = "dexcom";

/** Number of days of data to cover. */
const DAYS_OF_DATA = 60;

/** Number of nights for hypnogram data. */
const NIGHTS_OF_HYPNOGRAM = 14;

/** Number of nights for glucose intraday data. */
const NIGHTS_OF_GLUCOSE = 7;

// ─── Scenario Dates ─────────────────────────────────────────

const today = new Date();
today.setHours(0, 0, 0, 0);

/** S1 scenario: Late Meal Disrupts Sleep — 7 days ago. */
const S1_DAY_OFFSET = 7;
const S1_DATE = offsetDate(today, -S1_DAY_OFFSET);
const S1_DATE_STR = formatDate(S1_DATE);

/** S3 scenario: Hard Workout Recovery — days 14 to 10 ago (5-day arc). */
const S3_START_OFFSET = 14;
const S3_DAY_COUNT = 5;
const S3_DATES = Array.from({ length: S3_DAY_COUNT }, (_, i) =>
  offsetDate(today, -(S3_START_OFFSET - i)),
);
const S3_DATE_STRS = S3_DATES.map(formatDate);

// ─── Helpers ────────────────────────────────────────────────

function offsetDate(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

/**
 * Generate a deterministic pseudo-random number in [min, max].
 */
function rand(min: number, max: number, seed: number): number {
  const r = Math.abs(Math.sin(seed * 9301 + 49297) % 1);
  return min + r * (max - min);
}

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

// ─── Seed Functions ─────────────────────────────────────────

async function seedGlucoseIntraday(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log(
    "  Seeding glucose intraday series (%d nights)...",
    NIGHTS_OF_GLUCOSE,
  );

  let totalRows = 0;

  for (let nightIdx = 0; nightIdx < NIGHTS_OF_GLUCOSE; nightIdx++) {
    const dayOffset = nightIdx + 1; // 1..7 days ago
    const nightDate = offsetDate(today, -dayOffset);
    const dateStr = formatDate(nightDate);
    const isS1Night = dateStr === S1_DATE_STR;

    // Night window: previous day 8 PM to current day 8 AM (UTC)
    const prevDay = offsetDate(nightDate, -1);
    const windowStartMs = Date.UTC(
      prevDay.getFullYear(),
      prevDay.getMonth(),
      prevDay.getDate(),
      20,
      0,
      0,
    );
    const windowEndMs = Date.UTC(
      nightDate.getFullYear(),
      nightDate.getMonth(),
      nightDate.getDate(),
      8,
      0,
      0,
    );

    const rows: SeriesDataRow[] = [];
    const intervalMs = 5 * 60 * 1000; // 5 minutes

    for (let ts = windowStartMs; ts < windowEndMs; ts += intervalMs) {
      const recordedAt = new Date(ts);
      const hour = recordedAt.getUTCHours();
      const minute = recordedAt.getUTCMinutes();

      let glucoseValue: number;

      if (isS1Night) {
        // S1 scenario: normal ~100, spike to 180 at 9:45 PM, gradual descent over 3 hours
        if (hour === 21 && minute >= 45) {
          // Initial spike phase
          const minutesSinceSpike = minute - 45;
          glucoseValue = 100 + 80 * (minutesSinceSpike / 15); // ramp up
          glucoseValue = Math.min(glucoseValue, 180);
        } else if (hour === 22) {
          // Peak and start descent: 180 → ~140 over 1 hour
          glucoseValue = 180 - 40 * (minute / 60);
        } else if (hour === 23) {
          // Continued descent: 140 → ~120
          glucoseValue = 140 - 20 * (minute / 60);
        } else if (hour === 0) {
          // Final descent: 120 → ~105
          glucoseValue = 120 - 15 * (minute / 60);
        } else {
          // Normal baseline
          glucoseValue = roundTo(rand(90, 110, ts), 0);
        }
        glucoseValue = roundTo(glucoseValue, 0);
      } else {
        // Normal night: baseline ~95-105 mg/dL with minor fluctuations
        const seed = nightIdx * 10000 + (ts - windowStartMs) / intervalMs;
        glucoseValue = roundTo(rand(88, 108, seed), 0);
      }

      const encrypted = await encryption.encrypt(
        Buffer.from(JSON.stringify(glucoseValue)),
        TEST_USER_ID,
      );

      rows.push({
        userId: TEST_USER_ID,
        metricType: "glucose",
        recordedAt,
        valueEncrypted: encrypted,
        source: DEXCOM_SOURCE,
        sourceId: `dexcom_glucose_${dateStr}_${ts}`,
      });
    }

    await upsertSeriesData(db, rows);
    totalRows += rows.length;
    console.log(
      "    %s: %d points%s",
      dateStr,
      rows.length,
      isS1Night ? " (S1 spike)" : "",
    );
  }

  console.log("  ✓ Glucose intraday: %d total data points", totalRows);
}

async function seedSleepHypnogram(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log(
    "  Seeding sleep stage hypnogram periods (%d nights)...",
    NIGHTS_OF_HYPNOGRAM,
  );

  let totalRows = 0;

  for (let nightIdx = 0; nightIdx < NIGHTS_OF_HYPNOGRAM; nightIdx++) {
    const dayOffset = nightIdx + 1;
    const nightDate = offsetDate(today, -dayOffset);
    const dateStr = formatDate(nightDate);
    const isS1Night = dateStr === S1_DATE_STR;

    // Sleep start: previous day 10:30 PM UTC (normal) or 11:05 PM (S1 — 35min latency)
    const prevDay = offsetDate(nightDate, -1);
    let sleepStartMs: number;

    if (isS1Night) {
      // S1: 35-min sleep latency → bed at 10:30 PM, fall asleep at 11:05 PM
      sleepStartMs = Date.UTC(
        prevDay.getFullYear(),
        prevDay.getMonth(),
        prevDay.getDate(),
        23,
        5,
        0,
      );
    } else {
      // Normal: fall asleep ~10:30 PM with slight variation
      const variationMin = Math.floor(rand(0, 15, nightIdx * 777));
      sleepStartMs = Date.UTC(
        prevDay.getFullYear(),
        prevDay.getMonth(),
        prevDay.getDate(),
        22,
        30 + variationMin,
        0,
      );
    }

    // Define sleep architecture
    type StageEntry = { stage: string; durationMin: number };
    let stages: StageEntry[];

    if (isS1Night) {
      // S1: Reduced deep sleep (~0.8hr total deep), disrupted architecture
      stages = [
        { stage: "light", durationMin: 25 },
        { stage: "deep", durationMin: 20 },
        { stage: "light", durationMin: 20 },
        { stage: "rem", durationMin: 15 },
        { stage: "awake", durationMin: 8 },
        { stage: "light", durationMin: 30 },
        { stage: "deep", durationMin: 15 },
        { stage: "light", durationMin: 20 },
        { stage: "rem", durationMin: 20 },
        { stage: "light", durationMin: 25 },
        { stage: "deep", durationMin: 13 },
        { stage: "rem", durationMin: 25 },
        { stage: "light", durationMin: 30 },
        { stage: "awake", durationMin: 10 },
        { stage: "light", durationMin: 25 },
        { stage: "rem", durationMin: 20 },
        { stage: "light", durationMin: 15 },
        { stage: "awake", durationMin: 5 },
      ];
    } else {
      // Normal night: ~7-7.5hr total, cycling through stages
      stages = [
        { stage: "light", durationMin: 15 },
        { stage: "deep", durationMin: 45 },
        { stage: "light", durationMin: 20 },
        { stage: "rem", durationMin: 10 },
        { stage: "light", durationMin: 25 },
        { stage: "deep", durationMin: 40 },
        { stage: "light", durationMin: 15 },
        { stage: "rem", durationMin: 25 },
        { stage: "awake", durationMin: 5 },
        { stage: "light", durationMin: 20 },
        { stage: "deep", durationMin: 30 },
        { stage: "rem", durationMin: 35 },
        { stage: "light", durationMin: 15 },
        { stage: "rem", durationMin: 40 },
        { stage: "light", durationMin: 10 },
        { stage: "awake", durationMin: 5 },
        { stage: "light", durationMin: 20 },
        { stage: "rem", durationMin: 25 },
      ];
    }

    const rows: PeriodDataRow[] = [];
    let currentMs = sleepStartMs;

    for (const { stage, durationMin } of stages) {
      const startedAt = new Date(currentMs);
      const endMs = currentMs + durationMin * 60 * 1000;
      const endedAt = new Date(endMs);

      const metadata = { stage, night_date: dateStr };
      const metadataEnc = await encryption.encrypt(
        Buffer.from(JSON.stringify(metadata)),
        TEST_USER_ID,
      );

      rows.push({
        userId: TEST_USER_ID,
        eventType: stage, // "awake", "light", "deep", "rem" — matching night view query
        subtype: stage,
        startedAt,
        endedAt,
        metadataEnc,
        source: OURA_SOURCE,
        sourceId: `oura_sleep_${dateStr}_${stage}_${currentMs}`,
      });

      currentMs = endMs;
    }

    const batchSize = 50;
    for (let i = 0; i < rows.length; i += batchSize) {
      await upsertPeriodData(db, rows.slice(i, i + batchSize));
    }
    totalRows += rows.length;
    console.log(
      "    %s: %d stages%s",
      dateStr,
      rows.length,
      isS1Night ? " (S1 disrupted)" : "",
    );
  }

  console.log("  ✓ Sleep hypnogram: %d total period rows", totalRows);
}

async function seedDailyMetrics(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log("  Seeding daily metrics (60 days)...");

  type MetricDef = {
    id: string;
    normalValue: number;
    variation: number;
    decimals: number;
    source: string;
    s1Override?: number;
    s3Overrides?: number[];
  };

  // S3 readiness progression: 42 → 61 → 68 → 82 → 84
  // S3 HRV progression: 26 → 34 → 40 → 48 → 50
  // S3 RHR progression: 66 → 63 → 59 → 59 → 59
  // S3 body_temp: +0.4 day 1, normalizing
  const s3ReadinessValues = [42, 61, 68, 82, 84];
  const s3HrvValues = [26, 34, 40, 48, 50];
  const s3RhrValues = [66, 63, 59, 59, 59];
  const s3TempValues = [0.4, 0.25, 0.15, 0.05, 0.0];

  const metrics: MetricDef[] = [
    {
      id: "sleep_latency",
      normalValue: 12,
      variation: 4,
      decimals: 0,
      source: OURA_SOURCE,
      s1Override: 35,
    },
    {
      id: "deep_sleep",
      normalValue: 1.6,
      variation: 0.3,
      decimals: 2,
      source: OURA_SOURCE,
      s1Override: 0.8,
    },
    {
      id: "rem_sleep",
      normalValue: 1.8,
      variation: 0.3,
      decimals: 2,
      source: OURA_SOURCE,
    },
    {
      id: "body_temperature_deviation",
      normalValue: 0.0,
      variation: 0.2,
      decimals: 2,
      source: OURA_SOURCE,
    },
    {
      id: "readiness_score",
      normalValue: 78,
      variation: 8,
      decimals: 0,
      source: OURA_SOURCE,
      s1Override: undefined,
      s3Overrides: s3ReadinessValues,
    },
    // Also seed HRV, RHR, and heart_rate with S3/S1 overrides
    {
      id: "hrv",
      normalValue: 48,
      variation: 10,
      decimals: 1,
      source: OURA_SOURCE,
      s3Overrides: s3HrvValues,
    },
    {
      id: "rhr",
      normalValue: 61,
      variation: 4,
      decimals: 0,
      source: OURA_SOURCE,
      s3Overrides: s3RhrValues,
    },
    // heart_rate daily — needed for Night view baseline computation (VAL-CROSS-007)
    {
      id: "heart_rate",
      normalValue: 58,
      variation: 5,
      decimals: 0,
      source: OURA_SOURCE,
      s1Override: 72,
    },
  ];

  // S1-specific overrides for metrics not in the above list
  const s1SleepScore = 64;
  const s1Rhr = 72;

  let totalRows = 0;

  for (const metric of metrics) {
    const rows: HealthDataRow[] = [];

    for (let dayOffset = 0; dayOffset < DAYS_OF_DATA; dayOffset++) {
      const date = offsetDate(today, -dayOffset);
      const dateStr = formatDate(date);

      let value: number;

      // Check S1 override
      if (dateStr === S1_DATE_STR && metric.s1Override !== undefined) {
        value = metric.s1Override;
      }
      // Check S3 override
      else if (metric.s3Overrides) {
        const s3Idx = S3_DATE_STRS.indexOf(dateStr);
        if (s3Idx !== -1) {
          value = metric.s3Overrides[s3Idx]!;
        } else {
          value = roundTo(
            rand(
              metric.normalValue - metric.variation,
              metric.normalValue + metric.variation,
              dayOffset * 1000 + metric.id.length * 137,
            ),
            metric.decimals,
          );
        }
      }
      // Check S3 body_temperature_deviation override
      else if (metric.id === "body_temperature_deviation") {
        const s3Idx = S3_DATE_STRS.indexOf(dateStr);
        if (s3Idx !== -1) {
          value = s3TempValues[s3Idx]!;
        } else {
          value = roundTo(
            rand(-0.2, 0.2, dayOffset * 1000 + metric.id.length * 137),
            metric.decimals,
          );
        }
      } else {
        value = roundTo(
          rand(
            metric.normalValue - metric.variation,
            metric.normalValue + metric.variation,
            dayOffset * 1000 + metric.id.length * 137,
          ),
          metric.decimals,
        );
      }

      const encrypted = await encryption.encrypt(
        Buffer.from(JSON.stringify(value)),
        TEST_USER_ID,
      );

      rows.push({
        userId: TEST_USER_ID,
        metricType: metric.id,
        date: dateStr,
        valueEncrypted: encrypted,
        source: metric.source,
        sourceId: `${metric.source}_${metric.id}_${dateStr}`,
      });
    }

    // Batch upsert
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      await upsertDailyData(db, rows.slice(i, i + batchSize));
    }

    totalRows += rows.length;
    console.log("    %s: %d data points", metric.id, rows.length);
  }

  // Seed S1 sleep_score and rhr overrides (these metrics exist in the base seed
  // but need S1-specific values)
  const s1Overrides = [
    { id: "sleep_score", value: s1SleepScore },
    { id: "rhr", value: s1Rhr },
  ];

  for (const override of s1Overrides) {
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(override.value)),
      TEST_USER_ID,
    );

    await upsertDailyData(db, [
      {
        userId: TEST_USER_ID,
        metricType: override.id,
        date: S1_DATE_STR,
        valueEncrypted: encrypted,
        source: OURA_SOURCE,
        sourceId: `${OURA_SOURCE}_${override.id}_${S1_DATE_STR}`,
      },
    ]);
    totalRows++;
    console.log("    %s S1 override: %d", override.id, override.value);
  }

  console.log("  ✓ Daily metrics: %d total rows", totalRows);
}

async function seedS1HeartRateSeries(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log("  Seeding S1 elevated heart rate series...");

  // S1 night: elevated HR through midnight
  const prevDay = offsetDate(S1_DATE, -1);
  const windowStartMs = Date.UTC(
    prevDay.getFullYear(),
    prevDay.getMonth(),
    prevDay.getDate(),
    20,
    0,
    0,
  );
  const windowEndMs = Date.UTC(
    S1_DATE.getFullYear(),
    S1_DATE.getMonth(),
    S1_DATE.getDate(),
    8,
    0,
    0,
  );

  const rows: SeriesDataRow[] = [];
  const intervalMs = 5 * 60 * 1000;

  for (let ts = windowStartMs; ts < windowEndMs; ts += intervalMs) {
    const recordedAt = new Date(ts);
    const hour = recordedAt.getUTCHours();

    let hrValue: number;

    // Elevated HR from 9 PM through midnight (S1 late meal effect)
    if (hour >= 21 || hour === 0) {
      hrValue = roundTo(rand(68, 82, ts), 0); // Elevated resting HR
    } else if (hour >= 1 && hour <= 3) {
      // Gradually returning to normal
      hrValue = roundTo(rand(58, 70, ts), 0);
    } else {
      // Normal sleeping HR
      hrValue = roundTo(rand(50, 62, ts), 0);
    }

    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(hrValue)),
      TEST_USER_ID,
    );

    rows.push({
      userId: TEST_USER_ID,
      metricType: "heart_rate",
      recordedAt,
      valueEncrypted: encrypted,
      source: OURA_SOURCE,
      sourceId: `oura_heart_rate_s1_${S1_DATE_STR}_${ts}`,
    });
  }

  await upsertSeriesData(db, rows);
  console.log("  ✓ S1 heart rate series: %d data points", rows.length);
}

async function seedS1Annotation(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log("  Seeding S1 annotation (Late dinner)...");

  const prevDay = offsetDate(S1_DATE, -1);
  const occurredAt = new Date(
    Date.UTC(
      prevDay.getFullYear(),
      prevDay.getMonth(),
      prevDay.getDate(),
      21,
      30,
      0, // 9:30 PM UTC
    ),
  );

  const labelEncrypted = await encryption.encrypt(
    Buffer.from("Late dinner"),
    TEST_USER_ID,
  );
  const noteEncrypted = await encryption.encrypt(
    Buffer.from("Heavy pasta, red wine"),
    TEST_USER_ID,
  );

  // Delete existing annotation for this event if any (idempotent)
  await db
    .delete(userAnnotations)
    .where(
      and(
        eq(userAnnotations.userId, TEST_USER_ID),
        eq(userAnnotations.eventType, "meal"),
        between(
          userAnnotations.occurredAt,
          new Date(occurredAt.getTime() - 60000),
          new Date(occurredAt.getTime() + 60000),
        ),
      ),
    );

  await db.insert(userAnnotations).values({
    userId: TEST_USER_ID,
    eventType: "meal",
    labelEncrypted,
    noteEncrypted,
    occurredAt,
  });

  console.log("  ✓ S1 annotation: meal at %s", occurredAt.toISOString());
}

async function seedS3Annotation(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  console.log("  Seeding S3 annotation (10K run)...");

  const workoutDate = S3_DATES[0]!;
  const occurredAt = new Date(
    Date.UTC(
      workoutDate.getFullYear(),
      workoutDate.getMonth(),
      workoutDate.getDate(),
      8,
      0,
      0, // 8:00 AM UTC
    ),
  );
  const endedAt = new Date(
    Date.UTC(
      workoutDate.getFullYear(),
      workoutDate.getMonth(),
      workoutDate.getDate(),
      9,
      5,
      0, // 9:05 AM UTC (~65 min)
    ),
  );

  const labelEncrypted = await encryption.encrypt(
    Buffer.from("10K run"),
    TEST_USER_ID,
  );
  const noteEncrypted = await encryption.encrypt(
    Buffer.from("Hard 10K race, pushed for PR"),
    TEST_USER_ID,
  );

  // Delete existing annotation for this event if any (idempotent)
  await db
    .delete(userAnnotations)
    .where(
      and(
        eq(userAnnotations.userId, TEST_USER_ID),
        eq(userAnnotations.eventType, "workout"),
        between(
          userAnnotations.occurredAt,
          new Date(occurredAt.getTime() - 60000),
          new Date(occurredAt.getTime() + 60000),
        ),
      ),
    );

  await db.insert(userAnnotations).values({
    userId: TEST_USER_ID,
    eventType: "workout",
    labelEncrypted,
    noteEncrypted,
    occurredAt,
    endedAt,
  });

  console.log("  ✓ S3 annotation: workout at %s", occurredAt.toISOString());
}

async function seedS2RemSleepOverride(
  encryption: ReturnType<typeof createEncryptionProvider>,
) {
  // S2 alcohol night: pick a date ~10 days ago (avoid S1 and S3 overlap)
  const s2Date = offsetDate(today, -5);
  const s2DateStr = formatDate(s2Date);

  // Only override rem_sleep for this date
  const encrypted = await encryption.encrypt(
    Buffer.from(JSON.stringify(0.6)),
    TEST_USER_ID,
  );

  await upsertDailyData(db, [
    {
      userId: TEST_USER_ID,
      metricType: "rem_sleep",
      date: s2DateStr,
      valueEncrypted: encrypted,
      source: OURA_SOURCE,
      sourceId: `${OURA_SOURCE}_rem_sleep_${s2DateStr}`,
    },
  ]);

  console.log("  ✓ S2 rem_sleep override: 0.6 hr on %s", s2DateStr);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  console.log("🌱 Dashboard Seed — Fixtures for Dashboard Views");
  console.log("=".repeat(60));
  console.log("  S1 date (Late Meal):    %s", S1_DATE_STR);
  console.log(
    "  S3 dates (Recovery):    %s to %s",
    S3_DATE_STRS[0],
    S3_DATE_STRS[S3_DATE_STRS.length - 1],
  );
  console.log("=".repeat(60));

  const encryption = createEncryptionProvider();

  try {
    // 1. Glucose intraday series
    await seedGlucoseIntraday(encryption);

    // 2. Sleep stage hypnogram periods
    await seedSleepHypnogram(encryption);

    // 3. Daily metrics (sleep_latency, deep_sleep, rem_sleep, body_temp_dev, readiness, hrv, rhr)
    await seedDailyMetrics(encryption);

    // 4. S1 elevated heart rate series
    await seedS1HeartRateSeries(encryption);

    // 5. S1 annotation (meal)
    await seedS1Annotation(encryption);

    // 6. S3 annotation (workout)
    await seedS3Annotation(encryption);

    // 7. S2 rem_sleep override
    await seedS2RemSleepOverride(encryption);

    console.log("=".repeat(60));
    console.log("✅ Dashboard seed complete!");

    // Print scenario summary
    console.log("\n📊 Scenario Summary:");
    console.log("  S1 (Late Meal, %s):", S1_DATE_STR);
    console.log("    - Glucose spike at 9:45 PM → 180 mg/dL");
    console.log("    - Elevated HR 9 PM–midnight");
    console.log(
      "    - sleep_latency=35, deep_sleep=0.8, sleep_score=64, rhr=72",
    );
    console.log("    - Meal annotation at 9:30 PM");
    console.log(
      "  S3 (Hard Workout, %s to %s):",
      S3_DATE_STRS[0],
      S3_DATE_STRS[S3_DATE_STRS.length - 1],
    );
    console.log("    - readiness: 42→61→68→82→84");
    console.log("    - hrv: 26→34→40→48→50");
    console.log("    - rhr: 66→63→59→59→59");
    console.log("    - body_temp_dev: +0.4→+0.25→+0.15→+0.05→0.0");
    console.log("    - Workout annotation on day 1");
  } catch (error) {
    console.error("❌ Dashboard seed failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
