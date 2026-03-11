/**
 * API key generation and validation utilities.
 *
 * Key format: tot_live_{shortToken}_{longToken}
 * - shortToken: 8 chars, base62 encoded (for lookup/display)
 * - longToken: 32 chars, base62 encoded (the secret)
 *
 * Storage: shortToken (plaintext) + SHA-256(longToken) (hash only).
 * The full key is returned once at creation and never stored.
 *
 * See: /docs/cli-mcp-server-lld.md Section 7.1
 */

import { createHash, randomBytes } from "crypto";

// ─── Constants ──────────────────────────────────────────────────────────────

// Build base62 character set: digits (0-9) + uppercase (A-Z) + lowercase (a-z)
function buildBase62Alphabet(): string {
  const chars: string[] = [];
  for (let i = 48; i <= 57; i++) chars.push(String.fromCharCode(i)); // 0-9
  for (let i = 65; i <= 90; i++) chars.push(String.fromCharCode(i)); // A-Z
  for (let i = 97; i <= 122; i++) chars.push(String.fromCharCode(i)); // a-z
  return chars.join("");
}
const BASE62_ALPHABET = buildBase62Alphabet();
const SHORT_TOKEN_LENGTH = 8;
const LONG_TOKEN_LENGTH = 32;
const KEY_PREFIX = "tot_live";

/**
 * Valid API key scopes.
 */
export const VALID_SCOPES = [
  "health:read",
  "health:write",
  "shares:read",
  "shares:write",
  "audit:read",
  "connections:read",
  "connections:write",
  "profile:read",
  "keys:read",
  "keys:write",
] as const;

export type ApiKeyScope = (typeof VALID_SCOPES)[number];

/**
 * Default expiration in days.
 */
export const DEFAULT_EXPIRES_IN_DAYS = 90;
export const MAX_EXPIRES_IN_DAYS = 365;
export const MIN_EXPIRES_IN_DAYS = 1;

/**
 * Maximum active (non-revoked, non-expired) keys per user.
 */
export const MAX_ACTIVE_KEYS_PER_USER = 10;

// ─── Base62 encoding ────────────────────────────────────────────────────────

/**
 * Encode random bytes to a base62 string of the given length.
 *
 * Uses rejection sampling to avoid modulo bias:
 * each byte (0-255) maps to a base62 char only if < 62*4=248.
 */
function base62Encode(length: number): string {
  const result: string[] = [];
  while (result.length < length) {
    const bytes = randomBytes(length * 2); // over-sample to account for rejections
    for (const byte of bytes) {
      if (result.length >= length) break;
      if (byte < 248) {
        // 248 = 62 * 4, avoids modulo bias
        result.push(BASE62_ALPHABET[byte % 62]);
      }
    }
  }
  return result.join("");
}

// ─── Key generation ─────────────────────────────────────────────────────────

export interface GeneratedApiKey {
  /** The full API key to return to the user (shown once) */
  fullKey: string;
  /** The short token (8 chars) stored in plaintext for lookup */
  shortToken: string;
  /** The long token (32 chars) — NOT stored, only its hash */
  longToken: string;
  /** SHA-256 hash of the long token, hex-encoded (64 chars) */
  longTokenHash: string;
}

/**
 * Generate a new API key.
 *
 * Returns the full key (for one-time display), short token (for storage/lookup),
 * and long token hash (for storage/verification).
 */
export function generateApiKey(): GeneratedApiKey {
  const shortToken = base62Encode(SHORT_TOKEN_LENGTH);
  const longToken = base62Encode(LONG_TOKEN_LENGTH);
  const longTokenHash = hashLongToken(longToken);
  const fullKey = `${KEY_PREFIX}_${shortToken}_${longToken}`;

  return { fullKey, shortToken, longToken, longTokenHash };
}

// ─── Key parsing ────────────────────────────────────────────────────────────

export interface ParsedApiKey {
  shortToken: string;
  longToken: string;
}

/**
 * Parse an API key string into its components.
 *
 * Expected format: tot_live_{shortToken}_{longToken}
 * Returns null if the format is invalid.
 */
export function parseApiKey(key: string): ParsedApiKey | null {
  // Validate prefix
  if (!key.startsWith(`${KEY_PREFIX}_`)) {
    return null;
  }

  // Split: ["tot", "live", shortToken, longToken]
  const parts = key.split("_");
  if (parts.length !== 4) {
    return null;
  }

  const [, , shortToken, longToken] = parts;

  // Validate lengths
  if (shortToken.length !== SHORT_TOKEN_LENGTH) {
    return null;
  }
  if (longToken.length !== LONG_TOKEN_LENGTH) {
    return null;
  }

  // Validate base62 characters
  const base62Regex = /^[0-9A-Za-z]+$/;
  if (!base62Regex.test(shortToken) || !base62Regex.test(longToken)) {
    return null;
  }

  return { shortToken, longToken };
}

// ─── Token hashing ──────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a long token, hex-encoded.
 */
export function hashLongToken(longToken: string): string {
  return createHash("sha256").update(longToken).digest("hex");
}

/**
 * Verify a long token against a stored hash using constant-time comparison.
 */
export function verifyLongToken(
  longToken: string,
  storedHash: string,
): boolean {
  const computedHash = hashLongToken(longToken);

  // Constant-time comparison to prevent timing attacks
  if (computedHash.length !== storedHash.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate that a set of scopes are all valid.
 */
export function validateScopes(scopes: string[]): scopes is ApiKeyScope[] {
  return scopes.every((s) => (VALID_SCOPES as readonly string[]).includes(s));
}

/**
 * Check if a set of scopes is a subset of another set.
 * Used for scope escalation prevention.
 */
export function isScopeSubset(requested: string[], allowed: string[]): boolean {
  return requested.every((s) => allowed.includes(s));
}
