"use client";

import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/nextjs";

/**
 * ClerkAuthProvider — wraps the app in Clerk's <ClerkProvider>.
 *
 * Used when NEXT_PUBLIC_USE_MOCK_AUTH is not "true".
 */
export function ClerkAuthProvider({ children }: { children: React.ReactNode }) {
  return <ClerkProvider>{children}</ClerkProvider>;
}

/**
 * Auth context shape matching the mock auth provider's useAuth() return type.
 */
interface AuthContextValue {
  userId: string | null;
  isSignedIn: boolean;
  isLoaded: boolean;
  signOut: () => Promise<void>;
}

/**
 * useAuth() hook wrapping Clerk's useAuth().
 *
 * Returns the same shape as the mock auth provider so consumers
 * do not need to know which auth backend is active.
 */
export function useAuth(): AuthContextValue {
  const { userId, isSignedIn, isLoaded, signOut } = useClerkAuth();

  return {
    userId: userId ?? null,
    isSignedIn: isSignedIn ?? false,
    isLoaded: isLoaded ?? false,
    signOut: async () => {
      await signOut();
    },
  };
}
