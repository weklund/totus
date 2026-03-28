/**
 * Unified auth module — client-safe exports only.
 *
 * This barrel is imported by client components (RootProviders.tsx).
 * It MUST NOT import any module that uses:
 *   - "next/headers" (mock-auth.ts)
 *   - "@clerk/nextjs/server" (clerk-auth.ts)
 *   - "pg" / database (resolve-api-key.ts, via db/index.ts)
 *
 * Server-only auth functions → import from "@/lib/auth/server"
 * Viewer tokens → import from "@/lib/auth/viewer"
 * Permissions → import from "@/lib/auth/permissions"
 * Request context → import from "@/lib/auth/request-context"
 * API key resolution → import from "@/lib/auth/resolve-api-key"
 * API key utils → import from "@/lib/auth/api-keys"
 */

// ─── Client-side auth (safe for "use client" components) ────────────────────

export { AuthProvider } from "./auth-provider";

import { useAuth as mockUseAuth } from "./mock-auth-provider";
import { useAuth as clerkUseAuth } from "./clerk-auth-provider";

const useMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

/**
 * useAuth() hook — provides { userId, isSignedIn, isLoaded, signOut }.
 * Uses mock auth when NEXT_PUBLIC_USE_MOCK_AUTH=true, Clerk otherwise.
 */
export const useAuth = useMockAuth ? mockUseAuth : clerkUseAuth;

export { MockAuthProvider } from "./mock-auth-provider";
