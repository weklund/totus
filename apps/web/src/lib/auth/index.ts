/**
 * Unified auth module.
 *
 * Exports auth(), useAuth(), session helpers, and viewer token system.
 * When NEXT_PUBLIC_USE_MOCK_AUTH=true, uses mock auth layer.
 * When false, uses real Clerk authentication.
 */

import type { AuthResult } from "./mock-auth";
import { mockAuth } from "./mock-auth";
import { clerkAuth } from "./clerk-auth";
import {
  createSessionToken as mockCreateSessionToken,
  verifySessionToken as mockVerifySessionToken,
  SESSION_COOKIE_CONFIG as mockSessionCookieConfig,
} from "./mock-auth";
import { clerkCreateSessionToken, clerkVerifySessionToken } from "./clerk-auth";

const useMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

// ─── Server-side auth (conditional on NEXT_PUBLIC_USE_MOCK_AUTH) ─────────────

/**
 * Server-side auth function.
 * Uses mock auth when NEXT_PUBLIC_USE_MOCK_AUTH=true, Clerk otherwise.
 */
export const auth: () => Promise<AuthResult> = useMockAuth
  ? mockAuth
  : clerkAuth;

/**
 * Create a session token (mock auth only).
 * Throws when using Clerk — Clerk manages its own sessions.
 */
export const createSessionToken: (userId: string) => Promise<string> =
  useMockAuth ? mockCreateSessionToken : clerkCreateSessionToken;

/**
 * Verify a session token (mock auth only).
 * Throws when using Clerk — Clerk manages its own sessions.
 */
export const verifySessionToken: (token: string) => Promise<string | null> =
  useMockAuth ? mockVerifySessionToken : clerkVerifySessionToken;

/**
 * Session cookie configuration (mock auth only).
 * When using Clerk, this config is unused — Clerk manages its own cookies.
 */
export const SESSION_COOKIE_CONFIG = mockSessionCookieConfig;

export type { AuthResult } from "./mock-auth";

// ─── Client-side auth (conditional on NEXT_PUBLIC_USE_MOCK_AUTH) ─────────────

export { AuthProvider } from "./auth-provider";

// Re-export useAuth conditionally: mock or Clerk
// Using a re-export wrapper to allow tree-shaking at build time.
import { useAuth as mockUseAuth } from "./mock-auth-provider";
import { useAuth as clerkUseAuth } from "./clerk-auth-provider";

/**
 * useAuth() hook — provides { userId, isSignedIn, isLoaded, signOut }.
 * Uses mock auth when NEXT_PUBLIC_USE_MOCK_AUTH=true, Clerk otherwise.
 */
export const useAuth = useMockAuth ? mockUseAuth : clerkUseAuth;

// Keep MockAuthProvider export for backward compatibility
export { MockAuthProvider } from "./mock-auth-provider";

// ─── Viewer token system (shared, independent of auth backend) ───────────────

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

// ─── Request context (shared) ────────────────────────────────────────────────

export {
  getRequestContext,
  createOwnerContext,
  createViewerContext,
  createApiKeyContext,
  createUnauthenticatedContext,
  REQUEST_CONTEXT_HEADER,
} from "./request-context";
export type { RequestContext, ViewerPermissions } from "./request-context";

// ─── Permissions (shared) ────────────────────────────────────────────────────

export {
  enforcePermissions,
  enforceScope,
  isApiKeyAuth,
  PermissionError,
} from "./permissions";
export type { RequestedScope, EffectiveScope } from "./permissions";

// ─── API key resolution for route handlers (shared) ──────────────────────────

export {
  resolveApiKeyAuth,
  getResolvedContext,
  checkApiKeyRateLimit,
} from "./resolve-api-key";

// ─── API keys (shared) ──────────────────────────────────────────────────────

export {
  generateApiKey,
  parseApiKey,
  hashLongToken,
  verifyLongToken,
  validateScopes,
  isScopeSubset,
  VALID_SCOPES,
  DEFAULT_EXPIRES_IN_DAYS,
  MAX_EXPIRES_IN_DAYS,
  MIN_EXPIRES_IN_DAYS,
  MAX_ACTIVE_KEYS_PER_USER,
} from "./api-keys";
export type { GeneratedApiKey, ParsedApiKey, ApiKeyScope } from "./api-keys";
