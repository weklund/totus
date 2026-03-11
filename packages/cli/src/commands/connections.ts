/**
 * Connections commands: list, sync
 *
 * See: LLD Sections 8.5.12-8.5.13
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { outputData, formatJson } from "../formatters.js";
import { EXIT_ERROR } from "../exit-codes.js";

interface Connection {
  id: string;
  provider: string;
  status: string;
  last_synced_at?: string | null;
  last_sync_at?: string | null;
  sync_status?: string;
  metrics?: string[];
  metric_count?: number;
}

interface SyncResult {
  job_id?: string;
  status?: string;
  message?: string;
}

export function createConnectionsCommand(): Command {
  const connections = new Command("connections").description(
    "Manage data source connections",
  );

  connections
    .command("list")
    .description("List data source connections")
    .action(async (_opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<Connection[]>("/api/connections");
      const conns = Array.isArray(response.data) ? response.data : [];

      const rows = conns.map((c) => ({
        provider: c.provider,
        status: c.status,
        last_sync:
          c.last_synced_at ?? c.last_sync_at
            ? new Date(
                (c.last_synced_at ?? c.last_sync_at)!,
              )
                .toISOString()
                .replace("T", " ")
                .slice(0, 19)
            : "—",
        id: c.id,
      }));

      const output = outputData(resolved.outputFormat, {
        columns: [
          { header: "Provider", key: "provider" },
          { header: "Status", key: "status" },
          { header: "Last Sync", key: "last_sync" },
          { header: "Connection ID", key: "id" },
        ],
        rows,
        jsonData: { connections: conns },
      });
      process.stdout.write(output + "\n");
    });

  connections
    .command("sync")
    .description("Trigger a data sync")
    .argument("[id]", "Connection ID to sync")
    .option("--all", "Sync all active connections")
    .action(async (id, opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      if (!id && !opts.all) {
        process.stderr.write(
          chalk.red('✗ Error: Specify a connection ID or use --all.\n') +
            '  Run "totus connections list" to find connection IDs.\n',
        );
        process.exit(EXIT_ERROR);
      }

      if (opts.all) {
        // Sync all active connections
        const listResponse = await client.get<Connection[]>(
          "/api/connections",
        );
        const conns = Array.isArray(listResponse.data)
          ? listResponse.data
          : [];
        const activeConns = conns.filter(
          (c) => c.status === "connected" || c.status === "active",
        );
        const skippedConns = conns.filter(
          (c) => c.status !== "connected" && c.status !== "active",
        );

        if (activeConns.length === 0) {
          process.stdout.write(
            "No active connections to sync.\n" +
              '  Run "totus connections list" to see your connections.\n',
          );
          return;
        }

        const results: Array<{
          provider: string;
          status: string;
          message: string;
        }> = [];

        for (const conn of activeConns) {
          try {
            await client.post(`/api/connections/${conn.provider}/sync`);
            results.push({
              provider: conn.provider,
              status: "queued",
              message: "",
            });
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "Unknown error";
            results.push({
              provider: conn.provider,
              status: "failed",
              message: msg,
            });
          }
        }

        if (resolved.outputFormat === "json") {
          process.stdout.write(
            formatJson({
              synced: results,
              skipped: skippedConns.map((c) => ({
                provider: c.provider,
                reason: c.status,
              })),
            }) + "\n",
          );
          return;
        }

        process.stdout.write(
          chalk.green(
            `\n✓ Sync triggered for ${results.filter((r) => r.status === "queued").length} connections\n`,
          ),
        );
        for (const r of results) {
          const icon = r.status === "queued" ? "→" : "✗";
          process.stdout.write(`  ${r.provider.padEnd(12)} ${icon} ${r.status}\n`);
        }
        for (const c of skippedConns) {
          process.stdout.write(
            `  ${c.provider.padEnd(12)} → skipped (status: ${c.status})\n`,
          );
        }
        process.stdout.write(
          '\n  Run "totus connections list" to check progress.\n\n',
        );
      } else {
        // Sync a single connection by ID
        // First, find the connection to get its provider
        const listResponse = await client.get<Connection[]>(
          "/api/connections",
        );
        const conns = Array.isArray(listResponse.data)
          ? listResponse.data
          : [];
        const conn = conns.find((c) => c.id === id);

        if (conn) {
          const response = await client.post<SyncResult>(
            `/api/connections/${conn.provider}/sync`,
          );

          if (resolved.outputFormat === "json") {
            process.stdout.write(formatJson(response.data) + "\n");
            return;
          }

          process.stdout.write(
            chalk.green(`\n✓ Sync triggered for ${conn.provider}\n`),
          );
          if (response.data?.status) {
            process.stdout.write(`  Status: ${response.data.status}\n`);
          }
        } else {
          // Try using the ID directly as a provider name
          const response = await client.post<SyncResult>(
            `/api/connections/${id}/sync`,
          );

          if (resolved.outputFormat === "json") {
            process.stdout.write(formatJson(response.data) + "\n");
            return;
          }

          process.stdout.write(
            chalk.green(`\n✓ Sync triggered for ${id}\n`),
          );
          if (response.data?.status) {
            process.stdout.write(`  Status: ${response.data.status}\n`);
          }
        }

        process.stdout.write(
          '  Run "totus connections list" to check progress.\n\n',
        );
      }
    });

  return connections;
}
