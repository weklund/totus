/**
 * In-memory rate limiter.
 *
 * Provides configurable rate limiting per key (IP address or userId).
 * Uses a sliding window approach with in-memory storage.
 *
 * For production, this would be replaced with a Redis-backed implementation
 * using the same interface.
 *
 * See: /docs/api-database-lld.md Section 7.1 (Rate Limits table)
 */

import { NextResponse } from "next/server";
import type { ErrorResponseBody } from "./errors";

/**
 * Rate limiter configuration.
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

/**
 * Rate limit check result.
 */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Maximum requests per window */
  limit: number;
  /** Remaining requests in the current window */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
}

/**
 * Internal tracking record for a rate limit key.
 */
interface RateLimitRecord {
  /** Timestamps of requests within the current window */
  timestamps: number[];
}

/**
 * In-memory rate limiter.
 *
 * Tracks request counts per key using a sliding window.
 * Expired entries are cleaned up periodically.
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly store: Map<string, RateLimitRecord> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // Clean up expired entries every window duration
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      this.config.windowMs,
    );
    // Don't prevent Node from exiting
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Check and consume a rate limit token for the given key.
   *
   * @param key - The rate limit key (e.g., IP address, userId)
   * @returns RateLimitResult indicating whether the request is allowed
   */
  check(key: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create the record
    let record = this.store.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.store.set(key, record);
    }

    // Remove expired timestamps
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    // Calculate reset time
    const resetAt = Math.ceil(
      (record.timestamps.length > 0
        ? record.timestamps[0] + this.config.windowMs
        : now + this.config.windowMs) / 1000,
    );

    // Check if over limit
    if (record.timestamps.length >= this.config.limit) {
      return {
        allowed: false,
        limit: this.config.limit,
        remaining: 0,
        resetAt,
      };
    }

    // Consume a token
    record.timestamps.push(now);

    return {
      allowed: true,
      limit: this.config.limit,
      remaining: this.config.limit - record.timestamps.length,
      resetAt,
    };
  }

  /**
   * Clean up expired entries from the store.
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, record] of this.store.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
      if (record.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Reset the rate limiter (useful for testing).
   */
  reset(): void {
    this.store.clear();
  }

  /**
   * Destroy the rate limiter and clean up resources.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

/**
 * Create a 429 Too Many Requests response with rate limit headers.
 *
 * @param result - The rate limit result
 * @returns NextResponse with 429 status and X-RateLimit-* headers
 */
export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  const body: ErrorResponseBody = {
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please try again later.",
    },
  };

  const response = NextResponse.json(body, { status: 429 });
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.resetAt));

  return response;
}

/**
 * Add rate limit headers to a successful response.
 *
 * @param response - The response to add headers to
 * @param result - The rate limit check result
 * @returns The response with rate limit headers added
 */
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.resetAt));
  return response;
}

// ─── Pre-configured rate limiters ──────────────────────────────────────────

/**
 * Default rate limiter for general API endpoints.
 * 100 requests per minute per key.
 */
export const generalRateLimiter = new RateLimiter({
  limit: 100,
  windowMs: 60_000,
});

/**
 * Strict rate limiter for share token validation.
 * 10 requests per minute per key (brute-force protection).
 */
export const validationRateLimiter = new RateLimiter({
  limit: 10,
  windowMs: 60_000,
});

/**
 * Rate limiter for health data queries.
 * 30 requests per minute per key.
 */
export const healthDataRateLimiter = new RateLimiter({
  limit: 30,
  windowMs: 60_000,
});
