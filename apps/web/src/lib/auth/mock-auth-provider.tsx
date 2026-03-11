"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Mock auth context shape, matching Clerk's useAuth() return type.
 */
interface MockAuthContextValue {
  userId: string | null;
  isSignedIn: boolean;
  isLoaded: boolean;
  signOut: () => Promise<void>;
}

const MockAuthContext = createContext<MockAuthContextValue>({
  userId: null,
  isSignedIn: false,
  isLoaded: false,
  signOut: async () => {},
});

/**
 * MockAuthProvider — React context provider for client components.
 *
 * Fetches the current session status on mount and provides
 * useAuth() hook with { userId, isSignedIn, signOut }.
 */
export function MockAuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Check session status on mount
    fetch("/api/auth/session")
      .then((res) => {
        if (res.ok) return res.json();
        return { userId: null };
      })
      .then((data: { userId: string | null }) => {
        setUserId(data.userId);
        setIsLoaded(true);
      })
      .catch(() => {
        setUserId(null);
        setIsLoaded(true);
      });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
      setUserId(null);
    } catch {
      // Best-effort sign-out
    }
  }, []);

  return (
    <MockAuthContext.Provider
      value={{
        userId,
        isSignedIn: userId !== null,
        isLoaded,
        signOut,
      }}
    >
      {children}
    </MockAuthContext.Provider>
  );
}

/**
 * useAuth() hook — provides { userId, isSignedIn, signOut } in client components.
 * Mirrors Clerk's useAuth() hook.
 */
export function useAuth(): MockAuthContextValue {
  return useContext(MockAuthContext);
}
