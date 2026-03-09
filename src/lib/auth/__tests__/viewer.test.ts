import { jwtVerify, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Tests for the viewer token system:
 * - generateShareToken: format, uniqueness, hash correctness
 * - validateShareToken: valid/expired/revoked grants
 * - issueViewerJwt: payload contents, TTL calculation
 * - verifyViewerJwt: current secret, previous secret, unknown secret
 * - VIEWER_COOKIE_CONFIG: correct cookie settings
 */

let generateShareToken: typeof import("../viewer").generateShareToken;
let _validateShareToken: typeof import("../viewer").validateShareToken;
let issueViewerJwt: typeof import("../viewer").issueViewerJwt;
let verifyViewerJwt: typeof import("../viewer").verifyViewerJwt;
let VIEWER_COOKIE_CONFIG: typeof import("../viewer").VIEWER_COOKIE_CONFIG;
let hashToken: typeof import("../viewer").hashToken;

beforeAll(async () => {
  // Ensure env vars are set for tests
  process.env.VIEWER_JWT_SECRET =
    process.env.VIEWER_JWT_SECRET || "test-viewer-jwt-secret";
  process.env.VIEWER_JWT_SECRET_PREVIOUS =
    process.env.VIEWER_JWT_SECRET_PREVIOUS || "test-viewer-jwt-secret-previous";

  const mod = await import("../viewer");
  generateShareToken = mod.generateShareToken;
  _validateShareToken = mod.validateShareToken;
  issueViewerJwt = mod.issueViewerJwt;
  verifyViewerJwt = mod.verifyViewerJwt;
  VIEWER_COOKIE_CONFIG = mod.VIEWER_COOKIE_CONFIG;
  hashToken = mod.hashToken;
});

// ─── generateShareToken ─────────────────────────────────────────────────────

describe("generateShareToken", () => {
  it("returns an object with rawToken and tokenHash", () => {
    const result = generateShareToken();
    expect(result).toHaveProperty("rawToken");
    expect(result).toHaveProperty("tokenHash");
    expect(typeof result.rawToken).toBe("string");
    expect(typeof result.tokenHash).toBe("string");
  });

  it("produces a 43-character base64url token", () => {
    const { rawToken } = generateShareToken();
    expect(rawToken).toHaveLength(43);
  });

  it("produces a base64url-encoded token (no +, /, = padding)", () => {
    // Generate multiple tokens and check each
    for (let i = 0; i < 10; i++) {
      const { rawToken } = generateShareToken();
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(rawToken).not.toContain("+");
      expect(rawToken).not.toContain("/");
      expect(rawToken).not.toContain("=");
    }
  });

  it("produces a 64-character hex tokenHash (SHA-256)", () => {
    const { tokenHash } = generateShareToken();
    expect(tokenHash).toHaveLength(64);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("tokenHash is the SHA-256 of the raw token", () => {
    const { rawToken, tokenHash } = generateShareToken();
    const expectedHash = hashToken(rawToken);
    expect(tokenHash).toBe(expectedHash);
  });

  it("generates unique tokens across multiple calls", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { rawToken } = generateShareToken();
      tokens.add(rawToken);
    }
    expect(tokens.size).toBe(100);
  });

  it("generates unique hashes across multiple calls", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { tokenHash } = generateShareToken();
      hashes.add(tokenHash);
    }
    expect(hashes.size).toBe(100);
  });
});

// ─── hashToken ──────────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("returns a 64-char hex string", () => {
    const hash = hashToken("test-token");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for the same input", () => {
    const hash1 = hashToken("deterministic-test");
    const hash2 = hashToken("deterministic-test");
    expect(hash1).toBe(hash2);
  });

  it("returns different hashes for different inputs", () => {
    const hash1 = hashToken("input-a");
    const hash2 = hashToken("input-b");
    expect(hash1).not.toBe(hash2);
  });
});

// ─── validateShareToken ─────────────────────────────────────────────────────

describe("validateShareToken", () => {
  // We mock the database module for these tests
  const mockGrant = {
    id: "grant-uuid-123",
    token: "", // will set in each test
    ownerId: "user_owner1",
    label: "Test share",
    note: "Test note",
    allowedMetrics: ["sleep_score", "hrv"],
    dataStart: "2025-06-01",
    dataEnd: "2026-03-08",
    grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
    revokedAt: null,
    viewCount: 0,
    lastViewedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("returns grant details for a valid, active token", async () => {
    const { rawToken, tokenHash } = generateShareToken();
    const grantWithToken = { ...mockGrant, token: tokenHash };

    // We'll test the integration aspect by mocking at the db level
    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([grantWithToken]),
          }),
        }),
      },
    }));

    // Re-import to pick up the mock
    vi.resetModules();
    process.env.VIEWER_JWT_SECRET = "test-viewer-jwt-secret";
    process.env.VIEWER_JWT_SECRET_PREVIOUS = "test-viewer-jwt-secret-previous";
    const freshMod = await import("../viewer");
    const result = await freshMod.validateShareToken(rawToken);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("grant-uuid-123");
    expect(result!.ownerId).toBe("user_owner1");
    expect(result!.allowedMetrics).toEqual(["sleep_score", "hrv"]);

    vi.doUnmock("@/db");
    vi.resetModules();
  });

  it("returns null for a token matching an expired grant", async () => {
    const { rawToken, tokenHash } = generateShareToken();
    const expiredGrant = {
      ...mockGrant,
      token: tokenHash,
      grantExpires: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    };

    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([expiredGrant]),
          }),
        }),
      },
    }));

    vi.resetModules();
    process.env.VIEWER_JWT_SECRET = "test-viewer-jwt-secret";
    process.env.VIEWER_JWT_SECRET_PREVIOUS = "test-viewer-jwt-secret-previous";
    const freshMod = await import("../viewer");
    const result = await freshMod.validateShareToken(rawToken);

    expect(result).toBeNull();

    vi.doUnmock("@/db");
    vi.resetModules();
  });

  it("returns null for a token matching a revoked grant", async () => {
    const { rawToken, tokenHash } = generateShareToken();
    const revokedGrant = {
      ...mockGrant,
      token: tokenHash,
      revokedAt: new Date(Date.now() - 30 * 60 * 1000), // revoked 30 min ago
    };

    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([revokedGrant]),
          }),
        }),
      },
    }));

    vi.resetModules();
    process.env.VIEWER_JWT_SECRET = "test-viewer-jwt-secret";
    process.env.VIEWER_JWT_SECRET_PREVIOUS = "test-viewer-jwt-secret-previous";
    const freshMod = await import("../viewer");
    const result = await freshMod.validateShareToken(rawToken);

    expect(result).toBeNull();

    vi.doUnmock("@/db");
    vi.resetModules();
  });

  it("returns null when no grant matches the token hash", async () => {
    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      },
    }));

    vi.resetModules();
    process.env.VIEWER_JWT_SECRET = "test-viewer-jwt-secret";
    process.env.VIEWER_JWT_SECRET_PREVIOUS = "test-viewer-jwt-secret-previous";
    const freshMod = await import("../viewer");
    const result = await freshMod.validateShareToken("nonexistent-token");

    expect(result).toBeNull();

    vi.doUnmock("@/db");
    vi.resetModules();
  });
});

// ─── issueViewerJwt ─────────────────────────────────────────────────────────

describe("issueViewerJwt", () => {
  const baseGrant = {
    id: "grant-uuid-456",
    ownerId: "user_owner2",
    allowedMetrics: ["sleep_score", "hrv", "rhr"],
    dataStart: "2025-01-01",
    dataEnd: "2026-06-30",
    grantExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
  };

  it("returns a valid JWT string", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    expect(typeof jwt).toBe("string");
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("JWT contains grantId claim", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.grantId).toBe("grant-uuid-456");
  });

  it("JWT contains ownerId claim", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.ownerId).toBe("user_owner2");
  });

  it("JWT contains allowedMetrics claim", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.allowedMetrics).toEqual(["sleep_score", "hrv", "rhr"]);
  });

  it("JWT contains dataStart and dataEnd claims", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.dataStart).toBe("2025-01-01");
    expect(payload.dataEnd).toBe("2026-06-30");
  });

  it("JWT contains iat claim", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.iat).toBeDefined();
    expect(typeof payload.iat).toBe("number");
  });

  it("JWT contains exp claim", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.exp).toBeDefined();
    expect(typeof payload.exp).toBe("number");
  });

  it("JWT contains jti claim (unique identifier)", async () => {
    const jwt = await issueViewerJwt(baseGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);
    expect(payload.jti).toBeDefined();
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti!.length).toBeGreaterThan(0);
  });

  it("JWT jti is unique across multiple issues", async () => {
    const jtis = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const jwt = await issueViewerJwt(baseGrant);
      const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
      const { payload } = await jwtVerify(jwt, secret);
      jtis.add(payload.jti!);
    }
    expect(jtis.size).toBe(10);
  });

  it("JWT exp = now + 4h when grant expires far in the future", async () => {
    const farFutureGrant = {
      ...baseGrant,
      grantExpires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    };

    const now = Math.floor(Date.now() / 1000);
    const jwt = await issueViewerJwt(farFutureGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);

    // exp should be approximately now + 4 hours (within 5 seconds tolerance)
    const fourHours = 4 * 60 * 60;
    expect(payload.exp!).toBeGreaterThanOrEqual(now + fourHours - 5);
    expect(payload.exp!).toBeLessThanOrEqual(now + fourHours + 5);
  });

  it("JWT exp = grant_expires when grant expires sooner than 4h", async () => {
    const soonExpiringGrant = {
      ...baseGrant,
      grantExpires: new Date(Date.now() + 1 * 60 * 60 * 1000), // 1 hour from now
    };

    const grantExpiresUnix = Math.floor(
      soonExpiringGrant.grantExpires.getTime() / 1000,
    );
    const jwt = await issueViewerJwt(soonExpiringGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);

    // exp should be approximately the grant_expires (within 5 seconds tolerance)
    expect(payload.exp!).toBeGreaterThanOrEqual(grantExpiresUnix - 5);
    expect(payload.exp!).toBeLessThanOrEqual(grantExpiresUnix + 5);
  });

  it("JWT exp = min(grant_expires, now + 4h) boundary case", async () => {
    // Grant expires in exactly 4 hours (boundary)
    const fourHoursMs = 4 * 60 * 60 * 1000;
    const boundaryGrant = {
      ...baseGrant,
      grantExpires: new Date(Date.now() + fourHoursMs),
    };

    const now = Math.floor(Date.now() / 1000);
    const fourHours = 4 * 60 * 60;
    const jwt = await issueViewerJwt(boundaryGrant);
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const { payload } = await jwtVerify(jwt, secret);

    // Both values are about the same, so exp should be approximately now + 4h
    expect(payload.exp!).toBeGreaterThanOrEqual(now + fourHours - 5);
    expect(payload.exp!).toBeLessThanOrEqual(now + fourHours + 5);
  });
});

// ─── verifyViewerJwt ────────────────────────────────────────────────────────

describe("verifyViewerJwt", () => {
  it("returns payload for JWT signed with current secret", async () => {
    const grant = {
      id: "grant-verify-1",
      ownerId: "user_verify1",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-06-30",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    const jwt = await issueViewerJwt(grant);
    const payload = await verifyViewerJwt(jwt);

    expect(payload).not.toBeNull();
    expect(payload!.grantId).toBe("grant-verify-1");
    expect(payload!.ownerId).toBe("user_verify1");
  });

  it("returns payload for JWT signed with previous secret", async () => {
    // Sign a JWT with the PREVIOUS secret manually
    const prevSecret = new TextEncoder().encode(
      process.env.VIEWER_JWT_SECRET_PREVIOUS!,
    );
    const token = await new SignJWT({
      grantId: "grant-prev-secret",
      ownerId: "user_prev",
      allowedMetrics: ["hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("4h")
      .setJti("jti-prev-test")
      .sign(prevSecret);

    const payload = await verifyViewerJwt(token);

    expect(payload).not.toBeNull();
    expect(payload!.grantId).toBe("grant-prev-secret");
    expect(payload!.ownerId).toBe("user_prev");
  });

  it("returns null for JWT signed with unknown secret", async () => {
    const unknownSecret = new TextEncoder().encode("totally-unknown-secret");
    const token = await new SignJWT({
      grantId: "grant-unknown",
      ownerId: "user_unknown",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("4h")
      .setJti("jti-unknown-test")
      .sign(unknownSecret);

    const payload = await verifyViewerJwt(token);
    expect(payload).toBeNull();
  });

  it("returns null for an expired JWT", async () => {
    const secret = new TextEncoder().encode(process.env.VIEWER_JWT_SECRET!);
    const token = await new SignJWT({
      grantId: "grant-expired-jwt",
      ownerId: "user_expired",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 86400)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1 hour ago
      .setJti("jti-expired-test")
      .sign(secret);

    const payload = await verifyViewerJwt(token);
    expect(payload).toBeNull();
  });

  it("returns null for an invalid token string", async () => {
    const payload = await verifyViewerJwt("not.a.valid.jwt");
    expect(payload).toBeNull();
  });

  it("returns null for an empty string", async () => {
    const payload = await verifyViewerJwt("");
    expect(payload).toBeNull();
  });

  it("returns payload with all expected fields", async () => {
    const grant = {
      id: "grant-full-payload",
      ownerId: "user_full",
      allowedMetrics: ["sleep_score", "hrv", "steps"],
      dataStart: "2025-03-01",
      dataEnd: "2026-03-01",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    const jwt = await issueViewerJwt(grant);
    const payload = await verifyViewerJwt(jwt);

    expect(payload).not.toBeNull();
    expect(payload!.grantId).toBe("grant-full-payload");
    expect(payload!.ownerId).toBe("user_full");
    expect(payload!.allowedMetrics).toEqual(["sleep_score", "hrv", "steps"]);
    expect(payload!.dataStart).toBe("2025-03-01");
    expect(payload!.dataEnd).toBe("2026-03-01");
    expect(payload!.iat).toBeDefined();
    expect(payload!.exp).toBeDefined();
    expect(payload!.jti).toBeDefined();
  });

  it("works during secret rotation (both secrets valid)", async () => {
    const grant = {
      id: "grant-rotation",
      ownerId: "user_rotation",
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
      grantExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };

    // JWT signed with current secret
    const jwtCurrent = await issueViewerJwt(grant);

    // JWT signed with previous secret
    const prevSecret = new TextEncoder().encode(
      process.env.VIEWER_JWT_SECRET_PREVIOUS!,
    );
    const jwtPrevious = await new SignJWT({
      grantId: "grant-rotation-prev",
      ownerId: "user_rotation_prev",
      allowedMetrics: ["hrv"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("4h")
      .setJti("jti-rotation-prev")
      .sign(prevSecret);

    // Both should verify
    const payloadCurrent = await verifyViewerJwt(jwtCurrent);
    const payloadPrevious = await verifyViewerJwt(jwtPrevious);

    expect(payloadCurrent).not.toBeNull();
    expect(payloadCurrent!.grantId).toBe("grant-rotation");
    expect(payloadPrevious).not.toBeNull();
    expect(payloadPrevious!.grantId).toBe("grant-rotation-prev");
  });
});

// ─── VIEWER_COOKIE_CONFIG ───────────────────────────────────────────────────

describe("VIEWER_COOKIE_CONFIG", () => {
  it("has correct cookie name", () => {
    expect(VIEWER_COOKIE_CONFIG.name).toBe("totus_viewer");
  });

  it("is httpOnly", () => {
    expect(VIEWER_COOKIE_CONFIG.httpOnly).toBe(true);
  });

  it("has SameSite=lax", () => {
    expect(VIEWER_COOKIE_CONFIG.sameSite).toBe("lax");
  });

  it("has path=/", () => {
    expect(VIEWER_COOKIE_CONFIG.path).toBe("/");
  });
});
