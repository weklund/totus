/**
 * Baseline Computation Service
 *
 * Provides 30-day rolling baselines (avg, stddev, upper, lower bounds) for
 * health metrics. Used by all view endpoints.
 *
 * Two main functions:
 * - fetchBaselines(): Cache-first lookup with on-demand fallback
 * - computeBaselinesOnDemand(): Direct computation from health_data_daily
 *
 * See: /docs/dashboard-backend-lld.md §4, §5.1
 */

import { and, between, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BaselinePayload } from "@/lib/dashboard/types";
import type { EncryptionProvider } from "@/lib/encryption";
import { healthDataDaily, metricBaselines } from "@/db/schema";

/** Minimum number of data points required to compute a meaningful baseline. */
const MIN_DATA_POINTS = 7;

/**
 * Pure computation: given a map of metric → numeric values,
 * compute BaselinePayload for each metric with sufficient data (>= 7 points).
 *
 * Uses population standard deviation (divisor N, not N-1).
 * Handles zero stddev gracefully (upper = lower = avg).
 *
 * @param dataByMetric - Map of metric type to array of decrypted numeric values
 * @returns Map of metric type to BaselinePayload (metrics with < 7 points omitted)
 */
export function computeBaselinesFromValues(
  dataByMetric: Map<string, number[]>,
): Map<string, BaselinePayload> {
  const results = new Map<string, BaselinePayload>();

  for (const [metric, values] of dataByMetric) {
    if (values.length < MIN_DATA_POINTS) {
      continue; // Skip metrics with insufficient data
    }

    const n = values.length;
    const avg = values.reduce((sum, v) => sum + v, 0) / n;

    // Population standard deviation (divisor N, not N-1)
    const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    results.set(metric, {
      avg_30d: avg,
      stddev_30d: stddev,
      upper: avg + stddev,
      lower: avg - stddev,
      sample_count: n,
    });
  }

  return results;
}

/**
 * Compute baselines on-demand by querying health_data_daily for a 30-day window
 * [referenceDate - 30 days, referenceDate - 1 day] inclusive.
 *
 * The referenceDate itself is excluded from the computation (FR-1.4).
 *
 * @param userId - The user to compute baselines for
 * @param metrics - Array of metric type strings to compute
 * @param referenceDate - YYYY-MM-DD date to anchor the baseline window
 * @param encryption - Encryption provider for decrypting stored values
 * @param database - Drizzle database instance
 * @returns Map of metric type to BaselinePayload
 */
export async function computeBaselinesOnDemand(
  userId: string,
  metrics: string[],
  referenceDate: string,
  encryption: EncryptionProvider,
  database: NodePgDatabase,
): Promise<Map<string, BaselinePayload>> {
  if (metrics.length === 0) {
    return new Map();
  }

  // Compute date window: [referenceDate - 30, referenceDate - 1]
  const refDate = new Date(referenceDate + "T00:00:00Z");
  const windowStart = new Date(refDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - 30);
  const windowEnd = new Date(refDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() - 1);

  const windowStartStr = windowStart.toISOString().split("T")[0]!;
  const windowEndStr = windowEnd.toISOString().split("T")[0]!;

  // Query encrypted rows from health_data_daily
  const rows = await database
    .select({
      metricType: healthDataDaily.metricType,
      date: healthDataDaily.date,
      valueEncrypted: healthDataDaily.valueEncrypted,
    })
    .from(healthDataDaily)
    .where(
      and(
        eq(healthDataDaily.userId, userId),
        inArray(healthDataDaily.metricType, metrics),
        between(healthDataDaily.date, windowStartStr, windowEndStr),
      ),
    );

  // Decrypt values and group by metric
  const dataByMetric = new Map<string, number[]>();

  for (const row of rows) {
    const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
    const value = JSON.parse(decrypted.toString()) as number;

    if (!dataByMetric.has(row.metricType)) {
      dataByMetric.set(row.metricType, []);
    }
    dataByMetric.get(row.metricType)!.push(value);
  }

  // Compute baselines using the pure function
  return computeBaselinesFromValues(dataByMetric);
}

/**
 * Fetch baselines with cache-first strategy.
 *
 * 1. Check metric_baselines cache for entries within tolerance of the referenceDate
 * 2. For cache hits: decrypt and return the cached BaselinePayload
 * 3. For cache misses: compute on-demand via computeBaselinesOnDemand
 * 4. Merge cached + on-demand results
 *
 * @param userId - The user to fetch baselines for
 * @param metrics - Array of metric type strings
 * @param referenceDate - YYYY-MM-DD date anchor
 * @param toleranceDays - Max days difference for cache hit (default 2)
 * @param encryption - Encryption provider
 * @param database - Drizzle database instance
 * @returns Map of metric type to BaselinePayload
 */
export async function fetchBaselines(
  userId: string,
  metrics: string[],
  referenceDate: string,
  toleranceDays: number = 2,
  encryption: EncryptionProvider,
  database: NodePgDatabase,
): Promise<Map<string, BaselinePayload>> {
  if (metrics.length === 0) {
    return new Map();
  }

  const results = new Map<string, BaselinePayload>();

  // Step 1: Check cache — find entries within tolerance window
  const refDate = new Date(referenceDate + "T00:00:00Z");
  const toleranceStart = new Date(refDate);
  toleranceStart.setUTCDate(toleranceStart.getUTCDate() - toleranceDays);
  const toleranceEnd = new Date(refDate);
  toleranceEnd.setUTCDate(toleranceEnd.getUTCDate() + toleranceDays);

  const toleranceStartStr = toleranceStart.toISOString().split("T")[0]!;
  const toleranceEndStr = toleranceEnd.toISOString().split("T")[0]!;

  const cachedRows = await database
    .select({
      metricType: metricBaselines.metricType,
      referenceDate: metricBaselines.referenceDate,
      valueEncrypted: metricBaselines.valueEncrypted,
    })
    .from(metricBaselines)
    .where(
      and(
        eq(metricBaselines.userId, userId),
        inArray(metricBaselines.metricType, metrics),
        between(
          metricBaselines.referenceDate,
          toleranceStartStr,
          toleranceEndStr,
        ),
      ),
    );

  // Decrypt and collect cached baselines
  // If multiple cache entries exist for the same metric, pick the closest to referenceDate
  const cachedByMetric = new Map<
    string,
    { referenceDate: string; valueEncrypted: Buffer }
  >();

  for (const row of cachedRows) {
    const existing = cachedByMetric.get(row.metricType);
    if (!existing) {
      cachedByMetric.set(row.metricType, row);
    } else {
      // Pick closer to referenceDate
      const existingDiff = Math.abs(
        new Date(existing.referenceDate + "T00:00:00Z").getTime() -
          refDate.getTime(),
      );
      const newDiff = Math.abs(
        new Date(row.referenceDate + "T00:00:00Z").getTime() -
          refDate.getTime(),
      );
      if (newDiff < existingDiff) {
        cachedByMetric.set(row.metricType, row);
      }
    }
  }

  // Decrypt cached entries
  for (const [metric, row] of cachedByMetric) {
    const decrypted = await encryption.decrypt(row.valueEncrypted, userId);
    const payload = JSON.parse(decrypted.toString()) as BaselinePayload;
    results.set(metric, payload);
  }

  // Step 2: Identify missing metrics and compute on-demand
  const missingMetrics = metrics.filter((m) => !results.has(m));
  if (missingMetrics.length > 0) {
    const computed = await computeBaselinesOnDemand(
      userId,
      missingMetrics,
      referenceDate,
      encryption,
      database,
    );

    // Merge computed into results
    for (const [metric, payload] of computed) {
      results.set(metric, payload);
    }
  }

  return results;
}
