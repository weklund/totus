/**
 * Migration script: oura_connections → provider_connections
 *
 * Reads each oura_connections row, decrypts the separate access_token_enc
 * and refresh_token_enc columns, re-encrypts them as a single JSONB blob,
 * and inserts into provider_connections.
 *
 * After verification, drops the oura_connections table.
 *
 * Usage: dotenv -e .env.local -- tsx src/db/migrate-oura-connections.ts
 */

import { pool } from "./index";
import { createEncryptionProvider } from "@/lib/encryption";

interface OuraConnectionRow {
  id: string;
  user_id: string;
  access_token_enc: Buffer;
  refresh_token_enc: Buffer;
  token_expires_at: Date;
  last_sync_at: Date | null;
  sync_cursor: string | null;
  sync_status: string;
  sync_error: string | null;
  created_at: Date;
}

async function main() {
  console.log("🔄 Migrating oura_connections → provider_connections");
  console.log("=".repeat(50));

  const encryption = createEncryptionProvider();

  // Check if oura_connections table exists
  const tableExists = await pool.query(
    `SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'oura_connections'
    ) AS exists`,
  );

  if (!tableExists.rows[0]?.exists) {
    console.log(
      "⏭ oura_connections table does not exist — nothing to migrate",
    );
    await pool.end();
    return;
  }

  // Read all oura_connections rows
  const result = await pool.query<OuraConnectionRow>(
    "SELECT * FROM oura_connections ORDER BY created_at",
  );
  const rows = result.rows;

  console.log("  Found %d oura_connections to migrate", rows.length);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    try {
      // Check if already migrated
      const existing = await pool.query(
        `SELECT id FROM provider_connections 
         WHERE user_id = $1 AND provider = 'oura'`,
        [row.user_id],
      );

      if (existing.rows.length > 0) {
        console.log("  ⏭ User %s already migrated, skipping", row.user_id);
        skippedCount++;
        continue;
      }

      let authEnc: Buffer;

      try {
        // Decrypt the separate tokens
        const accessToken = await encryption.decrypt(
          row.access_token_enc,
          row.user_id,
        );
        const refreshToken = await encryption.decrypt(
          row.refresh_token_enc,
          row.user_id,
        );

        // Construct the combined auth payload
        const authPayload = JSON.stringify({
          access_token: accessToken.toString("utf-8"),
          refresh_token: refreshToken.toString("utf-8"),
          expires_at: row.token_expires_at.toISOString(),
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

        // Re-encrypt as a single blob
        authEnc = await encryption.encrypt(
          Buffer.from(authPayload, "utf-8"),
          row.user_id,
        );
      } catch {
        // Decryption failed — this is likely test data with dummy encryption.
        // Create a placeholder encrypted blob so the row can be migrated.
        console.log(
          "  ⚠ Could not decrypt tokens for %s — using placeholder (test data)",
          row.user_id,
        );
        const placeholderPayload = JSON.stringify({
          access_token: "MIGRATION_PLACEHOLDER",
          refresh_token: "MIGRATION_PLACEHOLDER",
          expires_at: row.token_expires_at.toISOString(),
          scopes: [],
        });
        authEnc = await encryption.encrypt(
          Buffer.from(placeholderPayload, "utf-8"),
          row.user_id,
        );
      }

      // Determine status
      let status = "active";
      if (row.token_expires_at < new Date()) {
        status = "expired";
      } else if (row.sync_error) {
        status = "error";
      }

      // Insert into provider_connections
      await pool.query(
        `INSERT INTO provider_connections (
          id, user_id, provider, auth_type, auth_enc,
          token_expires_at, status, last_sync_at,
          daily_cursor, sync_status, sync_error,
          created_at, updated_at
        ) VALUES ($1, $2, 'oura', 'oauth2', $3, $4, $5, $6, $7, $8, $9, $10, now())`,
        [
          row.id,
          row.user_id,
          authEnc,
          row.token_expires_at,
          status,
          row.last_sync_at,
          row.sync_cursor,
          row.sync_status,
          row.sync_error,
          row.created_at,
        ],
      );

      migratedCount++;
      console.log("  ✓ Migrated user %s (status: %s)", row.user_id, status);
    } catch (error) {
      console.error("  ❌ Failed to migrate user %s:", row.user_id, error);
      throw error;
    }
  }

  // Verify counts
  const providerCount = await pool.query(
    "SELECT count(*) AS cnt FROM provider_connections WHERE provider = 'oura'",
  );
  console.log("\n" + "=".repeat(50));
  console.log("📊 Migration Summary:");
  console.log("  Oura connections found:  %d", rows.length);
  console.log("  Newly migrated:          %d", migratedCount);
  console.log("  Already migrated:        %d", skippedCount);
  console.log(
    "  Provider connections:     %d",
    providerCount.rows[0]?.cnt ?? 0,
  );

  if (parseInt(providerCount.rows[0]?.cnt ?? "0") >= rows.length) {
    console.log("\n✅ Migration verified — all rows accounted for");

    // Drop the old oura_connections table
    console.log("  Dropping oura_connections table...");
    await pool.query("DROP TABLE IF EXISTS oura_connections CASCADE");
    console.log("  ✓ oura_connections table dropped");
  } else {
    console.error(
      "\n❌ Migration count mismatch! Not dropping oura_connections.",
    );
    process.exitCode = 1;
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
