/**
 * Keys commands: list, create, revoke
 *
 * See: LLD Sections 8.5.10-8.5.11
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { outputData, formatJson } from "../formatters.js";

interface ApiKey {
  id: string;
  name: string;
  short_token: string;
  key?: string;
  scopes: string[];
  status?: string;
  expires_at: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export function createKeysCommand(): Command {
  const keys = new Command("keys").description("Manage API keys");

  keys
    .command("list")
    .description("List API keys")
    .action(async (_opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<ApiKey[]>("/api/keys");
      const keyList = Array.isArray(response.data) ? response.data : [];

      const rows = keyList.map((k) => {
        // Compute status
        let status = k.status ?? "active";
        if (k.revoked_at) status = "revoked";
        else if (k.expires_at && new Date(k.expires_at) < new Date())
          status = "expired";

        // Format scopes display
        let scopesDisplay: string;
        if (k.scopes.length <= 1) {
          scopesDisplay = k.scopes[0] ?? "";
        } else {
          scopesDisplay = `${k.scopes[0]} +${k.scopes.length - 1}`;
        }

        return {
          name: k.name,
          short_token: k.short_token,
          status,
          scopes: scopesDisplay,
          last_used: k.last_used_at
            ? new Date(k.last_used_at).toISOString().slice(0, 10)
            : "—",
          expires: k.expires_at
            ? new Date(k.expires_at).toISOString().slice(0, 10)
            : "",
        };
      });

      const output = outputData(resolved.outputFormat, {
        columns: [
          { header: "Name", key: "name" },
          { header: "Short Token", key: "short_token" },
          { header: "Status", key: "status" },
          { header: "Scopes", key: "scopes" },
          { header: "Last Used", key: "last_used" },
          { header: "Expires", key: "expires" },
        ],
        rows,
        jsonData: { keys: keyList },
      });
      process.stdout.write(output + "\n");
    });

  keys
    .command("create")
    .description("Create a new API key")
    .requiredOption("--name <name>", "Key label")
    .option(
      "--scopes <scopes>",
      "Comma-separated scopes (default: all available)",
    )
    .option("--expires <days>", "Expiration in days", "90")
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const body: {
        name: string;
        scopes?: string[];
        expires_in_days: number;
      } = {
        name: opts.name,
        expires_in_days: parseInt(opts.expires, 10),
      };

      if (opts.scopes) {
        body.scopes = opts.scopes.split(",").map((s) => s.trim());
      }

      const response = await client.post<ApiKey>("/api/keys", body);
      const key = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(key) + "\n");
        return;
      }

      process.stdout.write(chalk.green("\n✓ API key created\n"));
      process.stdout.write(`  Name: ${key.name}\n`);
      if (key.key) {
        process.stdout.write(`  Key: ${key.key}\n`);
      }
      process.stdout.write(
        `  Scopes: ${Array.isArray(key.scopes) ? key.scopes.join(", ") : key.scopes}\n`,
      );
      process.stdout.write(
        `  Expires: ${key.expires_at ? new Date(key.expires_at).toISOString().slice(0, 10) : ""}\n`,
      );
      process.stdout.write(
        chalk.yellow(
          "\n  ⚠ Save this key now — it will not be shown again.\n",
        ),
      );
      process.stdout.write("\n");
    });

  keys
    .command("revoke")
    .description("Revoke an API key")
    .argument("<id>", "API key ID")
    .action(async (id, _opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.patch<ApiKey>(`/api/keys/${id}`, {
        action: "revoke",
      });
      const key = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(key) + "\n");
        return;
      }

      process.stdout.write(
        chalk.green(`\n✓ API key revoked: "${key.name ?? id}"\n`),
      );
      if (key.revoked_at) {
        process.stdout.write(
          `  Revoked at: ${new Date(key.revoked_at).toISOString()}\n`,
        );
      }
      process.stdout.write("\n");
    });

  return keys;
}
