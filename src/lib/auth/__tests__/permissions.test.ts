import { describe, expect, it } from "vitest";
import { enforcePermissions, PermissionError } from "../permissions";
import type { RequestedScope } from "../permissions";
import type { RequestContext } from "../request-context";

// ─── Helper factories ───────────────────────────────────────────────────────

function ownerContext(userId: string = "user_owner1"): RequestContext {
  return {
    role: "owner",
    userId,
    permissions: "full",
    authMethod: "session",
  };
}

function viewerContext(
  overrides: Partial<{
    grantId: string;
    userId: string;
    allowedMetrics: string[];
    dataStart: string;
    dataEnd: string;
  }> = {},
): RequestContext {
  return {
    role: "viewer",
    userId: overrides.userId ?? "user_owner1",
    grantId: overrides.grantId ?? "grant_1",
    permissions: {
      allowedMetrics: overrides.allowedMetrics ?? ["sleep_score", "hrv", "rhr"],
      dataStart: overrides.dataStart ?? "2025-01-01",
      dataEnd: overrides.dataEnd ?? "2026-01-01",
    },
    authMethod: "viewer_jwt",
  };
}

function unauthenticatedContext(): RequestContext {
  return {
    role: "unauthenticated",
    permissions: "full",
    authMethod: "none",
  };
}

function baseScope(overrides: Partial<RequestedScope> = {}): RequestedScope {
  return {
    userId: overrides.userId ?? "user_owner1",
    metrics: overrides.metrics ?? ["sleep_score", "hrv"],
    startDate: overrides.startDate ?? "2025-06-01",
    endDate: overrides.endDate ?? "2025-12-31",
  };
}

// ─── Owner permissions ──────────────────────────────────────────────────────

describe("enforcePermissions — owner", () => {
  it("allows full access to own data", () => {
    const ctx = ownerContext("user_owner1");
    const scope = baseScope({ userId: "user_owner1" });
    const result = enforcePermissions(ctx, scope);

    expect(result.userId).toBe("user_owner1");
    expect(result.metrics).toEqual(["sleep_score", "hrv"]);
    expect(result.startDate).toBe("2025-06-01");
    expect(result.endDate).toBe("2025-12-31");
  });

  it("returns all requested metrics unchanged", () => {
    const ctx = ownerContext("user_owner1");
    const scope = baseScope({
      userId: "user_owner1",
      metrics: ["sleep_score", "hrv", "rhr", "steps", "readiness_score"],
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.metrics).toEqual([
      "sleep_score",
      "hrv",
      "rhr",
      "steps",
      "readiness_score",
    ]);
  });

  it("returns all requested dates unchanged", () => {
    const ctx = ownerContext("user_owner1");
    const scope = baseScope({
      userId: "user_owner1",
      startDate: "2020-01-01",
      endDate: "2026-12-31",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.startDate).toBe("2020-01-01");
    expect(result.endDate).toBe("2026-12-31");
  });

  it("rejects access to another user's data", () => {
    const ctx = ownerContext("user_owner1");
    const scope = baseScope({ userId: "user_other" });

    expect(() => enforcePermissions(ctx, scope)).toThrow(PermissionError);
    try {
      enforcePermissions(ctx, scope);
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).code).toBe("FORBIDDEN");
      expect((err as PermissionError).statusCode).toBe(403);
    }
  });
});

// ─── Viewer permissions ─────────────────────────────────────────────────────

describe("enforcePermissions — viewer", () => {
  it("intersects requested metrics with granted metrics", () => {
    const ctx = viewerContext({
      allowedMetrics: ["sleep_score", "hrv", "rhr"],
    });
    const scope = baseScope({
      metrics: ["sleep_score", "hrv", "steps"],
    });
    const result = enforcePermissions(ctx, scope);

    // Only sleep_score and hrv are in both sets
    expect(result.metrics).toEqual(["sleep_score", "hrv"]);
  });

  it("returns all requested metrics when all are granted", () => {
    const ctx = viewerContext({
      allowedMetrics: ["sleep_score", "hrv", "rhr"],
    });
    const scope = baseScope({
      metrics: ["sleep_score", "hrv"],
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.metrics).toEqual(["sleep_score", "hrv"]);
  });

  it("narrows to granted metrics when request includes extras", () => {
    const ctx = viewerContext({
      allowedMetrics: ["sleep_score"],
    });
    const scope = baseScope({
      metrics: ["sleep_score", "hrv", "rhr"],
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.metrics).toEqual(["sleep_score"]);
  });

  it("throws when no metrics overlap (empty intersection)", () => {
    const ctx = viewerContext({
      allowedMetrics: ["sleep_score", "hrv"],
    });
    const scope = baseScope({
      metrics: ["steps", "readiness_score"],
    });

    expect(() => enforcePermissions(ctx, scope)).toThrow(PermissionError);
    try {
      enforcePermissions(ctx, scope);
    } catch (err) {
      expect((err as PermissionError).code).toBe("FORBIDDEN");
      expect((err as PermissionError).statusCode).toBe(403);
      expect((err as PermissionError).message).toContain(
        "No permitted metrics",
      );
    }
  });

  it("clamps start date to grant boundary (request is earlier)", () => {
    const ctx = viewerContext({
      dataStart: "2025-06-01",
      dataEnd: "2026-01-01",
    });
    const scope = baseScope({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.startDate).toBe("2025-06-01"); // clamped from 2025-01-01
  });

  it("clamps end date to grant boundary (request is later)", () => {
    const ctx = viewerContext({
      dataStart: "2025-01-01",
      dataEnd: "2025-06-30",
    });
    const scope = baseScope({
      startDate: "2025-03-01",
      endDate: "2025-12-31",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.endDate).toBe("2025-06-30"); // clamped from 2025-12-31
  });

  it("does not clamp dates when request is within grant range", () => {
    const ctx = viewerContext({
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
    const scope = baseScope({
      startDate: "2025-03-01",
      endDate: "2025-09-30",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.startDate).toBe("2025-03-01");
    expect(result.endDate).toBe("2025-09-30");
  });

  it("throws when date range is entirely outside grant window", () => {
    const ctx = viewerContext({
      dataStart: "2025-06-01",
      dataEnd: "2025-12-31",
    });
    const scope = baseScope({
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    });

    expect(() => enforcePermissions(ctx, scope)).toThrow(PermissionError);
    try {
      enforcePermissions(ctx, scope);
    } catch (err) {
      expect((err as PermissionError).code).toBe("FORBIDDEN");
      expect((err as PermissionError).message).toContain(
        "outside the permitted window",
      );
    }
  });

  it("sets userId to the grant's ownerId", () => {
    const ctx = viewerContext({ userId: "user_data_owner" });
    const scope = baseScope({ userId: "user_data_owner" });
    const result = enforcePermissions(ctx, scope);
    expect(result.userId).toBe("user_data_owner");
  });

  it("handles exact grant boundary dates", () => {
    const ctx = viewerContext({
      dataStart: "2025-06-01",
      dataEnd: "2025-12-31",
    });
    const scope = baseScope({
      startDate: "2025-06-01",
      endDate: "2025-12-31",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.startDate).toBe("2025-06-01");
    expect(result.endDate).toBe("2025-12-31");
  });

  it("handles single-day range within grant", () => {
    const ctx = viewerContext({
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
    const scope = baseScope({
      startDate: "2025-06-15",
      endDate: "2025-06-15",
    });
    const result = enforcePermissions(ctx, scope);
    expect(result.startDate).toBe("2025-06-15");
    expect(result.endDate).toBe("2025-06-15");
  });
});

// ─── Unauthenticated ────────────────────────────────────────────────────────

describe("enforcePermissions — unauthenticated", () => {
  it("throws UNAUTHORIZED error", () => {
    const ctx = unauthenticatedContext();
    const scope = baseScope();

    expect(() => enforcePermissions(ctx, scope)).toThrow(PermissionError);
    try {
      enforcePermissions(ctx, scope);
    } catch (err) {
      expect((err as PermissionError).code).toBe("UNAUTHORIZED");
      expect((err as PermissionError).statusCode).toBe(401);
    }
  });
});

// ─── PermissionError ────────────────────────────────────────────────────────

describe("PermissionError", () => {
  it("has correct name", () => {
    const err = new PermissionError("FORBIDDEN", "test", 403);
    expect(err.name).toBe("PermissionError");
  });

  it("has correct code", () => {
    const err = new PermissionError("UNAUTHORIZED", "test", 401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("has correct statusCode", () => {
    const err = new PermissionError("FORBIDDEN", "test", 403);
    expect(err.statusCode).toBe(403);
  });

  it("has correct message", () => {
    const err = new PermissionError("FORBIDDEN", "Access denied", 403);
    expect(err.message).toBe("Access denied");
  });

  it("defaults statusCode to 403", () => {
    const err = new PermissionError("FORBIDDEN", "test");
    expect(err.statusCode).toBe(403);
  });
});
