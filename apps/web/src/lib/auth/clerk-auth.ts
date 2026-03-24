import { auth as clerkServerAuth } from "@clerk/nextjs/server";
import type { AuthResult } from "./mock-auth";

/**
 * Server-side auth function wrapping Clerk's auth().
 *
 * Returns the same { userId } shape as mockAuth so callers
 * can switch between mock and Clerk without code changes.
 */
export async function clerkAuth(): Promise<AuthResult> {
  const { userId } = await clerkServerAuth();
  return { userId };
}

/**
 * No-op: Clerk manages its own session tokens via its middleware and SDK.
 * Provided for interface compatibility with mock auth exports.
 */
export async function clerkCreateSessionToken(
  _userId: string,
): Promise<string> {
  throw new Error(
    "clerkCreateSessionToken is not supported — Clerk manages sessions automatically.",
  );
}

/**
 * No-op: Clerk manages its own session verification via its middleware and SDK.
 * Provided for interface compatibility with mock auth exports.
 */
export async function clerkVerifySessionToken(
  _token: string,
): Promise<string | null> {
  throw new Error(
    "clerkVerifySessionToken is not supported — Clerk manages sessions automatically.",
  );
}
