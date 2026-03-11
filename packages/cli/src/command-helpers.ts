/**
 * Shared helpers for CLI commands.
 * Resolves API client options from the Commander chain.
 */

import chalk from "chalk";
import { resolveApiKey, resolveServerUrl } from "./config.js";
import { createApiClient } from "./api-client.js";
import { resolveOutputFormat, type OutputFormat } from "./formatters.js";
import { EXIT_AUTH } from "./exit-codes.js";

export interface ResolvedOptions {
  apiKey: string;
  serverUrl: string;
  outputFormat: OutputFormat;
  verbose: boolean;
}

/** Minimal interface for a Commander-like command (avoids strict generic issues) */
interface CommandLike {
  parent?: CommandLike | null;
  opts(): Record<string, unknown>;
}

/**
 * Walk up the commander parent chain to resolve global options.
 */
export function getRootOpts(cmd: CommandLike): {
  apiKey?: string;
  serverUrl?: string;
  output?: string;
  verbose?: boolean;
} {
  // Walk up to root
  let current: CommandLike = cmd;
  while (current.parent) {
    current = current.parent;
  }
  return current.opts() as {
    apiKey?: string;
    serverUrl?: string;
    output?: string;
    verbose?: boolean;
  };
}

/**
 * Resolve all options and create an API client.
 * Exits with code 2 if no API key is found.
 */
export function resolveClientOptions(cmd: CommandLike): ResolvedOptions {
  const rootOpts = getRootOpts(cmd);

  const { key } = resolveApiKey(rootOpts.apiKey);
  if (!key) {
    process.stderr.write(
      chalk.red("✗ Error: No API key configured\n") +
        '  Run "totus auth login" to authenticate, or set TOTUS_API_KEY environment variable.\n',
    );
    process.exit(EXIT_AUTH);
  }

  const serverUrl = resolveServerUrl(rootOpts.serverUrl);
  const outputFormat = resolveOutputFormat(rootOpts.output);
  const verbose = rootOpts.verbose ?? false;

  return { apiKey: key, serverUrl, outputFormat, verbose };
}

/**
 * Create an API client from resolved options.
 */
export function createClientFromOptions(opts: ResolvedOptions) {
  return createApiClient({
    apiKey: opts.apiKey,
    serverUrl: opts.serverUrl,
    verbose: opts.verbose,
  });
}

/**
 * Convenience: resolve options and create API client in one call.
 * Accepts any Commander-like object (works with @commander-js/extra-typings).
 */
export function getClient(cmd: CommandLike) {
  const opts = resolveClientOptions(cmd);
  const client = createClientFromOptions(opts);
  return { client, opts };
}
