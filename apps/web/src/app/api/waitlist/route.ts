import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { waitlist } from "@/db/schema";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { email, devices } = body as {
      email?: string;
      devices?: string[];
    };

    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }

    const devicesStr =
      Array.isArray(devices) && devices.length > 0 ? devices.join(",") : null;

    await db
      .insert(waitlist)
      .values({ email: email.toLowerCase().trim(), devices: devicesStr })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Waitlist signup failed:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
