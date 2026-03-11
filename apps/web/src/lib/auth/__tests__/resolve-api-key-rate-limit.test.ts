import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { apiKeyGeneralRateLimiter } from "@/lib/api/rate-limit";

/**
 * Tests for API key rate limiting in getResolvedContext().
 *
 * Verifies that the general API key rate limiter is wired and sets
 * the _rateLimited field on the context when limits are exceeded.
 */

describe("API key general rate limiting", () => {
  beforeEach(() => {
    apiKeyGeneralRateLimiter.reset();
  });

  afterEach(() => {
    apiKeyGeneralRateLimiter.reset();
  });

  it("rate limiter allows requests within limit", () => {
    const result = apiKeyGeneralRateLimiter.check("test-key");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(299);
    expect(result.limit).toBe(300);
  });

  it("rate limiter blocks after exceeding limit", () => {
    // Exhaust the limit
    for (let i = 0; i < 300; i++) {
      apiKeyGeneralRateLimiter.check("burst-key");
    }

    const result = apiKeyGeneralRateLimiter.check("burst-key");
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.limit).toBe(300);
    expect(result.resetAt).toBeDefined();
  });

  it("rate limiting is per-key", () => {
    // Exhaust limit for key A
    for (let i = 0; i < 300; i++) {
      apiKeyGeneralRateLimiter.check("key-a");
    }

    // Key B should still be allowed
    const result = apiKeyGeneralRateLimiter.check("key-b");
    expect(result.allowed).toBe(true);
  });

  it("checkApiKeyRateLimit returns null when not rate limited", async () => {
    const { checkApiKeyRateLimit } = await import("@/lib/auth/resolve-api-key");

    const ctx = {
      role: "owner" as const,
      userId: "user-1",
      permissions: "full" as const,
      authMethod: "api_key" as const,
      apiKeyId: "key-1",
      scopes: ["health:read"],
    };

    const result = checkApiKeyRateLimit(ctx);
    expect(result).toBeNull();
  });

  it("checkApiKeyRateLimit returns 429 response when rate limited", async () => {
    const { checkApiKeyRateLimit } = await import("@/lib/auth/resolve-api-key");

    const ctx = {
      role: "owner" as const,
      userId: "user-1",
      permissions: "full" as const,
      authMethod: "api_key" as const,
      apiKeyId: "key-1",
      scopes: ["health:read"],
      _rateLimited: {
        allowed: false,
        limit: 300,
        remaining: 0,
        resetAt: Math.ceil(Date.now() / 1000) + 60,
      },
    };

    const response = checkApiKeyRateLimit(ctx);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);

    const body = await response!.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
