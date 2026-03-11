/**
 * Permission enforcement — pure function for owner/viewer access control.
 *
 * enforcePermissions takes a RequestContext and a requested scope,
 * and returns either a narrowed scope (possibly unchanged) or throws an error.
 *
 * enforceScope checks that an API key has the required scope.
 *
 * Key design decisions (from architecture-design.md):
 * 1. The API narrows, not rejects, when possible.
 * 2. Date range clamping happens automatically.
 * 3. Grant data is in the viewer JWT, so no DB hit needed.
 */

import type { RequestContext, ViewerPermissions } from "./request-context";

/**
 * The requested data scope from an API call.
 */
export interface RequestedScope {
  /** The user whose data is being accessed */
  userId: string;
  /** Requested metric types */
  metrics: string[];
  /** Start date (YYYY-MM-DD) */
  startDate: string;
  /** End date (YYYY-MM-DD) */
  endDate: string;
}

/**
 * The effective (possibly narrowed) scope after permission enforcement.
 */
export interface EffectiveScope {
  /** The user whose data will be accessed */
  userId: string;
  /** Metrics that are permitted (may be a subset of requested) */
  metrics: string[];
  /** Effective start date (may be clamped) */
  startDate: string;
  /** Effective end date (may be clamped) */
  endDate: string;
}

/**
 * Permission enforcement error.
 */
export class PermissionError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, message: string, statusCode: number = 403) {
    super(message);
    this.name = "PermissionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Enforce permissions for a data access request.
 *
 * - Owner: full access to own data; cannot access another user's data
 * - Viewer: metrics intersected with grant's allowedMetrics, dates clamped to grant boundaries
 * - Unauthenticated: always rejected
 *
 * Returns the effective scope (possibly narrowed), or throws PermissionError.
 *
 * @param ctx - The request context from middleware
 * @param scope - The requested data scope
 * @returns The effective scope after enforcement
 * @throws PermissionError if access is denied
 */
export function enforcePermissions(
  ctx: RequestContext,
  scope: RequestedScope,
): EffectiveScope {
  if (ctx.role === "unauthenticated") {
    throw new PermissionError(
      "UNAUTHORIZED",
      "Authentication is required",
      401,
    );
  }

  if (ctx.role === "owner") {
    // Owner can access all their own data
    if (scope.userId !== ctx.userId) {
      throw new PermissionError(
        "FORBIDDEN",
        "Cannot access another user's data",
        403,
      );
    }

    return {
      userId: scope.userId,
      metrics: scope.metrics,
      startDate: scope.startDate,
      endDate: scope.endDate,
    };
  }

  if (ctx.role === "viewer") {
    const permissions = ctx.permissions as ViewerPermissions;

    // 1. Intersect requested metrics with allowed metrics
    const allowedMetrics = scope.metrics.filter((m) =>
      permissions.allowedMetrics.includes(m),
    );

    if (allowedMetrics.length === 0) {
      throw new PermissionError(
        "FORBIDDEN",
        "No permitted metrics in this request",
        403,
      );
    }

    // 2. Clamp date range to grant boundaries
    const effectiveStart = maxDate(scope.startDate, permissions.dataStart);
    const effectiveEnd = minDate(scope.endDate, permissions.dataEnd);

    if (effectiveStart > effectiveEnd) {
      throw new PermissionError(
        "FORBIDDEN",
        "Requested date range is outside the permitted window",
        403,
      );
    }

    // 3. Return narrowed scope with the grant's owner as the userId
    return {
      userId: ctx.userId!,
      metrics: allowedMetrics,
      startDate: effectiveStart,
      endDate: effectiveEnd,
    };
  }

  // Should never reach here
  throw new PermissionError("FORBIDDEN", "Invalid role", 403);
}

/**
 * Return the later of two YYYY-MM-DD date strings.
 */
function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Return the earlier of two YYYY-MM-DD date strings.
 */
function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

/**
 * Enforce that an API key has the required scope.
 *
 * For session-authenticated requests, this is a no-op (sessions have full access).
 * For API key-authenticated requests, checks that the required scope is in the key's scopes.
 *
 * @param ctx - The request context from middleware
 * @param requiredScope - The scope required for this operation
 * @throws PermissionError if the API key lacks the required scope
 */
export function enforceScope(ctx: RequestContext, requiredScope: string): void {
  // Only enforce scopes for API key auth
  if (ctx.authMethod !== "api_key") return;

  if (!ctx.scopes || !ctx.scopes.includes(requiredScope)) {
    throw new PermissionError(
      "INSUFFICIENT_SCOPES",
      `API key does not have the required scope: ${requiredScope}`,
      403,
    );
  }
}

/**
 * Check if the request is authenticated via API key.
 */
export function isApiKeyAuth(ctx: RequestContext): boolean {
  return ctx.authMethod === "api_key";
}
