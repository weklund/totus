/**
 * Configuration file management for the Totus CLI.
 * Manages ~/.config/totus/config.json with 0600 permissions.
 *
 * See: LLD Section 8.3
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** Config file schema */
export interface TotusConfig {
  api_key?: string;
  api_url?: string;
  default_output?: "table" | "json" | "csv";
  phi_notice_shown?: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "totus");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const CONFIG_FILE_MODE = 0o600;

/**
 * Get the path to the config directory.
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Ensure the config directory exists with proper permissions.
 */
function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Read the config file. Returns empty config if file does not exist.
 */
export function readConfig(): TotusConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    const data = fs.readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(data) as TotusConfig;
  } catch {
    return {};
  }
}

/**
 * Write the config file with 0600 permissions.
 */
export function writeConfig(config: TotusConfig): void {
  ensureConfigDir();
  const data = JSON.stringify(config, null, 2) + "\n";
  fs.writeFileSync(CONFIG_FILE, data, { mode: CONFIG_FILE_MODE });
}

/**
 * Get a specific config value.
 */
export function getConfigValue(key: string): string | boolean | undefined {
  const config = readConfig();
  return config[key as keyof TotusConfig];
}

/**
 * Set a specific config value.
 */
export function setConfigValue(key: string, value: string | boolean): void {
  const config = readConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any)[key] = value;
  writeConfig(config);
}

/**
 * Delete a specific config value.
 */
export function deleteConfigValue(key: string): void {
  const config = readConfig();
  delete config[key as keyof TotusConfig];
  writeConfig(config);
}

/**
 * Check if the config file has correct permissions (0600).
 * Returns true if correct, false if permissions are too loose.
 */
export function checkConfigPermissions(): boolean {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return true; // File doesn't exist yet, will be created with correct permissions
    }
    const stats = fs.statSync(CONFIG_FILE);
    const mode = stats.mode & 0o777;
    return mode === CONFIG_FILE_MODE;
  } catch {
    return true; // Can't check, assume OK
  }
}

/**
 * Resolve API key from multiple sources in priority order:
 * 1. --api-key flag
 * 2. TOTUS_API_KEY environment variable
 * 3. Config file (~/.config/totus/config.json)
 */
export function resolveApiKey(flagValue?: string): { key: string | undefined; source: string } {
  if (flagValue) {
    return { key: flagValue, source: "command flag" };
  }

  const envKey = process.env.TOTUS_API_KEY;
  if (envKey) {
    return { key: envKey, source: "TOTUS_API_KEY environment variable" };
  }

  const config = readConfig();
  if (config.api_key) {
    return { key: config.api_key, source: `config file (${CONFIG_FILE})` };
  }

  return { key: undefined, source: "none" };
}

/**
 * Resolve the API server URL.
 * Priority: flag > env > config > default
 */
export function resolveServerUrl(flagValue?: string): string {
  if (flagValue) {
    return flagValue;
  }

  const envUrl = process.env.TOTUS_API_URL;
  if (envUrl) {
    return envUrl;
  }

  const config = readConfig();
  if (config.api_url) {
    return config.api_url;
  }

  return "https://totus.com/api";
}

/**
 * Validate API key format.
 * Format: tot_live_{8 base62}_{32 base62} or tot_test_{8}_{32}
 */
export function validateApiKeyFormat(key: string): boolean {
  return /^tot_(live|test)_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$/.test(key);
}

/**
 * Mask an API key for display.
 * Shows the prefix and short token only: tot_live_...BRTRKFsL
 */
export function maskApiKey(key: string): string {
  const match = key.match(/^(tot_(live|test))_([A-Za-z0-9]{8})_/);
  if (!match) {
    return "***invalid key format***";
  }
  return `${match[1]}_...${match[3]}`;
}

/**
 * Extract the short token from an API key.
 */
export function extractShortToken(key: string): string | null {
  const match = key.match(/^tot_(live|test)_([A-Za-z0-9]{8})_/);
  return match ? match[2] : null;
}
