import { createHash, randomBytes } from "crypto";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { shareGrants } from "@/db/schema";

/**
 * Viewer token system.
 *
 * Handles share token generation, validation, and viewer JWT issuance/verification.
 * Viewer JWTs are set as the `totus_viewer` cookie.
 *
 * - generateShareToken(): creates a cryptographically random token + SHA-256 hash
 * - validateShareToken(rawToken): looks up grant by token hash, checks validity
 * - issueViewerJwt(grant): creates a signed JWT with scoped claims
 * - verifyViewerJwt(token): verifies JWT with dual-secret rotation support
 */

const VIEWER_COOKIE_NAME = "totus_viewer";
const FOUR_HOURS_SECONDS = 4 * 60 * 60;

// ─── Secrets ────────────────────────────────────────────────────────────────

/**
 * Get the current viewer JWT signing secret as a Uint8Array.
 */
function getViewerSecret(): Uint8Array {
  const secret = process.env.VIEWER_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "VIEWER_JWT_SECRET environment variable is required for viewer tokens.",
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Get the previous viewer JWT signing secret as a Uint8Array.
 * Returns null if not configured (rotation not active).
 */
function getPreviousViewerSecret(): Uint8Array | null {
  const secret = process.env.VIEWER_JWT_SECRET_PREVIOUS;
  if (!secret) {
    return null;
  }
  return new TextEncoder().encode(secret);
}

// ─── Token Generation ───────────────────────────────────────────────────────

/**
 * Hash a raw token with SHA-256 and return the hex-encoded digest.
 */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generate a cryptographically random share token.
 *
 * - Generates 32 random bytes
 * - Base64url-encodes them (43 characters, no padding)
 * - SHA-256 hashes the raw token for storage
 *
 * @returns { rawToken, tokenHash } where rawToken is shown to the owner once,
 *          and tokenHash is stored in the database.
 */
export function generateShareToken(): { rawToken: string; tokenHash: string } {
  const bytes = randomBytes(32);
  const rawToken = bytes
    .toString("base64url")
    // base64url from Node.js already strips padding, but ensure no padding
    .replace(/=+$/, "");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

// ─── Token Validation ───────────────────────────────────────────────────────

/**
 * Grant details returned from validateShareToken.
 */
export interface ValidatedGrant {
  id: string;
  ownerId: string;
  label: string;
  note: string | null;
  allowedMetrics: string[];
  dataStart: string;
  dataEnd: string;
  grantExpires: Date;
  viewCount: number;
  lastViewedAt: Date | null;
  createdAt: Date;
}

/**
 * Validate a raw share token against the database.
 *
 * - Hashes the token
 * - Looks up share_grants by token hash
 * - Checks the grant is not revoked and not expired
 *
 * @returns Grant details if valid, null otherwise.
 */
export async function validateShareToken(
  rawToken: string,
): Promise<ValidatedGrant | null> {
  const tokenHash = hashToken(rawToken);

  const results = await db
    .select()
    .from(shareGrants)
    .where(eq(shareGrants.token, tokenHash));

  if (results.length === 0) {
    return null;
  }

  const grant = results[0];

  // Check if revoked
  if (grant.revokedAt !== null) {
    return null;
  }

  // Check if expired
  if (grant.grantExpires <= new Date()) {
    return null;
  }

  return {
    id: grant.id,
    ownerId: grant.ownerId,
    label: grant.label,
    note: grant.note,
    allowedMetrics: grant.allowedMetrics as string[],
    dataStart: grant.dataStart,
    dataEnd: grant.dataEnd,
    grantExpires: grant.grantExpires,
    viewCount: grant.viewCount,
    lastViewedAt: grant.lastViewedAt,
    createdAt: grant.createdAt,
  };
}

// ─── Viewer JWT ─────────────────────────────────────────────────────────────

/**
 * Input for issuing a viewer JWT. Subset of grant fields needed for the JWT payload.
 */
export interface ViewerJwtGrant {
  id: string;
  ownerId: string;
  allowedMetrics: string[];
  dataStart: string;
  dataEnd: string;
  grantExpires: Date;
}

/**
 * Payload structure of the viewer JWT.
 */
export interface ViewerJwtPayload {
  grantId: string;
  ownerId: string;
  allowedMetrics: string[];
  dataStart: string;
  dataEnd: string;
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Issue a viewer JWT for a validated share grant.
 *
 * JWT payload includes: grantId, ownerId, allowedMetrics, dataStart, dataEnd, iat, exp, jti.
 * Expiration is min(grant_expires, now + 4 hours).
 * Signed with VIEWER_JWT_SECRET using HS256 via jose.
 *
 * @param grant - The validated grant details
 * @returns Signed JWT string
 */
export async function issueViewerJwt(grant: ViewerJwtGrant): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fourHoursFromNow = now + FOUR_HOURS_SECONDS;
  const grantExpiresUnix = Math.floor(grant.grantExpires.getTime() / 1000);

  // exp = min(grant_expires, now + 4h)
  const exp = Math.min(grantExpiresUnix, fourHoursFromNow);

  // Generate a unique jti (JWT ID)
  const jti = randomBytes(16).toString("hex");

  const token = await new SignJWT({
    grantId: grant.id,
    ownerId: grant.ownerId,
    allowedMetrics: grant.allowedMetrics,
    dataStart: grant.dataStart,
    dataEnd: grant.dataEnd,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(getViewerSecret());

  return token;
}

/**
 * Verify a viewer JWT, trying the current secret first, then the previous secret.
 * Supports dual-secret rotation.
 *
 * @param token - The JWT string to verify
 * @returns Decoded payload if valid, null otherwise.
 */
export async function verifyViewerJwt(
  token: string,
): Promise<ViewerJwtPayload | null> {
  if (!token) {
    return null;
  }

  // Try current secret first
  try {
    const { payload } = await jwtVerify(token, getViewerSecret());
    return payload as unknown as ViewerJwtPayload;
  } catch {
    // Current secret failed, try previous secret
  }

  // Try previous secret for rotation
  const previousSecret = getPreviousViewerSecret();
  if (previousSecret) {
    try {
      const { payload } = await jwtVerify(token, previousSecret);
      return payload as unknown as ViewerJwtPayload;
    } catch {
      // Previous secret also failed
    }
  }

  return null;
}

// ─── Cookie Configuration ───────────────────────────────────────────────────

/**
 * Cookie configuration for the viewer JWT.
 *
 * httpOnly: prevents JS access (XSS protection)
 * secure: only sent over HTTPS in production
 * sameSite: lax prevents CSRF while allowing navigation
 * path: / makes the cookie available to all routes
 */
export const VIEWER_COOKIE_CONFIG = {
  name: VIEWER_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};
