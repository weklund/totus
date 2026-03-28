/**
 * Auto-provision user in the database on first authenticated access.
 *
 * When using Clerk, users are created in Clerk's system but not in our
 * PostgreSQL `users` table. This helper ensures the user row exists,
 * creating it if necessary (idempotent via ON CONFLICT DO NOTHING).
 */

import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Ensure a user row exists in the database for the given userId.
 * Returns the user row (existing or newly created).
 */
export async function ensureUser(
  userId: string,
  displayName?: string,
): Promise<{ id: string; displayName: string | null }> {
  // Check if user already exists (fast path)
  const [existing] = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId));

  if (existing) return existing;

  // Auto-provision: create user row
  const [created] = await db
    .insert(users)
    .values({
      id: userId,
      displayName: displayName ?? userId,
      kmsKeyArn: "local-dev-key",
    })
    .onConflictDoNothing()
    .returning({ id: users.id, displayName: users.displayName });

  // If onConflictDoNothing returned nothing (race condition), re-fetch
  if (!created) {
    const [refetched] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return refetched!;
  }

  return created;
}
