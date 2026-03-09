import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * GET /api/auth/session
 *
 * Returns the current session status.
 * Used by MockAuthProvider to check auth state on mount.
 */
export async function GET() {
  const { userId } = await auth();
  return NextResponse.json({ userId });
}
