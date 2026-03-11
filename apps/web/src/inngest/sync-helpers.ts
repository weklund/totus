/**
 * Sync Helper Functions
 *
 * Shared logic for sync.connection, sync.initial, and sync.manual functions.
 * Handles data fetching via provider adapters, encryption, and upserting
 * into the correct health data tables.
 *
 * See: /docs/integrations-pipeline-lld.md §7
 */

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { providerConnections } from "@/db/schema";
import {
  upsertDailyData,
  upsertSeriesData,
  upsertPeriodData,
  type HealthDataRow,
  type SeriesDataRow,
  type PeriodDataRow,
} from "@/db/upsert";
import { createEncryptionProvider } from "@/lib/encryption";
import { getAdapter } from "@/lib/integrations/adapters";
import { getProvider } from "@/config/providers";
import type { DecryptedAuth } from "@/lib/integrations/adapter";

/**
 * Attempt to claim a connection for syncing via atomic compare-and-swap.
 * Returns the number of rows updated (0 if another job beat us).
 */
export async function claimConnection(connectionId: string): Promise<number> {
  const result = await db
    .update(providerConnections)
    .set({ syncStatus: "syncing", syncError: null, updatedAt: new Date() })
    .where(
      and(
        eq(providerConnections.id, connectionId),
        ne(providerConnections.syncStatus, "syncing"),
      ),
    );
  return result.rowCount ?? 0;
}

/**
 * Mark a connection as idle after successful sync.
 */
export async function markSyncIdle(
  connectionId: string,
  cursors?: {
    dailyCursor?: string | null;
    seriesCursor?: string | null;
    periodsCursor?: string | null;
  },
): Promise<void> {
  await db
    .update(providerConnections)
    .set({
      syncStatus: "idle",
      lastSyncAt: new Date(),
      syncError: null,
      updatedAt: new Date(),
      ...(cursors?.dailyCursor !== undefined && {
        dailyCursor: cursors.dailyCursor,
      }),
      ...(cursors?.seriesCursor !== undefined && {
        seriesCursor: cursors.seriesCursor,
      }),
      ...(cursors?.periodsCursor !== undefined && {
        periodsCursor: cursors.periodsCursor,
      }),
    })
    .where(eq(providerConnections.id, connectionId));
}

/**
 * Mark a connection as errored after failed sync.
 */
export async function markSyncError(
  connectionId: string,
  error: string,
): Promise<void> {
  await db
    .update(providerConnections)
    .set({
      syncStatus: "error",
      syncError: error.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(providerConnections.id, connectionId));
}

/**
 * Ensure a value is a proper Buffer instance.
 * Inngest step.run() serializes Buffers as {type: "Buffer", data: number[]}.
 * This helper reconstructs the Buffer from the serialized form.
 */
export function ensureBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    (value as { type: string }).type === "Buffer" &&
    "data" in value &&
    Array.isArray((value as { data: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error("Cannot convert value to Buffer");
}

/**
 * Decrypt the auth_enc blob from a provider connection.
 */
export async function decryptAuth(
  authEnc: unknown,
  userId: string,
): Promise<DecryptedAuth> {
  const encryption = createEncryptionProvider();
  const buf = ensureBuffer(authEnc);
  const decrypted = await encryption.decrypt(buf, userId);
  const parsed = JSON.parse(decrypted.toString("utf-8"));

  return {
    accessToken: parsed.access_token ?? parsed.accessToken ?? "",
    refreshToken: parsed.refresh_token ?? parsed.refreshToken,
    expiresAt: new Date(parsed.expires_at ?? parsed.expiresAt ?? Date.now()),
    scopes: parsed.scopes ?? [],
  };
}

/**
 * Encrypt a token set back into a Buffer for storage.
 */
export async function encryptTokenSet(
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: Date;
    scopes: string[];
  },
  userId: string,
): Promise<Buffer> {
  const encryption = createEncryptionProvider();
  const payload = JSON.stringify({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.expiresAt.toISOString(),
    scopes: tokens.scopes,
  });
  return encryption.encrypt(Buffer.from(payload, "utf-8"), userId);
}

/**
 * Sync daily data for a connection.
 * Fetches via adapter, encrypts, and upserts into health_data_daily.
 */
export async function syncDailyData(
  connectionId: string,
  userId: string,
  provider: string,
  authEnc: unknown,
  dailyCursor: string | null,
): Promise<string | null> {
  const adapter = getAdapter(provider);
  const providerConfig = getProvider(provider);
  if (!providerConfig) return dailyCursor;

  const metrics = providerConfig.sync.dailyMetrics;
  if (metrics.length === 0) return dailyCursor;

  const auth = await decryptAuth(authEnc, userId);
  const result = await adapter.fetchDailyData(auth, metrics, dailyCursor);

  if (result.points.length === 0) return result.nextCursor ?? dailyCursor;

  const encryption = createEncryptionProvider();
  const rows: HealthDataRow[] = [];

  for (const point of result.points) {
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(point.value)),
      userId,
    );
    rows.push({
      userId,
      metricType: point.metricType,
      date: point.date,
      valueEncrypted: encrypted,
      source: point.source,
      sourceId: point.sourceId ?? null,
    });
  }

  await upsertDailyData(db, rows);
  return result.nextCursor ?? dailyCursor;
}

/**
 * Sync series data for a connection.
 * Fetches via adapter, encrypts, and upserts into health_data_series.
 */
export async function syncSeriesData(
  connectionId: string,
  userId: string,
  provider: string,
  authEnc: unknown,
  seriesCursor: string | null,
): Promise<string | null> {
  const adapter = getAdapter(provider);
  const providerConfig = getProvider(provider);
  if (!providerConfig) return seriesCursor;

  const metrics = providerConfig.sync.seriesMetrics;
  if (metrics.length === 0) return seriesCursor;

  const auth = await decryptAuth(authEnc, userId);
  const result = await adapter.fetchSeriesData(auth, metrics, seriesCursor);

  if (result.readings.length === 0) return result.nextCursor ?? seriesCursor;

  const encryption = createEncryptionProvider();
  const rows: SeriesDataRow[] = [];

  for (const reading of result.readings) {
    const encrypted = await encryption.encrypt(
      Buffer.from(JSON.stringify(reading.value)),
      userId,
    );
    rows.push({
      userId,
      metricType: reading.metricType,
      recordedAt: reading.recordedAt,
      valueEncrypted: encrypted,
      source: reading.source,
      sourceId: reading.sourceId ?? null,
    });
  }

  await upsertSeriesData(db, rows);
  return result.nextCursor ?? seriesCursor;
}

/**
 * Sync period data for a connection.
 * Fetches via adapter, encrypts metadata, and upserts into health_data_periods.
 */
export async function syncPeriodData(
  connectionId: string,
  userId: string,
  provider: string,
  authEnc: unknown,
  periodsCursor: string | null,
): Promise<string | null> {
  const adapter = getAdapter(provider);
  const providerConfig = getProvider(provider);
  if (!providerConfig) return periodsCursor;

  const eventTypes = providerConfig.sync.periodTypes;
  if (eventTypes.length === 0) return periodsCursor;

  const auth = await decryptAuth(authEnc, userId);
  const result = await adapter.fetchPeriods(auth, eventTypes, periodsCursor);

  if (result.periods.length === 0) return result.nextCursor ?? periodsCursor;

  const encryption = createEncryptionProvider();
  const rows: PeriodDataRow[] = [];

  for (const period of result.periods) {
    const metadataEnc = period.metadata
      ? await encryption.encrypt(
          Buffer.from(JSON.stringify(period.metadata)),
          userId,
        )
      : null;

    rows.push({
      userId,
      eventType: period.eventType,
      subtype: period.subtype ?? null,
      startedAt: period.startedAt,
      endedAt: period.endedAt,
      metadataEnc,
      source: period.source,
      sourceId: period.sourceId ?? null,
    });
  }

  await upsertPeriodData(db, rows);
  return result.nextCursor ?? periodsCursor;
}
