/**
 * Shares commands: list, get, create, revoke
 *
 * See: LLD Sections 8.5.6-8.5.8
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { outputData, formatJson } from "../formatters.js";

interface ShareGrant {
  id: string;
  label: string;
  status: string;
  metrics: string[];
  view_count?: number;
  views?: number;
  expires_at: string;
  created_at: string;
  start_date?: string;
  end_date?: string;
  note?: string;
  token?: string;
  url?: string;
  revoked_at?: string;
}

export function createSharesCommand(): Command {
  const shares = new Command("shares").description("Manage share links");

  shares
    .command("list")
    .description("List share grants")
    .option(
      "--status <status>",
      "Filter by status: active, expired, revoked, all",
      "all",
    )
    .option("--limit <n>", "Results per page", "20")
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const query: Record<string, string | number | boolean | undefined> = {
        limit: parseInt(opts.limit, 10),
      };
      if (opts.status && opts.status !== "all") {
        query.status = opts.status;
      }

      const response = await client.get<ShareGrant[]>("/api/shares", query);
      const sharesList = response.data;

      const rows = (Array.isArray(sharesList) ? sharesList : []).map((s) => ({
        id: s.id.slice(0, 10) + "...",
        label: s.label,
        status: s.status,
        metrics: Array.isArray(s.metrics) ? String(s.metrics.length) : "",
        views: String(s.view_count ?? s.views ?? 0),
        expires: s.expires_at
          ? new Date(s.expires_at).toISOString().slice(0, 10)
          : "",
        created: s.created_at
          ? new Date(s.created_at).toISOString().slice(0, 10)
          : "",
      }));

      const output = outputData(resolved.outputFormat, {
        columns: [
          { header: "ID", key: "id" },
          { header: "Label", key: "label" },
          { header: "Status", key: "status" },
          { header: "Metrics", key: "metrics" },
          { header: "Views", key: "views" },
          { header: "Expires", key: "expires" },
          { header: "Created", key: "created" },
        ],
        rows,
        jsonData: { shares: sharesList },
      });
      process.stdout.write(output + "\n");
    });

  shares
    .command("get")
    .description("Get share grant details")
    .argument("<id>", "Share grant ID")
    .action(async (id, _opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<ShareGrant>(`/api/shares/${id}`);
      const share = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(share) + "\n");
        return;
      }

      // Detail view
      process.stdout.write(chalk.bold("\nShare Details\n"));
      process.stdout.write(`  ID:         ${share.id}\n`);
      process.stdout.write(`  Label:      ${share.label}\n`);
      process.stdout.write(`  Status:     ${share.status}\n`);
      process.stdout.write(
        `  Metrics:    ${Array.isArray(share.metrics) ? share.metrics.join(", ") : share.metrics}\n`,
      );
      if (share.start_date) {
        process.stdout.write(
          `  Date Range: ${share.start_date} → ${share.end_date}\n`,
        );
      }
      process.stdout.write(
        `  Views:      ${share.view_count ?? share.views ?? 0}\n`,
      );
      process.stdout.write(
        `  Expires:    ${share.expires_at ? new Date(share.expires_at).toISOString() : "never"}\n`,
      );
      process.stdout.write(
        `  Created:    ${share.created_at ? new Date(share.created_at).toISOString() : ""}\n`,
      );
      if (share.note) {
        process.stdout.write(`  Note:       ${share.note}\n`);
      }
      process.stdout.write("\n");
    });

  shares
    .command("create")
    .description("Create a new share grant")
    .requiredOption("--label <label>", "Share label")
    .requiredOption(
      "--metrics <types>",
      "Comma-separated metric types to share",
    )
    .requiredOption("--start <date>", "Data start date (YYYY-MM-DD)")
    .requiredOption("--end <date>", "Data end date (YYYY-MM-DD)")
    .requiredOption("--expires <days>", "Expiration in days")
    .option("--note <note>", "Note shown to the viewer")
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const body = {
        label: opts.label,
        allowed_metrics: opts.metrics.split(",").map((m) => m.trim()),
        data_start: opts.start,
        data_end: opts.end,
        expires_in_days: parseInt(opts.expires, 10),
        note: opts.note,
      };

      const response = await client.post<ShareGrant>("/api/shares", body);
      const share = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(share) + "\n");
        return;
      }

      process.stdout.write(chalk.green("\n✓ Share created\n"));
      if (share.url || share.token) {
        const url = share.url ?? share.token;
        process.stdout.write(`  URL: ${url}\n`);
      }
      process.stdout.write(`  Label: ${share.label}\n`);
      process.stdout.write(
        `  Metrics: ${Array.isArray(share.metrics) ? share.metrics.join(", ") : share.metrics}\n`,
      );
      process.stdout.write(`  Date range: ${opts.start} → ${opts.end}\n`);
      process.stdout.write(
        `  Expires: ${share.expires_at ? new Date(share.expires_at).toISOString().slice(0, 10) : ""}\n`,
      );
      process.stdout.write(
        chalk.yellow(
          "\n  ⚠ Save this URL now — it will not be shown again.\n",
        ),
      );
      process.stdout.write("\n");
    });

  shares
    .command("revoke")
    .description("Revoke a share grant")
    .argument("<id>", "Share grant ID")
    .action(async (id, _opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.patch<ShareGrant>(`/api/shares/${id}`, {
        action: "revoke",
      });
      const share = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(share) + "\n");
        return;
      }

      const label = share.label ? `: "${share.label}"` : "";
      process.stdout.write(chalk.green(`\n✓ Share revoked${label}\n`));
      if (share.revoked_at) {
        process.stdout.write(
          `  Revoked at: ${new Date(share.revoked_at).toISOString()}\n`,
        );
      }
      process.stdout.write("\n");
    });

  return shares;
}
