/**
 * Grant token resolution for view endpoints.
 *
 * When a `grant_token` query parameter is present on a view endpoint request,
 * this module validates the token against the share_grants table and returns
 * a viewer RequestContext scoped to the grant's permissions.
 *
 * Unlike the cookie-based viewer flow (/api/viewer/validate → JWT cookie),
 * this is an inline resolution: the token is validated on each request with
 * no cookie/JWT involved. This supports direct grant_token links for viewers.
 *
 * Pattern reference: src/lib/auth/viewer.ts (validateShareToken) and
 * src/app/api/viewer/validate/route.ts.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { shareGrants } from "@/db/schema";
import { hashToken } from "./viewer";
import { createViewerContext } from "./request-context";
import type { RequestContext } from "./request-context";

/**
 * Resolve a grant_token query parameter into a viewer RequestContext.
 *
 * Validation flow:
 * 1. Hash the raw token with SHA-256
 * 2. Look up the share_grants row by token hash
 * 3. Check: exists, not revoked, not expired
 * 4. Increment view_count + update last_viewed_at (fire-and-forget)
 * 5. Return a viewer RequestContext with the grant's scoped permissions
 *
 * @param grantToken - The raw grant token string from the query parameter
 * @returns A viewer RequestContext if valid, or null if invalid/expired/revoked.
 */
export async function resolveGrantToken(
  grantToken: string,
): Promise<RequestContext | null> {
  const tokenHash = hashToken(grantToken);

  const results = await db
    .select()
    .from(shareGrants)
    .where(eq(shareGrants.token, tokenHash));

  if (results.length === 0) {
    return null;
  }

  const grant = results[0]!;

  // Check if revoked
  if (grant.revokedAt !== null) {
    return null;
  }

  // Check if expired
  if (grant.grantExpires <= new Date()) {
    return null;
  }

  // Increment view_count + update last_viewed_at (fire-and-forget)
  db.update(shareGrants)
    .set({
      viewCount: sql`${shareGrants.viewCount} + 1`,
      lastViewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(shareGrants.id, grant.id))
    .catch(() => {
      // Non-blocking — best-effort counter update
    });

  // Build a viewer RequestContext
  return createViewerContext(
    grant.id,
    grant.ownerId,
    grant.allowedMetrics as string[],
    grant.dataStart,
    grant.dataEnd,
  );
}
