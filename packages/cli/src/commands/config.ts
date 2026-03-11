/**
 * Config commands: get, set
 *
 * See: LLD Section 8.4 (config commands)
 */

import { Command } from "@commander-js/extra-typings";
import chalk from "chalk";
import { getConfigValue, setConfigValue, getConfigPath, readConfig } from "../config.js";
import { EXIT_ERROR } from "../exit-codes.js";

const VALID_KEYS = ["api_key", "api_url", "server_url", "default_output", "phi_notice_shown"];

/** Map aliases to canonical config keys */
function canonicalKey(key: string): string {
  if (key === "server_url") return "api_url";
  return key;
}

export function createConfigCommand(): Command {
  const config = new Command("config")
    .description("Manage CLI configuration");

  config
    .command("get")
    .description("Get a config value")
    .argument("<key>", `Config key (${VALID_KEYS.join(", ")})`)
    .action((key) => {
      if (!VALID_KEYS.includes(key)) {
        process.stderr.write(
          chalk.red(`✗ Error: Unknown config key "${key}"\n`) +
            `  Valid keys: ${VALID_KEYS.join(", ")}\n`,
        );
        process.exit(EXIT_ERROR);
      }

      const value = getConfigValue(canonicalKey(key));
      if (value === undefined) {
        process.stderr.write(`  ${key}: (not set)\n`);
      } else {
        // Mask API key in output
        if (canonicalKey(key) === "api_key" && typeof value === "string") {
          const masked = value.replace(
            /^(tot_(live|test)_[A-Za-z0-9]{8}_).+$/,
            "$1••••••••",
          );
          process.stdout.write(`${masked}\n`);
        } else {
          process.stdout.write(`${value}\n`);
        }
      }
    });

  config
    .command("set")
    .description("Set a config value")
    .argument("<key>", `Config key (${VALID_KEYS.join(", ")})`)
    .argument("<value>", "Config value")
    .action((key, value) => {
      if (!VALID_KEYS.includes(key)) {
        process.stderr.write(
          chalk.red(`✗ Error: Unknown config key "${key}"\n`) +
            `  Valid keys: ${VALID_KEYS.join(", ")}\n`,
        );
        process.exit(EXIT_ERROR);
      }

      const resolved = canonicalKey(key);

      // Validate specific key values
      if (resolved === "default_output" && !["table", "json", "csv"].includes(value)) {
        process.stderr.write(
          chalk.red(`✗ Error: Invalid output format "${value}"\n`) +
            "  Valid values: table, json, csv\n",
        );
        process.exit(EXIT_ERROR);
      }

      // Handle boolean values
      const finalValue = value === "true" ? true : value === "false" ? false : value;
      setConfigValue(resolved, finalValue);

      process.stderr.write(chalk.green(`✓ Config set: ${key} = ${value}\n`));
      process.stderr.write(`  Config: ${getConfigPath()}\n`);
    });

  config
    .command("list")
    .description("List all config values")
    .action(() => {
      const configData = readConfig();
      const path = getConfigPath();

      process.stdout.write(`Config file: ${path}\n\n`);

      if (Object.keys(configData).length === 0) {
        process.stdout.write("  (no values set)\n");
        return;
      }

      for (const [key, value] of Object.entries(configData)) {
        if (key === "api_key" && typeof value === "string") {
          const masked = value.replace(
            /^(tot_(live|test)_[A-Za-z0-9]{8}_).+$/,
            "$1••••••••",
          );
          process.stdout.write(`  ${key}: ${masked}\n`);
        } else {
          process.stdout.write(`  ${key}: ${value}\n`);
        }
      }
    });

  return config;
}
