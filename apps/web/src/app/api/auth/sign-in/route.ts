import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSessionToken,
  SESSION_COOKIE_CONFIG,
} from "@/lib/auth/mock-auth";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/sign-in
 *
 * Mock sign-in route. Accepts { email, password }, looks up user by email.
 * In mock mode, email is used as a lookup key (stored as displayName or
 * we look up by a convention: the user ID is derived from the email).
 *
 * If the user exists, issues a JWT session cookie.
 * If mock mode and user doesn't exist, creates the user automatically.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signInSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: parsed.error.issues,
          },
        },
        { status: 400 },
      );
    }

    const { email } = parsed.data;

    // In mock mode, use email as the lookup key.
    // We look up users by displayName containing the email,
    // or create one if not found.
    const mockUserId = `mock_${email.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, mockUserId))
      .limit(1);

    if (existingUsers.length === 0) {
      // In mock mode, auto-create user on sign-in
      await db.insert(users).values({
        id: mockUserId,
        displayName: email.split("@")[0],
        kmsKeyArn: "local-dev-key",
      });
    }

    // Issue JWT session
    const token = await createSessionToken(mockUserId);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_CONFIG.name, token, {
      httpOnly: SESSION_COOKIE_CONFIG.httpOnly,
      sameSite: SESSION_COOKIE_CONFIG.sameSite,
      path: SESSION_COOKIE_CONFIG.path,
      secure: SESSION_COOKIE_CONFIG.secure,
      maxAge: SESSION_COOKIE_CONFIG.maxAge,
    });

    return NextResponse.json({
      data: {
        userId: mockUserId,
        email,
      },
    });
  } catch (error) {
    console.error("Sign-in error:", error);
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred",
        },
      },
      { status: 500 },
    );
  }
}
