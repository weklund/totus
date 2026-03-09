/**
 * Unified auth module.
 *
 * Exports auth(), useAuth(), and session helpers.
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
