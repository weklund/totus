#!/usr/bin/env node

/**
 * @totus/cli - Totus Health Data CLI
 *
 * Entry point for the Totus CLI and MCP server.
 * Provides terminal access to Totus health data vault.
 */

import { Command } from "@commander-js/extra-typings";

const program = new Command()
  .name("totus")
  .description("Totus Health Data CLI — manage your health data from the terminal")
  .version("0.1.0");

program.parse();
