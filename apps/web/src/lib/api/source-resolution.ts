/**
 * Source Resolution Logic
 *
 * Determines which provider's data to return for each metric when
 * multiple providers offer the same metric.
 *
 * Resolution order:
 * 1. User preference (metric_source_preferences table)
 * 2. Most recently synced source (last 7 days)
 * 3. Alphabetical tie-break (deterministic)
 *
 * See: /docs/integrations-pipeline-lld.md §8.4
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { healthDataDaily, metricSourcePreferences } from "@/db/schema";

export interface SourceResolution {
  source: string;
  reason: "user_preference" | "most_recent" | "alphabetical" | "only_source";
}

/**
 * Resolve which source to use for each requested metric for a given user.
 *
 * @param userId - The user ID
 * @param metricTypes - Array of metric type IDs to resolve
 * @returns Map of metric type -> SourceResolution
 */
export async function resolveSourcesForMetrics(
  userId: string,
  metricTypes: string[],
): Promise<Map<string, SourceResolution>> {
  const resolutions = new Map<string, SourceResolution>();

  if (metricTypes.length === 0) return resolutions;

  // Step 1: Check user preferences
  const preferences = await db
    .select({
      metricType: metricSourcePreferences.metricType,
      provider: metricSourcePreferences.provider,
    })
    .from(metricSourcePreferences)
    .where(eq(metricSourcePreferences.userId, userId));

  const preferenceMap = new Map<string, string>();
  for (const pref of preferences) {
    preferenceMap.set(pref.metricType, pref.provider);
  }

  // Step 2: For metrics without preferences, find available sources
  const metricsNeedingResolution: string[] = [];
  for (const metricType of metricTypes) {
    const preferred = preferenceMap.get(metricType);
    if (preferred) {
      resolutions.set(metricType, {
        source: preferred,
        reason: "user_preference",
      });
    } else {
      metricsNeedingResolution.push(metricType);
    }
  }

  if (metricsNeedingResolution.length === 0) return resolutions;

  // Step 3: Query available sources with most recent sync info
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0]!;

  const sourceSummaries = await db
    .select({
      metricType: healthDataDaily.metricType,
      source: healthDataDaily.source,
      maxImportedAt: sql<string>`max(${healthDataDaily.importedAt})`,
    })
    .from(healthDataDaily)
    .where(
      and(
        eq(healthDataDaily.userId, userId),
        gte(healthDataDaily.date, sevenDaysAgoStr),
      ),
    )
    .groupBy(healthDataDaily.metricType, healthDataDaily.source);

  // Group by metric type
  const sourcesByMetric = new Map<
    string,
    { source: string; maxImportedAt: string }[]
  >();

  for (const row of sourceSummaries) {
    const existing = sourcesByMetric.get(row.metricType) || [];
    existing.push({
      source: row.source,
      maxImportedAt: row.maxImportedAt,
    });
    sourcesByMetric.set(row.metricType, existing);
  }

  // Step 4: Resolve each metric
  for (const metricType of metricsNeedingResolution) {
    const sources = sourcesByMetric.get(metricType);

    if (!sources || sources.length === 0) {
      // No data in last 7 days — will return all available data
      // Don't set a resolution (no source filter)
      continue;
    }

    if (sources.length === 1) {
      resolutions.set(metricType, {
        source: sources[0]!.source,
        reason: "only_source",
      });
      continue;
    }

    // Multiple sources: pick by most recent import
    sources.sort((a, b) => {
      // Most recent first
      const timeDiff = b.maxImportedAt.localeCompare(a.maxImportedAt);
      if (timeDiff !== 0) return timeDiff;
      // Alphabetical tie-break
      return a.source.localeCompare(b.source);
    });

    resolutions.set(metricType, {
      source: sources[0]!.source,
      reason: "most_recent",
    });
  }

  return resolutions;
}
