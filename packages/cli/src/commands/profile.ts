/**
 * Profile command: show user profile and health data summary
 *
 * See: LLD Section 8.4 (profile)
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { formatJson } from "../formatters.js";

interface UserProfile {
  id?: string;
  display_name?: string;
  email?: string;
  created_at?: string;
  stats?: {
    data_points?: number;
    connections?: number;
    active_shares?: number;
    metric_types?: number;
  };
}

export function createProfileCommand(): Command {
  const profile = new Command("profile")
    .description("Show user profile and stats")
    .action(async (_opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<UserProfile>("/api/user/profile");
      const data = response.data;

      if (resolved.outputFormat === "json") {
        process.stdout.write(formatJson(data) + "\n");
        return;
      }

      process.stdout.write(chalk.bold("\nProfile\n"));
      process.stdout.write(
        `  Name:     ${data.display_name ?? data.email ?? "—"}\n`,
      );
      if (data.email) {
        process.stdout.write(`  Email:    ${data.email}\n`);
      }
      if (data.created_at) {
        process.stdout.write(
          `  Joined:   ${new Date(data.created_at).toISOString().slice(0, 10)}\n`,
        );
      }

      if (data.stats) {
        process.stdout.write("\n  Health Data:\n");
        if (data.stats.data_points !== undefined) {
          process.stdout.write(
            `    Data points:   ${data.stats.data_points.toLocaleString()}\n`,
          );
        }
        if (data.stats.connections !== undefined) {
          process.stdout.write(
            `    Connections:   ${data.stats.connections}\n`,
          );
        }
        if (data.stats.active_shares !== undefined) {
          process.stdout.write(
            `    Active shares: ${data.stats.active_shares}\n`,
          );
        }
        if (data.stats.metric_types !== undefined) {
          process.stdout.write(
            `    Metric types:  ${data.stats.metric_types}\n`,
          );
        }
      }
      process.stdout.write("\n");
    });

  return profile;
}
