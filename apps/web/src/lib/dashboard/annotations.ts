/**
 * Annotation Merge Service
 *
 * Fetches and merges annotations from two sources into a unified sorted timeline:
 * 1. user_annotations — manually created event markers (encrypted labels/notes)
 * 2. health_data_periods — provider-sourced events (workouts, sleep stages, meals)
 *
 * For viewer access, annotations are filtered by the annotation-to-metric mapping
 * (LLD §9.2) so viewers only see event types relevant to their granted metrics.
 *
 * See: /docs/dashboard-backend-lld.md §9.2
 */

import { and, between, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Annotation } from "@/lib/dashboard/types";
import type { EncryptionProvider } from "@/lib/encryption";
import { userAnnotations, healthDataPeriods } from "@/db/schema";

/**
 * Annotation-to-metric mapping for viewer scoping (LLD §9.2, FR-10.6).
 *
 * Maps each annotation event_type to the set of metric types that make it
 * relevant. A viewer sees an annotation only if their granted metrics
 * overlap with the annotation's related metrics.
 *
 * `null` means the annotation is visible with ANY granted metric.
 */
export const ANNOTATION_METRIC_MAP: Record<string, string[] | null> = {
  meal: ["glucose", "calories_consumed"],
  workout: ["active_calories", "steps", "heart_rate", "hrv", "rhr"],
  travel: ["sleep_score", "readiness_score", "body_temperature_deviation"],
  alcohol: ["sleep_score", "hrv", "rhr", "deep_sleep", "rem_sleep"],
  medication: null, // visible with any granted metric
  supplement: null,
  custom: null,
};

/**
 * Determine if an annotation is visible to a viewer based on the
 * annotation-to-metric mapping and the viewer's granted metrics.
 *
 * @param eventType - The annotation's event_type
 * @param viewerMetrics - Array of metric types granted to the viewer
 * @returns true if the annotation should be visible to the viewer
 */
export function isAnnotationVisibleToViewer(
  eventType: string,
  viewerMetrics: string[],
): boolean {
  const relatedMetrics = ANNOTATION_METRIC_MAP[eventType];

  // Unknown event types: not visible to viewers
  if (relatedMetrics === undefined) {
    return false;
  }

  // null means visible with any granted metric
  if (relatedMetrics === null) {
    return viewerMetrics.length > 0;
  }

  // Check if any of the viewer's granted metrics overlap
  return relatedMetrics.some((metric) => viewerMetrics.includes(metric));
}

/**
 * Fetch and merge annotations from user_annotations and health_data_periods
 * into a unified timeline sorted by occurred_at ascending.
 *
 * User annotations have source="user" and their labels/notes are decrypted.
 * Provider events have source=<provider_name> and id=null.
 *
 * @param userId - The user to fetch annotations for
 * @param startDate - Start of the date range (ISO datetime string)
 * @param endDate - End of the date range (ISO datetime string)
 * @param encryption - Encryption provider for decrypting user annotation fields
 * @param database - Drizzle database instance
 * @param viewerMetrics - If provided, filter annotations by annotation-to-metric mapping
 * @returns Merged and sorted array of Annotation objects
 */
export async function fetchMergedAnnotations(
  userId: string,
  startDate: string,
  endDate: string,
  encryption: EncryptionProvider,
  database: NodePgDatabase,
  viewerMetrics?: string[],
): Promise<Annotation[]> {
  // Query both sources in parallel
  const [userRows, periodRows] = await Promise.all([
    database
      .select({
        id: userAnnotations.id,
        eventType: userAnnotations.eventType,
        labelEncrypted: userAnnotations.labelEncrypted,
        noteEncrypted: userAnnotations.noteEncrypted,
        occurredAt: userAnnotations.occurredAt,
        endedAt: userAnnotations.endedAt,
      })
      .from(userAnnotations)
      .where(
        and(
          eq(userAnnotations.userId, userId),
          between(
            userAnnotations.occurredAt,
            new Date(startDate),
            new Date(endDate),
          ),
        ),
      ),
    database
      .select({
        eventType: healthDataPeriods.eventType,
        source: healthDataPeriods.source,
        startedAt: healthDataPeriods.startedAt,
        endedAt: healthDataPeriods.endedAt,
      })
      .from(healthDataPeriods)
      .where(
        and(
          eq(healthDataPeriods.userId, userId),
          between(
            healthDataPeriods.startedAt,
            new Date(startDate),
            new Date(endDate),
          ),
        ),
      ),
  ]);

  // Decrypt user annotations and map to Annotation interface
  const userAnnotationResults: Annotation[] = await Promise.all(
    userRows.map(async (row) => {
      const labelDecrypted = await encryption.decrypt(
        row.labelEncrypted,
        userId,
      );
      const label = labelDecrypted.toString();

      let note: string | null = null;
      if (row.noteEncrypted) {
        const noteDecrypted = await encryption.decrypt(
          row.noteEncrypted,
          userId,
        );
        note = noteDecrypted.toString();
      }

      return {
        id: row.id,
        source: "user" as const,
        event_type: row.eventType,
        label,
        note,
        occurred_at: row.occurredAt.toISOString(),
        ended_at: row.endedAt ? row.endedAt.toISOString() : null,
      };
    }),
  );

  // Map health_data_periods to Annotation format
  const periodAnnotations: Annotation[] = periodRows.map((row) => ({
    id: null,
    source: row.source,
    event_type: row.eventType,
    label: row.eventType,
    note: null,
    occurred_at: row.startedAt.toISOString(),
    ended_at: row.endedAt.toISOString(),
  }));

  // Merge both sources
  let merged = [...userAnnotationResults, ...periodAnnotations];

  // Apply viewer metric filtering if viewerMetrics is provided
  if (viewerMetrics) {
    merged = merged.filter((annotation) =>
      isAnnotationVisibleToViewer(annotation.event_type, viewerMetrics),
    );
  }

  // Sort by occurred_at ascending
  merged.sort(
    (a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime(),
  );

  return merged;
}
