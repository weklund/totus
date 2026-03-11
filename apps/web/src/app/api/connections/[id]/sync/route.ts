/**
 * POST /api/connections/:id/sync — Manually trigger a data sync.
 *
 * Sets sync_status to 'syncing', generates mock health data for 7 days,
 * updates sync_cursor and last_sync_at, then sets sync_status back to 'idle'.
 * Rejects if already syncing (409).
 *
 * Auth: Owner (session required)
 *
 * See: /docs/api-database-lld.md Section 7.2.5
 */

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerConnections, auditEvents } from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api/errors";
import { createEncryptionProvider } from "@/lib/encryption";
import { upsertDailyData, type HealthDataRow } from "@/db/upsert";

/**
 * Metric definitions for mock sync data generation.
 */
const SYNC_METRICS = [
  { id: "sleep_score", min: 60, max: 95, decimals: 0 },
  { id: "hrv", min: 20, max: 80, decimals: 1 },
  { id: "rhr", min: 50, max: 70, decimals: 0 },
  { id: "steps", min: 3000, max: 15000, decimals: 0 },
  { id: "readiness_score", min: 55, max: 98, decimals: 0 },
  { id: "sleep_duration", min: 5.5, max: 9.0, decimals: 2 },
  { id: "deep_sleep", min: 0.5, max: 2.5, decimals: 2 },
  { id: "active_calories", min: 150, max: 800, decimals: 0 },
] as const;

const SYNC_DAYS = 7;

/**
 * Generate a random value in range with given precision.
 */
function generateValue(min: number, max: number, decimals: number): number {
  const value = min + Math.random() * (max - min);
  return Number(value.toFixed(decimals));
}

/**
 * Format a Date as YYYY-MM-DD.
 */
function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    const { id } = await params;

    // Find the connection (only if owned by this user)
    const connections = await db
      .select()
      .from(providerConnections)
      .where(
        and(
          eq(providerConnections.id, id),
          eq(providerConnections.userId, ctx.userId),
        ),
      )
      .limit(1);

    if (connections.length === 0) {
      throw new ApiError("NOT_FOUND", "Connection not found", 404);
    }

    const connection = connections[0];

    // Reject if connection is expired — user must re-authenticate
    if (connection.status === "expired") {
      throw new ApiError(
        "FORBIDDEN",
        "Connection has expired. Please re-authenticate with the provider.",
        403,
      );
    }

    // Reject if already syncing (409 SYNC_IN_PROGRESS)
    if (connection.syncStatus === "syncing") {
      throw new ApiError(
        "CONFLICT",
        "A sync is already in progress for this connection",
        409,
      );
    }

    // Set status to syncing
    await db
      .update(providerConnections)
      .set({ syncStatus: "syncing", updatedAt: new Date() })
      .where(eq(providerConnections.id, id));

    try {
      // Generate mock data for the last 7 days
      const encryption = createEncryptionProvider();
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const rows: HealthDataRow[] = [];

      for (const metric of SYNC_METRICS) {
        for (let dayOffset = 0; dayOffset < SYNC_DAYS; dayOffset++) {
          const date = new Date(today);
          date.setDate(date.getDate() - dayOffset);
          const dateStr = formatDate(date);

          const value = generateValue(metric.min, metric.max, metric.decimals);

          const encrypted = await encryption.encrypt(
            Buffer.from(JSON.stringify(value)),
            ctx.userId,
          );

          rows.push({
            userId: ctx.userId,
            metricType: metric.id,
            date: dateStr,
            valueEncrypted: encrypted,
            source: connection.provider,
            sourceId: `${connection.provider}_${metric.id}_${dateStr}`,
          });
        }
      }

      // Batch upsert data
      await upsertDailyData(db, rows);

      // Update connection: set sync cursor, last_sync_at, status back to idle
      const now = new Date();
      await db
        .update(providerConnections)
        .set({
          syncStatus: "idle",
          lastSyncAt: now,
          dailyCursor: formatDate(today),
          syncError: null,
          updatedAt: now,
        })
        .where(eq(providerConnections.id, id));

      // Emit audit event (fire-and-forget)
      db.insert(auditEvents)
        .values({
          ownerId: ctx.userId,
          actorType: "owner",
          actorId: ctx.userId,
          eventType: "data.synced",
          resourceType: "connection",
          resourceDetail: {
            connection_id: id,
            provider: connection.provider,
            days_synced: SYNC_DAYS,
            metrics_synced: SYNC_METRICS.length,
            rows_upserted: rows.length,
          },
          ipAddress: request.headers.get("x-forwarded-for") || "127.0.0.1",
        })
        .catch((err) => {
          console.error("Failed to emit audit event:", err);
        });

      return NextResponse.json({
        data: {
          sync_id: `sync_${Date.now()}`,
          status: "completed",
          message: `Synced ${rows.length} data points across ${SYNC_METRICS.length} metrics for the last ${SYNC_DAYS} days`,
          rows_synced: rows.length,
        },
      });
    } catch (syncError) {
      // On error, set status back to error
      await db
        .update(providerConnections)
        .set({
          syncStatus: "error",
          syncError:
            syncError instanceof Error
              ? syncError.message
              : "Unknown sync error",
          updatedAt: new Date(),
        })
        .where(eq(providerConnections.id, id));

      throw syncError;
    }
  } catch (error) {
    return createErrorResponse(error);
  }
}
