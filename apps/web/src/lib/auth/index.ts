/**
 * Unified auth module.
 *
 * Exports auth(), useAuth(), session helpers, and viewer token system.
 * When NEXT_PUBLIC_USE_MOCK_AUTH=true, uses mock auth layer.
 * When false, would use real Clerk (not yet implemented).
 */

export { mockAuth as auth } from "./mock-auth";
export {
  createSessionToken,
  SESSION_COOKIE_CONFIG,
  verifySessionToken,
} from "./mock-auth";
export type { AuthResult } from "./mock-auth";
export { MockAuthProvider, useAuth } from "./mock-auth-provider";

// Viewer token system
export {
  generateShareToken,
  hashToken,
  issueViewerJwt,
  validateShareToken,
  verifyViewerJwt,
  VIEWER_COOKIE_CONFIG,
} from "./viewer";
export type {
  ValidatedGrant,
  ViewerJwtGrant,
  ViewerJwtPayload,
} from "./viewer";

// Request context
export {
  getRequestContext,
  createOwnerContext,
  createViewerContext,
  createUnauthenticatedContext,
  REQUEST_CONTEXT_HEADER,
} from "./request-context";
export type { RequestContext, ViewerPermissions } from "./request-context";

// Permissions
export { enforcePermissions, PermissionError } from "./permissions";
export type { RequestedScope, EffectiveScope } from "./permissions";
