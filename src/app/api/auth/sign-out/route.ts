import { SESSION_COOKIE_CONFIG } from "@/lib/auth/mock-auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * POST /api/auth/sign-out
 *
 * Clears the __session cookie to sign the user out.
 */
export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_CONFIG.name, "", {
    httpOnly: SESSION_COOKIE_CONFIG.httpOnly,
    sameSite: SESSION_COOKIE_CONFIG.sameSite,
    path: SESSION_COOKIE_CONFIG.path,
    secure: SESSION_COOKIE_CONFIG.secure,
    maxAge: 0, // Expire immediately
  });

  return NextResponse.json({ data: { success: true } });
}
