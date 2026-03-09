/**
 * POST /api/user/export — Export all user data as JSON.
 *
 * Collects profile, health data (decrypted), shares, and audit log.
 * For MVP, returns data inline (sync) since <500 users.
 *
 * Auth: Owner (session required).
 *
 * See: /docs/api-database-lld.md Section 7.6
 */

import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  healthData,
  shareGrants,
  ouraConnections,
  auditEvents,
} from "@/db/schema";
import { getRequestContext } from "@/lib/auth/request-context";
import { createErrorResponse, ApiError } from "@/lib/api";
import { createEncryptionProvider } from "@/lib/encryption";

// ─── POST /api/user/export ──────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = getRequestContext(request);

    if (ctx.role !== "owner" || !ctx.userId) {
      throw new ApiError("UNAUTHORIZED", "Authentication is required", 401);
    }

    // Fetch user profile
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, ctx.userId));

    if (!user) {
      throw new ApiError("NOT_FOUND", "User not found", 404);
    }

    // Fetch connections
    const connections = await db
      .select({
        id: ouraConnections.id,
        syncStatus: ouraConnections.syncStatus,
        lastSyncAt: ouraConnections.lastSyncAt,
        createdAt: ouraConnections.createdAt,
      })
      .from(ouraConnections)
      .where(eq(ouraConnections.userId, ctx.userId));

    // Fetch and decrypt health data
    const healthRows = await db
      .select({
        metricType: healthData.metricType,
        date: healthData.date,
        valueEncrypted: healthData.valueEncrypted,
        source: healthData.source,
        importedAt: healthData.importedAt,
      })
      .from(healthData)
      .where(eq(healthData.userId, ctx.userId))
      .orderBy(healthData.metricType, healthData.date);

    const encryption = createEncryptionProvider();
    const decryptedHealthData = [];

    for (const row of healthRows) {
      const decrypted = await encryption.decrypt(
        row.valueEncrypted,
        ctx.userId,
      );
      const value = JSON.parse(decrypted.toString()) as number;
      decryptedHealthData.push({
        metric_type: row.metricType,
        date: row.date,
        value,
        source: row.source,
        imported_at: row.importedAt.toISOString(),
      });
    }

    // Fetch share grants
    const shares = await db
      .select({
        id: shareGrants.id,
        label: shareGrants.label,
        allowedMetrics: shareGrants.allowedMetrics,
        dataStart: shareGrants.dataStart,
        dataEnd: shareGrants.dataEnd,
        grantExpires: shareGrants.grantExpires,
        revokedAt: shareGrants.revokedAt,
        viewCount: shareGrants.viewCount,
        createdAt: shareGrants.createdAt,
      })
      .from(shareGrants)
      .where(eq(shareGrants.ownerId, ctx.userId))
      .orderBy(desc(shareGrants.createdAt));

    // Fetch audit events
    const auditRows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.ownerId, ctx.userId))
      .orderBy(desc(auditEvents.createdAt));

    // Package export
    const exportData = {
      exported_at: new Date().toISOString(),
      profile: {
        id: user.id,
        display_name: user.displayName,
        created_at: user.createdAt.toISOString(),
        updated_at: user.updatedAt.toISOString(),
      },
      connections: connections.map((c) => ({
        id: c.id,
        provider: "oura",
        sync_status: c.syncStatus,
        last_sync_at: c.lastSyncAt?.toISOString() ?? null,
        created_at: c.createdAt.toISOString(),
      })),
      health_data: decryptedHealthData,
      shares: shares.map((s) => ({
        id: s.id,
        label: s.label,
        allowed_metrics: s.allowedMetrics,
        data_start: s.dataStart,
        data_end: s.dataEnd,
        grant_expires: s.grantExpires.toISOString(),
        revoked_at: s.revokedAt?.toISOString() ?? null,
        view_count: s.viewCount,
        created_at: s.createdAt.toISOString(),
      })),
      audit_log: auditRows.map((a) => ({
        id: a.id.toString(),
        event_type: a.eventType,
        actor_type: a.actorType,
        actor_id: a.actorId,
        grant_id: a.grantId,
        resource_type: a.resourceType,
        resource_detail: a.resourceDetail,
        created_at: a.createdAt.toISOString(),
      })),
    };

    // Emit audit event (fire-and-forget)
    db.insert(auditEvents)
      .values({
        ownerId: ctx.userId,
        actorType: "owner",
        actorId: ctx.userId,
        eventType: "data.exported",
        resourceType: "user",
        resourceDetail: {
          health_data_points: decryptedHealthData.length,
          shares_count: shares.length,
          audit_events_count: auditRows.length,
        },
      })
      .catch((error) => {
        console.error("Failed to emit audit event:", error);
      });

    return NextResponse.json({
      data: {
        export: exportData,
      },
    });
  } catch (error) {
    return createErrorResponse(error);
  }
}
