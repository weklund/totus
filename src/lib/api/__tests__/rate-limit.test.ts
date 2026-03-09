import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRateLimitHeaders,
  createRateLimitResponse,
  RateLimiter,
} from "../rate-limit";
import { NextResponse } from "next/server";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ limit: 3, windowMs: 60_000 });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it("allows requests under the limit", () => {
    const result = limiter.check("key1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.limit).toBe(3);
  });

  it("decrements remaining with each request", () => {
    const r1 = limiter.check("key1");
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("key1");
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("key1");
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests over the limit", () => {
    limiter.check("key1");
    limiter.check("key1");
    limiter.check("key1");

    const r4 = limiter.check("key1");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("tracks different keys independently", () => {
    limiter.check("key1");
    limiter.check("key1");
    limiter.check("key1");

    // key1 is exhausted
    expect(limiter.check("key1").allowed).toBe(false);

    // key2 is fresh
    const result = limiter.check("key2");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("resets after the window expires", () => {
    vi.useFakeTimers();

    const timedLimiter = new RateLimiter({ limit: 2, windowMs: 1000 });
    timedLimiter.check("key1");
    timedLimiter.check("key1");
    expect(timedLimiter.check("key1").allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(1100);

    const result = timedLimiter.check("key1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);

    timedLimiter.destroy();
    vi.useRealTimers();
  });

  it("provides a valid resetAt timestamp", () => {
    const now = Date.now();
    const result = limiter.check("key1");

    // resetAt should be within the window (in seconds)
    expect(result.resetAt).toBeGreaterThanOrEqual(Math.floor(now / 1000));
    expect(result.resetAt).toBeLessThanOrEqual(
      Math.ceil((now + 60_000) / 1000) + 1,
    );
  });

  it("reset() clears all tracked keys", () => {
    limiter.check("key1");
    limiter.check("key1");
    limiter.check("key1");
    expect(limiter.check("key1").allowed).toBe(false);

    limiter.reset();

    expect(limiter.check("key1").allowed).toBe(true);
    expect(limiter.check("key1").remaining).toBe(1);
  });

  it("handles high-volume single key correctly", () => {
    const highLimiter = new RateLimiter({ limit: 100, windowMs: 60_000 });

    for (let i = 0; i < 100; i++) {
      expect(highLimiter.check("key1").allowed).toBe(true);
    }

    expect(highLimiter.check("key1").allowed).toBe(false);
    highLimiter.destroy();
  });
});

// ─── createRateLimitResponse ────────────────────────────────────────────────

describe("createRateLimitResponse", () => {
  it("returns 429 status code", async () => {
    const response = createRateLimitResponse({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1709913781,
    });

    expect(response.status).toBe(429);
  });

  it("returns standard error envelope with RATE_LIMITED code", async () => {
    const response = createRateLimitResponse({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1709913781,
    });

    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toBeDefined();
  });

  it("sets X-RateLimit-Limit header", () => {
    const response = createRateLimitResponse({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1709913781,
    });

    expect(response.headers.get("X-RateLimit-Limit")).toBe("10");
  });

  it("sets X-RateLimit-Remaining header", () => {
    const response = createRateLimitResponse({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1709913781,
    });

    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("sets X-RateLimit-Reset header", () => {
    const response = createRateLimitResponse({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: 1709913781,
    });

    expect(response.headers.get("X-RateLimit-Reset")).toBe("1709913781");
  });
});

// ─── addRateLimitHeaders ────────────────────────────────────────────────────

describe("addRateLimitHeaders", () => {
  it("adds rate limit headers to existing response", () => {
    const response = NextResponse.json({ data: "ok" }, { status: 200 });

    addRateLimitHeaders(response, {
      allowed: true,
      limit: 100,
      remaining: 97,
      resetAt: 1709913781,
    });

    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("97");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1709913781");
  });

  it("preserves existing response headers", () => {
    const response = NextResponse.json({ data: "ok" }, { status: 200 });
    response.headers.set("X-Custom-Header", "custom-value");

    addRateLimitHeaders(response, {
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: 1709913781,
    });

    expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
  });
});
