/**
 * Export command: download JSON data export
 *
 * See: LLD Section 8.4 (export)
 */

import { Command } from "@commander-js/extra-typings";
import * as fs from "node:fs";
import chalk from "chalk";
import { getClient } from "../command-helpers.js";
import { formatJson } from "../formatters.js";

export function createExportCommand(): Command {
  const exportCmd = new Command("export")
    .description("Download JSON data export")
    .option(
      "--file <path>",
      "Output file path (default: totus-export-YYYY-MM-DD.json)",
    )
    .action(async (opts, cmd) => {
      const { client, opts: resolved } = getClient(cmd);

      const response = await client.get<unknown>("/api/user/export");
      const data = response.data;

      if (resolved.outputFormat === "json" && !opts.file) {
        // Direct JSON output to stdout (for piping)
        process.stdout.write(formatJson(data) + "\n");
        return;
      }

      // Write to file
      const filename =
        opts.file ??
        `totus-export-${new Date().toISOString().slice(0, 10)}.json`;
      const jsonContent = JSON.stringify(data, null, 2);
      fs.writeFileSync(filename, jsonContent, "utf-8");

      process.stderr.write(chalk.green(`\n✓ Data exported to ${filename}\n`));
      process.stderr.write(
        `  Size: ${(jsonContent.length / 1024).toFixed(1)} KB\n\n`,
      );
    });

  return exportCmd;
}
