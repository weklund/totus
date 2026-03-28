/**
 * Server-only auth exports.
 *
 * Import this module from Server Components and API routes only.
 * Never import from "use client" components — use "@/lib/auth" instead.
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
 */
export const SESSION_COOKIE_CONFIG = mockSessionCookieConfig;

export type { AuthResult } from "./mock-auth";
