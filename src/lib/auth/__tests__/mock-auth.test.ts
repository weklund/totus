import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Tests for mock auth core functions:
 * - createSessionToken: creates valid JWT
 * - verifySessionToken: verifies valid/invalid/expired tokens
 * - SESSION_COOKIE_CONFIG: correct cookie settings
 */

let createSessionToken: typeof import("../mock-auth").createSessionToken;
let verifySessionToken: typeof import("../mock-auth").verifySessionToken;
let SESSION_COOKIE_CONFIG: typeof import("../mock-auth").SESSION_COOKIE_CONFIG;

beforeAll(async () => {
  // Ensure env vars are set for tests
  process.env.MOCK_AUTH_SECRET =
    process.env.MOCK_AUTH_SECRET || "test-secret-for-mock-auth";

  const mod = await import("../mock-auth");
  createSessionToken = mod.createSessionToken;
  verifySessionToken = mod.verifySessionToken;
  SESSION_COOKIE_CONFIG = mod.SESSION_COOKIE_CONFIG;
});

describe("createSessionToken", () => {
  it("creates a valid JWT string", async () => {
    const token = await createSessionToken("user_123");
    expect(typeof token).toBe("string");
    // JWT has 3 parts separated by dots
    expect(token.split(".")).toHaveLength(3);
  });

  it("encodes the userId as the sub claim", async () => {
    const token = await createSessionToken("user_abc");
    const userId = await verifySessionToken(token);
    expect(userId).toBe("user_abc");
  });

  it("creates different tokens for different users", async () => {
    const token1 = await createSessionToken("user_1");
    const token2 = await createSessionToken("user_2");
    expect(token1).not.toBe(token2);
  });
});

describe("verifySessionToken", () => {
  it("returns userId for a valid token", async () => {
    const token = await createSessionToken("user_valid");
    const userId = await verifySessionToken(token);
    expect(userId).toBe("user_valid");
  });

  it("returns null for an invalid token", async () => {
    const userId = await verifySessionToken("invalid.token.here");
    expect(userId).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const userId = await verifySessionToken("");
    expect(userId).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const wrongSecret = new TextEncoder().encode("wrong-secret");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_wrong")
      .setIssuer("totus-mock-auth")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(wrongSecret);

    const userId = await verifySessionToken(token);
    expect(userId).toBeNull();
  });

  it("returns null for a token with wrong issuer", async () => {
    const secret = new TextEncoder().encode(process.env.MOCK_AUTH_SECRET!);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_wrong_iss")
      .setIssuer("wrong-issuer")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    const userId = await verifySessionToken(token);
    expect(userId).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const secret = new TextEncoder().encode(process.env.MOCK_AUTH_SECRET!);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user_expired")
      .setIssuer("totus-mock-auth")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 86400) // issued 1 day ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
      .sign(secret);

    const userId = await verifySessionToken(token);
    expect(userId).toBeNull();
  });

  it("returns null for a token without sub claim", async () => {
    const secret = new TextEncoder().encode(process.env.MOCK_AUTH_SECRET!);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("totus-mock-auth")
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    const userId = await verifySessionToken(token);
    expect(userId).toBeNull();
  });
});

describe("SESSION_COOKIE_CONFIG", () => {
  it("has correct cookie name", () => {
    expect(SESSION_COOKIE_CONFIG.name).toBe("__session");
  });

  it("is httpOnly", () => {
    expect(SESSION_COOKIE_CONFIG.httpOnly).toBe(true);
  });

  it("has SameSite=lax", () => {
    expect(SESSION_COOKIE_CONFIG.sameSite).toBe("lax");
  });

  it("has path=/", () => {
    expect(SESSION_COOKIE_CONFIG.path).toBe("/");
  });

  it("has 7-day maxAge", () => {
    expect(SESSION_COOKIE_CONFIG.maxAge).toBe(7 * 24 * 60 * 60);
  });
});

afterAll(() => {
  // Clean up
});
