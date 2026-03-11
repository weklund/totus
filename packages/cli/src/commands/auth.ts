/**
 * Auth commands: login, logout, status, token
 *
 * See: LLD Sections 8.5.1-8.5.2
 */

import { Command } from "@commander-js/extra-typings";
import * as readline from "node:readline";
import chalk from "chalk";
import {
  readConfig,
  writeConfig,
  validateApiKeyFormat,
  maskApiKey,
  resolveApiKey,
  resolveServerUrl,
  getConfigPath,
} from "../config.js";
import { createApiClient, ApiError } from "../api-client.js";
import { EXIT_AUTH, EXIT_ERROR, EXIT_SUCCESS } from "../exit-codes.js";

/**
 * Prompt for user input with optional masking.
 */
function prompt(question: string, mask = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });

    if (mask && process.stdin.isTTY) {
      // Mask input by writing * for each character
      process.stderr.write(question);
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      const onData = (char: string) => {
        const c = char.toString();
        if (c === "\n" || c === "\r") {
          process.stderr.write("\n");
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          rl.close();
          resolve(input);
        } else if (c === "\u0003") {
          // Ctrl+C
          process.stderr.write("\n");
          process.stdin.setRawMode(false);
          rl.close();
          process.exit(1);
        } else if (c === "\u007F" || c === "\b") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stderr.write("\b \b");
          }
        } else {
          input += c;
          process.stderr.write("*");
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

export function createAuthCommand(): Command {
  const auth = new Command("auth")
    .description("Manage authentication");

  auth
    .command("login")
    .description("Store API key in config")
    .option("--stdin", "Read key from stdin (for piping)")
    .action(async (opts) => {
      try {
        let apiKey: string;

        if (opts.stdin) {
          // Read from stdin
          apiKey = await new Promise<string>((resolve) => {
            let data = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => {
              data += chunk;
            });
            process.stdin.on("end", () => {
              resolve(data.trim());
            });
            process.stdin.resume();
          });
        } else {
          apiKey = await prompt("? Enter your Totus API key: ", true);
        }

        if (!apiKey) {
          process.stderr.write(
            chalk.red("✗ Error: No API key provided\n"),
          );
          process.exit(EXIT_AUTH);
        }

        // Validate format
        if (!validateApiKeyFormat(apiKey)) {
          process.stderr.write(
            chalk.red(
              '✗ Error: Invalid API key format\n  Expected format: tot_live_{8 chars}_{32 chars}\n  Example: tot_live_BRTRKFsL_51FwqftsmMDHHbJAMEXXHCgG\n',
            ),
          );
          process.exit(EXIT_AUTH);
        }

        // Get the parent command's options for server URL
        const parentOpts = auth.parent?.opts() as { serverUrl?: string } | undefined;

        // Validate by calling the API
        const serverUrl = resolveServerUrl(parentOpts?.serverUrl);
        const client = createApiClient({
          apiKey,
          serverUrl,
        });

        try {
          const response = await client.get<{ display_name?: string; email?: string }>(
            "/api/user/profile",
          );
          const displayName = response.data.display_name || response.data.email || "User";

          // Save to config
          const config = readConfig();
          config.api_key = apiKey;
          writeConfig(config);

          process.stderr.write(
            chalk.green(`✓ Authenticated as ${displayName} (key: ${maskApiKey(apiKey)})\n`),
          );
          process.stderr.write(
            `  API key stored in ${getConfigPath()}\n`,
          );
        } catch (error) {
          if (error instanceof ApiError) {
            process.stderr.write(
              chalk.red(`✗ Error: ${error.message}\n`),
            );
            process.exit(error.exitCode);
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof ApiError) {
          process.stderr.write(chalk.red(`✗ Error: ${error.message}\n`));
          process.exit(error.exitCode);
        }
        process.stderr.write(
          chalk.red(`✗ Error: ${error instanceof Error ? error.message : "Unknown error"}\n`),
        );
        process.exit(EXIT_ERROR);
      }
    });

  auth
    .command("logout")
    .description("Remove stored API key")
    .action(() => {
      const config = readConfig();
      if (!config.api_key) {
        process.stderr.write("No API key stored. Already logged out.\n");
        process.exit(EXIT_SUCCESS);
      }

      delete config.api_key;
      writeConfig(config);

      process.stderr.write(chalk.green("✓ API key removed from config\n"));
      process.stderr.write(`  Config: ${getConfigPath()}\n`);
    });

  auth
    .command("status")
    .description("Show current auth status")
    .action(async () => {
      try {
        const parentOpts = auth.parent?.opts() as { apiKey?: string; serverUrl?: string } | undefined;
        const { key, source } = resolveApiKey(parentOpts?.apiKey);

        if (!key) {
          process.stderr.write(
            chalk.yellow("✗ Not authenticated\n") +
              '  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.\n',
          );
          process.exit(EXIT_AUTH);
        }

        process.stdout.write(chalk.green("✓ Authenticated\n"));
        process.stdout.write(`  Key: ${maskApiKey(key)}\n`);
        process.stdout.write(`  Source: ${source}\n`);

        // Try to get profile info
        const serverUrl = resolveServerUrl(parentOpts?.serverUrl);
        try {
          const client = createApiClient({ apiKey: key, serverUrl });
          const response = await client.get<{
            display_name?: string;
            email?: string;
          }>("/api/user/profile");
          const displayName = response.data.display_name || response.data.email || "User";
          process.stdout.write(`  User: ${displayName}\n`);
          process.stdout.write(`  Server: ${serverUrl}\n`);
        } catch {
          // Profile fetch failed, still show what we know
          process.stdout.write(`  Server: ${serverUrl}\n`);
          process.stdout.write(
            chalk.yellow("  ⚠ Could not verify key with server\n"),
          );
        }
      } catch (error) {
        process.stderr.write(
          chalk.red(`✗ Error: ${error instanceof Error ? error.message : "Unknown error"}\n`),
        );
        process.exit(EXIT_ERROR);
      }
    });

  auth
    .command("token")
    .description("Print current API key (masked)")
    .option("--unmask", "Show the full key (use with caution)")
    .action((opts) => {
      const parentOpts = auth.parent?.opts() as { apiKey?: string } | undefined;
      const { key, source } = resolveApiKey(parentOpts?.apiKey);

      if (!key) {
        process.stderr.write(
          chalk.yellow("✗ No API key configured\n") +
            '  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.\n',
        );
        process.exit(EXIT_AUTH);
      }

      if (opts.unmask) {
        process.stdout.write(`${key}\n`);
      } else {
        process.stdout.write(`${maskApiKey(key)}\n`);
      }
      process.stderr.write(`  Source: ${source}\n`);
    });

  return auth;
}
