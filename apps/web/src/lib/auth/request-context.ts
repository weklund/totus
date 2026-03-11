/**
 * RequestContext — Unified auth context produced by middleware.
 *
 * The middleware encodes this as JSON in the `x-request-context` header.
 * API route handlers and server components read it via `getRequestContext(request)`.
 */

export const REQUEST_CONTEXT_HEADER = "x-request-context";

/**
 * Viewer permissions derived from the share grant JWT.
 */
export interface ViewerPermissions {
  allowedMetrics: string[];
  dataStart: string;
  dataEnd: string;
}

/**
 * Unified request context object.
 *
 * - role='owner': authenticated user via __session cookie or API key
 * - role='viewer': authenticated viewer via totus_viewer JWT cookie
 * - role='unauthenticated': no valid auth present
 */
export interface RequestContext {
  role: "owner" | "viewer" | "unauthenticated";
  userId?: string;
  grantId?: string;
  permissions: ViewerPermissions | "full";
  authMethod: "session" | "viewer_jwt" | "api_key" | "none";
  /** Present only when authMethod='api_key' */
  apiKeyId?: string;
  /** Scopes granted by the API key. Present only when authMethod='api_key' */
  scopes?: string[];
  /** Set by getResolvedContext() when the general API key rate limit is exceeded */
  _rateLimited?: import("@/lib/api/rate-limit").RateLimitResult;
}

/**
 * Create an owner request context.
 */
export function createOwnerContext(userId: string): RequestContext {
  return {
    role: "owner",
    userId,
    permissions: "full",
    authMethod: "session",
  };
}

/**
 * Create a viewer request context from viewer JWT claims.
 */
export function createViewerContext(
  grantId: string,
  ownerId: string,
  allowedMetrics: string[],
  dataStart: string,
  dataEnd: string,
): RequestContext {
  return {
    role: "viewer",
    userId: ownerId,
    grantId,
    permissions: {
      allowedMetrics,
      dataStart,
      dataEnd,
    },
    authMethod: "viewer_jwt",
  };
}

/**
 * Create an API key owner request context.
 */
export function createApiKeyContext(
  userId: string,
  apiKeyId: string,
  scopes: string[],
): RequestContext {
  return {
    role: "owner",
    userId,
    permissions: "full",
    authMethod: "api_key",
    apiKeyId,
    scopes,
  };
}

/**
 * Create an unauthenticated request context.
 */
export function createUnauthenticatedContext(): RequestContext {
  return {
    role: "unauthenticated",
    permissions: "full",
    authMethod: "none",
  };
}

/**
 * Read the RequestContext from a request's headers.
 *
 * The middleware serializes the context as JSON in the `x-request-context` header.
 * This helper deserializes it.
 *
 * @param request - The incoming Request or Headers object
 * @returns The parsed RequestContext, or an unauthenticated context if the header is missing/invalid
 */
export function getRequestContext(request: Request | Headers): RequestContext {
  const headers = request instanceof Headers ? request : request.headers;
  const raw = headers.get(REQUEST_CONTEXT_HEADER);

  if (!raw) {
    return createUnauthenticatedContext();
  }

  try {
    const parsed = JSON.parse(raw) as RequestContext;

    // Basic validation
    if (
      !parsed.role ||
      !["owner", "viewer", "unauthenticated"].includes(parsed.role)
    ) {
      return createUnauthenticatedContext();
    }

    return parsed;
  } catch {
    return createUnauthenticatedContext();
  }
}
