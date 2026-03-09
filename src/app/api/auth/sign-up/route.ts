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

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  displayName: z.string().min(1).max(100).optional(),
});

/**
 * POST /api/auth/sign-up
 *
 * Mock sign-up route. Accepts { email, password, displayName },
 * creates a user record in the database, and issues a JWT session cookie.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = signUpSchema.safeParse(body);

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

    const { email, displayName } = parsed.data;
    const mockUserId = `mock_${email.replace(/[^a-zA-Z0-9]/g, "_")}`;

    // Check if user already exists
    const existingUsers = await db
      .select()
      .from(users)
      .where(eq(users.id, mockUserId))
      .limit(1);

    if (existingUsers.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "A user with this email already exists",
          },
        },
        { status: 409 },
      );
    }

    // Create user record
    await db.insert(users).values({
      id: mockUserId,
      displayName: displayName ?? email.split("@")[0],
      kmsKeyArn: "local-dev-key",
    });

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

    return NextResponse.json(
      {
        data: {
          userId: mockUserId,
          email,
          displayName: displayName ?? email.split("@")[0],
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Sign-up error:", error);
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
