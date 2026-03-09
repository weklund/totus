import { describe, expect, it } from "vitest";
import {
  createOwnerContext,
  createViewerContext,
  createUnauthenticatedContext,
  getRequestContext,
  REQUEST_CONTEXT_HEADER,
} from "../request-context";
import type { RequestContext } from "../request-context";

// ─── createOwnerContext ─────────────────────────────────────────────────────

describe("createOwnerContext", () => {
  it("creates context with role=owner", () => {
    const ctx = createOwnerContext("user_123");
    expect(ctx.role).toBe("owner");
  });

  it("sets userId correctly", () => {
    const ctx = createOwnerContext("user_abc");
    expect(ctx.userId).toBe("user_abc");
  });

  it("sets permissions to full", () => {
    const ctx = createOwnerContext("user_123");
    expect(ctx.permissions).toBe("full");
  });

  it("sets authMethod to session", () => {
    const ctx = createOwnerContext("user_123");
    expect(ctx.authMethod).toBe("session");
  });

  it("does not include grantId", () => {
    const ctx = createOwnerContext("user_123");
    expect(ctx.grantId).toBeUndefined();
  });
});

// ─── createViewerContext ────────────────────────────────────────────────────

describe("createViewerContext", () => {
  it("creates context with role=viewer", () => {
    const ctx = createViewerContext(
      "grant_1",
      "owner_1",
      ["sleep_score", "hrv"],
      "2025-01-01",
      "2026-01-01",
    );
    expect(ctx.role).toBe("viewer");
  });

  it("sets grantId correctly", () => {
    const ctx = createViewerContext(
      "grant_xyz",
      "owner_1",
      ["sleep_score"],
      "2025-01-01",
      "2026-01-01",
    );
    expect(ctx.grantId).toBe("grant_xyz");
  });

  it("sets userId to ownerId", () => {
    const ctx = createViewerContext(
      "grant_1",
      "owner_abc",
      ["sleep_score"],
      "2025-01-01",
      "2026-01-01",
    );
    expect(ctx.userId).toBe("owner_abc");
  });

  it("sets permissions with allowedMetrics, dataStart, dataEnd", () => {
    const ctx = createViewerContext(
      "grant_1",
      "owner_1",
      ["sleep_score", "hrv"],
      "2025-03-01",
      "2026-03-01",
    );
    expect(ctx.permissions).toEqual({
      allowedMetrics: ["sleep_score", "hrv"],
      dataStart: "2025-03-01",
      dataEnd: "2026-03-01",
    });
  });

  it("sets authMethod to viewer_jwt", () => {
    const ctx = createViewerContext(
      "grant_1",
      "owner_1",
      ["sleep_score"],
      "2025-01-01",
      "2026-01-01",
    );
    expect(ctx.authMethod).toBe("viewer_jwt");
  });
});

// ─── createUnauthenticatedContext ───────────────────────────────────────────

describe("createUnauthenticatedContext", () => {
  it("creates context with role=unauthenticated", () => {
    const ctx = createUnauthenticatedContext();
    expect(ctx.role).toBe("unauthenticated");
  });

  it("has no userId", () => {
    const ctx = createUnauthenticatedContext();
    expect(ctx.userId).toBeUndefined();
  });

  it("has no grantId", () => {
    const ctx = createUnauthenticatedContext();
    expect(ctx.grantId).toBeUndefined();
  });

  it("sets authMethod to none", () => {
    const ctx = createUnauthenticatedContext();
    expect(ctx.authMethod).toBe("none");
  });
});

// ─── getRequestContext ──────────────────────────────────────────────────────

describe("getRequestContext", () => {
  it("returns owner context from valid header", () => {
    const ownerCtx: RequestContext = {
      role: "owner",
      userId: "user_123",
      permissions: "full",
      authMethod: "session",
    };

    const headers = new Headers();
    headers.set(REQUEST_CONTEXT_HEADER, JSON.stringify(ownerCtx));

    const result = getRequestContext(headers);
    expect(result.role).toBe("owner");
    expect(result.userId).toBe("user_123");
    expect(result.permissions).toBe("full");
    expect(result.authMethod).toBe("session");
  });

  it("returns viewer context from valid header", () => {
    const viewerCtx: RequestContext = {
      role: "viewer",
      userId: "owner_1",
      grantId: "grant_abc",
      permissions: {
        allowedMetrics: ["sleep_score"],
        dataStart: "2025-01-01",
        dataEnd: "2026-01-01",
      },
      authMethod: "viewer_jwt",
    };

    const headers = new Headers();
    headers.set(REQUEST_CONTEXT_HEADER, JSON.stringify(viewerCtx));

    const result = getRequestContext(headers);
    expect(result.role).toBe("viewer");
    expect(result.grantId).toBe("grant_abc");
    expect(result.permissions).toEqual({
      allowedMetrics: ["sleep_score"],
      dataStart: "2025-01-01",
      dataEnd: "2026-01-01",
    });
  });

  it("returns unauthenticated context when header is missing", () => {
    const headers = new Headers();
    const result = getRequestContext(headers);
    expect(result.role).toBe("unauthenticated");
    expect(result.authMethod).toBe("none");
  });

  it("returns unauthenticated context for invalid JSON", () => {
    const headers = new Headers();
    headers.set(REQUEST_CONTEXT_HEADER, "not-json");
    const result = getRequestContext(headers);
    expect(result.role).toBe("unauthenticated");
  });

  it("returns unauthenticated context for invalid role", () => {
    const headers = new Headers();
    headers.set(
      REQUEST_CONTEXT_HEADER,
      JSON.stringify({
        role: "admin",
        permissions: "full",
        authMethod: "none",
      }),
    );
    const result = getRequestContext(headers);
    expect(result.role).toBe("unauthenticated");
  });

  it("reads from Request object", () => {
    const ownerCtx: RequestContext = {
      role: "owner",
      userId: "user_456",
      permissions: "full",
      authMethod: "session",
    };

    const request = new Request("http://localhost:3000/api/test", {
      headers: {
        [REQUEST_CONTEXT_HEADER]: JSON.stringify(ownerCtx),
      },
    });

    const result = getRequestContext(request);
    expect(result.role).toBe("owner");
    expect(result.userId).toBe("user_456");
  });

  it("reads from Headers object", () => {
    const viewerCtx: RequestContext = {
      role: "viewer",
      userId: "owner_789",
      grantId: "grant_def",
      permissions: {
        allowedMetrics: ["hrv"],
        dataStart: "2025-06-01",
        dataEnd: "2026-06-01",
      },
      authMethod: "viewer_jwt",
    };

    const headers = new Headers();
    headers.set(REQUEST_CONTEXT_HEADER, JSON.stringify(viewerCtx));

    const result = getRequestContext(headers);
    expect(result.role).toBe("viewer");
    expect(result.grantId).toBe("grant_def");
  });
});
