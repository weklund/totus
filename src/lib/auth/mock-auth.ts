import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

/**
 * Mock Clerk auth layer.
 *
 * When NEXT_PUBLIC_USE_MOCK_AUTH=true, this module provides auth() and
 * session helpers that mirror Clerk's API surface using jose JWTs.
 *
 * Session cookie: __session, httpOnly, SameSite=Lax, path=/
 * Algorithm: HS256 via jose
 * Secret: MOCK_AUTH_SECRET env var
 */

const SESSION_COOKIE = "__session";
const JWT_ISSUER = "totus-mock-auth";

/**
 * Get the signing secret as a Uint8Array for jose.
 */
function getSecret(): Uint8Array {
  const secret = process.env.MOCK_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "MOCK_AUTH_SECRET environment variable is required for mock auth.",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Result type matching Clerk's auth() return shape.
 */
export interface AuthResult {
  userId: string | null;
}

/**
 * Server-side auth function matching Clerk's auth() signature.
 *
 * Reads the __session cookie, verifies the JWT with jose,
 * and returns { userId } or { userId: null }.
 */
export async function mockAuth(): Promise<AuthResult> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE);

    if (!sessionCookie?.value) {
      return { userId: null };
    }

    const { payload } = await jwtVerify(sessionCookie.value, getSecret(), {
      issuer: JWT_ISSUER,
    });

    const userId = payload.sub;
    if (!userId || typeof userId !== "string") {
      return { userId: null };
    }

    return { userId };
  } catch {
    // Invalid/expired JWT -> treat as unauthenticated
    return { userId: null };
  }
}

/**
 * Create a signed JWT session token for a user.
 */
export async function createSessionToken(userId: string): Promise<string> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());

  return token;
}

/**
 * Verify a session token and extract the userId.
 * Returns null if the token is invalid or expired.
 */
export async function verifySessionToken(
  token: string,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
    });
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Cookie configuration for the session token.
 */
export const SESSION_COOKIE_CONFIG = {
  name: SESSION_COOKIE,
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60, // 7 days
};
