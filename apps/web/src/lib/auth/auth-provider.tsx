"use client";

/**
 * Conditional auth provider.
 *
 * When NEXT_PUBLIC_USE_MOCK_AUTH=true, renders MockAuthProvider.
 * Otherwise, renders ClerkAuthProvider.
 *
 * This component is used by the root layout to wrap the app in the
 * correct auth provider based on the environment.
 */

import { MockAuthProvider } from "./mock-auth-provider";
import { ClerkAuthProvider } from "./clerk-auth-provider";

const useMockAuth = process.env.NEXT_PUBLIC_USE_MOCK_AUTH === "true";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (useMockAuth) {
    return <MockAuthProvider>{children}</MockAuthProvider>;
  }
  return <ClerkAuthProvider>{children}</ClerkAuthProvider>;
}
