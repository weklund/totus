#!/usr/bin/env node

/**
 * @totus/cli - Totus Health Data CLI
 *
 * Entry point for the Totus CLI and MCP server.
 * Provides terminal access to Totus health data vault.
 *
 * See: LLD Section 8.4 (Command Structure)
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { createAuthCommand } from "./commands/auth.js";
import { createConfigCommand } from "./commands/config.js";
import { checkConfigPermissions, getConfigPath } from "./config.js";
import { EXIT_AUTH, EXIT_ERROR, EXIT_PERMISSION } from "./exit-codes.js";
import { ApiError } from "./api-client.js";

const program = new Command()
  .name("totus")
  .description(
    "Totus Health Data CLI — manage your health data from the terminal",
  )
  .version("0.1.0")
  .option("--api-key <key>", "Override API key for this command")
  .option(
    "-o, --output <format>",
    "Output format: table, json, csv",
  )
  .option("-v, --verbose", "Show request/response details")
  .option("--server-url <url>", "Override API server URL")
  .option("--no-color", "Disable colored output");

// Register subcommands
program.addCommand(createAuthCommand());
program.addCommand(createConfigCommand());

// Check config file permissions on startup
if (!checkConfigPermissions()) {
  process.stderr.write(
    chalk.yellow(
      `⚠ Warning: Config file ${getConfigPath()} has insecure permissions.\n` +
        "  Run: chmod 600 " +
        getConfigPath() +
        "\n",
    ),
  );
}

// Global error handler
program.exitOverride();

async function main() {
  try {
    await program.parseAsync();
  } catch (error) {
    // Commander exit override throws for --help and --version
    if (error && typeof error === "object" && "code" in error) {
      const cmdError = error as { code: string; exitCode: number };
      if (
        cmdError.code === "commander.helpDisplayed" ||
        cmdError.code === "commander.version"
      ) {
        process.exit(0);
      }
    }

    if (error instanceof ApiError) {
      process.stderr.write(chalk.red(`✗ Error: ${error.message}\n`));
      process.exit(error.exitCode);
    }

    // Unauthenticated error shows helpful message
    if (error instanceof Error && error.message.includes("No API key")) {
      process.stderr.write(
        chalk.red("✗ Error: No API key configured\n") +
          '  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.\n',
      );
      process.exit(EXIT_AUTH);
    }

    // Generic error handling with exit code mapping
    if (error instanceof Error) {
      process.stderr.write(chalk.red(`✗ Error: ${error.message}\n`));

      if (error.message.includes("authentication") || error.message.includes("unauthorized")) {
        process.exit(EXIT_AUTH);
      }
      if (error.message.includes("permission") || error.message.includes("forbidden")) {
        process.exit(EXIT_PERMISSION);
      }
      process.exit(EXIT_ERROR);
    }

    process.exit(EXIT_ERROR);
  }
}

main();

export { program };
